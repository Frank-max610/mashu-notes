import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note, NoteKind, NoteMeta } from '../src/lib/types';
import {
  buildDailyDigest,
  DEFAULT_DIGEST_SCHEDULE,
  DIGEST_HISTORY_KEY,
  DIGEST_HISTORY_MAX,
  DIGEST_SCHEDULE_KEY,
  getDigestSchedule,
  isDigestDue,
  loadDigestHistory,
  saveDigestToHistory,
  setDigestSchedule,
  UNASSIGNED_SECTION_TITLE,
  type DailyDigest,
} from '../src/lib/digest';

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
    id: input.id ?? `d-note-${counter}`,
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

/** `now` = 2026-03-11 08:00 → digest day 03-11, reviewed day 03-10. */
const NOW = new Date(2026, 2, 11, 8, 0);

/** Epoch ms on a fixed March 2026 day. */
function at(day: number, hour: number, minute = 0): number {
  return new Date(2026, 2, day, hour, minute).getTime();
}

const WORK_DIR = makeNote({
  id: 'dir-work',
  title: '工作',
  content: '#目录',
  tags: ['目录'],
  meta: { directory: { color: '#65788a' } },
  ts: at(1, 9),
});

const LIFE_DIR = makeNote({
  id: 'dir-life',
  title: '生活',
  content: '#目录',
  tags: ['目录'],
  meta: { directory: { color: '#627a4e' } },
  ts: at(2, 9),
});

const HISTORY_NOTES: Note[] = [
  // Trailing 7-day baseline used for comparisons (03-03 … 03-09).
  ...[3, 4, 5, 6, 7, 8, 9].map((day) =>
    makeNote({
      id: `hist-spend-${day}`,
      title: `历史支出 ${day}`,
      kind: 'finance',
      content: '',
      meta: { amount: 50, category: '餐饮', direction: 'expense' },
      ts: at(day, 12),
    }),
  ),
  ...[4, 5, 6, 7, 8].map((day) =>
    makeNote({
      id: `hist-sleep-${day}`,
      title: `历史睡眠 ${day}`,
      kind: 'health',
      content: '',
      meta: { metric: '睡眠', value: 7.0, unit: '小时' },
      ts: at(day, 7),
    }),
  ),
];

/** A day with records spread across two directories plus 未分类. */
const YESTERDAY_NOTES: Note[] = [
  makeNote({
    id: 'y-sleep',
    title: '睡眠 7.2 小时',
    content: '昨晚睡得还行。\n\n#健康 #睡眠',
    tags: ['健康', '睡眠'],
    kind: 'health',
    meta: { metric: '睡眠', value: 7.2, unit: '小时' },
    ts: at(10, 7),
    dirId: 'dir-life',
  }),
  makeNote({
    id: 'y-meeting',
    title: '周会记录',
    content: '对齐了本周的三件事。\n\n#工作',
    tags: ['工作'],
    ts: at(10, 10),
    dirId: 'dir-work',
  }),
  makeNote({
    id: 'y-lunch',
    title: '午餐 · 牛肉面',
    content: '午饭牛肉面。\n\n#饮食 #午餐',
    tags: ['饮食', '午餐'],
    kind: 'food',
    meta: { meal: '午餐', amount: 32, calories: 620, dishes: ['牛肉面'] },
    ts: at(10, 12),
    dirId: 'dir-life',
  }),
  makeNote({
    id: 'y-idea',
    title: '随手记',
    content: '地铁上想到一个念头。\n\n#想法',
    tags: ['想法'],
    ts: at(10, 15),
  }),
  makeNote({
    id: 'y-taxi',
    title: '打车 ¥18',
    content: '下午打车去客户那边。\n\n#理财 #交通',
    tags: ['理财', '交通'],
    kind: 'finance',
    meta: { amount: 18, category: '交通', direction: 'expense' },
    ts: at(10, 15, 30),
  }),
  makeNote({
    id: 'y-review',
    title: '项目复盘',
    content: '把目录视图的想法写下来了。\n\n#复盘',
    tags: ['复盘'],
    ts: at(10, 20),
    dirId: 'dir-work',
  }),
];

