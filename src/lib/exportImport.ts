import type { Note } from './types';
import { extractTags } from './links';
import { makeId } from './prefs';

/**
 * Portable vault export/import. JSON is the lossless format; a single Markdown
 * bundle exists for humans and for re-importing into Obsidian-like tools.
 */

export interface VaultFile {
  app: 'inkstone';
  version: 1;
  exportedAt: string;
  notes: Note[];
}

export const VAULT_APP = 'inkstone' as const;
export const VAULT_VERSION = 1 as const;

/** Serialise the whole vault. */
export function toVaultJson(notes: Note[]): string {
  const file: VaultFile = {
    app: VAULT_APP,
    version: VAULT_VERSION,
    exportedAt: new Date().toISOString(),
    notes,
  };
  return JSON.stringify(file, null, 2);
}

function coerceNote(raw: unknown): Note | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const content = typeof value.content === 'string' ? value.content : '';
  const title = typeof value.title === 'string' && value.title.trim() ? value.title.trim() : '未命名笔记';
  const now = Date.now();
  const createdAt = typeof value.createdAt === 'number' ? value.createdAt : now;
  const updatedAt = typeof value.updatedAt === 'number' ? value.updatedAt : createdAt;
  return {
    id: typeof value.id === 'string' && value.id ? value.id : makeId(),
    title,
    content,
    tags: extractTags(content),
    createdAt,
    updatedAt,
    pinned: value.pinned === true,
  };
}

/**
 * Parse an exported JSON file (also accepts a raw note array).
 * Throws a readable error for invalid input.
 */
export function parseVaultJson(text: string): Note[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('不是有效的 JSON 文件。');
  }
  let list: unknown;
  if (Array.isArray(parsed)) {
    list = parsed;
  } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as VaultFile).notes)) {
    list = (parsed as VaultFile).notes;
  } else {
    throw new Error('文件里没有找到笔记数据（缺少 notes 数组）。');
  }
  const notes = (list as unknown[]).map(coerceNote).filter((note): note is Note => note !== null);
  if (notes.length === 0) throw new Error('文件里没有可导入的笔记。');
  return notes;
}

/** Human readable Markdown bundle of the whole vault. */
export function toMarkdownBundle(notes: Note[]): string {
  const exportedAt = new Date().toLocaleString('zh-CN', { hour12: false });
  const header = [
    '# Inkstone 笔记导出',
    '',
    `> 导出时间：${exportedAt}`,
    `> 笔记数量：${notes.length}`,
    '',
    '---',
    '',
  ].join('\n');
  const body = notes
    .map((note) => {
      const tags = note.tags.length ? `\n标签：${note.tags.map((tag) => `#${tag}`).join(' ')}\n` : '';
      return [`## ${note.title}`, tags, note.content.trim(), '', '---', ''].join('\n');
    })
    .join('\n');
  return `${header}${body}`;
}

/** Trigger a browser download for a generated file. */
export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Open the OS file picker and resolve the chosen file's text. */
export function pickTextFile(accept = '.json,.md,.txt,application/json,text/markdown,text/plain'): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    input.style.pointerEvents = 'none';
    document.body.append(input);
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) {
        resolve(null);
        return;
      }
      file
        .text()
        .then(resolve)
        .catch(() => reject(new Error('读取文件失败。')));
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    input.click();
  });
}

/** `20261103-1903` — sortable, filename safe. */
export function fileStamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}
