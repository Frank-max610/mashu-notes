import { describe, expect, it } from 'vitest';
import type { Note, NoteKind, NoteMeta } from '../src/lib/types';
import {
  formatSources,
  groundedAnswer,
  isKnowledgeNote,
  isTemplateNote,
  searchKnowledge,
  type KnowledgeHit,
} from '../src/lib/knowledge';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

let counter = 0;

interface NoteInput {
  id?: string;
  title?: string;
  content?: string;
  kind?: NoteKind;
  meta?: NoteMeta;
  tags?: string[];
  /** Sets both `createdAt`/`updatedAt` and (unless overridden) `meta.occurredAt`. */
  ts?: number;
  updatedAt?: number;
  archivedAt?: number;
  dirId?: string;
}

function makeNote(input: NoteInput): Note {
  counter += 1;
  const ts = input.ts ?? new Date(2026, 2, 10, 12, 0).getTime();
  const meta: NoteMeta = { ...input.meta };
  if (meta.occurredAt === undefined && input.ts !== undefined) meta.occurredAt = ts;
  return {
    id: input.id ?? `k-note-${counter}`,
    title: input.title ?? '测试记录',
    content: input.content ?? '',
    tags: input.tags ?? [],
    createdAt: ts,
    updatedAt: input.updatedAt ?? ts,
    pinned: false,
    kind: input.kind ?? 'note',
    meta,
    manualLinks: [],
    archivedAt: input.archivedAt,
    dirId: input.dirId,
  };
}

/** Fixed "now": 2026-03-10 12:30 local (today = 03-10). */
const NOW = new Date(2026, 2, 10, 12, 30);

function at(month: number, day: number, hour: number, minute = 0): number {
  return new Date(2026, month - 1, day, hour, minute).getTime();
}

const WORK_DIR = makeNote({
  id: 'dir-work',
  title: '工作',
  content: '#目录',
  tags: ['目录'],
  meta: { directory: { color: '#65788a' } },
  ts: at(3, 1, 9),
});

const LIFE_DIR = makeNote({
  id: 'dir-life',
  title: '生活',
  content: '#目录',
  tags: ['目录'],
  meta: { directory: { color: '#627a4e' } },
  ts: at(3, 1, 10),
});

const SLEEP_NOTE = makeNote({
  id: 'note-sleep',
  title: '睡眠 7.2 小时',
  content: '昨晚睡得还行。\n\n#健康 #睡眠',
  tags: ['健康', '睡眠'],
  kind: 'health',
  meta: { metric: '睡眠', value: 7.2, unit: '小时' },
  ts: at(3, 10, 7, 30),
});

const STEPS_NOTE = makeNote({
  id: 'note-steps',
  title: '步数 8321 步',
  content: 'Apple 健康 · 步数记录\n\n#健康 #步数',
  tags: ['健康', '步数'],
  kind: 'health',
  meta: { metric: '步数', value: 8321, unit: '步' },
  ts: at(3, 10, 22),
});

const BREAKFAST_NOTE = makeNote({
  id: 'note-breakfast',
  title: '早餐 · 包子',
  content: '早上吃了两个包子。\n\n#饮食 #早餐',
  tags: ['饮食', '早餐'],
  kind: 'food',
  meta: { meal: '早餐', amount: 8, calories: 480, dishes: ['包子'] },
  ts: at(3, 10, 8),
});

const LUNCH_NOTE = makeNote({
  id: 'note-lunch',
  title: '午餐 · 牛肉面',
  content: '午饭牛肉面。\n\n#饮食 #午餐',
  tags: ['饮食', '午餐'],
  kind: 'food',
  meta: { meal: '午餐', amount: 32, calories: 620, dishes: ['牛肉面'] },
  ts: at(3, 10, 12, 10),
});

const TAXI_NOTE = makeNote({
  id: 'note-taxi',
  title: '打车 ¥18',
  content: '下午打车去客户那边。\n\n#理财 #交通',
  tags: ['理财', '交通'],
  kind: 'finance',
  meta: { amount: 18, category: '交通', direction: 'expense' },
  ts: at(3, 10, 15),
});

const INCOME_NOTE = makeNote({
  id: 'note-income',
  title: '工资 ¥8500',
  content: '这个月工资到账。\n\n#理财 #收入',
  tags: ['理财', '收入'],
  kind: 'finance',
  meta: { amount: 8500, category: '收入', direction: 'income' },
  ts: at(3, 10, 9),
});

