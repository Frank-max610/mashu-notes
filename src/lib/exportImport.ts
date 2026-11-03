import type { Note } from './types';
import { normalizeNote } from './prefs';

/**
 * Portable vault export/import. JSON is the lossless format; a single Markdown
 * bundle exists for humans and for re-importing into Obsidian-like tools.
 */

export interface VaultFile {
  app: 'rixin';
  version: 2;
  exportedAt: string;
  notes: Note[];
}

export const VAULT_APP = 'rixin' as const;
/** v2 adds life-record fields (kind/meta/manualLinks/position); v1 is accepted. */
export const VAULT_VERSION = 2 as const;

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
  const seenIds = new Set<string>();
  const notes = (list as unknown[])
    .map((raw) => normalizeNote(raw, seenIds))
    .filter((note): note is Note => note !== null);
  if (notes.length === 0) throw new Error('文件里没有可导入的笔记。');
  return notes;
}

export interface MergeResult {
  notes: Note[];
  /** Notes appended because no title match existed. */
  added: number;
  /** Existing notes replaced by a newer version from the file. */
  updated: number;
}

/**
 * Merge an imported backup into the current vault.
 *
 * Local notes are never dropped: an incoming note only replaces the first
 * existing note with the same title when it is newer; everything else is
 * appended. (Rebuilding the vault through a title-keyed map would silently
 * collapse pre-existing notes that happen to share a title, e.g. two
 * "未命名笔记".)
 */
export function mergeVaultNotes(existing: Note[], incoming: Note[]): MergeResult {
  const keyOf = (note: Note) => note.title.trim().toLowerCase() || note.id;
  const notes = [...existing];
  const indexByTitle = new Map<string, number>();
  notes.forEach((note, index) => {
    const key = keyOf(note);
    if (!indexByTitle.has(key)) indexByTitle.set(key, index);
  });

  let added = 0;
  let updated = 0;
  for (const note of incoming) {
    const key = keyOf(note);
    const index = indexByTitle.get(key);
    if (index === undefined) {
      indexByTitle.set(key, notes.length);
      notes.push(note);
      added += 1;
    } else if (note.updatedAt > notes[index].updatedAt) {
      notes[index] = note;
      updated += 1;
    }
  }

  return { notes, added, updated };
}

/** Human readable Markdown bundle of the whole vault. */
export function toMarkdownBundle(notes: Note[]): string {
  const exportedAt = new Date().toLocaleString('zh-CN', { hour12: false });
  const header = [
    '# 日新 笔记导出',
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

/**
 * Share a generated file through the iOS share sheet (store to Files / iCloud),
 * falling back to a normal download when Web Share files are unavailable.
 */
export async function shareOrDownload(
  filename: string,
  text: string,
  mime = 'application/json',
): Promise<'shared' | 'downloaded'> {
  const navigatorWithShare = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
    share?: (data: ShareData) => Promise<void>;
  };
  try {
    const file = new File([text], filename, { type: `${mime};charset=utf-8` });
    if (navigatorWithShare.share && navigatorWithShare.canShare?.({ files: [file] })) {
      await navigatorWithShare.share({ files: [file], title: filename });
      return 'shared';
    }
  } catch (error) {
    // A user cancelled share sheet is not an error; anything else falls back.
    if ((error as DOMException)?.name === 'AbortError') return 'shared';
  }
  downloadText(filename, text, mime);
  return 'downloaded';
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
