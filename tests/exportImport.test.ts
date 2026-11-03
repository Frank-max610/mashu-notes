import { describe, expect, it } from 'vitest';
import {
  fileStamp,
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
};

describe('vault JSON round trip', () => {
  it('exports a versioned envelope', () => {
    const parsed = JSON.parse(toVaultJson([note])) as {
      app: string;
      version: number;
      notes: Note[];
    };
    expect(parsed.app).toBe('inkstone');
    expect(parsed.version).toBe(1);
    expect(parsed.notes[0].title).toBe('测试笔记');
  });

  it('round trips notes and recomputes tags', () => {
    const restored = parseVaultJson(toVaultJson([note]));
    expect(restored).toHaveLength(1);
    expect(restored[0].id).toBe('n1');
    expect(restored[0].pinned).toBe(true);
    expect(restored[0].tags).toEqual(['标签']);
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