const DIARY_NOTE = makeNote({
  id: 'note-diary',
  title: '3月10日 · 日记',
  content: '今天有点累，但把知识库目录整理好了。\n\n#日记',
  tags: ['日记'],
  kind: 'diary',
  ts: at(3, 10, 21),
  dirId: 'dir-life',
});

const WEIGHT_NOTE = makeNote({
  id: 'note-weight',
  title: '体重 52.4 kg',
  content: '晨间称重。\n\n#健康 #体重',
  tags: ['健康', '体重'],
  kind: 'health',
  meta: { metric: '体重', value: 52.4, unit: 'kg' },
  ts: at(3, 8, 7),
});

const PROJECT_NOTE = makeNote({
  id: 'note-project',
  title: '项目复盘',
  content: '今天和团队对齐了知识库检索方案，下一步做目录视图。\n\n#复盘 #技术',
  tags: ['复盘', '技术'],
  ts: at(3, 8, 20),
  dirId: 'dir-work',
});

const READING_NOTE = makeNote({
  id: 'note-reading',
  title: '读书笔记：置身事内',
  content: '读到第三章，讲地方政府的财政。\n\n#阅读',
  tags: ['阅读'],
  ts: at(3, 7, 22),
});

const LONG_NOTE = makeNote({
  id: 'note-long',
  title: '长笔记',
  content: `${'一'.repeat(80)}检索方案${'二'.repeat(80)}`,
  ts: at(3, 6, 12),
});

const REACT_NOTE = makeNote({
  id: 'note-react',
  title: 'React Hooks 笔记',
  content: 'useEffect 用来清理副作用。\n\n#技术',
  tags: ['技术'],
  ts: at(3, 8, 21),
});

const TEMPLATE_NOTE = makeNote({
  id: 'note-template',
  title: '模板 · 周复盘',
  content: '本周记录：\n\n#模板 #复盘',
  tags: ['模板', '复盘'],
  ts: at(3, 9, 9),
});

const ARCHIVED_NOTE = makeNote({
  id: 'note-archived',
  title: '旧想法',
  content: '潜水旅行计划。\n\n#旅行',
  tags: ['旅行'],
  ts: at(3, 5, 9),
  archivedAt: at(3, 9, 9),
});

const PLAN_NOTE = makeNote({
  id: 'note-plan',
  title: '读完《置身事内》',
  content: '这周读完前两章。\n\n#计划',
  tags: ['计划'],
  meta: { plan: { status: 'todo' } },
  ts: at(3, 9, 10),
});

const VAULT: Note[] = [
  WORK_DIR,
  LIFE_DIR,
  SLEEP_NOTE,
  STEPS_NOTE,
  BREAKFAST_NOTE,
  LUNCH_NOTE,
  TAXI_NOTE,
  INCOME_NOTE,
  DIARY_NOTE,
  WEIGHT_NOTE,
  PROJECT_NOTE,
  READING_NOTE,
  LONG_NOTE,
  REACT_NOTE,
  TEMPLATE_NOTE,
  ARCHIVED_NOTE,
  PLAN_NOTE,
];

const VAULT_IDS = new Set(VAULT.map((note) => note.id));

function ids(hits: KnowledgeHit[]): string[] {
  return hits.map((hit) => hit.note.id);
}

function findNote(id: string): Note {
  const note = VAULT.find((item) => item.id === id);
  if (!note) throw new Error(`missing fixture note ${id}`);
  return note;
}

/* ------------------------------------------------------------------ */
/* searchKnowledge                                                     */
/* ------------------------------------------------------------------ */

