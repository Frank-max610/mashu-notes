import { describe, expect, it } from 'vitest';
import { searchNotes, searchTitleIndex } from '../src/lib/search';
import type { Note } from '../src/lib/types';

let counter = 0;

function makeNote(overrides: Partial<Note> & { title: string }): Note {
  counter += 1;
  const stamp = 1_700_000_000_000 + counter * 1_000;
  return {
    id: overrides.id ?? `note-${counter}`,
    title: overrides.title,
    content: overrides.content ?? '',
    tags: overrides.tags ?? [],
    createdAt: overrides.createdAt ?? stamp,
    updatedAt: overrides.updatedAt ?? stamp,
    pinned: overrides.pinned ?? false,
  };
}

describe('searchNotes — ranking', () => {
  it('ranks title exact > prefix > contains > body-only', () => {
    const exact = makeNote({ title: 'Alpha' });
    const prefix = makeNote({ title: 'Alpha guide' });
    const contains = makeNote({ title: 'Guide to Alpha' });
    const bodyOnly = makeNote({ title: 'Body only', content: 'The alpha value lives here.' });
    // A bare token must match title/content, so a tag alone does not qualify.
    const tagged = makeNote({ title: 'Tagged only', tags: ['alpha'] });

    const hits = searchNotes([bodyOnly, tagged, contains, prefix, exact], 'alpha');

    expect(hits.map((hit) => hit.title)).toEqual([
      'Alpha',
      'Alpha guide',
      'Guide to Alpha',
      'Body only',
    ]);
    expect(hits.map((hit) => hit.score)).toEqual([1000, 600, 400, 130]);
  });

  it('scores tag-token matches at 200 and adds them to text scores', () => {
    const older = makeNote({ title: 'Older', tags: ['alpha'], updatedAt: 10 });
    const newer = makeNote({ title: 'Newer', tags: ['alpha'], updatedAt: 20 });

    const tagHits = searchNotes([older, newer], '#alpha');
    expect(tagHits.map((hit) => hit.id)).toEqual([newer.id, older.id]);
    expect(tagHits.map((hit) => hit.score)).toEqual([200, 200]);

    const combined = makeNote({ title: 'Alpha', tags: ['alpha'] });
    expect(searchNotes([combined], '#alpha alpha')[0].score).toBe(1200);
  });

  it('adds body occurrence points on top of the title score', () => {
    const one = makeNote({ title: 'Report one', content: 'bug' });
    const five = makeNote({ title: 'Report five', content: 'bug bug bug bug bug' });
    const twelve = makeNote({ title: 'Report twelve', content: 'bug '.repeat(12) });

    const hits = searchNotes([one, five, twelve], 'bug');

    expect(hits.map((hit) => hit.id)).toEqual([twelve.id, five.id, one.id]);
    expect(hits[2].score).toBe(130);
    expect(hits[1].score).toBe(170);
    // 12 occurrences are capped at 10, so the score tops out at 120 + 100.
    expect(hits[0].score).toBe(220);
  });

  it('caps body occurrence scoring at ten matches', () => {
    const ten = makeNote({ title: 'Ten', content: 'bug '.repeat(10), updatedAt: 200 });
    const twelve = makeNote({ title: 'Twelve', content: 'bug '.repeat(12), updatedAt: 100 });

    const hits = searchNotes([ten, twelve], 'bug');

    expect(hits[0].score).toBe(220);
    expect(hits[1].score).toBe(220);
    expect(hits.map((hit) => hit.id)).toEqual([ten.id, twelve.id]);
  });

  it('requires every token to match (AND semantics) across title and body', () => {
    const bothInTitle = makeNote({ title: 'React hooks' });
    const splitAcrossFields = makeNote({ title: 'React notes', content: 'about hooks' });
    const onlyOne = makeNote({ title: 'React only', content: 'nothing else here' });

    const hits = searchNotes([bothInTitle, splitAcrossFields, onlyOne], 'react hooks');

    expect(hits.map((hit) => hit.id)).toEqual([bothInTitle.id, splitAcrossFields.id]);
  });

  it('matches case-insensitively', () => {
    const title = makeNote({ title: 'Alpha' });
    const body = makeNote({ title: 'Other', content: 'Mixed CASE keyword' });

    expect(searchNotes([title], 'ALPHA')).toHaveLength(1);
    expect(searchNotes([title], 'aLpHa')[0].score).toBe(1000);
    expect(searchNotes([body], 'case')).toHaveLength(1);
  });

  it('matches Chinese substrings in titles and bodies', () => {
    const title = makeNote({ title: '读书笔记' });
    const body = makeNote({ title: '日记', content: '今天读了《活着》，很有感触。' });

    const titleHits = searchNotes([title, body], '读书');
    expect(titleHits.map((hit) => hit.id)).toEqual([title.id]);
    expect(titleHits[0].score).toBe(600);

    const bodyHits = searchNotes([title, body], '活着');
    expect(bodyHits).toHaveLength(1);
    expect(bodyHits[0].id).toBe(body.id);
    expect(bodyHits[0].snippet).toContain('活着');
  });
});

