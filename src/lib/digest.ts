import type { HealthMetric, Note } from './types';
import { directoryColor, directoryList } from './directories';
import { formatAmount } from './kinds';
import {
  dayKeyOf,
  formatMoney,
  noteDayKey,
  summarizeDay,
  summarizeRange,
  type DaySummary,
} from './insights';
import { isKnowledgeNote, isTemplateNote } from './knowledge';

/**
 * Daily digest engine for 麻薯.
 *
 * Objective: 「AI 助手每日定时汇总，给出建议」. Once a day the app can build a
 * short digest of yesterday's records, grouped by the user-created knowledge
 * directories, with concrete highlights and 2–3 suggestions derived from those
 * facts (never generic advice). Like the rest of the core libs it is a pure
 * function over the in-memory vault — no network, no timers, no randomness —
 * so the same notes + `now` always produce the same digest.
 *
 * Decisions (documented because the UI layer builds on them):
 * - The digest always reviews the *previous local day*, even when generated in
 *   the evening; that keeps the "早上看昨天" cadence predictable.
 * - `dateKey` is the local day the digest is generated for (today), so history
 *   can dedupe one digest per generation day; `isDigestDue` compares it with
 *   today's date.
 * - Directory order follows the user's creation order (like the 知识库目录
 *   screen); the 未分类 bucket is always last and only appears when it has
 *   records. Directory notes / archived notes / plan items / templates are not
 *   records and never enter the digest.
 * - Comparison thresholds mirror `lib/brief.ts` (7-day baseline before
 *   yesterday, spend spike 1.2×, sleep below 7h or 0.5h under average).
 */

/* ------------------------------------------------------------------ */
/* Public types                                                        */
/* ------------------------------------------------------------------ */

export interface DigestSection {
  /** Directory note id; `null` for the trailing 未分类 bucket. */
  dirId: string | null;
  /** Directory name (or 未分类). */
  title: string;
  /** Directory colour, when the user picked one. */
  color?: string;
  /** Number of records in this section. */
  count: number;
  /** 2–3 concrete facts about the records. */
  highlights: string[];
}

export interface DailyDigest {
  /** Local day the digest is generated for, `YYYY-MM-DD` (content = yesterday). */
  dateKey: string;
  /** Epoch ms passed as `now` — deterministic for the same input. */
  generatedAt: number;
  sections: DigestSection[];
  /** One-sentence summary of yesterday. */
  summary: string;
  /** 2–3 concrete suggestions derived from yesterday's facts. */
  suggestions: string[];
  /** Ids of every underlying record used, in chronological order. */
  sourceIds: string[];
}

export interface DigestSchedule {
  enabled: boolean;
  /** Local `HH:mm`. */
  time: string;
}

/** Where the last 14 digests live (localStorage is optional — private mode safe). */
export const DIGEST_HISTORY_KEY = 'mashu.digest.v1';
export const DIGEST_HISTORY_MAX = 14;
/** Where the user's daily digest schedule lives. */
export const DIGEST_SCHEDULE_KEY = 'mashu.digest.schedule.v1';
/** Default: daily at 08:00, so the first launch already has a morning review. */
export const DEFAULT_DIGEST_SCHEDULE: DigestSchedule = { enabled: true, time: '08:00' };
/** Title of the bucket for records that were not filed into a directory. */
export const UNASSIGNED_SECTION_TITLE = '未分类';

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const HOUR_MS = 3_600_000;
const HISTORY_BASELINE_DAYS = 7;
const SPEND_SPIKE_RATIO = 1.2;
const CALORIE_SPIKE_RATIO = 1.2;
const SLEEP_SHORT_HOURS = 7;
const SLEEP_DEVIATION_HOURS = 0.5;
const METRIC_UNITS: Record<HealthMetric, string> = {
  体重: 'kg',
  睡眠: '小时',
  步数: '步',
  心率: 'bpm',
  饮水: 'ml',
  运动: '分钟',
  活动能量: 'kcal',
  心情: '',
  其他: '',
};

function finiteNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** Effective record time: `meta.occurredAt` when set, else `createdAt`. */
function effectiveTime(note: Note): number {
  const occurredAt = finiteNumber(note.meta?.occurredAt);
  if (occurredAt !== undefined && occurredAt > 0) return occurredAt;
  return finiteNumber(note.createdAt) ?? 0;
}

function byTime(a: Note, b: Note): number {
  const diff = effectiveTime(a) - effectiveTime(b);
  if (diff !== 0) return diff;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function shiftDay(now: Date, deltaDays: number): Date {
  const day = new Date(now.getTime());
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() + deltaDays);
  return day;
}

function amountOf(note: Note): number {
  return Math.max(0, finiteNumber(note.meta?.amount) ?? 0);
}

/** Yesterday's records: user notes only, no templates / directories / plans / archives. */
function recordsForDay(notes: Note[], dateKey: string): Note[] {
  return notes
    .filter((note) => isKnowledgeNote(note) && !isTemplateNote(note) && noteDayKey(note) === dateKey)
    .sort(byTime);
}

interface HistoryAverages {
  spend?: number;
  calories?: number;
  sleep?: number;
  records?: number;
}

/**
 * Averages over the 7 days before yesterday. Only days that recorded a metric
 * participate (same rule as `lib/brief.ts`), so a sparse week does not look like
 * a spending spike.
 */
function historyAverages(days: DaySummary[]): HistoryAverages {
  return {
    spend: mean(days.filter((day) => day.spend > 0).map((day) => day.spend)),
    calories: mean(days.filter((day) => day.calories > 0).map((day) => day.calories)),
    sleep: mean(
      days
        .map((day) => day.sleep)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)),
    ),
    records: mean(days.filter((day) => day.recordCount > 0).map((day) => day.recordCount)),
  };
}

interface MoneyFacts {
  spend: number;
  income: number;
  top?: { category: string; amount: number };
}

/** Same money rules as `lib/insights`: food amounts + finance expenses are spend. */
function moneyFacts(records: Note[]): MoneyFacts {
  let spend = 0;
  let income = 0;
  const categories = new Map<string, number>();

  for (const note of records) {
    const amount = amountOf(note);
    if (amount <= 0) continue;
    if (note.kind === 'food') {
      spend += amount;
      const category = (note.meta?.category ?? '').trim() || '餐饮';
      categories.set(category, (categories.get(category) ?? 0) + amount);
    } else if (note.kind === 'finance') {
      if (note.meta?.direction === 'income') {
        income += amount;
      } else {
        spend += amount;
        const category = (note.meta?.category ?? '').trim() || '其他';
        categories.set(category, (categories.get(category) ?? 0) + amount);
      }
    }
  }

  const top = [...categories.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => {
      if (b.amount !== a.amount) return b.amount - a.amount;
      return a.category < b.category ? -1 : a.category > b.category ? 1 : 0;
    })[0];

  return { spend, income, top };
}

/** Latest recorded value of one health metric inside a chronological record list. */
function latestMetric(records: Note[], metric: HealthMetric): { note: Note; value: number } | undefined {
  let found: { note: Note; value: number } | undefined;
  for (const note of records) {
    if (note.kind !== 'health' || note.meta?.metric !== metric) continue;
    const value = finiteNumber(note.meta?.value);
    if (value === undefined || value <= 0) continue;
    found = { note, value };
  }
  return found;
}

const HIGHLIGHT_METRICS: readonly { metric: HealthMetric; label: string; decimals: number }[] = [
  { metric: '睡眠', label: '睡眠', decimals: 1 },
  { metric: '体重', label: '体重', decimals: 1 },
  { metric: '步数', label: '走了', decimals: 0 },
  { metric: '饮水', label: '喝水', decimals: 0 },
  { metric: '运动', label: '运动', decimals: 0 },
];

