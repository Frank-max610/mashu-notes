import type { HealthMetric, Note } from './types';
import { formatAmount } from './kinds';

/**
 * Life-record insights for Rixin.
 *
 * Everything here is a pure function over the in-memory vault: no IndexedDB,
 * no network, no timers. The agent, the daily overview and the charts all read
 * the same numbers, so "今天花了多少" and the spending chart can never disagree.
 *
 * Only life records count: `kind` must be one of diary/food/health/finance.
 * Plain Markdown notes (`kind === 'note'`) are intentionally ignored.
 */

export interface DaySummary {
  /** Local calendar day, `YYYY-MM-DD`. */
  dateKey: string;
  /** Epoch ms of local midnight for this day. */
  startedAt: number;
  /** Food amounts + finance expenses. */
  spend: number;
  /** Finance income only. */
  income: number;
  /** Sum of food calories. */
  calories: number;
  /** Number of food records. */
  meals: number;
  /** Latest health metric value of the day (not a sum). */
  sleep?: number;
  weight?: number;
  steps?: number;
  water?: number;
  exercise?: number;
  /** Latest mood mentioned that day. */
  mood?: string;
  /** Number of diary records. */
  diaryCount: number;
  /** All life records of the day. */
  recordCount: number;
  /** Ids of every counted record, in chronological order. */
  noteIds: string[];
}