describe('searchNotes — #tag filters', () => {
  const work = makeNote({ title: 'Work log', tags: ['work'], content: 'standup notes' });
  const urgent = makeNote({ title: 'Urgent task', tags: ['work', 'urgent'], content: 'deploy' });
  const personal = makeNote({ title: 'Personal', tags: ['life'], content: 'weekend' });
  const notes = [work, urgent, personal];

  it('filters by a single tag token, case-insensitively', () => {
    expect(searchNotes(notes, '#work').map((hit) => hit.id).sort()).toEqual(
      [work.id, urgent.id].sort(),
    );
    expect(searchNotes(notes, '#WORK')).toHaveLength(2);
    expect(searchNotes(notes, '#work #urgent').map((hit) => hit.id)).toEqual([urgent.id]);
  });

  it('intersects multiple tag tokens', () => {
    expect(searchNotes(notes, '#work #life')).toEqual([]);
  });

  it('combines tag filters with ANDed text tokens', () => {
    expect(searchNotes(notes, '#work deploy').map((hit) => hit.id)).toEqual([urgent.id]);
    expect(searchNotes(notes, '#life deploy')).toEqual([]);
  });

  it('tolerates a leading # inside stored tags', () => {
    const stored = makeNote({ title: 'Stored with hash', tags: ['#Work'] });
    expect(searchNotes([stored], '#work')).toHaveLength(1);
    expect(searchNotes([stored], 'work')).toHaveLength(0);
  });
});

describe('searchNotes — snippets', () => {
  it('clips around the first body match with ellipses', () => {
    const content = `${'开头'.repeat(30)}关键内容${'结尾'.repeat(30)}`;
    const note = makeNote({ title: '日志', content });

    const [hit] = searchNotes([note], '关键内容');

    expect(hit.snippet.startsWith('…')).toBe(true);
    expect(hit.snippet.endsWith('…')).toBe(true);
    expect(hit.snippet).toContain('关键内容');
    // 40 chars of context on each side plus the two ellipses.
    expect(hit.snippet.length).toBeLessThanOrEqual(40 + 4 + 40 + 2);
  });

  it('collapses whitespace into a single line', () => {
    const note = makeNote({ title: 'Other', content: 'line one\n\nline   two keyword here' });

    const [hit] = searchNotes([note], 'keyword');

    expect(hit.snippet).toBe('line one line two keyword here');
    expect(hit.snippet).not.toContain('\n');
    expect(hit.snippet).not.toMatch(/ {2}/);
  });

  it('returns an empty snippet for title-only hits', () => {
    const note = makeNote({ title: 'Alpha note', content: 'nothing relevant here' });
    const [hit] = searchNotes([note], 'alpha');
    expect(hit.snippet).toBe('');
  });

  it('returns an empty snippet for tag-only hits', () => {
    const note = makeNote({ title: 'Note', tags: ['alpha'], content: 'body text' });
    const [hit] = searchNotes([note], '#alpha');
    expect(hit.snippet).toBe('');
  });
});

describe('searchNotes — blank query', () => {
  const older = makeNote({ title: 'Older', content: 'old body', updatedAt: 100 });
  const newest = makeNote({ title: 'Newest', content: 'new body', updatedAt: 300 });
  const middle = makeNote({ title: 'Middle', content: 'mid body', updatedAt: 200 });
  const notes = [older, newest, middle];

  it('returns most recently updated notes with excerpt snippets', () => {
    const hits = searchNotes(notes, '');

    expect(hits.map((hit) => hit.title)).toEqual(['Newest', 'Middle', 'Older']);
    expect(hits.every((hit) => hit.score === 0)).toBe(true);
    expect(hits[0].snippet).toBe('new body');
  });

  it('treats a whitespace-only query as blank', () => {
    expect(searchNotes(notes, '   \n\t ').map((hit) => hit.title)).toEqual([
      'Newest',
      'Middle',
      'Older',
    ]);
  });

  it('clips long idle excerpts', () => {
    const long = makeNote({ title: 'Long', content: 'x'.repeat(120), updatedAt: 400 });
    const [hit] = searchNotes([long], '', 1);
    expect(hit.snippet).toHaveLength(61);
    expect(hit.snippet.endsWith('…')).toBe(true);
  });

  it('respects the limit for blank queries', () => {
    expect(searchNotes(notes, '', 2)).toHaveLength(2);
  });
});

