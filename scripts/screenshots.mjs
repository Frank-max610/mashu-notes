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
const PROFILE_DIR = resolve(tmpdir(), `rixin-chrome-${Date.now()}`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const SHOTS = [
  { file: 'today.png', hash: '#/today', waitFor: '.home-capture', delay: 1000 },
  { file: 'records.png', hash: '#/records', waitFor: '.record-row', delay: 800 },
  {
    file: 'capture.png',
    hash: '#/records',
    waitFor: '.record-row',
    delay: 500,
    action: `(() => {
      document.querySelector('[aria-label="记一笔"]')?.click();
      setTimeout(() => {
        const input = document.querySelector('.capture-sheet__textarea');
        if (!input) return;
        input.focus();
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(input, '午饭牛肉面 32 元，620 大卡');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, 400);
    })()`,
    afterActionWaitFor: '.capture-sheet__parse',
    afterActionDelay: 700,
  },
  { file: 'graph.png', hash: '#/graph', waitFor: '.graph-view canvas', delay: 3000 },
  { file: 'agent.png', hash: '#/agent', waitFor: '.agent-screen', delay: 900 },
  {
    file: 'editor.png',
    hash: '#/note/seed-welcome',
    waitFor: '.editor-screen .markdown-body',
    delay: 700,
  },
  {
    file: 'editor-edit.png',
    hash: '#/note/seed-welcome',
    waitFor: '.editor-screen',
    delay: 500,
    action: `(() => {
      document.querySelector('[aria-label="更多操作"]')?.click();
      setTimeout(() => {
        const item = [...document.querySelectorAll('.sheet-item')].find((el) => el.textContent.includes('编辑正文'));
        item?.click();
      }, 350);
    })()`,
    afterActionWaitFor: '.editor-textarea',
    afterActionDelay: 600,
  },
  {
    file: 'search.png',
    hash: '#/search',
    waitFor: '.search-input',
    delay: 500,
    action: `(() => { const input = document.querySelector('.search-input'); if (!input) return; input.focus(); const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(input, '麻薯'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`,
    afterActionWaitFor: '.record-snippet mark',
    afterActionDelay: 600,
  },
  { file: 'settings.png', hash: '#/settings', waitFor: '.settings-card', delay: 800 },
  {
    file: 'install.png',
    hash: '#/settings',
    waitFor: '.install-card',
    delay: 800,
    ios: true,
    scrollTo: '.install-card',
  },
  {
    file: 'dark-today.png',
    hash: '#/today',
    waitFor: '.home-capture',
    delay: 800,
    theme: 'dark',
  },
  {
    file: 'empty-records.png',
    hash: '#/records',
    waitFor: '.empty',
    delay: 800,
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

    if (shot.ios) {
      await cdp.send('Emulation.setUserAgentOverride', {
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
        platform: 'iPhone',
      });
    }

    // Freeze the clock so seeded demo data and relative timestamps are stable.
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        const RealDate = Date;
        const FIXED = Date.UTC(2026, 10, 3, 13, 0, 0);
        class FrozenDate extends RealDate {
          constructor(...args) { if (args.length === 0) super(FIXED); else super(...args); }
          static now() { return FIXED; }
        }
        window.Date = FrozenDate;
        try {
          Object.defineProperty(navigator, 'storage', {
            configurable: true,
            value: {
              estimate: () => Promise.resolve({ usage: 1600000, quota: 10000000000 }),
              persist: () => Promise.resolve(true),
            },
          });
        } catch (error) { /* ignore */ }
      })()`,
    });

    const url = `${BASE}/${shot.hash}`;
    await cdp.send('Page.navigate', { url });
    await waitForExpression(cdp, 'document.readyState === "complete"', 12000);

    if (shot.theme) {
      await cdp.send('Runtime.evaluate', {
        expression: `localStorage.setItem('mashu.theme.v1', ${JSON.stringify(shot.theme)}); location.reload();`,
      });
      await sleep(500);
      await waitForExpression(cdp, 'document.readyState === "complete"', 12000);
    }

    if (shot.resetVault) {
      // Empty vault + light theme, so the captured empty state is reproducible.
      await cdp.send('Runtime.evaluate', {
        expression: `(async () => {
          localStorage.setItem('mashu.theme.v1', 'light');
          localStorage.setItem('mashu.onboarded.v1', '1');
          localStorage.removeItem('mashu.notes.v1');
          localStorage.removeItem('mochi.notes.v1');
          localStorage.removeItem('inkstone.notes.v1');
          await new Promise((done) => {
            const request = indexedDB.deleteDatabase('mashu');
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

    if (shot.scrollTo) {
      await cdp.send('Runtime.evaluate', {
        expression: `document.querySelector(${JSON.stringify(shot.scrollTo)})?.scrollIntoView({ block: 'center' })`,
      });
      await sleep(500);
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