const RECORD_KINDS: ReadonlySet<string> = new Set(['food', 'finance', 'health', 'diary']);

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function finite(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function metaOf(note: Note): Note['meta'] {
  return note.meta ?? {};
}

/** True when the note is a life record (not a plain note). */
function isRecord(note: Note): boolean {
  return RECORD_KINDS.has(note.kind ?? 'note');
}

/**
 * Effective timestamp of a record: explicit `occurredAt`, otherwise creation
 * time. `occurredAt: 0` is treated as "unset" so legacy/empty metadata cannot
 * dump every record into 1970.
 */
function effectiveTimestamp(note: Note): number {
  const occurredAt = finite(metaOf(note).occurredAt);
  if (occurredAt !== undefined && occurredAt > 0) return occurredAt;
  return finite(note.createdAt) ?? 0;
}

/** Local `YYYY-MM-DD` key. Invalid dates fall back to the epoch day. */
export function dayKeyOf(date: Date): string {
  const time = date.getTime();
  if (!Number.isFinite(time)) return '1970-01-01';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Epoch ms of local midnight for the day containing `ts`. */
export function startOfDay(ts: number): number {
  const date = new Date(Number.isFinite(ts) ? ts : 0);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Local day key of a note: `meta.occurredAt` when set, else `createdAt`. */
export function noteDayKey(note: Note): string {
  return dayKeyOf(new Date(effectiveTimestamp(note)));
}

/** Chronological, deterministic order for notes inside one day. */
function byTime(a: Note, b: Note): number {
  const diff = effectiveTimestamp(a) - effectiveTimestamp(b);
  if (diff !== 0) return diff;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function addIntoTotals(summary: DaySummary, meta: Note['meta'], kind: Note['kind']): void {
  switch (kind) {
    case 'food': {
      summary.meals += 1;
      summary.spend += Math.max(0, finite(meta.amount) ?? 0);
      summary.calories += Math.max(0, finite(meta.calories) ?? 0);
      break;
    }
    case 'finance': {
      const amount = Math.max(0, finite(meta.amount) ?? 0);
      if (meta.direction === 'income') summary.income += amount;
      else summary.spend += amount;
      break;
    }
    case 'health': {
      const value = finite(meta.value);
      if (value === undefined) break;
      switch (meta.metric) {
        case '睡眠':
          summary.sleep = value;
          break;
        case '体重':
          summary.weight = value;
          break;
        case '步数':
          summary.steps = value;
          break;
        case '饮水':
          summary.water = value;
          break;
        case '运动':
          summary.exercise = value;
          break;
        default:
          break;
      }
      break;
    }
    default:
      break;
  }
}

/** Summarize one local day. Records outside that day are ignored. */
export function summarizeDay(notes: Note[], date = new Date()): DaySummary {
  const startedAt = startOfDay(date.getTime());
  const dateKey = dayKeyOf(new Date(startedAt));
  const summary: DaySummary = {
    dateKey,
    startedAt,
    spend: 0,
    income: 0,
    calories: 0,
    meals: 0,
    diaryCount: 0,
    recordCount: 0,
    noteIds: [],
  };

  const dayNotes = notes
    .filter((note) => isRecord(note) && noteDayKey(note) === dateKey)
    .sort(byTime);

  for (const note of dayNotes) {
    const meta = metaOf(note);
    summary.recordCount += 1;
    summary.noteIds.push(note.id);
    if (note.kind === 'diary') summary.diaryCount += 1;
    addIntoTotals(summary, meta, note.kind);
    // Mood is a generic field: the latest record that mentions one wins.
    if (typeof meta.mood === 'string' && meta.mood.trim()) summary.mood = meta.mood.trim();
  }

  return summary;
}

/** Local calendar dates for the last `count` days, oldest first, ending today. */
function rangeDates(count: number, now: Date): Date[] {
  const base = new Date(now.getTime());
  base.setHours(0, 0, 0, 0);
  const dates: Date[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const day = new Date(base.getTime());
    day.setDate(day.getDate() - offset);
    dates.push(day);
  }
  return dates;
}

function clampDays(days: number): number {
  if (!Number.isFinite(days)) return 0;
  return Math.max(0, Math.floor(days));
}

/**
 * Summaries for the last `days` local days, oldest → newest; the last entry is
 * today. `days <= 0` returns an empty array.
 */
export function summarizeRange(notes: Note[], days: number, now = new Date()): DaySummary[] {
  const count = clampDays(days);
  if (count === 0) return [];
  return rangeDates(count, now).map((date) => summarizeDay(notes, date));
}

/**
 * Numbers for one health metric over the last `days` days. Only days with a
 * recorded value appear, so charts can show gaps instead of fake zeros.
 */
export function healthSeries(
  notes: Note[],
  metric: HealthMetric,
  days = 7,
  now = new Date(),
): { dateKey: string; value: number }[] {
  const count = clampDays(days);
  if (count === 0) return [];
  const series: { dateKey: string; value: number }[] = [];

  for (const date of rangeDates(count, now)) {
    const dateKey = dayKeyOf(date);
    const candidates = notes
      .filter(
        (note) =>
          isRecord(note) &&
          note.kind === 'health' &&
          metaOf(note).metric === metric &&
          noteDayKey(note) === dateKey,
      )
      .sort(byTime);
    const latest = candidates[candidates.length - 1];
    const value = latest ? finite(metaOf(latest).value) : undefined;
    if (value !== undefined) series.push({ dateKey, value });
  }

  return series;
}

/**
 * Spending grouped by category for the last `days` days, biggest first.
 * Food counts as `meta.category` (default 餐饮), finance expenses use their
 * category (default 其他); income is not spending.
 */
export function spendingByCategory(
  notes: Note[],
  days = 7,
  now = new Date(),
): { category: string; amount: number }[] {
  const count = clampDays(days);
  if (count === 0) return [];
  const keys = new Set(rangeDates(count, now).map((date) => dayKeyOf(date)));
  const totals = new Map<string, number>();

  for (const note of notes) {
    if (!isRecord(note) || !keys.has(noteDayKey(note))) continue;
    const meta = metaOf(note);
    const amount = Math.max(0, finite(meta.amount) ?? 0);
    if (amount <= 0) continue;

    let category: string;
    if (note.kind === 'food') {
      category = (meta.category ?? '').trim() || '餐饮';
    } else if (note.kind === 'finance') {
      if (meta.direction === 'income') continue;
      category = (meta.category ?? '').trim() || '其他';
    } else {
      continue;
    }
    totals.set(category, (totals.get(category) ?? 0) + amount);
  }

  return [...totals.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => {
      if (b.amount !== a.amount) return b.amount - a.amount;
      return a.category < b.category ? -1 : a.category > b.category ? 1 : 0;
    });
}

/** `¥12` for whole amounts, `¥12.50` otherwise. */
export function formatMoney(amount: number): string {
  if (!Number.isFinite(amount)) return '¥0';
  const rounded = Math.round(amount * 100) / 100;
  if (Number.isInteger(rounded)) return `¥${rounded}`;
  return `¥${rounded.toFixed(2)}`;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Short Chinese bullet summary for the local agent: spending, records, food,
 * sleep/weight and the top spending category over the last 7 days.
 */
export function weekSummaryText(notes: Note[], now = new Date()): string {
  const days = summarizeRange(notes, 7, now);
  const records = days.reduce((total, day) => total + day.recordCount, 0);
  if (records === 0) return '最近 7 天还没有记录。';

  let spend = 0;
  let income = 0;
  let meals = 0;
  let calories = 0;
  let diary = 0;
  for (const day of days) {
    spend += day.spend;
    income += day.income;
    meals += day.meals;
    calories += day.calories;
    diary += day.diaryCount;
  }

  const lines: string[] = [`最近 7 天记了 ${records} 条记录。`];

  const money: string[] = [];
  if (spend > 0) money.push(`支出 ${formatMoney(spend)}`);
  if (income > 0) money.push(`收入 ${formatMoney(income)}`);
  if (money.length > 0) lines.push(`· ${money.join('，')}`);

  const life: string[] = [`饮食 ${meals} 次`, `摄入 ${Math.round(calories)} kcal`];
  if (diary > 0) life.push(`日记 ${diary} 篇`);
  lines.push(`· ${life.join('，')}`);

  const sleepDays = days.filter((day) => day.sleep !== undefined);
  const health: string[] = [];
  if (sleepDays.length > 0) {
    const total = sleepDays.reduce((sum, day) => sum + (day.sleep ?? 0), 0);
    health.push(`睡眠平均 ${formatAmount(roundTo(total / sleepDays.length, 1))} 小时`);
  }
  const weightDay = [...days].reverse().find((day) => day.weight !== undefined);
  if (weightDay?.weight !== undefined) {
    health.push(`体重 ${formatAmount(weightDay.weight)} kg`);
  }
  if (health.length > 0) lines.push(`· ${health.join('，')}`);

  const topCategory = spendingByCategory(notes, 7, now)[0];
  if (topCategory) {
    lines.push(`· 花得最多的是 ${topCategory.category}（${formatMoney(topCategory.amount)}）`);
  }

  return lines.join('\n');
}
