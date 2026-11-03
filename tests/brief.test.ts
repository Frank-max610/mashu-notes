import { describe, expect, it } from 'vitest';
import type { Note, NoteKind, NoteMeta } from '../src/lib/types';
import { buildDailyBrief, type DailyBrief } from '../src/lib/brief';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

let counter = 0;

interface NoteInput {
  id?: string;
  title?: string;
  kind?: NoteKind;
  meta?: NoteMeta;
  /** Sets both `createdAt` and `meta.occurredAt`. */
  ts?: number;
}

function makeNote(input: NoteInput): Note {
  counter += 1;
  const createdAt = input.ts ?? new Date(2026, 2, 10, 12, 0).getTime();
  const meta: NoteMeta = { ...input.meta };
  if (input.ts !== undefined) meta.occurredAt = input.ts;
  return {
    id: input.id ?? `brief-note-${counter}`,
    title: input.title ?? '测试记录',
    content: '',
    tags: [],
    createdAt,
    updatedAt: createdAt,
    pinned: false,
    kind: input.kind ?? 'note',
    meta,
    manualLinks: [],
  };
}

/** `now` is fixed: today 2026-03-11, yesterday 2026-03-10. */
const NOW = new Date(2026, 2, 11, 8, 0);
const YESTERDAY = new Date(2026, 2, 10);

function at(base: Date, days: number, hour: number, minute = 0): number {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days, hour, minute).getTime();
}

/** Day `offset` relative to yesterday (negative = earlier history). */
function hist(offset: number, hour = 12): number {
  return at(YESTERDAY, offset, hour);
}

const YESTERDAY_AT = (hour: number, minute = 0): number => at(YESTERDAY, 0, hour, minute);

/* ------------------------------------------------------------------ */
/* Rich day + history                                                  */
/* ------------------------------------------------------------------ */

const richNotes: Note[] = [
  // ---- yesterday: 9 life records ----
  makeNote({ kind: 'food', title: '早餐', meta: { meal: '早餐', amount: 8, calories: 480 }, ts: YESTERDAY_AT(8) }),
  makeNote({ kind: 'food', title: '午餐', meta: { meal: '午餐', amount: 32, calories: 620 }, ts: YESTERDAY_AT(12) }),
  makeNote({ kind: 'food', title: '晚餐', meta: { meal: '晚餐', amount: 40, calories: 900 }, ts: YESTERDAY_AT(19) }),
  makeNote({
    kind: 'finance',
    title: '咖啡 ¥20',
    meta: { amount: 20, category: '餐饮', direction: 'expense' },
    ts: YESTERDAY_AT(15),
  }),
  makeNote({
    kind: 'finance',
    title: '收入 ¥8500',
    meta: { amount: 8500, category: '收入', direction: 'income' },
    ts: YESTERDAY_AT(9),
  }),
  makeNote({ kind: 'health', title: '睡眠 8.1 小时', meta: { metric: '睡眠', value: 8.1, unit: '小时' }, ts: YESTERDAY_AT(7) }),
  makeNote({ kind: 'health', title: '步数 9200 步', meta: { metric: '步数', value: 9200, unit: '步' }, ts: YESTERDAY_AT(19) }),
  makeNote({ kind: 'health', title: '饮水 1800 ml', meta: { metric: '饮水', value: 1800, unit: 'ml' }, ts: YESTERDAY_AT(17) }),
  makeNote({ kind: 'diary', title: '3月10日 · 日记', ts: YESTERDAY_AT(21) }),

  // ---- history (03-03 … 03-09): spend avg 50, calories avg 1500,
  //      sleep avg 7.0, steps avg 6000, water avg 2000 ----
  makeNote({ kind: 'finance', meta: { amount: 50, category: '餐饮', direction: 'expense' }, ts: hist(-7) }),
  makeNote({ kind: 'food', meta: { amount: 0, calories: 1500 }, ts: hist(-6), title: '历史饮食' }),
  makeNote({ kind: 'health', meta: { metric: '步数', value: 6000 }, ts: hist(-6, 19) }),
  makeNote({ kind: 'health', meta: { metric: '饮水', value: 2000 }, ts: hist(-6, 17) }),
  makeNote({ kind: 'finance', meta: { amount: 50, category: '餐饮', direction: 'expense' }, ts: hist(-5) }),
  makeNote({ kind: 'health', meta: { metric: '睡眠', value: 7.0 }, ts: hist(-5, 7) }),
  makeNote({ kind: 'food', meta: { amount: 0, calories: 1500 }, ts: hist(-4), title: '历史饮食' }),
  makeNote({ kind: 'health', meta: { metric: '饮水', value: 2000 }, ts: hist(-4, 17) }),
  makeNote({ kind: 'health', meta: { metric: '睡眠', value: 7.0 }, ts: hist(-3, 7) }),
  makeNote({ kind: 'health', meta: { metric: '步数', value: 6000 }, ts: hist(-2, 19) }),
];