const RICH_NOTES: Note[] = [
  WORK_DIR,
  LIFE_DIR,
  ...YESTERDAY_NOTES,
  ...HISTORY_NOTES,
  // Records that must NOT enter the digest:
  makeNote({
    id: 'y-archived',
    title: '归档的旧想法',
    content: '旧想法。',
    ts: at(10, 9),
    archivedAt: at(10, 23),
  }),
  makeNote({
    id: 'y-plan',
    title: '读完这本书',
    content: '计划。\n\n#计划',
    tags: ['计划'],
    meta: { plan: { status: 'todo' } },
    ts: at(10, 9),
  }),
  makeNote({
    id: 'y-template',
    title: '模板 · 每日日记',
    content: '#模板',
    tags: ['模板'],
    ts: at(10, 9),
  }),
  makeNote({
    id: 'today-note',
    title: '今天的记录',
    content: '今天早上写的。',
    ts: at(11, 7),
  }),
];

const RICH = buildDailyDigest(RICH_NOTES, NOW);

function collectStrings(digest: DailyDigest): string[] {
  const lines = [digest.summary, ...digest.suggestions];
  for (const section of digest.sections) {
    lines.push(section.title, ...section.highlights);
  }
  return lines;
}

function expectNoLeaks(digest: DailyDigest): void {
  for (const line of collectStrings(digest)) {
    expect(line.trim().length, `empty line in ${JSON.stringify(line)}`).toBeGreaterThan(0);
    expect(line).not.toContain('undefined');
    expect(line).not.toContain('NaN');
    expect(line).not.toContain('[object');
  }
}

/* ------------------------------------------------------------------ */
/* buildDailyDigest                                                    */
/* ------------------------------------------------------------------ */

describe('buildDailyDigest — rich day', () => {
  it('is anchored to today and reviews local yesterday', () => {
    expect(RICH.dateKey).toBe('2026-03-11');
    expect(RICH.generatedAt).toBe(NOW.getTime());
    expect(RICH.sourceIds.length).toBe(6);
    expect(RICH.sourceIds).toEqual([
      'y-sleep',
      'y-meeting',
      'y-lunch',
      'y-idea',
      'y-taxi',
      'y-review',
    ]);
  });

  it('groups records by the user directories, 未分类 last', () => {
    expect(RICH.sections.map((section) => section.title)).toEqual(['工作', '生活', UNASSIGNED_SECTION_TITLE]);
    expect(RICH.sections.map((section) => section.dirId)).toEqual(['dir-work', 'dir-life', null]);
    expect(RICH.sections.map((section) => section.count)).toEqual([2, 2, 2]);
    expect(RICH.sections[0].color).toBe('#65788a');
    expect(RICH.sections[1].color).toBe('#627a4e');
    expect(RICH.sections[2].color).toBeUndefined();
  });

  it('gives every section 2–3 concrete highlights', () => {
    for (const section of RICH.sections) {
      expect(section.highlights.length).toBeGreaterThanOrEqual(2);
      expect(section.highlights.length).toBeLessThanOrEqual(3);
    }

    const work = RICH.sections[0];
    expect(work.highlights[0]).toContain('记了 2 条记录');
    expect(work.highlights[0]).toContain('笔记 2 条');
    expect(work.highlights.some((line) => line.includes('《周会记录》'))).toBe(true);
    expect(work.highlights.some((line) => line.includes('《项目复盘》'))).toBe(true);

    const life = RICH.sections[1];
    expect(life.highlights.some((line) => line.includes('睡眠 7.2 小时'))).toBe(true);
    expect(life.highlights.some((line) => line.includes('支出 ¥32'))).toBe(true);

    const unassigned = RICH.sections[2];
    expect(unassigned.highlights.some((line) => line.includes('¥18'))).toBe(true);
    expect(unassigned.highlights.some((line) => line.includes('《随手记》'))).toBe(true);
  });

  it('writes a one-sentence summary naming directories and facts', () => {
    expect(RICH.summary).not.toContain('\n');
    expect(RICH.summary).toContain('昨天你在知识库里记了 6 条记录');
    expect(RICH.summary).toContain('「工作」「生活」');
    expect(RICH.summary).toContain('另有 2 条未分类');
    expect(RICH.summary).toContain('支出 ¥50');
    expect(RICH.summary).toContain('睡眠 7.2 小时');
    expect(RICH.summary.endsWith('。')).toBe(true);
  });

  it('derives 2–3 concrete suggestions from yesterday, without generic advice', () => {
    expect(RICH.suggestions.length).toBeGreaterThanOrEqual(2);
    expect(RICH.suggestions.length).toBeLessThanOrEqual(3);
    expect(RICH.suggestions[0]).toContain('未分类');
    expect(RICH.suggestions[0]).toContain('《随手记》');
    expect(RICH.suggestions.some((line) => line.includes('「工作」'))).toBe(true);
    expect(RICH.suggestions.some((line) => line.includes('日记'))).toBe(true);
    for (const line of RICH.suggestions) {
      expect(line).not.toBe('保持健康');
      expect(line.length).toBeGreaterThan(8);
    }
  });

  it('only uses real yesterday records as sources', () => {
    const ids = new Set(RICH.sourceIds);
    for (const forbidden of ['y-archived', 'y-plan', 'y-template', 'today-note']) {
      expect(ids.has(forbidden)).toBe(false);
    }
    for (const note of RICH_NOTES) {
      if (ids.has(note.id)) {
        expect(note.archivedAt).toBeUndefined();
        expect(note.meta.plan).toBeUndefined();
        expect(note.tags).not.toContain('模板');
      }
    }
    expect(RICH.sourceIds).toEqual([...new Set(RICH.sourceIds)]);
  });

  it('uses Chinese strings throughout and no development jargon', () => {
    const hasHan = /[\u3400-\u9fff]/;
    for (const line of collectStrings(RICH)) {
      expect(hasHan.test(line), line).toBe(true);
    }
    expectNoLeaks(RICH);
  });

  it('is deterministic and does not mutate the vault', () => {
    const snapshot = JSON.stringify(RICH_NOTES);
    const again = buildDailyDigest(RICH_NOTES, NOW);
    const cloned = buildDailyDigest(JSON.parse(JSON.stringify(RICH_NOTES)) as Note[], NOW);
    expect(again).toEqual(RICH);
    expect(cloned).toEqual(RICH);
    expect(JSON.stringify(RICH_NOTES)).toBe(snapshot);
  });
});

