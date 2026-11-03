#!/usr/bin/env node
/**
 * Mochi LAN share server.
 *
 * Serves the production build from ./dist, prints the LAN URL and a QR code so
 * a phone on the same Wi-Fi can open the app immediately.
 *
 * Usage: npm run share [-- --port 4173]
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { networkInterfaces } from 'node:os';
import qrcode from 'qrcode-terminal';

const root = resolve(process.cwd(), 'dist');
const portArgIndex = process.argv.findIndex((arg) => arg === '--port' || arg === '-p');
const port = Number(
  (portArgIndex !== -1 ? process.argv[portArgIndex + 1] : undefined) ?? process.env.PORT ?? 4173,
);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

if (!existsSync(join(root, 'index.html'))) {
  console.error('\n未找到 dist/index.html。\n请先运行 npm run build，再运行 npm run share。\n');
  process.exit(1);
}

function lanAddresses() {
  const addresses = [];
  const interfaces = networkInterfaces();
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      if (name.startsWith('utun') || name.startsWith('awdl') || name.startsWith('llw')) continue;
      addresses.push(entry.address);
    }
  }
  return [...new Set(addresses)];
}

function resolveFile(urlPath) {
  let pathname;
  try {
    pathname = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  const candidate = normalize(join(root, pathname));
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  // SPA fallback: hash routing means unknown paths should still boot the app.
  if (!extname(pathname)) return join(root, 'index.html');
  return null;
}

const server = createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end('Method Not Allowed');
    return;
  }

  const file = resolveFile(request.url ?? '/');
  if (!file) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not Found');
    return;
  }

  const extension = extname(file);
  const isHtml = extension === '.html';
  const headers = {
    'Content-Type': MIME[extension] ?? 'application/octet-stream',
    'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  };

  if (request.method === 'HEAD') {
    response.writeHead(200, headers);
    response.end();
    return;
  }

  response.writeHead(200, headers);
  createReadStream(file).pipe(response);
});

server.listen(port, '0.0.0.0', () => {
  const localUrl = `http://localhost:${port}`;
  const addresses = lanAddresses();
  const lanUrl = addresses.length > 0 ? `http://${addresses[0]}:${port}` : null;

  console.log('');
  console.log('  🍡 Mochi 麻薯已启动');
  console.log('');
  console.log(`  本机访问    ${localUrl}`);
  if (lanUrl) {
    console.log(`  手机访问    ${lanUrl}   （手机与电脑需连接同一 Wi-Fi）`);
  } else {
    console.log('  未检测到局域网 IP，请检查网络连接。');
  }
  console.log('');
  if (lanUrl) {
    console.log('  用手机扫描二维码打开：');
    qrcode.generate(lanUrl, { small: true });
  }
  console.log('  按 Ctrl+C 停止服务。');
  console.log('');
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n端口 ${port} 已被占用，换一个端口：npm run share -- --port 4174\n`);
  } else {
    console.error(error);
  }
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