describe('searchKnowledge — retrieval', () => {
  it('finds a Chinese keyword by content and title', () => {
    const hits = searchKnowledge(VAULT, '睡眠');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].note.id).toBe('note-sleep');
    expect(hits[0].score).toBeGreaterThan(0);
    expect(hits[0].excerpt).toContain('睡得');
  });

  it('matches Chinese character bigrams, not only exact words', () => {
    const hits = searchKnowledge(VAULT, '睡得怎么样');
    expect(ids(hits)).toContain('note-sleep');
  });

  it('filters #tag tokens against note tags', () => {
    const hits = searchKnowledge(VAULT, '#阅读');
    expect(ids(hits)).toEqual(['note-reading']);
  });

  it('matches latin words case-insensitively', () => {
    expect(ids(searchKnowledge(VAULT, 'React'))).toEqual(['note-react']);
    expect(ids(searchKnowledge(VAULT, 'useeffect'))).toEqual(['note-react']);
  });

  it('strips question scaffolding so the topic drives the search', () => {
    const hits = searchKnowledge(VAULT, '我记过关于打车的记录吗');
    expect(ids(hits)).toContain('note-taxi');
  });

  it('ranks title matches above content-only matches', () => {
    const hits = searchKnowledge(VAULT, '复盘', 10);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits[0].note.id).toBe('note-project');
    const template = hits.find((hit) => hit.note.id === 'note-template');
    expect(template).toBeDefined();
    expect(template?.score).toBeLessThan(hits[0].score);
  });

  it('never returns directory notes, archived notes or plan items', () => {
    expect(searchKnowledge(VAULT, '工作')).toHaveLength(0);
    expect(searchKnowledge(VAULT, '潜水')).toHaveLength(0);
    expect(searchKnowledge(VAULT, '读完')).toHaveLength(0);
    for (const hit of searchKnowledge(VAULT, '记录', 20)) {
      expect(isKnowledgeNote(hit.note)).toBe(true);
    }
  });

  it('returns an excerpt of about 120 characters around the first match', () => {
    const hit = searchKnowledge(VAULT, '检索方案', 10).find(
      (candidate) => candidate.note.id === 'note-long',
    );
    expect(hit).toBeDefined();
    expect(hit?.excerpt).toContain('检索方案');
    expect(hit?.excerpt.startsWith('…')).toBe(true);
    expect(hit?.excerpt.endsWith('…')).toBe(true);
    expect((hit?.excerpt ?? '').length).toBeLessThanOrEqual(124);
  });

  it('falls back to structured fields when the record body is empty', () => {
    const bare = makeNote({
      id: 'bare-sleep',
      title: '健康记录',
      content: '',
      kind: 'health',
      meta: { metric: '睡眠', value: 6.8, unit: '小时' },
      ts: at(3, 10, 7),
    });
    const hit = searchKnowledge([bare], '睡眠')[0];
    expect(hit.excerpt).toContain('睡眠');
    expect(hit.excerpt).toContain('6.8');
  });

  it('respects the limit and treats zero as empty', () => {
    expect(searchKnowledge(VAULT, '健康', 2)).toHaveLength(2);
    expect(searchKnowledge(VAULT, '健康', 0)).toHaveLength(0);
    expect(searchKnowledge(VAULT, '健康', Number.NaN).length).toBeLessThanOrEqual(3);
  });

  it('returns recent knowledge notes for a blank query', () => {
    const hits = searchKnowledge(VAULT, '   ');
    expect(hits.length).toBe(3);
    expect(hits.every((hit) => hit.score === 0)).toBe(true);
    for (const hit of hits) {
      expect(isKnowledgeNote(hit.note)).toBe(true);
      expect(VAULT_IDS.has(hit.note.id)).toBe(true);
    }
    expect(hits[0].note.id).toBe('note-steps');
  });

  it('is deterministic and does not mutate the vault', () => {
    const snapshot = JSON.stringify(VAULT);
    const first = searchKnowledge(VAULT, '复盘', 5);
    const second = searchKnowledge(VAULT, '复盘', 5);
    expect(ids(first)).toEqual(ids(second));
    expect(first).toEqual(second);
    expect(JSON.stringify(VAULT)).toBe(snapshot);
  });

  it('keeps input order for fully tied hits', () => {
    const a = makeNote({ id: 'tie-a', title: '同题记录', content: '相同内容', ts: at(3, 2, 9) });
    const b = makeNote({ id: 'tie-b', title: '同题记录', content: '相同内容', ts: at(3, 2, 9) });
    const hits = searchKnowledge([a, b], '同题', 5);
    expect(ids(hits)).toEqual(['tie-a', 'tie-b']);
  });
});

/* ------------------------------------------------------------------ */
/* Corpus helpers                                                      */
/* ------------------------------------------------------------------ */