describe('buildDailyDigest — empty and sparse vaults', () => {
  it('builds a gentle digest for an empty vault', () => {
    const digest = buildDailyDigest([], NOW);

    expect(digest.dateKey).toBe('2026-03-11');
    expect(digest.generatedAt).toBe(NOW.getTime());
    expect(digest.sections).toEqual([]);
    expect(digest.sourceIds).toEqual([]);
    expect(digest.summary).toBe('昨天没有记录，今天随手记一笔，明天就能看到按目录整理的摘要。');
    expect(digest.suggestions.length).toBeGreaterThanOrEqual(2);
    expect(digest.suggestions.length).toBeLessThanOrEqual(3);
    expect(digest.suggestions[0]).toContain('记一笔');
    expectNoLeaks(digest);
  });

  it('ignores directories, archives, plans, templates and today’s records', () => {
    const digest = buildDailyDigest(
      RICH_NOTES.filter((note) =>
        ['dir-work', 'y-archived', 'y-plan', 'y-template', 'today-note'].includes(note.id),
      ),
      NOW,
    );

    expect(digest.sections).toEqual([]);
    expect(digest.sourceIds).toEqual([]);
    expect(digest.summary).toContain('昨天没有记录');
  });

  it('puts records without a directory in a single trailing 未分类 section', () => {
    const notes = [
      WORK_DIR,
      makeNote({ id: 'loose-1', title: '散记', content: '随手写。', ts: at(10, 9) }),
      makeNote({
        id: 'loose-2',
        title: '早餐',
        kind: 'food',
        content: '',
        meta: { meal: '早餐', amount: 8, calories: 400 },
        ts: at(10, 8),
      }),
    ];
    const digest = buildDailyDigest(notes, NOW);

    expect(digest.sections).toHaveLength(1);
    expect(digest.sections[0].dirId).toBeNull();
    expect(digest.sections[0].title).toBe(UNASSIGNED_SECTION_TITLE);
    expect(digest.sections[0].count).toBe(2);
    expect(digest.sections[0].highlights.length).toBeGreaterThanOrEqual(2);
    expect(digest.summary).toContain('都还没有归到目录');
    expect(digest.suggestions[0]).toContain('未分类');
  });

  it('omits directories that received no records yesterday', () => {
    const notes = [
      WORK_DIR,
      LIFE_DIR,
      makeNote({ id: 'only-work-1', title: '工作记录', content: '写。', dirId: 'dir-work', ts: at(10, 9) }),
    ];
    const digest = buildDailyDigest(notes, NOW);

    expect(digest.sections).toHaveLength(1);
    expect(digest.sections[0].title).toBe('工作');
    expect(digest.suggestions.join('')).not.toContain('该目录');
  });

  it('respects local day boundaries around midnight', () => {
    const lateRecord = makeNote({
      id: 'late-record',
      title: '深夜记录',
      content: '23:59 写的。',
      ts: new Date(2026, 2, 10, 23, 59).getTime(),
    });
    const afterMidnight = makeNote({
      id: 'after-midnight',
      title: '凌晨记录',
      content: '00:05 写的。',
      ts: new Date(2026, 2, 11, 0, 5).getTime(),
    });
    const digest = buildDailyDigest([lateRecord, afterMidnight], new Date(2026, 2, 11, 0, 10));

    expect(digest.dateKey).toBe('2026-03-11');
    expect(digest.sourceIds).toEqual(['late-record']);
  });
});

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

