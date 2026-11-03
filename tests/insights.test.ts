import { describe, expect, it } from 'vitest';
import type { Note, NoteKind, NoteMeta } from '../src/lib/types';
import {
  dayKeyOf,
  formatMoney,
  healthSeries,
  noteDayKey,
  spendingByCategory,
  startOfDay,
  summarizeDay,
  summarizeRange,
  weekSummaryText,
} from '../src/lib/insights';

let counter = 0;

interface NoteInput {
  id?: string;
  title?: string;
  kind?: NoteKind;
  meta?: NoteMeta;
  /** Sets both `createdAt` and `meta.occurredAt`. */
  ts?: number;
  createdAt?: number;
  content?: string;
}

function makeNote(input: NoteInput): Note {
  counter += 1;
  const createdAt = input.createdAt ?? input.ts ?? new Date(2026, 2, 10, 12, 0).getTime();
  const meta: NoteMeta = { ...input.meta };
  const occurredAt = input.ts ?? input.meta?.occurredAt;
  if (occurredAt !== undefined) meta.occurredAt = occurredAt;
  return {
    id: input.id ?? `note-${counter}`,
    title: input.title ?? '测试记录',
    content: input.content ?? '',
    tags: [],
    createdAt,
    updatedAt: createdAt,
    pinned: false,
    kind: input.kind ?? 'note',
    meta,
    manualLinks: [],
  };
}

function at(day: Date, hour: number, minute = 0): number {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute).getTime();
}

const TODAY = new Date(2026, 2, 10, 20, 0);

describe('day helpers', () => {
  it('uses local calendar days and start-of-day timestamps', () => {
    const late = new Date(2026, 0, 5, 23, 59, 59);
    const early = new Date(2026, 0, 6, 0, 0, 1);

    expect(dayKeyOf(late)).toBe('2026-01-05');
    expect(dayKeyOf(early)).toBe('2026-01-06');
    expect(startOfDay(late.getTime())).toBe(new Date(2026, 0, 5).getTime());
  });

  it('prefers meta.occurredAt and falls back to createdAt', () => {
    const occurred = makeNote({ kind: 'food', ts: new Date(2026, 0, 5, 12).getTime() });
    expect(noteDayKey(occurred)).toBe('2026-01-05');

    const fallback = makeNote({ kind: 'diary', createdAt: new Date(2026, 0, 6, 9).getTime() });
    expect(fallback.meta.occurredAt).toBeUndefined();
    expect(noteDayKey(fallback)).toBe('2026-01-06');
  });

  it('buckets records across midnight by local day', () => {
    const late = makeNote({ kind: 'food', ts: new Date(2026, 0, 15, 23, 59).getTime(), meta: { amount: 10 } });
    const early = makeNote({ kind: 'food', ts: new Date(2026, 0, 16, 0, 1).getTime(), meta: { amount: 20 } });

    expect(summarizeDay([late, early], new Date(2026, 0, 15, 12)).spend).toBe(10);
    expect(summarizeDay([late, early], new Date(2026, 0, 16, 12)).spend).toBe(20);
  });
});