/* ------------------------------------------------------------------ */
/* Section content                                                     */
/* ------------------------------------------------------------------ */

/** 2–3 concrete facts for one directory section. */
function buildHighlights(records: Note[], sectionTitle: string, unassigned: boolean): string[] {
  const highlights: string[] = [];

  const counts = { food: 0, health: 0, finance: 0, diary: 0, note: 0 };
  for (const note of records) counts[note.kind] += 1;

  const breakdown: string[] = [];
  if (counts.food > 0) breakdown.push(`饮食 ${counts.food} 条`);
  if (counts.health > 0) breakdown.push(`健康 ${counts.health} 条`);
  if (counts.finance > 0) breakdown.push(`收支 ${counts.finance} 笔`);
  if (counts.diary > 0) breakdown.push(`日记 ${counts.diary} 篇`);
  if (counts.note > 0) breakdown.push(`笔记 ${counts.note} 条`);
  highlights.push(`记了 ${records.length} 条记录：${breakdown.join('、')}`);

  const money = moneyFacts(records);
  if (money.spend > 0) {
    const top = money.top ? `，最多的是${money.top.category}（${formatMoney(money.top.amount)}）` : '';
    highlights.push(`支出 ${formatMoney(money.spend)}${top}`);
  }
  if (money.income > 0) highlights.push(`收入 ${formatMoney(money.income)}`);

  const metricParts: string[] = [];
  for (const spec of HIGHLIGHT_METRICS) {
    if (metricParts.length >= 3) break;
    const latest = latestMetric(records, spec.metric);
    if (!latest) continue;
    const unit = latest.note.meta?.unit?.trim() || METRIC_UNITS[spec.metric];
    const value = formatAmount(roundTo(latest.value, spec.decimals));
    metricParts.push(`${spec.label} ${value}${unit ? ` ${unit}` : ''}`);
  }
  if (metricParts.length > 0) highlights.push(metricParts.join('、'));

  const foods = records.filter((note) => note.kind === 'food');
  if (foods.length > 0) {
    const dishes: string[] = [];
    let calories = 0;
    for (const note of foods) {
      calories += Math.max(0, finiteNumber(note.meta?.calories) ?? 0);
      for (const raw of note.meta?.dishes ?? []) {
        const dish = raw.trim();
        if (dish && !dishes.includes(dish)) dishes.push(dish);
      }
    }
    const parts: string[] = [];
    parts.push(dishes.length > 0 ? `吃了 ${dishes.slice(0, 3).join('、')}` : `吃了 ${foods.length} 顿`);
    if (calories > 0) parts.push(`摄入 ${Math.round(calories)} kcal`);
    highlights.push(parts.join('，'));
  }

  const written = records.filter((note) => note.kind === 'diary' || note.kind === 'note');
  if (written.length > 0) {
    const titles = written.slice(0, 3).map((note) => `《${note.title}》`).join('');
    highlights.push(written.length > 3 ? `写了${titles}等 ${written.length} 条` : `写了${titles}`);
  }

  // Always give a section at least two concrete facts.
  if (highlights.length < 2) {
    highlights.push(
      unassigned ? '这些记录还没有归到目录里。' : `这些记录都收在「${sectionTitle}」目录里。`,
    );
  }

  return highlights.slice(0, 3);
}

/* ------------------------------------------------------------------ */
/* Daily digest                                                        */
/* ------------------------------------------------------------------ */

