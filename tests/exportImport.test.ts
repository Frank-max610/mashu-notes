import { describe, expect, it } from 'vitest';
import {
  fileStamp,
  mergeVaultNotes,
  parseVaultJson,
  toMarkdownBundle,
  toVaultJson,
} from '../src/lib/exportImport';
import type { Note } from '../src/lib/types';

const note: Note = {
  id: 'n1',
  title: '测试笔记',
  content: '# 内容\n\n见 [[其他笔记]] #标签',
  tags: ['标签'],
  createdAt: 1,
  updatedAt: 2,
  pinned: true,
  kind: 'food',
  meta: { meal: '午餐', calories: 620, amount: 32 },
  manualLinks: ['other-note'],
  position: { x: 0.4, y: 0.6 },
};

describe('vault JSON round trip', () => {
  it('exports a versioned envelope', () => {
    const parsed = JSON.parse(toVaultJson([note])) as {
      app: string;
      version: number;
      notes: Note[];
    };
    expect(parsed.app).toBe('rixin');
    expect(parsed.version).toBe(2);
    expect(parsed.notes[0].title).toBe('测试笔记');
  });

  it('round trips notes and recomputes tags', () => {
    const restored = parseVaultJson(toVaultJson([note]));
    expect(restored).toHaveLength(1);
    expect(restored[0].id).toBe('n1');
    expect(restored[0].pinned).toBe(true);
    expect(restored[0].tags).toEqual(['标签']);
  });

  it('round trips life-record fields', () => {
    const [restored] = parseVaultJson(toVaultJson([note]));
    expect(restored.kind).toBe('food');
    expect(restored.meta).toEqual({ meal: '午餐', calories: 620, amount: 32 });
    expect(restored.manualLinks).toEqual(['other-note']);
    expect(restored.position).toEqual({ x: 0.4, y: 0.6 });
  });

  it('accepts a v1 backup and defaults the new fields', () => {
    const legacy = JSON.stringify({
      app: 'mochi',
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      notes: [{ id: 'old', title: '旧笔记', content: '内容', tags: [], createdAt: 1, updatedAt: 2, pinned: false }],
    });
    const [restored] = parseVaultJson(legacy);
    expect(restored.kind).toBe('note');
    expect(restored.meta).toEqual({});
    expect(restored.manualLinks).toEqual([]);
  });

  it('accepts a raw note array', () => {
    const restored = parseVaultJson(JSON.stringify([{ title: '裸数组', content: '内容 #x' }]));
    expect(restored).toHaveLength(1);
    expect(restored[0].tags).toEqual(['x']);
    expect(restored[0].id).toBeTruthy();
  });

  it('fills safe defaults for partial notes', () => {
    const [restored] = parseVaultJson(JSON.stringify([{ content: '只有正文' }]));
    expect(restored.title).toBe('未命名笔记');
    expect(typeof restored.createdAt).toBe('number');
  });

  it('rejects invalid JSON with a readable error', () => {
    expect(() => parseVaultJson('not json')).toThrow('不是有效的 JSON 文件。');
  });

  it('rejects files without notes', () => {
    expect(() => parseVaultJson(JSON.stringify({ hello: 'world' }))).toThrow();
    expect(() => parseVaultJson(JSON.stringify({ notes: [] }))).toThrow('没有可导入的笔记');
  });
});

describe('markdown bundle', () => {
  it('includes every note title and content', () => {
    const second: Note = { ...note, id: 'n2', title: '第二条', content: '内容二', tags: [] };
    const bundle = toMarkdownBundle([note, second]);
    expect(bundle).toContain('## 测试笔记');
    expect(bundle).toContain('## 第二条');
    expect(bundle).toContain('见 [[其他笔记]]');
    expect(bundle).toContain('#标签');
  });
});

describe('fileStamp', () => {
  it('is filename safe and sortable', () => {
    const stamp = fileStamp(new Date(2026, 10, 3, 19, 3));
    expect(stamp).toBe('20261103-1903');
  });
});

describe('mergeVaultNotes', () => {
  const existing = (id: string, title: string, updatedAt: number): Note => ({
    id,
    title,
    content: '',
    tags: [],
    createdAt: updatedAt,
    updatedAt,
    pinned: false,
    kind: 'note',
    meta: {},
    manualLinks: [],
  });

  it('never drops local notes that share a title', () => {
    const local = [existing('a', '未命名笔记', 1), existing('b', '未命名笔记', 2), existing('c', '其他', 3)];
    const incoming = [existing('x', '导入的新笔记', 4)];
    const result = mergeVaultNotes(local, incoming);
    expect(result.notes).toHaveLength(4);
    expect(result.added).toBe(1);
    expect(result.notes.filter((note) => note.title === '未命名笔记')).toHaveLength(2);
  });

  it('appends unmatched notes and keeps their ids', () => {
    const local = [existing('a', 'A', 1)];
    const incoming = [existing('n1', 'B', 2), existing('n2', 'C', 3)];
    const result = mergeVaultNotes(local, incoming);
    expect(result.added).toBe(2);
    expect(result.notes.map((note) => note.id)).toEqual(['a', 'n1', 'n2']);
  });

  it('updates the first title match only when the incoming copy is newer', () => {
    const local = [existing('a', 'A', 10)];
    const newer = mergeVaultNotes(local, [existing('a2', 'A', 20)]);
    expect(newer.updated).toBe(1);
    expect(newer.notes).toHaveLength(1);
    expect(newer.notes[0].id).toBe('a2');

    const older = mergeVaultNotes(local, [existing('a3', 'A', 5)]);
    expect(older.updated).toBe(0);
    expect(older.notes[0].id).toBe('a');
  });

  it('matches titles case-insensitively and trims whitespace', () => {
    const local = [existing('a', 'My Note', 1)];
    const result = mergeVaultNotes(local, [existing('b', '  my note ', 9)]);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].id).toBe('b');
  });
});

describe('duplicate ids in an imported file', () => {
  it('regenerates colliding ids instead of losing notes', () => {
    const raw = JSON.stringify([
      { id: 'dup', title: '第一条', content: 'a' },
      { id: 'dup', title: '第二条', content: 'b' },
    ]);
    const notes = parseVaultJson(raw);
    expect(notes).toHaveLength(2);
    expect(new Set(notes.map((note) => note.id)).size).toBe(2);
  });
});
