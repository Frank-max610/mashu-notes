#!/usr/bin/env node
/**
 * Inject the hashed build assets into the Service Worker precache list.
 *
 * Vite generates hashed file names, so the app shell can only be cached fully
 * after reading the real build output. This runs after `vite build` and rewrites
 * dist/sw.js (public/sw.js stays generic for dev).
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = 'dist';

function walk(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) entries.push(...walk(full));
    else entries.push(full);
  }
  return entries;
}

const files = walk(DIST)
  .filter((file) => !file.endsWith('sw.js'))
  .map((file) => `./${relative(DIST, file).split('\\').join('/')}`)
  .filter((file) => !file.includes('/splash/')) // iOS launch images are fetched by the OS
  .sort((a, b) => a.localeCompare(b));

const swPath = join(DIST, 'sw.js');
const source = readFileSync(swPath, 'utf8');
const marker = /const PRECACHE = \[[^\]]*\];/;
if (!marker.test(source)) {
  console.error('sw-precache: PRECACHE marker not found in dist/sw.js');
  process.exit(1);
}

const replacement = `const PRECACHE = ${JSON.stringify(['./', ...files], null, 2)};`;
writeFileSync(swPath, source.replace(marker, replacement));
console.log(`sw-precache: ${files.length + 1} entries injected`);