function buildDigestSummary(sections: DigestSection[], records: Note[], day: DaySummary): string {
  if (records.length === 0) {
    return '昨天没有记录，今天随手记一笔，明天就能看到按目录整理的摘要。';
  }

  const dirSections = sections.filter((section) => section.dirId !== null);
  const unassigned = sections.find((section) => section.dirId === null);
  const parts: string[] = [`昨天你在知识库里记了 ${records.length} 条记录`];

  if (dirSections.length > 0) {
    const names = dirSections.map((section) => `「${section.title}」`).join('');
    parts.push(
      dirSections.length === 1
        ? `放在${names}目录里`
        : `分布在${names}${dirSections.length} 个目录里`,
    );
    if (unassigned) parts.push(`另有 ${unassigned.count} 条未分类`);
  } else if (unassigned) {
    parts.push(`${unassigned.count} 条都还没有归到目录`);
  }

  if (day.spend > 0) parts.push(`支出 ${formatMoney(day.spend)}`);
  if (day.sleep !== undefined) parts.push(`睡眠 ${formatAmount(day.sleep)} 小时`);
  return `${parts.join('，')}。`;
}

/**
 * 2–3 concrete actions for today, derived from yesterday's deviations and from
 * the directories that actually received records. Every line names a directory
 * or a record, and `保持健康`-style generic advice is deliberately absent.
 */
function buildDigestSuggestions(
  records: Note[],
  dirSections: DigestSection[],
  unassignedRecords: Note[],
  day: DaySummary,
  averages: HistoryAverages,
): string[] {
  const suggestions: string[] = [];
  const push = (line: string) => {
    const trimmed = line.trim();
    if (trimmed && !suggestions.includes(trimmed)) suggestions.push(trimmed);
  };

  if (records.length === 0) {
    push('今天先记一笔，比如「午饭 30 元」，明天的摘要里就会出现。');
    push('在知识库里建一个目录（比如「生活」），之后的记录会按目录自动汇总。');
    return suggestions.slice(0, 2);
  }

  let busiest: DigestSection | undefined;
  for (const section of dirSections) {
    if (
      !busiest ||
      section.count > busiest.count ||
      (section.count === busiest.count && section.title < busiest.title)
    ) {
      busiest = section;
    }
  }
  const refDir = busiest ? `「${busiest.title}」目录` : '知识库';

  if (unassignedRecords.length > 0) {
    const example = unassignedRecords[0];
    push(
      `把昨天还在「${UNASSIGNED_SECTION_TITLE}」的 ${unassignedRecords.length} 条记录（如《${example.title}》）移进目录，下次摘要会自动分组。`,
    );
  }

  if (busiest && busiest.count >= 2) {
    push(`「${busiest.title}」昨天记了 ${busiest.count} 条；今天在这个目录下补一句复盘，把它们和之前的记录连起来。`);
  }

  if (day.sleep !== undefined) {
    const average = averages.sleep;
    const tooLittle =
      day.sleep < SLEEP_SHORT_HOURS ||
      (average !== undefined && day.sleep < average - SLEEP_DEVIATION_HOURS);
    if (tooLittle) {
      const diff = average !== undefined ? roundTo(day.sleep - average, 1) : 0;
      const compare =
        average === undefined || diff === 0
          ? '，不足 7 小时'
          : `，比过去 7 天平均${diff > 0 ? '多' : '少'} ${formatAmount(Math.abs(diff))} 小时`;
      push(`昨晚睡了 ${formatAmount(day.sleep)} 小时${compare}，今晚提前 30 分钟睡，明早把睡眠补记到${refDir}。`);
    }
  }

  const averageSpend = averages.spend;
  if (
    day.spend > 0 &&
    averageSpend !== undefined &&
    averageSpend > 0 &&
    day.spend / averageSpend > SPEND_SPIKE_RATIO
  ) {
    const baseline = formatMoney(Math.round(averageSpend));
    push(
      `昨天支出 ${formatMoney(day.spend)}，比过去 7 天日均 ${baseline} 高；今天把支出控制在 ${baseline} 左右，记完顺手归到${refDir}。`,
    );
  }

  if (records.length > 0 && !records.some((note) => note.kind === 'diary')) {
    push(`昨天没有写日记；今晚在${refDir}记两句复盘，明天的摘要会更完整。`);
  }

  const untagged = records.find(
    (note) => (note.kind === 'note' || note.kind === 'diary') && (note.tags ?? []).length === 0,
  );
  if (untagged) {
    push(`给《${untagged.title}》补一个 #标签，之后在知识库里更容易被找到。`);
  }

  const averageCalories = averages.calories;
  if (
    day.calories > 0 &&
    averageCalories !== undefined &&
    averageCalories > 0 &&
    day.calories / averageCalories > CALORIE_SPIKE_RATIO
  ) {
    push(`昨天摄入 ${Math.round(day.calories)} kcal，比过去 7 天平均多；今天晚餐清淡一些，吃完记一笔。`);
  }

  const first = records[0];
  if (first) {
    push(`照着《${first.title}》的格式，今天再记一条同类记录，连续几天就能看出变化。`);
  }
  push(`把昨天的 ${records.length} 条记录翻一遍，挑一条补上当时的心情，之后的回顾会更完整。`);

  return suggestions.slice(0, 3);
}