describe('summarizeDay', () => {
  const health = (meta: NoteMeta, hour: number, minute = 0): Note =>
    makeNote({ kind: 'health', meta, ts: at(TODAY, hour, minute) });
  const finance = (meta: NoteMeta, hour: number): Note =>
    makeNote({ kind: 'finance', meta, ts: at(TODAY, hour) });

  const notes: Note[] = [
    makeNote({ kind: 'food', title: '早餐', meta: { meal: '早餐', amount: 8, calories: 480 }, ts: at(TODAY, 8) }),
    makeNote({ kind: 'food', title: '午餐', meta: { meal: '午餐', amount: 32, calories: 620 }, ts: at(TODAY, 12) }),
    finance({ amount: 18, category: '餐饮', direction: 'expense' }, 15),
    finance({ amount: 8500, category: '收入', direction: 'income' }, 9),
    finance({ amount: 5 }, 11), // no direction -> defaults to expense
    health({ metric: '睡眠', value: 6.5, unit: '小时' }, 6),
    health({ metric: '睡眠', value: 7.2, unit: '小时' }, 7),
    health({ metric: '体重', value: 52.4, unit: 'kg' }, 7, 30),
    health({ metric: '步数', value: 5000, unit: '步' }, 12),
    health({ metric: '步数', value: 8321, unit: '步' }, 19),
    health({ metric: '饮水', value: 500, unit: 'ml' }, 10),
    health({ metric: '饮水', value: 750, unit: 'ml' }, 16),
    health({ metric: '运动', value: 20, unit: '分钟' }, 17),
    health({ metric: '运动', value: 45, unit: '分钟' }, 18),
    health({ metric: '心情', mood: '平静' }, 17, 30),
    makeNote({ kind: 'diary', title: '日记', ts: at(TODAY, 21) }),
    makeNote({ kind: 'note', title: '普通笔记', ts: at(TODAY, 10) }),
    makeNote({ kind: 'food', title: '昨天的午饭', meta: { amount: 28, calories: 700 }, ts: at(new Date(2026, 2, 9, 12), 12) }),
  ];

  it('sums food/finance and counts records per day', () => {
    const summary = summarizeDay(notes, TODAY);

    expect(summary.dateKey).toBe('2026-03-10');
    expect(summary.startedAt).toBe(new Date(2026, 2, 10).getTime());
    expect(summary.spend).toBe(63); // 8 + 32 (food) + 18 + 5 (finance expense)
    expect(summary.income).toBe(8500);
    expect(summary.calories).toBe(1100);
    expect(summary.meals).toBe(2);
    expect(summary.diaryCount).toBe(1);
    expect(summary.recordCount).toBe(16); // 2 food + 3 finance + 10 health + 1 diary
    expect(summary.noteIds).toHaveLength(16);
    expect(new Set(summary.noteIds).size).toBe(16);
  });

  it('keeps the latest health value per day instead of summing', () => {
    const summary = summarizeDay(notes, TODAY);

    expect(summary.sleep).toBe(7.2);
    expect(summary.weight).toBe(52.4);
    expect(summary.steps).toBe(8321);
    expect(summary.water).toBe(750);
    expect(summary.exercise).toBe(45);
    expect(summary.mood).toBe('平静');
  });

  it('returns a fully zeroed summary for empty input', () => {
    const summary = summarizeDay([], TODAY);

    expect(summary).toMatchObject({
      dateKey: '2026-03-10',
      spend: 0,
      income: 0,
      calories: 0,
      meals: 0,
      diaryCount: 0,
      recordCount: 0,
      noteIds: [],
    });
    expect(summary.sleep).toBeUndefined();
    expect(Number.isNaN(summary.spend)).toBe(false);
    expect(Number.isNaN(summary.calories)).toBe(false);
  });
});

describe('summarizeRange', () => {
  const now = new Date(2026, 2, 10, 18, 0);
  const notes: Note[] = [
    makeNote({ kind: 'finance', meta: { amount: 10, direction: 'expense' }, ts: new Date(2026, 2, 10, 9).getTime() }),
    makeNote({ kind: 'finance', meta: { amount: 20, direction: 'expense' }, ts: new Date(2026, 2, 9, 9).getTime() }),
    makeNote({ kind: 'finance', meta: { amount: 30, direction: 'expense' }, ts: new Date(2026, 2, 8, 9).getTime() }),
    makeNote({ kind: 'finance', meta: { amount: 99, direction: 'expense' }, ts: new Date(2026, 2, 7, 9).getTime() }),
  ];

  it('returns chronological days ending today', () => {
    const range = summarizeRange(notes, 3, now);

    expect(range.map((day) => day.dateKey)).toEqual(['2026-03-08', '2026-03-09', '2026-03-10']);
    expect(range.map((day) => day.spend)).toEqual([30, 20, 10]);
    expect(range[2].startedAt).toBe(new Date(2026, 2, 10).getTime());
  });

  it('handles zero, negative and fractional day counts', () => {
    expect(summarizeRange(notes, 0, now)).toEqual([]);
    expect(summarizeRange(notes, -3, now)).toEqual([]);
    expect(summarizeRange(notes, 2.9, now)).toHaveLength(2);
  });
});

