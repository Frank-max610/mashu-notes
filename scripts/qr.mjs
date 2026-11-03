#!/usr/bin/env node
/**
 * Generate a QR code PNG for the current LAN URL, so a phone can open the
 * running app by scanning docs/screenshots/lan-qr.png.
 *
 * Usage: npm run qr [-- --url http://192.168.1.20:4173]
 */
import { networkInterfaces } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import QRCode from 'qrcode';

const args = process.argv.slice(2);
const urlIndex = args.findIndex((arg) => arg === '--url' || arg === '-u');
const portIndex = args.findIndex((arg) => arg === '--port' || arg === '-p');
const port = (portIndex !== -1 ? args[portIndex + 1] : undefined) ?? '4173';

function firstLanAddress() {
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    if (name.startsWith('utun') || name.startsWith('awdl') || name.startsWith('llw')) continue;
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return null;
}

const url =
  (urlIndex !== -1 ? args[urlIndex + 1] : undefined) ??
  (() => {
    const address = firstLanAddress();
    return address ? `http://${address}:${port}` : `http://localhost:${port}`;
  })();

const outDir = resolve(process.cwd(), 'docs/screenshots');
const outFile = resolve(outDir, 'lan-qr.png');
await mkdir(outDir, { recursive: true });
await QRCode.toFile(outFile, url, {
  width: 640,
  margin: 1,
  color: { dark: '#0e0e12ff', light: '#ffffffff' },
});
const ascii = await QRCode.toString(url, { type: 'terminal', small: true });
console.log(`\n  手机访问地址: ${url}\n`);
console.log(ascii);
console.log(`  二维码已保存: ${outFile}\n`);

// Also print the raw URL for copy/paste in the terminal log.
await writeFile(resolve(outDir, 'lan-url.txt'), `${url}\n`, 'utf8');