/**
 * Build yesterday's digest, grouped by the user's knowledge directories.
 *
 * @param notes whole vault (directories come from `directoryList`)
 * @param now   generation anchor; pass it in tests for determinism
 */
export function buildDailyDigest(notes: Note[], now = new Date()): DailyDigest {
  const dateKey = dayKeyOf(now);
  const yesterdayKey = dayKeyOf(shiftDay(now, -1));
  const knowledge = notes.filter(isKnowledgeNote).sort(byTime);
  const records = recordsForDay(notes, yesterdayKey);

  const directories = directoryList(notes);
  const directoryMap = new Map(directories.map((directory) => [directory.id, directory]));

  const grouped = new Map<string, Note[]>();
  const unassignedRecords: Note[] = [];
  for (const note of records) {
    const directory = note.dirId ? directoryMap.get(note.dirId) : undefined;
    if (!directory || !note.dirId) {
      unassignedRecords.push(note);
      continue;
    }
    const bucket = grouped.get(note.dirId);
    if (bucket) bucket.push(note);
    else grouped.set(note.dirId, [note]);
  }

  const sections: DigestSection[] = [];
  for (const directory of directories) {
    const bucket = grouped.get(directory.id);
    if (!bucket || bucket.length === 0) continue;
    const ordered = [...bucket].sort(byTime);
    const color = directory.meta?.directory?.color ?? directoryColor(directory);
    const section: DigestSection = {
      dirId: directory.id,
      title: directory.title,
      count: ordered.length,
      highlights: buildHighlights(ordered, directory.title, false),
    };
    if (color) section.color = color;
    sections.push(section);
  }

  if (unassignedRecords.length > 0) {
    const ordered = [...unassignedRecords].sort(byTime);
    sections.push({
      dirId: null,
      title: UNASSIGNED_SECTION_TITLE,
      count: ordered.length,
      highlights: buildHighlights(ordered, UNASSIGNED_SECTION_TITLE, true),
    });
  }

  const daySummary = summarizeDay(knowledge, shiftDay(now, -1));
  const history = summarizeRange(knowledge, HISTORY_BASELINE_DAYS, shiftDay(now, -2));
  const averages = historyAverages(history);

  const dirSections = sections.filter((section) => section.dirId !== null);
  const sourceIds: string[] = [];
  const seenIds = new Set<string>();
  for (const note of records) {
    if (seenIds.has(note.id)) continue;
    seenIds.add(note.id);
    sourceIds.push(note.id);
  }

  return {
    dateKey,
    generatedAt: now.getTime(),
    sections,
    summary: buildDigestSummary(sections, records, daySummary),
    suggestions: buildDigestSuggestions(records, dirSections, unassignedRecords, daySummary, averages),
    sourceIds,
  };
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

/** localStorage when available (guarded for tests, SSR and private mode). */
function getStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSection(raw: unknown): DigestSection | null {
  if (!isRecordObject(raw)) return null;
  if (typeof raw.title !== 'string' || !raw.title.trim()) return null;
  const dirId = raw.dirId === null || typeof raw.dirId === 'string' ? raw.dirId : null;
  const count =
    typeof raw.count === 'number' && Number.isFinite(raw.count)
      ? Math.max(0, Math.floor(raw.count))
      : 0;
  const highlights = Array.isArray(raw.highlights)
    ? raw.highlights.filter((line): line is string => typeof line === 'string')
    : [];
  const section: DigestSection = { dirId, title: raw.title, count, highlights };
  if (typeof raw.color === 'string' && raw.color) section.color = raw.color;
  return section;
}

/** Validate one stored digest so corrupted localStorage never crashes the app. */
function normalizeStoredDigest(raw: unknown): DailyDigest | null {
  if (!isRecordObject(raw)) return null;
  const dateKey = typeof raw.dateKey === 'string' ? raw.dateKey : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const summary = typeof raw.summary === 'string' ? raw.summary : '';
  if (!summary) return null;
  const generatedAt =
    typeof raw.generatedAt === 'number' && Number.isFinite(raw.generatedAt) ? raw.generatedAt : 0;
  const sections = Array.isArray(raw.sections)
    ? raw.sections
        .map((section) => normalizeSection(section))
        .filter((section): section is DigestSection => section !== null)
    : [];
  const suggestions = Array.isArray(raw.suggestions)
    ? raw.suggestions.filter((line): line is string => typeof line === 'string')
    : [];
  const sourceIds = Array.isArray(raw.sourceIds)
    ? raw.sourceIds.filter((id): id is string => typeof id === 'string')
    : [];
  return { dateKey, generatedAt, sections, summary, suggestions, sourceIds };
}

/** Newest first: descending `dateKey`, then newer `generatedAt` wins ties. */
function sortDigests(a: DailyDigest, b: DailyDigest): number {
  if (a.dateKey !== b.dateKey) return a.dateKey < b.dateKey ? 1 : -1;
  return b.generatedAt - a.generatedAt;
}

/**
 * Read the last ≤14 digests (newest first). Missing/invalid localStorage or
 * corrupted JSON yields an empty list — the feature simply looks un-read.
 */
export function loadDigestHistory(): DailyDigest[] {
  const storage = getStorage();
  if (!storage) return [];

  let parsed: unknown;
  try {
    const raw = storage.getItem(DIGEST_HISTORY_KEY);
    if (!raw) return [];
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const entries: DailyDigest[] = [];
  for (const value of parsed) {
    const digest = normalizeStoredDigest(value);
    if (digest) entries.push(digest);
  }

  // Keep the freshest digest per dateKey; a later stored entry wins ties
  // (defensive: saveDigestToHistory already replaces same-day entries).
  const byDate = new Map<string, DailyDigest>();
  for (const entry of entries) {
    const existing = byDate.get(entry.dateKey);
    if (!existing || entry.generatedAt >= existing.generatedAt) byDate.set(entry.dateKey, entry);
  }
  return [...byDate.values()].sort(sortDigests).slice(0, DIGEST_HISTORY_MAX);
}

function clampHistoryMax(max: number): number {
  if (!Number.isFinite(max)) return DIGEST_HISTORY_MAX;
  return Math.max(0, Math.floor(max));
}

/**
 * Store a digest, replacing the previous one for the same `dateKey`, keeping at
 * most `max` (never more than 14) and newest-first order. Returns the new list
 * even when localStorage is unavailable, so callers can render without it.
 */
export function saveDigestToHistory(digest: DailyDigest, max = DIGEST_HISTORY_MAX): DailyDigest[] {
  const limit = Math.min(clampHistoryMax(max), DIGEST_HISTORY_MAX);
  const current = loadDigestHistory().filter((entry) => entry.dateKey !== digest.dateKey);
  const next = [digest, ...current].sort(sortDigests).slice(0, limit);

  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(DIGEST_HISTORY_KEY, JSON.stringify(next));
    } catch {
      /* private mode / quota — keep the in-memory result */
    }
  }
  return next;
}

