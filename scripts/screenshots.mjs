#!/usr/bin/env node
/**
 * Capture README screenshots with the locally installed Chrome, driving it over
 * the DevTools protocol. No extra dependencies: Node 22+ ships `fetch` and a
 * WebSocket client.
 *
 * Usage:
 *   npm run build && npm run share        # in one terminal
 *   npm run screenshots                   # in another
 *   npm run screenshots -- --base http://127.0.0.1:4173
 *
 * Set CHROME_PATH to point at a different Chrome/Chromium binary.
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const CHROME = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
if (!CHROME) {
  console.error('未找到 Chrome，请设置 CHROME_PATH 指向 Chrome/Chromium 可执行文件。');
  process.exit(1);
}

const args = process.argv.slice(2);
const baseArgIndex = args.findIndex((arg) => arg === '--base' || arg === '-b');
const BASE = (baseArgIndex !== -1 ? args[baseArgIndex + 1] : undefined) ?? 'http://127.0.0.1:4173';
const PORT = 9333;
const OUT_DIR = resolve(process.cwd(), 'docs/screenshots');
const PROFILE_DIR = resolve(tmpdir(), `mochi-chrome-${Date.now()}`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const SHOTS = [
  { file: 'mobile-notes.png', hash: '#/notes', waitFor: '.note-card', delay: 700 },
  { file: 'graph.png', hash: '#/graph', waitFor: '.graph-view canvas', delay: 1400 },
  {
    file: 'editor.png',
    hash: '#/note/seed-welcome',
    waitFor: '.editor-screen .markdown-body',
    delay: 600,
  },
  {
    file: 'editor-edit.png',
    hash: '#/note/seed-welcome',
    waitFor: '.editor-screen',
    delay: 500,
    action: `document.querySelector('[aria-label="切换到编辑"]')?.click()`,
    afterActionWaitFor: '.editor-textarea',
    afterActionDelay: 500,
  },
  {
    file: 'search.png',
    hash: '#/search',
    waitFor: '.search-screen',
    delay: 500,
    action: `(() => { const input = document.querySelector('.search-screen input[type="search"]'); if (!input) return; input.focus(); const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(input, '链接'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`,
    afterActionWaitFor: '.search-screen mark',
    afterActionDelay: 500,
  },
  { file: 'settings.png', hash: '#/settings', waitFor: '.settings-card', delay: 500 },
  {
    file: 'dark-notes.png',
    hash: '#/notes',
    waitFor: '.note-card',
    delay: 700,
    theme: 'dark',
  },
  {
    file: 'empty-notes.png',
    hash: '#/notes',
    waitFor: '.empty',
    delay: 700,
    resetVault: true,
  },
];

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.errors = [];
    this.ready = new Promise((resolveReady, rejectReady) => {
      this.ws.addEventListener('open', () => resolveReady());
      this.ws.addEventListener('error', (event) => rejectReady(event.error ?? new Error('WS error')));
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const { resolve: done, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else done(message.result);
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') {
        this.errors.push(message.params.exceptionDetails?.text ?? 'unknown exception');
      }
      if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
        this.errors.push(message.params.entry.text);
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        this.errors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(' '));
      }
    });
  }

  async connect() {
    await this.ready;
    return this;
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((done, reject) => {
      this.pending.set(id, { resolve: done, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

async function waitForHttp(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      /* retry */
    }
    await sleep(150);
  }
  throw new Error(`等待 ${url} 超时`);
}

async function waitForExpression(cdp, expression, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.result?.value) return true;
    await sleep(120);
  }
  return false;
}

async function newTarget() {
  const response = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
  return response.json();
}

async function closeTarget(id) {
  await fetch(`http://127.0.0.1:${PORT}/json/close/${id}`).catch(() => undefined);
}

async function capture(shot) {
  const target = await newTarget();
  const cdp = await new Cdp(target.webSocketDebuggerUrl).connect();
  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
      screenWidth: 390,
      screenHeight: 844,
    });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

    const url = `${BASE}/${shot.hash}`;
    await cdp.send('Page.navigate', { url });
    await waitForExpression(cdp, 'document.readyState === "complete"', 12000);

    if (shot.theme) {
      await cdp.send('Runtime.evaluate', {
        expression: `localStorage.setItem('mochi.theme.v1', ${JSON.stringify(shot.theme)}); location.reload();`,
      });
      await sleep(500);
      await waitForExpression(cdp, 'document.readyState === "complete"', 12000);
    }

    if (shot.resetVault) {
      // Empty vault + light theme, so the captured empty state is reproducible.
      await cdp.send('Runtime.evaluate', {
        expression: `(async () => {
          localStorage.setItem('mochi.theme.v1', 'light');
          localStorage.setItem('mochi.onboarded.v1', '1');
          localStorage.removeItem('mochi.notes.v1');
          await new Promise((done) => {
            const request = indexedDB.deleteDatabase('mochi');
            request.onsuccess = request.onerror = request.onblocked = () => done();
          });
          location.reload();
        })()`,
        awaitPromise: true,
      });
      await sleep(900);
      await waitForExpression(cdp, 'document.readyState === "complete"', 12000);
    }

    if (shot.waitFor) {
      const ok = await waitForExpression(
        cdp,
        `!!document.querySelector(${JSON.stringify(shot.waitFor)})`,
        12000,
      );
      if (!ok) console.warn(`  ! 等待选择器超时: ${shot.waitFor}`);
    }
    await sleep(shot.delay ?? 400);

    if (shot.action) {
      await cdp.send('Runtime.evaluate', { expression: shot.action });
      if (shot.afterActionWaitFor) {
        await waitForExpression(
          cdp,
          `!!document.querySelector(${JSON.stringify(shot.afterActionWaitFor)})`,
          8000,
        );
      }
      await sleep(shot.afterActionDelay ?? 400);
    }

    // Freeze animations so captures are reproducible (the mascot bobs).
    await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const style = document.createElement('style');
        style.textContent = '*,*::before,*::after{animation-duration:0.001ms !important;animation-delay:0ms !important;animation-iteration-count:1 !important;}';
        document.head.append(style);
      })()`,
    });
    await sleep(120);

    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    const file = resolve(OUT_DIR, shot.file);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, Buffer.from(data, 'base64'));
    console.log(`  ✓ ${shot.file}`);

    if (cdp.errors.length > 0) {
      console.warn(`  ! 页面错误 (${shot.file}):`);
      for (const message of new Set(cdp.errors)) console.warn(`    - ${message}`);
    }
  } finally {
    cdp.close();
    await closeTarget(target.id);
  }
}

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-breakpad',
    '--disable-crash-reporter',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--mute-audio',
    '--remote-allow-origins=*',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let exitCode = 0;
try {
  await waitForHttp(`http://127.0.0.1:${PORT}/json/version`);
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`\n使用 ${CHROME}\n截取 ${BASE} …\n`);
  for (const shot of SHOTS) {
    await capture(shot);
  }
  console.log(`\n截图已写入 ${OUT_DIR}\n`);
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  chrome.kill('SIGTERM');
}
process.exit(exitCode);