describe('knowledge corpus rules', () => {
  it('treats directory notes as folders, not memories', () => {
    expect(isKnowledgeNote(WORK_DIR)).toBe(false);
    expect(isKnowledgeNote(LIFE_DIR)).toBe(false);
  });

  it('excludes archived notes and plan items', () => {
    expect(isKnowledgeNote(ARCHIVED_NOTE)).toBe(false);
    expect(isKnowledgeNote(PLAN_NOTE)).toBe(false);
    expect(isKnowledgeNote(PROJECT_NOTE)).toBe(true);
  });

  it('detects template notes so they can rank lower', () => {
    expect(isTemplateNote(TEMPLATE_NOTE)).toBe(true);
    expect(isTemplateNote(makeNote({ title: '模板 · 每日日记', tags: [] }))).toBe(true);
    expect(isTemplateNote(PROJECT_NOTE)).toBe(false);
  });

  it('formats sources in Chinese', () => {
    expect(formatSources([])).toBe('');
    expect(
      formatSources([
        { id: 'a', title: '睡眠 7.2 小时' },
        { id: 'b', title: '日记' },
      ]),
    ).toBe('来源：《睡眠 7.2 小时》、《日记》');
  });
});

/* ------------------------------------------------------------------ */
/* groundedAnswer — lookup                                             */
/* ------------------------------------------------------------------ */

function everySourceIsReal(answer: { sources: { id: string; title: string }[] }): void {
  for (const source of answer.sources) {
    expect(VAULT_IDS.has(source.id), `unknown source ${source.id}`).toBe(true);
    expect(findNote(source.id).title).toBe(source.title);
  }
}

function expectNoLeaks(text: string): void {
  expect(text).not.toContain('undefined');
  expect(text).not.toContain('NaN');
  expect(text.trim().length).toBeGreaterThan(0);
}

describe('groundedAnswer — lookup', () => {
  it('answers a lookup question with real notes, quotes and sources', () => {
    const answer = groundedAnswer(VAULT, '我记过关于睡眠的记录吗', NOW);

    expect(answer.grounded).toBe(true);
    expect(answer.sources.map((source) => source.id)).toEqual(['note-sleep']);
    expect(answer.text).toContain('根据你的知识库');
    expect(answer.text).toContain('《睡眠 7.2 小时》');
    expect(answer.text).toContain('来源：');
    everySourceIsReal(answer);
    expectNoLeaks(answer.text);
  });

  it('mentions the containing directory when one exists', () => {
    const answer = groundedAnswer(VAULT, '我记过关于目录整理的内容吗', NOW);
    expect(answer.grounded).toBe(true);
    expect(answer.sources.map((source) => source.id)).toContain('note-diary');
    expect(answer.text).toContain('目录「生活」');
  });

  it('refuses instead of inventing when nothing relevant exists', () => {
    const answer = groundedAnswer(VAULT, '我记过关于潜水的记录吗', NOW);

    expect(answer.grounded).toBe(false);
    expect(answer.usedFallback).toBe(true);
    expect(answer.sources).toEqual([]);
    expect(answer.text).toContain('你的知识库里没有找到与「我记过关于潜水的记录吗」相关的记录');
    expect(answer.text).toContain('经历库');
    expectNoLeaks(answer.text);
  });
});

/* ------------------------------------------------------------------ */
/* groundedAnswer — stats                                              */
/* ------------------------------------------------------------------ */

describe('groundedAnswer — stats', () => {
  it('answers spending with the record count and underlying notes', () => {
    const answer = groundedAnswer(VAULT, '今天花了多少', NOW);

    expect(answer.grounded).toBe(true);
    expect(answer.text).toContain('依据是「你的 4 条记录」');
    expect(answer.text).toContain('今天共支出 ¥58');
    expect(answer.text).toContain('最多的是餐饮（¥40）');
    expect(answer.text).toContain('另有收入 ¥8500');
    expect(answer.sources).toHaveLength(4);
    expect(answer.sources.map((source) => source.id).sort()).toEqual([
      'note-breakfast',
      'note-income',
      'note-lunch',
      'note-taxi',
    ]);
    everySourceIsReal(answer);
    expectNoLeaks(answer.text);
  });

  it('answers a single-day sleep question from the sleep record', () => {
    const answer = groundedAnswer(VAULT, '今天睡眠怎么样', NOW);

    expect(answer.grounded).toBe(true);
    expect(answer.text).toContain('依据是「你的 1 条记录」');
    expect(answer.text).toContain('今天睡眠 7.2 小时');
    expect(answer.sources.map((source) => source.id)).toEqual(['note-sleep']);
  });

  it('counts records and breaks them down by kind', () => {
    const answer = groundedAnswer(VAULT, '今天记了几条', NOW);

    expect(answer.grounded).toBe(true);
    expect(answer.text).toContain('依据是「你的 7 条记录」');
    expect(answer.text).toContain('共记了 7 条');
    expect(answer.text).toContain('饮食 2 条');
    expect(answer.text).toContain('健康 2 条');
    expect(answer.text).toContain('收支 2 笔');
    expect(answer.text).toContain('日记 1 篇');
    expect(answer.sources).toHaveLength(5);
  });

  it('answers plan questions from plan records', () => {
    const answer = groundedAnswer(VAULT, '计划里还有什么', NOW);

    expect(answer.grounded).toBe(true);
    expect(answer.text).toContain('依据是「你的 1 条记录」');
    expect(answer.text).toContain('待办 1 项');
    expect(answer.sources.map((source) => source.id)).toEqual(['note-plan']);
  });

  it('cites the latest weight when today has no weight record', () => {
    const answer = groundedAnswer(VAULT, '今天体重怎么样', NOW);

    expect(answer.grounded).toBe(true);
    expect(answer.text).toContain('今天还没有体重记录');
    expect(answer.text).toContain('最近一次是3月8日');
    expect(answer.text).toContain('52.4 kg');
    expect(answer.sources.map((source) => source.id)).toEqual(['note-weight']);
  });

  it('refuses politely when the window has no matching records', () => {
    const answer = groundedAnswer(VAULT, '昨天花了多少', NOW);

    expect(answer.grounded).toBe(false);
    expect(answer.sources).toEqual([]);
    expect(answer.text).toContain('还没有昨天的支出记录');
    expect(answer.text).toContain('换个时间范围');
    expectNoLeaks(answer.text);
  });
});