describe('searchNotes — limits, stability and misses', () => {
  it('applies the limit after ranking', () => {
    const notes = [
      makeNote({ title: 'Alpha one', updatedAt: 10 }),
      makeNote({ title: 'Alpha two', updatedAt: 20 }),
      makeNote({ title: 'Alpha three', updatedAt: 30 }),
    ];

    const hits = searchNotes(notes, 'alpha', 2);

    expect(hits.map((hit) => hit.title)).toEqual(['Alpha three', 'Alpha two']);
    expect(searchNotes(notes, 'alpha', 0)).toEqual([]);
  });

  it('is stable when scores and timestamps tie', () => {
    const first = makeNote({ title: 'Alpha A', updatedAt: 100 });
    const second = makeNote({ title: 'Alpha B', updatedAt: 100 });

    expect(searchNotes([second, first], 'alpha').map((hit) => hit.id)).toEqual([
      second.id,
      first.id,
    ]);
  });

  it('returns an empty array when nothing matches', () => {
    const notes = [makeNote({ title: 'Alpha' }), makeNote({ title: 'Beta' })];
    expect(searchNotes(notes, 'zeta')).toEqual([]);
    expect(searchNotes(notes, '#missing')).toEqual([]);
    expect(searchNotes([], 'alpha')).toEqual([]);
  });
});

describe('searchTitleIndex', () => {
  it('orders exact then prefix then substring matches, recency inside groups', () => {
    const exact = makeNote({ title: 'Alpha', updatedAt: 10 });
    const prefixOld = makeNote({ title: 'Alpha guide', updatedAt: 20 });
    const prefixNew = makeNote({ title: 'Alpha notes', updatedAt: 90 });
    const containsNewest = makeNote({ title: 'The Alpha chronicles', updatedAt: 999 });
    const unrelated = makeNote({ title: 'Beta', updatedAt: 500 });

    const result = searchTitleIndex([exact, prefixOld, prefixNew, containsNewest, unrelated], 'alpha');

    expect(result.map((note) => note.title)).toEqual([
      'Alpha',
      'Alpha notes',
      'Alpha guide',
      'The Alpha chronicles',
    ]);
  });

  it('matches case-insensitively and applies the limit', () => {
    const notes = Array.from({ length: 10 }, (_, index) =>
      makeNote({ title: `Alpha ${index}`, updatedAt: index }),
    );

    const result = searchTitleIndex(notes, 'ALPHA', 3);

    expect(result.map((note) => note.title)).toEqual(['Alpha 9', 'Alpha 8', 'Alpha 7']);
  });

  it('returns recent notes for a blank query', () => {
    const one = makeNote({ title: 'One', updatedAt: 1 });
    const two = makeNote({ title: 'Two', updatedAt: 3 });
    const three = makeNote({ title: 'Three', updatedAt: 2 });

    const result = searchTitleIndex([one, two, three], '  ');

    expect(result.map((note) => note.title)).toEqual(['Two', 'Three', 'One']);
    expect(result[0]).toMatchObject({ id: two.id, title: 'Two', updatedAt: 3, pinned: false });
    expect(result[0].tags).toEqual([]);
    expect(result[0]).not.toHaveProperty('content');
  });

  it('defaults to eight results for a blank query', () => {
    const notes = Array.from({ length: 10 }, (_, index) =>
      makeNote({ title: `Note ${index}`, updatedAt: index }),
    );

    const result = searchTitleIndex(notes, '');

    expect(result).toHaveLength(8);
    expect(result[0].title).toBe('Note 9');
  });

  it('handles Chinese titles and misses', () => {
    const read = makeNote({ title: '读书笔记', updatedAt: 1 });
    const sorted = makeNote({ title: '笔记整理', updatedAt: 2 });

    expect(searchTitleIndex([read, sorted], '笔记').map((note) => note.title)).toEqual([
      '笔记整理',
      '读书笔记',
    ]);
    expect(searchTitleIndex([read, sorted], '无关')).toEqual([]);
    expect(searchTitleIndex([read, sorted], '笔记', 0)).toEqual([]);
  });
});