const richBrief: DailyBrief = buildDailyBrief(richNotes, NOW);

/* ------------------------------------------------------------------ */
/* Shared assertions                                                   */
/* ------------------------------------------------------------------ */

function collectStrings(brief: DailyBrief): string[] {
  const lines = [brief.summary, ...brief.review, ...brief.suggestions];
  for (const trend of brief.trends) {
    lines.push(trend.label, trend.value);
    if (trend.detail) lines.push(trend.detail);
  }
  return lines;
}

function expectNoLeaks(brief: DailyBrief): void {
  for (const line of collectStrings(brief)) {
    expect(line.trim().length).toBeGreaterThan(0);
    expect(line).not.toContain('undefined');
    expect(line).not.toContain('NaN');
  }
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('buildDailyBrief — date keys', () => {
  it('reports today and yesterday in local calendar days', () => {
    expect(richBrief.dateKey).toBe('2026-03-11');
    expect(richBrief.yesterdayKey).toBe('2026-03-10');
  });

  it('keeps local day boundaries late at night and just after midnight', () => {
    const lateNight = buildDailyBrief(richNotes, new Date(2026, 2, 11, 23, 59));
    expect(lateNight.dateKey).toBe('2026-03-11');
    expect(lateNight.yesterdayKey).toBe('2026-03-10');

    const midnight = buildDailyBrief(richNotes, new Date(2026, 2, 12, 0, 0));
    expect(midnight.dateKey).toBe('2026-03-12');
    expect(midnight.yesterdayKey).toBe('2026-03-11');
  });

  it('builds an empty brief for a day with no notes at all', () => {
    expect(buildDailyBrief([], NOW).yesterdayKey).toBe('2026-03-10');
  });
});

describe('buildDailyBrief — rich day', () => {
  it('writes a factual one-line headline', () => {
    expect(richBrief.summary).toBe('昨天记了 9 条，睡得比平均多 1.1 小时。');
    expect(richBrief.summary).not.toContain('\n');
  });

  it('produces 2–4 review bullets covering counts, money, calories and sleep', () => {
    expect(richBrief.review.length).toBeGreaterThanOrEqual(2);
    expect(richBrief.review.length).toBeLessThanOrEqual(4);
    expect(richBrief.review[0]).toContain('昨天记了 9 条记录');
    expect(richBrief.review[0]).toContain('饮食 3 条');
    expect(richBrief.review[0]).toContain('日记 1 篇');
    expect(richBrief.review.some((line) => line.includes('支出 ¥100'))).toBe(true);
    expect(richBrief.review.some((line) => line.includes('超支'))).toBe(true);
    expect(richBrief.review.some((line) => line.includes('2000 kcal'))).toBe(true);
    expect(richBrief.review.some((line) => line.includes('睡眠 8.1 小时'))).toBe(true);
    expect(richBrief.review.some((line) => line.includes('比 7 日均值多 1.1 小时'))).toBe(true);
  });

  it('derives specific, non-generic suggestions from the deviations', () => {
    expect(richBrief.suggestions.length).toBeGreaterThanOrEqual(2);
    expect(richBrief.suggestions.length).toBeLessThanOrEqual(3);
    expect(richBrief.suggestions.some((line) => line.includes('支出控制在 ¥50 左右'))).toBe(true);
    expect(richBrief.suggestions.some((line) => line.includes('晚餐清淡'))).toBe(true);
    for (const line of richBrief.suggestions) {
      expect(line).not.toBe('保持健康');
      expect(line.length).toBeGreaterThan(6);
    }
  });

  it('returns four dashboard trends with values, details and tones', () => {
    expect(richBrief.trends.map((trend) => trend.label)).toEqual(['支出', '摄入', '睡眠', '记录']);
    expect(richBrief.trends[0]).toMatchObject({ value: '¥100', detail: '比 7 日均值多 100%', tone: 'warn' });
    expect(richBrief.trends[1]).toMatchObject({ value: '2000 kcal', detail: '比 7 日均值多 33%', tone: 'warn' });
    expect(richBrief.trends[2]).toMatchObject({ value: '8.1 小时', detail: '比 7 日均值多 1.1 小时', tone: 'good' });
    expect(richBrief.trends[3]).toMatchObject({ value: '9 条', detail: '比 7 日均值多 7.3 条', tone: 'good' });
    for (const trend of richBrief.trends) {
      expect(['good', 'warn', 'neutral']).toContain(trend.tone);
      expect(trend.detail).toBeTruthy();
    }
  });
});

describe('buildDailyBrief — empty and note-only vaults', () => {
  it('phrases a completely empty vault neutrally', () => {
    const brief = buildDailyBrief([], NOW);

    expect(brief.summary).toBe('昨天没有记录。');
    expect(brief.review).toHaveLength(2);
    expect(brief.review[0]).toBe('昨天没有记录。');
    expect(brief.review[1]).toBe('近 7 天还没有可对比的记录。');
    expect(brief.suggestions.length).toBeGreaterThanOrEqual(2);
    expect(brief.suggestions.length).toBeLessThanOrEqual(3);
    expect(brief.suggestions[0]).toContain('记一笔');
    expect(brief.trends).toHaveLength(4);
    expect(brief.trends.map((trend) => trend.value)).toEqual(['¥0', '0 kcal', '—', '0 条']);
    expect(brief.trends.every((trend) => trend.tone === 'neutral')).toBe(true);
    expectNoLeaks(brief);
  });

  it('treats plain Markdown notes as notes, not life records', () => {
    const notes: Note[] = [
      makeNote({ kind: 'note', title: '项目想法', ts: YESTERDAY_AT(10) }),
      makeNote({ kind: 'note', title: '读书笔记', ts: YESTERDAY_AT(21) }),
      makeNote({ kind: 'note', title: '上周的旧笔记', ts: hist(-7) }),
    ];
    const brief = buildDailyBrief(notes, NOW);

    expect(brief.summary).toBe('昨天没有记录。');
    expect(brief.review[0]).toBe('昨天没有记录。');
    expect(brief.review[1]).toBe('写了 2 条普通笔记。');
    expect(brief.review[2]).toBe('近 7 天还没有可对比的记录。');
    expect(brief.review.length).toBeLessThanOrEqual(4);
    expect(brief.trends[3].value).toBe('0 条');
    expect(brief.suggestions.length).toBeGreaterThanOrEqual(2);
    expectNoLeaks(brief);
  });
});

describe('buildDailyBrief — deviations', () => {
  it('flags a spending spike and suggests a concrete budget', () => {
    const notes: Note[] = [
      makeNote({ kind: 'finance', meta: { amount: 50, direction: 'expense' }, ts: hist(-7) }),
      makeNote({ kind: 'finance', meta: { amount: 50, direction: 'expense' }, ts: hist(-5) }),
      makeNote({ kind: 'food', meta: { amount: 120 }, ts: YESTERDAY_AT(12) }),
      makeNote({ kind: 'diary', ts: YESTERDAY_AT(22) }),
    ];
    const brief = buildDailyBrief(notes, NOW);

    expect(brief.review.some((line) => line.includes('支出 ¥120'))).toBe(true);
    expect(brief.review.some((line) => line.includes('超支'))).toBe(true);
    expect(brief.trends[0].tone).toBe('warn');
    expect(brief.suggestions[0]).toContain('支出控制在 ¥50 左右');
    expectNoLeaks(brief);
  });

  it('suggests going to bed 30 minutes earlier after a short night', () => {
    const notes: Note[] = [
      makeNote({ kind: 'health', meta: { metric: '睡眠', value: 7.0 }, ts: hist(-5) }),
      makeNote({ kind: 'health', meta: { metric: '睡眠', value: 7.0 }, ts: hist(-3) }),
      makeNote({ kind: 'health', meta: { metric: '睡眠', value: 6.2 }, ts: YESTERDAY_AT(7) }),
      makeNote({ kind: 'diary', ts: YESTERDAY_AT(22) }),
    ];
    const brief = buildDailyBrief(notes, NOW);

    expect(brief.summary).toBe('昨天记了 2 条，睡得比平均少 0.8 小时。');
    expect(brief.review.some((line) => line.includes('睡眠 6.2 小时'))).toBe(true);
    expect(brief.trends[2].tone).toBe('warn');
    expect(brief.trends[2].detail).toBe('比 7 日均值少 0.8 小时');
    expect(brief.suggestions.some((line) => line.includes('提前 30 分钟'))).toBe(true);
    expectNoLeaks(brief);
  });

  it('suggests a short walk when steps are low', () => {
    const notes: Note[] = [
      makeNote({ kind: 'health', meta: { metric: '步数', value: 7000 }, ts: hist(-6, 19) }),
      makeNote({ kind: 'health', meta: { metric: '步数', value: 7000 }, ts: hist(-2, 19) }),
      makeNote({ kind: 'health', meta: { metric: '步数', value: 3200 }, ts: YESTERDAY_AT(19) }),
      makeNote({ kind: 'diary', ts: YESTERDAY_AT(22) }),
    ];
    const brief = buildDailyBrief(notes, NOW);

    expect(brief.review.some((line) => line.includes('走了 3200 步'))).toBe(true);
    expect(brief.review.some((line) => line.includes('比 7 日均值少 3800 步'))).toBe(true);
    expect(brief.suggestions[0]).toContain('走一走');
    expectNoLeaks(brief);
  });

  it('suggests an evening review when the day has no diary', () => {
    const notes: Note[] = [
      makeNote({ kind: 'food', meta: { amount: 0, calories: 1500 }, ts: hist(-6) }),
      makeNote({ kind: 'health', meta: { metric: '睡眠', value: 7.0 }, ts: hist(-5, 7) }),
      makeNote({ kind: 'health', meta: { metric: '步数', value: 6000 }, ts: hist(-2, 19) }),
      makeNote({ kind: 'health', meta: { metric: '饮水', value: 2000 }, ts: hist(-4, 17) }),
      makeNote({ kind: 'food', meta: { amount: 30, calories: 600 }, ts: YESTERDAY_AT(12) }),
      makeNote({ kind: 'health', meta: { metric: '睡眠', value: 7.2 }, ts: YESTERDAY_AT(7) }),
      makeNote({ kind: 'health', meta: { metric: '步数', value: 9000 }, ts: YESTERDAY_AT(19) }),
      makeNote({ kind: 'health', meta: { metric: '饮水', value: 1800 }, ts: YESTERDAY_AT(17) }),
    ];
    const brief = buildDailyBrief(notes, NOW);

    expect(brief.suggestions[0]).toContain('复盘');
    expect(brief.suggestions.some((line) => line.includes('走够了步数'))).toBe(true);
    expectNoLeaks(brief);
  });

  it('suggests drinking more water below 1500 ml', () => {
    const notes: Note[] = [
      makeNote({ kind: 'health', meta: { metric: '饮水', value: 1800 }, ts: hist(-4, 17) }),
      makeNote({ kind: 'health', meta: { metric: '饮水', value: 1800 }, ts: hist(-2, 17) }),
      makeNote({ kind: 'health', meta: { metric: '饮水', value: 1200 }, ts: YESTERDAY_AT(17) }),
      makeNote({ kind: 'diary', ts: YESTERDAY_AT(22) }),
    ];
    const brief = buildDailyBrief(notes, NOW);

    expect(brief.suggestions[0]).toContain('喝够 1500 ml');
    expectNoLeaks(brief);
  });
});

describe('buildDailyBrief — no history', () => {
  it('stays neutral when there is nothing to compare against', () => {
    const notes: Note[] = [
      makeNote({ kind: 'food', meta: { amount: 30, calories: 600 }, ts: YESTERDAY_AT(12) }),
      makeNote({ kind: 'health', meta: { metric: '睡眠', value: 7.2 }, ts: YESTERDAY_AT(7) }),
      makeNote({ kind: 'diary', ts: YESTERDAY_AT(22) }),
    ];
    const brief = buildDailyBrief(notes, NOW);

    expect(brief.summary).toBe('昨天记了 3 条，睡了 7.2 小时。');
    expect(brief.review).toContain('支出 ¥30。');
    expect(brief.review.some((line) => line === '睡眠 7.2 小时。')).toBe(true);
    expect(brief.review.some((line) => line.includes('比 7 日均值'))).toBe(false);
    expect(brief.trends[0].detail).toBe('近 7 天没有支出记录');
    expect(brief.trends[2].detail).toBe('近 7 天没有睡眠记录');
    expect(brief.trends[2].tone).toBe('neutral');
    expectNoLeaks(brief);
  });
});

describe('buildDailyBrief — determinism and output shape', () => {
  it('is a pure deterministic function', () => {
    const first = buildDailyBrief(richNotes, NOW);
    const second = buildDailyBrief(richNotes, NOW);
    const cloned = buildDailyBrief(JSON.parse(JSON.stringify(richNotes)) as Note[], NOW);

    expect(first).toEqual(second);
    expect(first).toEqual(cloned);
    expect(first).toEqual(richBrief);
  });

  it('does not mutate the vault', () => {
    const snapshot = JSON.stringify(richNotes);
    buildDailyBrief(richNotes, NOW);
    expect(JSON.stringify(richNotes)).toBe(snapshot);
  });

  it('always returns 2–4 review bullets and 2–3 suggestions', () => {
    const fixtures = [
      buildDailyBrief([], NOW),
      buildDailyBrief([makeNote({ kind: 'diary', ts: YESTERDAY_AT(21) })], NOW),
      richBrief,
      buildDailyBrief(richNotes.slice(0, 4), NOW),
    ];
    for (const brief of fixtures) {
      expect(brief.review.length).toBeGreaterThanOrEqual(2);
      expect(brief.review.length).toBeLessThanOrEqual(4);
      expect(brief.suggestions.length).toBeGreaterThanOrEqual(2);
      expect(brief.suggestions.length).toBeLessThanOrEqual(3);
      expect(brief.trends).toHaveLength(4);
      expectNoLeaks(brief);
    }
  });

  it('uses Chinese strings throughout and never the generic phrase 保持健康', () => {
    const brief = richBrief;
    const hasHan = /[\u3400-\u9fff]/;
    expect(hasHan.test(brief.summary)).toBe(true);
    for (const line of [...brief.review, ...brief.suggestions]) {
      expect(hasHan.test(line)).toBe(true);
      expect(line).not.toContain('保持健康');
    }
    for (const trend of brief.trends) expect(hasHan.test(trend.label)).toBe(true);
  });

  it('works with a single record on the only day', () => {
    const brief = buildDailyBrief([makeNote({ kind: 'diary', ts: YESTERDAY_AT(21) })], NOW);
    expect(brief.summary).toBe('昨天记了 1 条，写了一篇日记。');
    expect(brief.review[0]).toBe('昨天记了 1 条记录：日记 1 篇。');
    expect(brief.review[1]).toBe('昨天没有支出记录。');
    expect(brief.suggestions.length).toBeGreaterThanOrEqual(2);
    expect(brief.trends[3].value).toBe('1 条');
    expectNoLeaks(brief);
  });
});