/* ------------------------------------------------------------------ */
/* groundedAnswer — reflection, help and fallbacks                     */
/* ------------------------------------------------------------------ */

describe('groundedAnswer — reflection and fallbacks', () => {
  it('derives reflection suggestions from cited records', () => {
    const answer = groundedAnswer(VAULT, '给我一点建议', NOW);

    expect(answer.grounded).toBe(true);
    expect(answer.sources.length).toBeGreaterThanOrEqual(2);
    expect(answer.text).toContain('我翻了你的知识库里最近的');
    expect(answer.text).toContain('下面是从这些记录出发的建议');
    expect(answer.text).toContain('来源：');
    expect(answer.text).not.toContain('保持健康');
    // Every suggestion must reference a real cited record.
    for (const source of answer.sources) {
      expect(answer.text).toContain(`《${source.title}》`);
    }
    everySourceIsReal(answer);
    expectNoLeaks(answer.text);
  });

  it('uses matching records for a topical reflection question', () => {
    const answer = groundedAnswer(VAULT, '关于睡眠给我一点建议', NOW);
    expect(answer.grounded).toBe(true);
    expect(answer.sources.map((source) => source.id)).toContain('note-sleep');
    expect(answer.text).toContain('睡眠');
  });

  it('explains itself for help and blank questions without inventing facts', () => {
    const help = groundedAnswer(VAULT, '你能做什么', NOW);
    expect(help.grounded).toBe(false);
    expect(help.usedFallback).toBe(true);
    expect(help.sources).toEqual([]);
    expect(help.text).toContain('知识库');

    const blank = groundedAnswer(VAULT, '   ', NOW);
    expect(blank.grounded).toBe(false);
    expect(blank.usedFallback).toBe(true);
    expect(blank.sources).toEqual([]);
    expect(blank.text).toContain('知识库');
  });

  it('refuses on an empty vault instead of inventing an answer', () => {
    const answer = groundedAnswer([], '我记过关于睡眠的记录吗', NOW);
    expect(answer.grounded).toBe(false);
    expect(answer.sources).toEqual([]);
    expect(answer.text).toContain('没有找到');
  });

  it('is deterministic given notes and now', () => {
    const queries = ['今天花了多少', '今天睡眠怎么样', '我记过关于打车的记录吗', '给我一点建议'];
    for (const query of queries) {
      const first = groundedAnswer(VAULT, query, NOW);
      const second = groundedAnswer(VAULT, query, NOW);
      const cloned = groundedAnswer(JSON.parse(JSON.stringify(VAULT)) as Note[], query, NOW);
      expect(first).toEqual(second);
      expect(first).toEqual(cloned);
      expectNoLeaks(first.text);
    }
  });

  it('does not mutate the vault', () => {
    const snapshot = JSON.stringify(VAULT);
    groundedAnswer(VAULT, '今天花了多少', NOW);
    groundedAnswer(VAULT, '给我一点建议', NOW);
    groundedAnswer(VAULT, '我记过关于睡眠的记录吗', NOW);
    expect(JSON.stringify(VAULT)).toBe(snapshot);
  });
});