/* ------------------------------------------------------------------ */
/* Schedule                                                            */
/* ------------------------------------------------------------------ */

interface ClockTime {
  hours: number;
  minutes: number;
}

/** Parse local `HH:mm` (1–2 digit hour tolerated). Invalid strings return null. */
function parseClockTime(value: string): ClockTime | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec((value ?? '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

function formatClockTime(time: ClockTime): string {
  return `${String(time.hours).padStart(2, '0')}:${String(time.minutes).padStart(2, '0')}`;
}

function normalizeClockTime(value: string): string | null {
  const parsed = parseClockTime(value);
  return parsed ? formatClockTime(parsed) : null;
}

/** Read the saved daily schedule; falls back to 08:00 daily. */
export function getDigestSchedule(): DigestSchedule {
  const storage = getStorage();
  if (!storage) return { ...DEFAULT_DIGEST_SCHEDULE };

  try {
    const raw = storage.getItem(DIGEST_SCHEDULE_KEY);
    if (!raw) return { ...DEFAULT_DIGEST_SCHEDULE };
    const parsed: unknown = JSON.parse(raw);
    if (!isRecordObject(parsed)) return { ...DEFAULT_DIGEST_SCHEDULE };
    const enabled =
      typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_DIGEST_SCHEDULE.enabled;
    const time =
      typeof parsed.time === 'string' && normalizeClockTime(parsed.time)
        ? (normalizeClockTime(parsed.time) as string)
        : DEFAULT_DIGEST_SCHEDULE.time;
    return { enabled, time };
  } catch {
    return { ...DEFAULT_DIGEST_SCHEDULE };
  }
}

/**
 * Merge a partial schedule into the stored one and persist it.
 * Invalid times are ignored (the current time is kept) so the UI can be sloppy.
 */
export function setDigestSchedule(schedule: Partial<DigestSchedule>): DigestSchedule {
  const current = getDigestSchedule();
  const enabled = typeof schedule.enabled === 'boolean' ? schedule.enabled : current.enabled;
  const candidate =
    typeof schedule.time === 'string' ? normalizeClockTime(schedule.time) : null;
  const next: DigestSchedule = { enabled, time: candidate ?? current.time };

  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(DIGEST_SCHEDULE_KEY, JSON.stringify(next));
    } catch {
      /* ignore private mode / quota */
    }
  }
  return next;
}

/**
 * Is the daily digest due right now?
 *
 * True when this local day has no digest in history yet **and** the current
 * time is at or past `at` (`HH:mm`, local). With no history at all the first
 * check after `at` is due, so a fresh install gets a digest on the next tick.
 * Invalid `at` strings are treated as "not due" rather than firing constantly.
 */
export function isDigestDue(now: Date, at: string): boolean {
  const time = parseClockTime(at);
  if (!time) return false;

  const todayKey = dayKeyOf(now);
  const history = loadDigestHistory();
  if (history.some((digest) => digest.dateKey === todayKey)) return false;

  const dueAt = new Date(now.getTime());
  dueAt.setHours(time.hours, time.minutes, 0, 0);
  return now.getTime() >= dueAt.getTime();
}

/** Convenience: milliseconds until the next `HH:mm` local occurrence. */
export function msUntilNextDigest(now: Date, at: string): number {
  const time = parseClockTime(at);
  if (!time) return 0;
  const next = new Date(now.getTime());
  next.setHours(time.hours, time.minutes, 0, 0);
  if (next.getTime() <= now.getTime()) next.setTime(next.getTime() + 24 * HOUR_MS);
  return next.getTime() - now.getTime();
}