function dayTimestamp(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day, 8, 0).getTime();
}

function makeDigest(dateKey: string, summary = '摘要'): DailyDigest {
  return {
    dateKey,
    generatedAt: dayTimestamp(dateKey),
    sections: [],
    summary,
    suggestions: ['建议一', '建议二'],
    sourceIds: [],
  };
}

describe('buildDailyDigest — history helpers', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createMemoryStorage();
    vi.stubGlobal('localStorage', storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exposes the documented keys', () => {
    expect(DIGEST_HISTORY_KEY).toBe('mashu.digest.v1');
    expect(DIGEST_HISTORY_MAX).toBe(14);
    expect(DIGEST_SCHEDULE_KEY).toBe('mashu.digest.schedule.v1');
  });

  it('saves a digest and loads it back newest-first', () => {
    const saved = saveDigestToHistory(makeDigest('2026-03-10'));
    expect(saved).toHaveLength(1);
    expect(storage.getItem(DIGEST_HISTORY_KEY)).toBeTruthy();

    const loaded = loadDigestHistory();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].dateKey).toBe('2026-03-10');
  });

  it('dedupes by dateKey, keeping the latest content', () => {
    saveDigestToHistory(makeDigest('2026-03-10', '旧摘要'));
    const list = saveDigestToHistory(makeDigest('2026-03-10', '新摘要'));

    expect(list).toHaveLength(1);
    expect(loadDigestHistory()).toHaveLength(1);
    expect(loadDigestHistory()[0].summary).toBe('新摘要');
  });

  it('keeps at most 14 digests with the newest dates', () => {
    for (let day = 1; day <= 16; day += 1) {
      saveDigestToHistory(makeDigest(`2026-03-${String(day).padStart(2, '0')}`));
    }

    const history = loadDigestHistory();
    expect(history).toHaveLength(DIGEST_HISTORY_MAX);
    expect(history[0].dateKey).toBe('2026-03-16');
    expect(history[history.length - 1].dateKey).toBe('2026-03-03');
    expect(new Set(history.map((digest) => digest.dateKey)).size).toBe(DIGEST_HISTORY_MAX);
  });

  it('never stores more than 14 even with a larger max argument', () => {
    for (let day = 1; day <= 16; day += 1) {
      saveDigestToHistory(makeDigest(`2026-04-${String(day).padStart(2, '0')}`), 30);
    }
    expect(loadDigestHistory()).toHaveLength(DIGEST_HISTORY_MAX);
  });

  it('ignores corrupted or malformed storage', () => {
    storage.setItem(DIGEST_HISTORY_KEY, '{not json');
    expect(loadDigestHistory()).toEqual([]);

    storage.setItem(DIGEST_HISTORY_KEY, JSON.stringify({ dateKey: '2026-03-10' }));
    expect(loadDigestHistory()).toEqual([]);

    storage.setItem(
      DIGEST_HISTORY_KEY,
      JSON.stringify([
        { dateKey: 'not-a-day', summary: '坏数据' },
        { dateKey: '2026-03-10' },
        makeDigest('2026-03-09'),
      ]),
    );
    const history = loadDigestHistory();
    expect(history).toHaveLength(1);
    expect(history[0].dateKey).toBe('2026-03-09');
  });

  it('dedupes duplicated dateKeys already present in storage', () => {
    storage.setItem(
      DIGEST_HISTORY_KEY,
      JSON.stringify([makeDigest('2026-03-10', '旧的'), makeDigest('2026-03-10', '新的')]),
    );
    const history = loadDigestHistory();
    expect(history).toHaveLength(1);
    expect(history[0].summary).toBe('新的');
  });

  it('works without localStorage (private mode / tests)', () => {
    vi.unstubAllGlobals();
    expect(loadDigestHistory()).toEqual([]);
    expect(() => saveDigestToHistory(makeDigest('2026-03-10'))).not.toThrow();
    expect(saveDigestToHistory(makeDigest('2026-03-10'))).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* isDigestDue                                                         */
/* ------------------------------------------------------------------ */

describe('isDigestDue', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createMemoryStorage();
    vi.stubGlobal('localStorage', storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is due once the clock reaches the scheduled HH:mm', () => {
    expect(isDigestDue(new Date(2026, 2, 11, 7, 59), '08:00')).toBe(false);
    expect(isDigestDue(new Date(2026, 2, 11, 8, 0), '08:00')).toBe(true);
    expect(isDigestDue(new Date(2026, 2, 11, 8, 0, 30), '08:00')).toBe(true);
    expect(isDigestDue(new Date(2026, 2, 11, 23, 59), '08:00')).toBe(true);
  });

  it('is due at midnight for a 00:00 schedule', () => {
    expect(isDigestDue(new Date(2026, 2, 11, 0, 0), '00:00')).toBe(true);
    expect(isDigestDue(new Date(2026, 2, 11, 0, 1), '00:00')).toBe(true);
  });

  it('accepts a single-digit hour', () => {
    expect(isDigestDue(new Date(2026, 2, 11, 7, 5), '7:05')).toBe(true);
    expect(isDigestDue(new Date(2026, 2, 11, 7, 4), '7:05')).toBe(false);
  });

  it('is not due again once today already has a digest', () => {
    saveDigestToHistory(makeDigest('2026-03-11'));
    expect(isDigestDue(new Date(2026, 2, 11, 8, 0), '08:00')).toBe(false);
    expect(isDigestDue(new Date(2026, 2, 11, 23, 0), '08:00')).toBe(false);
  });

  it('ignores digests from previous days', () => {
    saveDigestToHistory(makeDigest('2026-03-10'));
    expect(isDigestDue(new Date(2026, 2, 11, 8, 0), '08:00')).toBe(true);
  });

  it('treats invalid times as not due instead of firing constantly', () => {
    expect(isDigestDue(new Date(2026, 2, 11, 12, 0), '8点')).toBe(false);
    expect(isDigestDue(new Date(2026, 2, 11, 12, 0), '25:00')).toBe(false);
    expect(isDigestDue(new Date(2026, 2, 11, 12, 0), '08:60')).toBe(false);
    expect(isDigestDue(new Date(2026, 2, 11, 12, 0), '')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Schedule                                                            */
/* ------------------------------------------------------------------ */

describe('digest schedule preferences', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to a daily 08:00 digest', () => {
    expect(getDigestSchedule()).toEqual(DEFAULT_DIGEST_SCHEDULE);
    expect(DEFAULT_DIGEST_SCHEDULE).toEqual({ enabled: true, time: '08:00' });
  });

  it('persists enabled and time under the schedule key', () => {
    const next = setDigestSchedule({ time: '21:30' });
    expect(next).toEqual({ enabled: true, time: '21:30' });
    expect(getDigestSchedule()).toEqual({ enabled: true, time: '21:30' });

    const raw = globalThis.localStorage.getItem(DIGEST_SCHEDULE_KEY);
    expect(raw).toBe(JSON.stringify({ enabled: true, time: '21:30' }));
  });

  it('merges partial updates and normalises the time', () => {
    setDigestSchedule({ time: '21:30' });
    expect(setDigestSchedule({ enabled: false })).toEqual({ enabled: false, time: '21:30' });
    expect(setDigestSchedule({ time: '7:05' })).toEqual({ enabled: false, time: '07:05' });
  });

  it('ignores invalid times instead of corrupting the schedule', () => {
    setDigestSchedule({ time: '21:30' });
    expect(setDigestSchedule({ time: '25:00' })).toEqual({ enabled: true, time: '21:30' });
    expect(setDigestSchedule({ time: '晚上' })).toEqual({ enabled: true, time: '21:30' });
  });

  it('recovers from corrupted stored preferences', () => {
    const storage = globalThis.localStorage;
    storage.setItem(DIGEST_SCHEDULE_KEY, 'oops');
    expect(getDigestSchedule()).toEqual(DEFAULT_DIGEST_SCHEDULE);

    storage.setItem(DIGEST_SCHEDULE_KEY, JSON.stringify({ enabled: false, time: '99:99' }));
    expect(getDigestSchedule()).toEqual({ enabled: false, time: DEFAULT_DIGEST_SCHEDULE.time });
  });

  it('works without localStorage', () => {
    vi.unstubAllGlobals();
    expect(getDigestSchedule()).toEqual(DEFAULT_DIGEST_SCHEDULE);
    expect(() => setDigestSchedule({ enabled: false })).not.toThrow();
    expect(setDigestSchedule({ enabled: false })).toEqual({ enabled: false, time: '08:00' });
  });
});
