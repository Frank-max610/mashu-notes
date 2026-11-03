import { describe, expect, it } from 'vitest';
import {
  allTags,
  backlinkCounts,
  backlinksFor,
  buildTitleIndex,
  extractTags,
  extractWikiLinks,
  maskCode,
  normalizeTitle,
  noteMatches,
  outgoingLinks,
  resolveLink,
} from '../src/lib/links';
import type { Note } from '../src/lib/types';

function makeNote(id: string, title: string, content: string, updatedAt = 1): Note {
  return {
    id,
    title,
    content,
    tags: extractTags(content),
    createdAt: updatedAt,
    updatedAt,
    pinned: false,
    kind: 'note',
    meta: {},
    manualLinks: [],
  };
}

describe('maskCode', () => {
  it('blanks fenced code blocks but keeps newlines', () => {
    const masked = maskCode('a\n```\n[[hidden]]\n```\nb');
    expect(masked).not.toContain('hidden');
    expect(masked.split('\n')).toHaveLength(5);
  });

  it('blanks inline code', () => {
    expect(maskCode('`[[x]]` and #tag')).not.toContain('[[');
  });
});

describe('extractWikiLinks', () => {
  it('parses plain and aliased links', () => {
    const links = extractWikiLinks('See [[Alpha]] and [[Beta|the beta one]].');
    expect(links).toEqual([
      { target: 'Alpha', alias: null },
      { target: 'Beta', alias: 'the beta one' },
    ]);
  });

  it('handles CJK targets', () => {
    expect(extractWikiLinks('去[[欢迎来到 Mochi]]看看')).toEqual([
      { target: '欢迎来到 Mochi', alias: null },
    ]);
  });

  it('ignores links inside code', () => {
    expect(extractWikiLinks('`[[nope]]`')).toEqual([]);
    expect(extractWikiLinks('```\n[[nope]]\n```')).toEqual([]);
  });

  it('trims whitespace and ignores empty targets', () => {
    expect(extractWikiLinks('[[  Alpha  ]]')).toEqual([{ target: 'Alpha', alias: null }]);
    expect(extractWikiLinks('[[]]')).toEqual([]);
  });

  it('treats an empty alias as no alias and never keeps the pipe in the target', () => {
    expect(extractWikiLinks('[[Alpha|]]')).toEqual([{ target: 'Alpha', alias: null }]);
    expect(extractWikiLinks('[[Alpha|甲]]')).toEqual([{ target: 'Alpha', alias: '甲' }]);
  });

  it('ignores wiki links inside an unclosed fence while typing', () => {
    expect(extractWikiLinks('```md\n[[nope]]\n#nope')).toEqual([]);
  });
});

describe('extractTags', () => {
  it('parses tags including CJK, hyphens and slashes', () => {
    expect(extractTags('文字 #写作 与 #移动端 和 #a/b-c')).toEqual(['写作', '移动端', 'a/b-c']);
  });

  it('rejects purely numeric tags', () => {
    expect(extractTags('第 #2026 版')).toEqual([]);
  });

  it('ignores URL fragments and heading markers', () => {
    expect(extractTags('https://example.com/#section')).toEqual([]);
    expect(extractTags('# 标题')).toEqual([]);
    expect(extractTags('## 二级标题')).toEqual([]);
  });

  it('deduplicates case-insensitively', () => {
    expect(extractTags('#Tag #tag #TAG')).toEqual(['Tag']);
  });

  it('ignores tags in code', () => {
    expect(extractTags('`#notatag`')).toEqual([]);
  });
});

describe('title resolution', () => {
  const alpha = makeNote('1', 'Alpha Note', 'body');
  const beta = makeNote('2', 'Beta', 'body');

  it('normalises titles', () => {
    expect(normalizeTitle('  Alpha   Note ')).toBe('alpha note');
  });

  it('resolves case-insensitively and strips .md', () => {
    const index = buildTitleIndex([alpha, beta]);
    expect(resolveLink('alpha note', index)?.id).toBe('1');
    expect(resolveLink('Alpha Note.md', index)?.id).toBe('1');
    expect(resolveLink('missing', index)).toBeUndefined();
  });

  it('lists outgoing links with resolution state', () => {
    const note = makeNote('3', 'Hub', '[[Alpha Note]] [[Ghost]]');
    const links = outgoingLinks(note, [alpha, beta, note]);
    expect(links).toHaveLength(2);
    expect(links[0].note?.id).toBe('1');
    expect(links[1].note).toBeNull();
  });

  it('computes backlinks with counts', () => {
    const source = makeNote('4', 'Source', '[[Alpha Note]] and again [[Alpha Note]]');
    const other = makeNote('5', 'Other', '[[Alpha Note]]');
    const links = backlinksFor(alpha, [alpha, source, other]);
    expect(links.map((link) => link.note.id).sort()).toEqual(['4', '5']);
    expect(links[0].note.id).toBe('4');
    expect(links[0].count).toBe(2);
  });

  it('counts backlinks for the graph', () => {
    const source = makeNote('4', 'Source', '[[Alpha Note]] [[Beta]]');
    const counts = backlinkCounts([alpha, beta, source]);
    expect(counts.get('1')).toBe(1);
    expect(counts.get('2')).toBe(1);
  });
});

describe('tags aggregation', () => {
  it('groups case-insensitively with counts, most used first', () => {
    const notes = [
      makeNote('1', 'A', '#写作 #写作 #功能'),
      makeNote('2', 'B', '#写作 #功能'),
      makeNote('3', 'C', '#写作'),
    ];
    const tags = allTags(notes);
    expect(tags[0]).toMatchObject({ tag: '写作', count: 3 });
    expect(tags[1]).toMatchObject({ tag: '功能', count: 2 });
  });
});

describe('noteMatches', () => {
  const note = makeNote('1', 'Knowledge Graph', '关于双向链接的笔记');
  it('matches title and body case-insensitively', () => {
    expect(noteMatches(note, 'graph')).toBe(true);
    expect(noteMatches(note, '双向')).toBe(true);
    expect(noteMatches(note, 'nope')).toBe(false);
    expect(noteMatches(note, '   ')).toBe(true);
  });
});