describe('healthSeries', () => {
  const now = new Date(2026, 2, 10, 18, 0);

  it('returns one value per day, latest record wins', () => {
    const notes: Note[] = [
      makeNote({ kind: 'health', meta: { metric: '睡眠', value: 6.5 }, ts: at(new Date(2026, 2, 8, 12), 6) }),
      makeNote({ kind: 'health', meta: { metric: '睡眠', value: 7.0 }, ts: at(new Date(2026, 2, 8, 12), 8) }),
      makeNote({ kind: 'health', meta: { metric: '睡眠', value: 7.2 }, ts: at(new Date(2026, 2, 10, 12), 7) }),
      makeNote({ kind: 'health', meta: { metric: '体重', value: 52.4 }, ts: at(new Date(2026, 2, 10, 12), 7) }),
    ];

    expect(healthSeries(notes, '睡眠', 7, now)).toEqual([
      { dateKey: '2026-03-08', value: 7.0 },
      { dateKey: '2026-03-10', value: 7.2 },
    ]);
    expect(healthSeries(notes, '体重', 7, now)).toEqual([{ dateKey: '2026-03-10', value: 52.4 }]);
  });

  it('returns an empty series when nothing is recorded', () => {
    expect(healthSeries([], '睡眠', 7, now)).toEqual([]);
    expect(healthSeries([makeNote({ kind: 'health', meta: { metric: '饮水', value: 500 } })], '步数', 7, now)).toEqual([]);
  });
});

describe('spendingByCategory', () => {
  const now = new Date(2026, 2, 10, 18, 0);

  it('groups food and expenses, biggest first, excluding income', () => {
    const notes: Note[] = [
      makeNote({ kind: 'food', meta: { amount: 32 }, ts: at(new Date(2026, 2, 10, 12), 12) }),
      makeNote({ kind: 'food', meta: { amount: 22 }, ts: at(new Date(2026, 2, 9, 12), 12) }),
      makeNote({ kind: 'finance', meta: { amount: 18, category: '餐饮', direction: 'expense' }, ts: at(new Date(2026, 2, 10, 12), 15) }),
      makeNote({ kind: 'finance', meta: { amount: 6, category: '交通', direction: 'expense' }, ts: at(new Date(2026, 2, 10, 12), 8) }),
      makeNote({ kind: 'finance', meta: { amount: 8500, category: '收入', direction: 'income' }, ts: at(new Date(2026, 2, 10, 12), 9) }),
      makeNote({ kind: 'finance', meta: { amount: 999, category: '购物', direction: 'expense' }, ts: at(new Date(2026, 2, 1, 12), 9) }),
      makeNote({ kind: 'note', meta: { amount: 500 }, ts: at(new Date(2026, 2, 10, 12), 10) }),
    ];

    expect(spendingByCategory(notes, 7, now)).toEqual([
      { category: '餐饮', amount: 72 },
      { category: '交通', amount: 6 },
    ]);
    expect(spendingByCategory(notes, 0, now)).toEqual([]);
    expect(spendingByCategory([], 7, now)).toEqual([]);
  });
});

describe('formatMoney', () => {
  it('formats whole amounts and cents', () => {
    expect(formatMoney(12)).toBe('¥12');
    expect(formatMoney(12.5)).toBe('¥12.50');
    expect(formatMoney(0)).toBe('¥0');
    expect(formatMoney(1234.567)).toBe('¥1234.57');
    expect(formatMoney(Number.NaN)).toBe('¥0');
  });
});

describe('weekSummaryText', () => {
  const now = new Date(2026, 2, 10, 18, 0);
  const notes: Note[] = [
    makeNote({ kind: 'food', meta: { amount: 32, calories: 620, meal: '午餐' }, ts: at(new Date(2026, 2, 10, 12), 12) }),
    makeNote({ kind: 'finance', meta: { amount: 18, category: '餐饮', direction: 'expense' }, ts: at(new Date(2026, 2, 10, 12), 15) }),
    makeNote({ kind: 'health', meta: { metric: '睡眠', value: 7.2 }, ts: at(new Date(2026, 2, 10, 12), 7) }),
    makeNote({ kind: 'health', meta: { metric: '体重', value: 52.4 }, ts: at(new Date(2026, 2, 10, 12), 7) }),
    makeNote({ kind: 'diary', ts: at(new Date(2026, 2, 10, 12), 21) }),
  ];

  it('builds a short bullet summary', () => {
    const text = weekSummaryText(notes, now);

    expect(text).toContain('最近 7 天记了 5 条记录');
    expect(text).toContain('支出 ¥50');
    expect(text).toContain('摄入 620 kcal');
    expect(text).toContain('睡眠平均 7.2 小时');
    expect(text).toContain('体重 52.4 kg');
    expect(text).toContain('花得最多的是 餐饮');
    expect(text).not.toContain('NaN');
  });

  it('handles an empty week', () => {
    const text = weekSummaryText([], now);
    expect(text).toContain('还没有记录');
    expect(text).not.toContain('NaN');
  });
});
