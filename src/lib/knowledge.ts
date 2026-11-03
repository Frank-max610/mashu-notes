import type { HealthMetric, Note } from './types';
import { directoryNoteMap } from './directories';
import { describeMeta, formatAmount } from './kinds';
import {
  formatMoney,
  noteDayKey,
  summarizeDay,
  summarizeRange,
  type DaySummary,
} from './insights';
import { plainText } from './markdown';

/**
 * Knowledge-grounded assistant brain for 麻薯.
 *
 * The user's notes *are* the knowledge base: user-created directories, plain
 * Markdown notes and the structured life records all live in one vault. This
 * module answers questions using only that vault, so the assistant can never
 * invent a fact that is not in a real note:
 *
 * - `searchKnowledge` is deterministic keyword/tag/title retrieval with
 *   Chinese-friendly tokenisation (CJK character bigrams + latin words).
 * - `groundedAnswer` classifies the question (lookup / stats / reflection),
 *   answers from real notes and always returns the source note ids it used.
 *   When nothing relevant exists it refuses instead of guessing.
 *
 * Everything is a pure function over the in-memory vault: no network, no
 * timers, no randomness. `groundedAnswer` takes an explicit `now` for the
 * stats window (defaults to the current clock) so the same notes + now always
 * produce the same answer. Directories, archived notes, plan items and
 * templates are handled explicitly: directory notes, archived notes and plan
 * items are never part of the knowledge corpus; templates stay searchable but
 * score lower because they are empty skeletons, not memories.
 */

/* ------------------------------------------------------------------ */
/* Public types                                                        */
/* ------------------------------------------------------------------ */

export interface KnowledgeHit {
  /** The matched knowledge note (never a directory note / archived / plan). */
  note: Note;
  /** Higher is better; deterministic for the same vault and query. */
  score: number;
  /** Short quote around the first match (~120 chars, `…` when clipped). */
  excerpt: string;
}

export interface GroundedSource {
  id: string;
  title: string;
}

export interface GroundedAnswer {
  text: string;
  sources: GroundedSource[];
  /** True only when the text is backed by at least one real note. */
  grounded: boolean;
  /** True when the reply is a fallback (refusal/help) rather than a grounded answer. */
  usedFallback?: boolean;
}

/* ------------------------------------------------------------------ */
/* Corpus rules                                                        */
/* ------------------------------------------------------------------ */

/** Notes the user actually wrote: no directory folders, archives or plan items. */
export function isKnowledgeNote(note: Note): boolean {
  if (!note) return false;
  if (note.archivedAt) return false;
  if (note.meta?.directory) return false;
  if (note.meta?.plan) return false;
  return true;
}

/** Templates are tagged `#模板` (or titled `模板 …`) and are skeletons, not memories. */
export function isTemplateNote(note: Note): boolean {
  const tags = note.tags ?? [];
  if (tags.some((tag) => tag.replace(/^#/, '').trim().toLowerCase() === '模板')) return true;
  return (note.title ?? '').trim().startsWith('模板');
}

/* ------------------------------------------------------------------ */
/* Text helpers                                                        */
/* ------------------------------------------------------------------ */

const CJK_RUN_RE = /[\u3400-\u9fff\uf900-\ufaff]+/g;
const LATIN_WORD_RE = /[a-z0-9]+(?:[._+-][a-z0-9]+)*/g;

/**
 * Question scaffolding that carries no retrieval value. Removing it before
 * tokenising keeps bigrams such as `我记` / `关于` from outvoting the actual
 * topic in `我记过关于睡眠的记录吗`. Longest alternatives come first.
 * (This is a pragmatic heuristic, not a general Chinese segmenter.)
 */
const QUERY_FILLER_RE =
  /我记过|记录过|有没有|是否有|告诉我|告诉我的|帮我|麻烦|请帮|找一下|找找|查一下|查查|看一下|看看|总结一下|复盘一下|回顾一下|总结|复盘|回顾|关于|相关的|这段时间|的内容|记录|笔记|我的|内容|东西|资料|什么|哪些|哪个|怎么|如何|为什么|为啥|是否|可以|一点|一些|最近|一下|的记录|告诉我|给我|还有|多少|几个|几条|吗|呢|吧|啊|呀|哦|嗯|我|你|的|了|是|在|和|与|跟|有|找|查|看|给/g;

const EXCERPT_LENGTH = 120;
const EXCERPT_CONTEXT = 56;
const DEFAULT_LIMIT = 3;
const LOOKUP_LIMIT = 3;
/** Representative source notes listed under a stats answer. */
const SOURCE_LIMIT = 5;

const TITLE_FULL_SCORE = 120;
const TITLE_TOKEN_SCORE = 40;
const TAG_SCORE = 26;
const BODY_SCORE = 8;
const BODY_OCCURRENCE_SCORE = 3;
const BODY_OCCURRENCE_CAP = 5;
/** Templates can surface, but below any real memory. */
const TEMPLATE_SCORE_FACTOR = 0.35;

function normalizeText(value: string): string {
  return (value ?? '').replace(/\r\n?/g, '\n').trim();
}

/** Lower-case + collapse whitespace for tolerant matching. */
function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max).trimEnd()}…`;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

function clampLimit(limit: number, fallback: number): number {
  const value = Number.isFinite(limit) ? Math.floor(limit) : fallback;
  return Math.max(0, value);
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Tokenise a query into CJK character bigrams and latin/digit words.
 * A single-character CJK run is kept as a unigram (`猫`), latin tokens shorter
 * than two characters are dropped as noise.
 */
function tokenize(value: string): string[] {
  const tokens = new Set<string>();
  const lower = value.toLowerCase();

  for (const match of lower.matchAll(LATIN_WORD_RE)) {
    if (match[0].length >= 2) tokens.add(match[0]);
  }

  for (const match of lower.matchAll(CJK_RUN_RE)) {
    const run = match[0];
    if (run.length === 1) {
      tokens.add(run);
      continue;
    }
    for (let index = 0; index + 1 < run.length; index += 1) {
      tokens.add(run.slice(index, index + 2));
    }
  }

  return [...tokens];
}

/** Strip question scaffolding, then tokenise; fall back to the raw query. */
function queryTokens(query: string): string[] {
  const cleaned = query.replace(QUERY_FILLER_RE, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ');
  const tokens = tokenize(cleaned);
  if (tokens.length > 0) return tokens;
  return tokenize(query);
}

/** Searchable body: Markdown text plus the structured fields of a record. */
function searchableBody(note: Note): string {
  const parts: string[] = [];
  const body = plainText(note.content ?? '').replace(/\s+/g, ' ').trim();
  if (body) parts.push(body);
  const described = describeMeta(note).replace(/\s+/g, ' ').trim();
  if (described) parts.push(described);
  if (note.meta?.detail) parts.push(note.meta.detail);
  if (note.meta?.dishes?.length) parts.push(note.meta.dishes.join(' '));
  return parts.join(' ').trim();
}

/** Earliest match of any token; `-1` when only the title/tags matched. */
function firstMatchIndex(flatLower: string, tokens: string[]): number {
  let index = -1;
  for (const token of tokens) {
    const found = flatLower.indexOf(token);
    if (found !== -1 && (index === -1 || found < index)) index = found;
  }
  return index;
}

/**
 * Quote around the first body match. Falls back to the head of the body, then
 * to the structured fields, then to the title so a title-only hit still shows
 * something concrete.
 */
function buildExcerpt(note: Note, tokens: string[]): string {
  const flat = plainText(note.content ?? '').replace(/\s+/g, ' ').trim();
  if (flat) {
    const index = firstMatchIndex(flat.toLowerCase(), tokens);
    if (index === -1) return clip(flat, EXCERPT_LENGTH);
    const start = Math.max(0, index - EXCERPT_CONTEXT);
    const end = Math.min(flat.length, start + EXCERPT_LENGTH);
    let excerpt = flat.slice(start, end).trim();
    if (start > 0) excerpt = `…${excerpt}`;
    if (end < flat.length) excerpt = `${excerpt}…`;
    return excerpt;
  }

  const described = clip(describeMeta(note), EXCERPT_LENGTH);
  if (described) return described;
  return clip(note.title, EXCERPT_LENGTH);
}

/** Local `M月D日` label of a note's effective day. */
function dateLabel(note: Note): string {
  const key = noteDayKey(note);
  const parts = key.split('-');
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return key;
  return `${month}月${day}日`;
}

/** Effective timestamp of a note: `meta.occurredAt` when set, else `createdAt`. */
function effectiveTime(note: Note): number {
  const occurredAt = note.meta?.occurredAt;
  if (typeof occurredAt === 'number' && Number.isFinite(occurredAt) && occurredAt > 0) {
    return occurredAt;
  }
  return Number.isFinite(note.createdAt) ? note.createdAt : 0;
}

/** Chronological order, id as the deterministic tiebreaker. */
function byTime(a: Note, b: Note): number {
  const diff = effectiveTime(a) - effectiveTime(b);
  if (diff !== 0) return diff;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Most recent first (sources read better this way). */
function latestFirst(notes: Note[]): Note[] {
  return [...notes].sort(byTime).reverse();
}

/** De-duplicated, representative sources (max `limit`, most recent first). */
function knowledgeSources(notes: Note[], limit = SOURCE_LIMIT): GroundedSource[] {
  const seen = new Set<string>();
  const sources: GroundedSource[] = [];
  for (const note of notes) {
    if (seen.has(note.id)) continue;
    seen.add(note.id);
    sources.push({ id: note.id, title: note.title });
    if (sources.length >= limit) break;
  }
  return sources;
}

/** 「来源：《A》《B》」 — empty string when there is nothing to cite. */
export function formatSources(sources: { id: string; title: string }[]): string {
  if (!sources || sources.length === 0) return '';
  return `来源：${sources.map((source) => `《${source.title}》`).join('、')}`;
}

/* ------------------------------------------------------------------ */
/* Retrieval                                                           */
/* ------------------------------------------------------------------ */

interface ScoredNote {
  note: Note;
  score: number;
  index: number;
}

function scoreNote(note: Note, tokens: string[], normalizedQuery: string, body: string): number {
  const title = normalizeForMatch(note.title ?? '');
  const bodyLower = body.toLowerCase();
  let score = 0;

  if (normalizedQuery.length >= 2 && title.includes(normalizedQuery)) {
    score += TITLE_FULL_SCORE;
  }

  const tagKeys = new Set(
    (note.tags ?? []).map((tag) => tag.replace(/^#/, '').trim().toLowerCase()).filter(Boolean),
  );

  for (const token of tokens) {
    if (token) {
      if (title.includes(token)) score += TITLE_TOKEN_SCORE;
      if (tagKeys.has(token)) score += TAG_SCORE;
      const occurrences = countOccurrences(bodyLower, token);
      if (occurrences > 0) {
        score += BODY_SCORE + BODY_OCCURRENCE_SCORE * Math.min(occurrences, BODY_OCCURRENCE_CAP);
      }
    }
  }

  if (isTemplateNote(note)) score *= TEMPLATE_SCORE_FACTOR;
  return score;
}

/**
 * Deterministic keyword/tag/title retrieval over the user's notes.
 *
 * - Excludes directory notes, archived notes and plan items.
 * - Chinese queries match on character bigrams, so 「睡眠」 also finds 「昨晚睡得不好」.
 * - Scores title > tags > body; templates are included but ranked lower.
 * - The excerpt quotes ~120 characters around the first body match.
 * - Sorted by score, then most recently updated, then input order.
 *
 * A blank query returns the most recently updated knowledge notes (score 0),
 * which is handy for a search screen's idle list.
 */
export function searchKnowledge(notes: Note[], query: string, limit = DEFAULT_LIMIT): KnowledgeHit[] {
  const max = clampLimit(limit, DEFAULT_LIMIT);
  if (max === 0) return [];

  const candidates = notes.filter(isKnowledgeNote);
  const trimmed = normalizeText(query);

  if (!trimmed) {
    return candidates
      .map((note, index) => ({ note, index }))
      .sort((a, b) => b.note.updatedAt - a.note.updatedAt || a.index - b.index)
      .slice(0, max)
      .map(({ note }) => ({
        note,
        score: 0,
        excerpt: buildExcerpt(note, []),
      }));
  }

  const tokens = queryTokens(trimmed);
  if (tokens.length === 0) return [];

  const normalizedQuery = normalizeForMatch(trimmed);
  const scored: ScoredNote[] = [];

  candidates.forEach((note, index) => {
    const body = searchableBody(note);
    const score = scoreNote(note, tokens, normalizedQuery, body);
    if (score > 0) scored.push({ note, score, index });
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.note.updatedAt !== a.note.updatedAt) return b.note.updatedAt - a.note.updatedAt;
    return a.index - b.index;
  });

  return scored
    .slice(0, max)
    .map(({ note, score }) => ({ note, score, excerpt: buildExcerpt(note, tokens) }));
}

/* ------------------------------------------------------------------ */
/* Reply builders                                                      */
/* ------------------------------------------------------------------ */

function helpAnswer(): GroundedAnswer {
  return {
    text: '我会只根据你知识库里的记录回答：可以问我「我记过关于睡眠的记录吗」「本周花了多少」「昨天记了几条」，也可以说「给我一点建议」。找不到依据时，我会直接告诉你没有相关记录。',
    sources: [],
    grounded: false,
    usedFallback: true,
  };
}

function blankQueryAnswer(): GroundedAnswer {
  return {
    text: '想了解知识库里的什么？可以问我「我记过关于睡眠的记录吗」或「本周花了多少」。',
    sources: [],
    grounded: false,
    usedFallback: true,
  };
}

/** Strict refusal: never guess when the knowledge base has nothing relevant. */
function refusalAnswer(query: string): GroundedAnswer {
  const subject = clip(query, 40);
  return {
    text: `你的知识库里没有找到与「${subject}」相关的记录。可以先在经历库记一条，或换个关键词。`,
    sources: [],
    grounded: false,
    usedFallback: true,
  };
}

/** Lookup answer: list the matched notes with short quotes and cite sources. */
function lookupAnswer(notes: Note[], hits: KnowledgeHit[]): GroundedAnswer {
  const dirs = directoryNoteMap(notes);
  const lines = hits.map((hit) => {
    const directory = hit.note.dirId ? dirs.get(hit.note.dirId) : undefined;
    const where = directory ? ` · 目录「${directory.title}」` : '';
    return `· 《${hit.note.title}》（${dateLabel(hit.note)}${where}）：${hit.excerpt}`;
  });
  const sources = knowledgeSources(
    hits.map((hit) => hit.note),
    SOURCE_LIMIT,
  );
  return {
    text: [`根据你的知识库，找到 ${hits.length} 条相关记录：`, ...lines, formatSources(sources)]
      .filter(Boolean)
      .join('\n'),
    sources,
    grounded: true,
  };
}

function answerWithSources(text: string, sources: Note[]): GroundedAnswer {
  const unique = knowledgeSources(latestFirst(sources));
  const footer = formatSources(unique);
  return {
    text: footer ? `${text}\n${footer}` : text,
    sources: unique,
    grounded: true,
  };
}

/* ------------------------------------------------------------------ */
/* Stats answers                                                       */
/* ------------------------------------------------------------------ */

type StatScope = 'today' | 'yesterday' | 'week' | 'month';

type StatTopic =
  | 'money'
  | 'income'
  | 'sleep'
  | 'weight'
  | 'steps'
  | 'water'
  | 'exercise'
  | 'diet'
  | 'diary'
  | 'plan'
  | 'records'
  | 'overview';

interface ScopeWindow {
  scope: StatScope;
  label: string;
  days: DaySummary[];
  dayKeys: Set<string>;
}

interface StatLine {
  text: string;
  sources: Note[];
}

const STATS_TOPIC_RULES: readonly { topic: StatTopic; pattern: RegExp }[] = [
  { topic: 'income', pattern: /收入|工资|奖金|进账|赚了|赚/ },
  { topic: 'weight', pattern: /体重|称重/ },
  { topic: 'sleep', pattern: /睡眠|睡了|睡够/ },
  { topic: 'steps', pattern: /步数|走了|走路|万步/ },
  { topic: 'water', pattern: /喝水|饮水/ },
  { topic: 'exercise', pattern: /运动|跑步|健身|锻炼/ },
  { topic: 'money', pattern: /支出|花费|花了|消费|超支|账|钱/ },
  { topic: 'diet', pattern: /吃|饮食|热量|摄入|卡路里|餐/ },
  { topic: 'diary', pattern: /日记/ },
  { topic: 'plan', pattern: /计划|待办|任务/ },
  { topic: 'records', pattern: /记录|记了/ },
];

const STAT_TOPIC_LABELS: Record<StatTopic, string> = {
  money: '支出',
  income: '收入',
  sleep: '睡眠',
  weight: '体重',
  steps: '步数',
  water: '饮水',
  exercise: '运动',
  diet: '饮食',
  diary: '日记',
  plan: '计划',
  records: '记录',
  overview: '记录',
};

const NUMBER_SIGNAL_RE =
  /[？?]|多少|几[条次笔顿篇个项天]|怎么样|如何|趋势|平均|一共|总共|合计|统计|汇总|记了几/;
const SUMMARY_SIGNAL_RE = /总结|复盘|回顾|梳理/;
const LOOKUP_ONLY_RE = /我记过|记过|记录过|有没有|是否|找一下|找找|查一下|关于|的记录|哪些记录|列出/;
const REFLECTION_RE =
  /(?:给我|帮我|来点|来一些|提供|有什么|写几条|给点)[^。！？?]{0,6}建议|建议[？?]?$|怎么改进|如何改进|怎么调整|如何调整|怎么做得更好|怎么办|该不该|改进建议|优化建议/;
const HELP_RE = /帮助|能做什么|你能做什么|怎么用|使用说明|会什么/;

function detectTopic(query: string): StatTopic {
  for (const rule of STATS_TOPIC_RULES) {
    if (rule.pattern.test(query)) return rule.topic;
  }
  return 'overview';
}

function detectScope(query: string): StatScope {
  if (/昨天|昨日/.test(query)) return 'yesterday';
  if (/本月|这个月|当月/.test(query)) return 'month';
  if (/本周|这周|这个星期|这星期|最近|近七天|近 7 天|近一周/.test(query)) return 'week';
  if (/今天|今日|当天/.test(query)) return 'today';
  // Unqualified reflection/summary asks usually mean "最近几天".
  return SUMMARY_SIGNAL_RE.test(query) || /知识库/.test(query) ? 'week' : 'today';
}

function scopeLabel(scope: StatScope): string {
  switch (scope) {
    case 'yesterday':
      return '昨天';
    case 'week':
      return '最近 7 天';
    case 'month':
      return '这个月';
    default:
      return '今天';
  }
}

function shiftDay(date: Date, deltaDays: number): Date {
  const next = new Date(date.getTime());
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() + deltaDays);
  return next;
}

/** Calendar window for a stats question; summaries run on the knowledge corpus. */
function buildScope(knowledge: Note[], scope: StatScope, now: Date): ScopeWindow {
  let days: DaySummary[];
  switch (scope) {
    case 'yesterday':
      days = [summarizeDay(knowledge, shiftDay(now, -1))];
      break;
    case 'week':
      days = summarizeRange(knowledge, 7, now);
      break;
    case 'month':
      days = summarizeRange(knowledge, Math.max(1, now.getDate()), now);
      break;
    default:
      days = [summarizeDay(knowledge, now)];
      break;
  }
  return {
    scope,
    label: scopeLabel(scope),
    days,
    dayKeys: new Set(days.map((day) => day.dateKey)),
  };
}

function recordsInScope(knowledge: Note[], window: ScopeWindow): Note[] {
  return knowledge.filter((note) => window.dayKeys.has(noteDayKey(note))).sort(byTime);
}

function finiteNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function amountOf(note: Note): number {
  return Math.max(0, finiteNumber(note.meta?.amount) ?? 0);
}

interface MoneyTally {
  spend: number;
  income: number;
  outflow: Note[];
  inflow: Note[];
  categories: { category: string; amount: number }[];
}

/** Same money rules as `lib/insights`: food amounts + finance expenses are spend. */
function tallyMoney(records: Note[]): MoneyTally {
  const outflow: Note[] = [];
  const inflow: Note[] = [];
  const categories = new Map<string, number>();
  let spend = 0;
  let income = 0;

  for (const note of records) {
    const amount = amountOf(note);
    if (amount <= 0) continue;
    if (note.kind === 'food') {
      spend += amount;
      outflow.push(note);
      const category = (note.meta?.category ?? '').trim() || '餐饮';
      categories.set(category, (categories.get(category) ?? 0) + amount);
    } else if (note.kind === 'finance') {
      if (note.meta?.direction === 'income') {
        income += amount;
        inflow.push(note);
      } else {
        spend += amount;
        outflow.push(note);
        const category = (note.meta?.category ?? '').trim() || '其他';
        categories.set(category, (categories.get(category) ?? 0) + amount);
      }
    }
  }

  const grouped = [...categories.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => {
      if (b.amount !== a.amount) return b.amount - a.amount;
      return a.category < b.category ? -1 : a.category > b.category ? 1 : 0;
    });

  return { spend, income, outflow, inflow, categories: grouped };
}

function moneyStat(records: Note[], window: ScopeWindow): StatLine | null {
  const tally = tallyMoney(records);
  if (tally.spend <= 0 && tally.income <= 0) return null;

  if (tally.spend <= 0) {
    const count = tally.inflow.length;
    return {
      text: `依据是「你的 ${count} 条记录」：${window.label}没有支出记录，收入 ${formatMoney(tally.income)}。`,
      sources: tally.inflow,
    };
  }

  const top = tally.categories[0];
  const topText = top ? `，最多的是${top.category}（${formatMoney(top.amount)}）` : '';
  const incomeText = tally.income > 0 ? `；另有收入 ${formatMoney(tally.income)}` : '';
  const count = tally.outflow.length + tally.inflow.length;
  return {
    text: `依据是「你的 ${count} 条记录」：${window.label}共支出 ${formatMoney(tally.spend)}${topText}${incomeText}。`,
    sources: [...tally.outflow, ...tally.inflow],
  };
}

function incomeStat(records: Note[], window: ScopeWindow): StatLine | null {
  const tally = tallyMoney(records);
  if (tally.income <= 0) return null;
  return {
    text: `依据是「你的 ${tally.inflow.length} 条记录」：${window.label}收入 ${formatMoney(tally.income)}。`,
    sources: tally.inflow,
  };
}

interface MetricEntry {
  note: Note;
  value: number;
}

function metricValues(records: Note[], metric: HealthMetric): MetricEntry[] {
  const entries: MetricEntry[] = [];
  for (const note of records) {
    if (note.kind !== 'health' || note.meta?.metric !== metric) continue;
    const value = finiteNumber(note.meta?.value);
    if (value === undefined || value <= 0) continue;
    entries.push({ note, value });
  }
  return entries;
}

/**
 * Generic single-day "latest value" / multi-day "average" metric answer.
 * `label` is pasted in front of the value, e.g. 「睡眠 7.2 小时」/「走了 8321 步」.
 * Mixed units (运动 can be 分钟 or 公里) are averaged as recorded; the latest
 * unit is shown.
 */
function metricStat(
  records: Note[],
  window: ScopeWindow,
  metric: HealthMetric,
  label: string,
  unitDefault: string,
  decimals: number,
): StatLine | null {
  const entries = metricValues(records, metric);
  if (entries.length === 0) return null;

  const latest = entries[entries.length - 1];
  const unit = latest.note.meta?.unit?.trim() || unitDefault;

  if (window.scope === 'today' || window.scope === 'yesterday') {
    return {
      text: `依据是「你的 ${entries.length} 条记录」：${window.label}${label} ${formatAmount(latest.value)} ${unit}。`,
      sources: [latest.note],
    };
  }

  const total = entries.reduce((sum, entry) => sum + entry.value, 0);
  const average = roundTo(total / entries.length, decimals);
  return {
    text: `依据是「你的 ${entries.length} 条记录」：${window.label}${label}平均 ${formatAmount(average)} ${unit}。`,
    sources: latestFirst(entries.map((entry) => entry.note)),
  };
}

/** Weight needs a special case: if the window is empty, cite the latest real weight. */
function weightStat(records: Note[], window: ScopeWindow, knowledge: Note[]): StatLine | null {
  const entries = metricValues(records, '体重');
  if (entries.length > 0) {
    const latest = entries[entries.length - 1];
    if (window.scope === 'today' || window.scope === 'yesterday' || entries.length === 1) {
      return {
        text: `依据是「你的 ${entries.length} 条记录」：${window.label}体重 ${formatAmount(latest.value)} kg。`,
        sources: [latest.note],
      };
    }
    const first = entries[0];
    const change = roundTo(latest.value - first.value, 1);
    const changeText = change === 0 ? '，基本持平' : '';
    return {
      text: `依据是「你的 ${entries.length} 条记录」：${window.label}体重从 ${formatAmount(
        first.value,
      )} kg 到 ${formatAmount(latest.value)} kg${changeText}。`,
      sources: latestFirst(entries.map((entry) => entry.note)),
    };
  }

  const overall = metricValues(knowledge, '体重');
  const latest = overall[overall.length - 1];
  if (!latest) return null;
  return {
    text: `依据是「你的 1 条记录」：${window.label}还没有体重记录；最近一次是${dateLabel(
      latest.note,
    )}，体重 ${formatAmount(latest.value)} kg。`,
    sources: [latest.note],
  };
}

function dietStat(records: Note[], window: ScopeWindow): StatLine | null {
  const foods = records.filter((note) => note.kind === 'food');
  if (foods.length === 0) return null;

  let calories = 0;
  let spend = 0;
  const dishes: string[] = [];
  for (const note of foods) {
    calories += Math.max(0, finiteNumber(note.meta?.calories) ?? 0);
    spend += amountOf(note);
    for (const raw of note.meta?.dishes ?? []) {
      const dish = raw.trim();
      if (dish && !dishes.includes(dish)) dishes.push(dish);
    }
  }

  const parts = [`${window.label}吃了 ${foods.length} 顿`];
  if (calories > 0) parts.push(`摄入 ${Math.round(calories)} kcal`);
  if (spend > 0) parts.push(`花费 ${formatMoney(spend)}`);
  const dishText = dishes.length > 0 ? `（${dishes.slice(0, 3).join('、')}）` : '';
  return {
    text: `依据是「你的 ${foods.length} 条记录」：${parts.join('，')}${dishText}。`,
    sources: foods,
  };
}

function diaryStat(records: Note[], window: ScopeWindow): StatLine | null {
  const diaries = records.filter((note) => note.kind === 'diary');
  if (diaries.length === 0) return null;
  const titles = diaries.slice(0, 3).map((note) => `《${note.title}》`).join('');
  const titleText = titles ? `：${titles}` : '';
  return {
    text: `依据是「你的 ${diaries.length} 条记录」：${window.label}写了 ${diaries.length} 篇日记${titleText}。`,
    sources: diaries,
  };
}

function recordsStat(records: Note[], window: ScopeWindow): StatLine | null {
  if (records.length === 0) return null;

  const counts = { food: 0, health: 0, finance: 0, diary: 0, note: 0 };
  for (const note of records) counts[note.kind] += 1;

  const parts: string[] = [];
  if (counts.food > 0) parts.push(`饮食 ${counts.food} 条`);
  if (counts.health > 0) parts.push(`健康 ${counts.health} 条`);
  if (counts.finance > 0) parts.push(`收支 ${counts.finance} 笔`);
  if (counts.diary > 0) parts.push(`日记 ${counts.diary} 篇`);
  if (counts.note > 0) parts.push(`笔记 ${counts.note} 条`);

  return {
    text: `依据是「你的 ${records.length} 条记录」：${window.label}共记了 ${records.length} 条，其中${parts.join('、')}。`,
    sources: records,
  };
}

/** Plans are open items, not day-bound records, so the window does not apply. */
function planStat(notes: Note[]): StatLine | null {
  const plans = notes
    .filter((note) => note.meta?.plan && !note.archivedAt && !note.meta?.directory)
    .sort(byTime);
  if (plans.length === 0) return null;

  let todo = 0;
  let doing = 0;
  let done = 0;
  for (const note of plans) {
    switch (note.meta?.plan?.status) {
      case 'done':
        done += 1;
        break;
      case 'doing':
        doing += 1;
        break;
      default:
        todo += 1;
        break;
    }
  }

  const parts: string[] = [];
  if (todo > 0) parts.push(`待办 ${todo} 项`);
  if (doing > 0) parts.push(`进行中 ${doing} 项`);
  if (done > 0) parts.push(`已完成 ${done} 项`);
  return {
    text: `依据是「你的 ${plans.length} 条记录」：计划里有 ${parts.join('、')}。`,
    sources: plans,
  };
}

function overviewStat(records: Note[], window: ScopeWindow): StatLine | null {
  if (records.length === 0) return null;

  const tally = tallyMoney(records);
  const parts: string[] = [];
  if (tally.spend > 0) parts.push(`支出 ${formatMoney(tally.spend)}`);
  if (tally.income > 0) parts.push(`收入 ${formatMoney(tally.income)}`);

  const foods = records.filter((note) => note.kind === 'food');
  if (foods.length > 0) {
    const calories = foods.reduce(
      (sum, note) => sum + Math.max(0, finiteNumber(note.meta?.calories) ?? 0),
      0,
    );
    parts.push(`饮食 ${foods.length} 次${calories > 0 ? `（${Math.round(calories)} kcal）` : ''}`);
  }

  const sleep = metricValues(records, '睡眠');
  const sleepLatest = sleep[sleep.length - 1];
  if (sleepLatest) parts.push(`睡眠 ${formatAmount(sleepLatest.value)} 小时`);

  const steps = metricValues(records, '步数');
  const stepsLatest = steps[steps.length - 1];
  if (stepsLatest) parts.push(`走了 ${Math.round(stepsLatest.value)} 步`);

  const diaries = records.filter((note) => note.kind === 'diary').length;
  if (diaries > 0) parts.push(`日记 ${diaries} 篇`);

  const plainNotes = records.filter((note) => note.kind === 'note').length;
  if (plainNotes > 0) parts.push(`笔记 ${plainNotes} 条`);

  if (parts.length === 0) parts.push(`记了 ${records.length} 条记录`);

  return {
    text: `依据是「你的 ${records.length} 条记录」：${window.label}${parts.join('，')}。`,
    sources: records,
  };
}

function statsNoData(topic: StatTopic, window: ScopeWindow): GroundedAnswer {
  if (topic === 'plan') {
    return {
      text: '你的知识库里还没有计划记录。可以先在计划模块加一项，之后的摘要就能看到进度。',
      sources: [],
      grounded: false,
      usedFallback: true,
    };
  }
  const label = STAT_TOPIC_LABELS[topic];
  const detail = topic === 'overview' ? '' : label;
  return {
    text: `你的知识库里还没有${window.label}的${detail}记录。可以先在经历库记一条，或换个时间范围。`,
    sources: [],
    grounded: false,
    usedFallback: true,
  };
}

function statsReply(notes: Note[], query: string, now: Date): GroundedAnswer {
  const knowledge = notes.filter(isKnowledgeNote).sort(byTime);
  const topic = detectTopic(query);
  const scope = detectScope(query);
  const window = buildScope(knowledge, scope, now);
  const records = recordsInScope(knowledge, window);

  let line: StatLine | null = null;
  switch (topic) {
    case 'money':
      line = moneyStat(records, window);
      break;
    case 'income':
      line = incomeStat(records, window);
      break;
    case 'sleep':
      line = metricStat(records, window, '睡眠', '睡眠', '小时', 1);
      break;
    case 'steps':
      line = metricStat(records, window, '步数', '走了', '步', 0);
      break;
    case 'water':
      line = metricStat(records, window, '饮水', '喝水', 'ml', 0);
      break;
    case 'exercise':
      line = metricStat(records, window, '运动', '运动', '分钟', 0);
      break;
    case 'weight':
      line = weightStat(records, window, knowledge);
      break;
    case 'diet':
      line = dietStat(records, window);
      break;
    case 'diary':
      line = diaryStat(records, window);
      break;
    case 'plan':
      line = planStat(notes);
      break;
    case 'records':
      line = recordsStat(records, window);
      break;
    default:
      line = overviewStat(records, window);
      break;
  }

  if (!line) return statsNoData(topic, window);
  return answerWithSources(line.text, line.sources);
}

/* ------------------------------------------------------------------ */
/* Reflection answers                                                  */
/* ------------------------------------------------------------------ */

/**
 * Suggestions for a reflection question. Every line is derived from the cited
 * records and names the record it comes from — no generic "保持健康" advice.
 */
function reflectionSuggestions(cited: Note[], dirs: Map<string, Note>): string[] {
  const suggestions: string[] = [];
  const push = (line: string) => {
    const trimmed = line.trim();
    if (trimmed && !suggestions.includes(trimmed)) suggestions.push(trimmed);
  };

  for (const note of cited) {
    const directory = note.dirId ? dirs.get(note.dirId) : undefined;
    if (directory) {
      push(`《${note.title}》已经收在「${directory.title}」目录里，可以在这个目录下补一条复盘。`);
    } else if (note.kind === 'note' || note.kind === 'diary') {
      push(`把《${note.title}》归到一个知识库目录里，之后按目录回顾会更清楚。`);
    }

    if ((note.kind === 'food' || note.kind === 'finance') && amountOf(note) > 0) {
      const category = (note.meta?.category ?? '').trim() || (note.kind === 'food' ? '餐饮' : '其他');
      push(
        `《${note.title}》对应 ${formatMoney(amountOf(note))} 的${category}；下次记的时候补一句用途，回看时更容易判断值不值。`,
      );
    } else if (note.kind === 'health' && finiteNumber(note.meta?.value) !== undefined) {
      const metric = note.meta?.metric ?? '健康';
      const unit = note.meta?.unit?.trim() ?? '';
      const value = `${formatAmount(note.meta.value as number)}${unit ? ` ${unit}` : ''}`;
      push(`《${note.title}》记的是${metric} ${value}；每天在同一时间记一次，趋势会更可靠。`);
    } else if (note.kind === 'diary') {
      push(`把《${note.title}》里的一件事改写成「发生了什么 / 下次怎么做」两行，下次回顾更容易接上。`);
    } else if (note.kind === 'note') {
      const firstTag = (note.tags ?? [])[0];
      if (firstTag) {
        push(`《${note.title}》已经有 #${firstTag} 标签，可以把它和其它同标签的记录串起来看。`);
      } else {
        push(`给《${note.title}》补一个 #标签，知识库检索会更容易找到它。`);
      }
    }

    if (suggestions.length >= 3) break;
  }

  const first = cited[0];
  if (first) {
    push(`先从《${first.title}》开始，把它补成一条包含时间、地点和感受的完整记录。`);
  }
  push('把最近这几条记录归到同一个目录，下次回顾时就能连起来看。');

  return suggestions.slice(0, 3);
}

function reflectionReply(notes: Note[], query: string): GroundedAnswer {
  const knowledge = notes.filter(isKnowledgeNote).sort(byTime);
  if (knowledge.length === 0) {
    return {
      text: '你的知识库里还没有记录，暂时没有可以依据的内容。可以先在经历库记一条，我再基于你的记录给建议。',
      sources: [],
      grounded: false,
      usedFallback: true,
    };
  }

  const hits = searchKnowledge(notes, query, LOOKUP_LIMIT);
  const usedSearch = hits.length > 0;
  const cited = usedSearch
    ? hits.map((hit) => hit.note)
    : [...knowledge]
        .filter((note) => !isTemplateNote(note))
        .sort(byTime)
        .reverse()
        .slice(0, LOOKUP_LIMIT);

  if (cited.length === 0) return refusalAnswer(query);

  const lines = cited.map((note) => {
    const excerpt = buildExcerpt(note, usedSearch ? queryTokens(query) : []);
    return `· 《${note.title}》（${dateLabel(note)}）：${excerpt}`;
  });
  const dirs = directoryNoteMap(notes);
  const suggestions = reflectionSuggestions(cited, dirs);
  const sources = knowledgeSources([...cited]);

  return {
    text: [
      usedSearch
        ? `我翻了你的知识库里和相关主题有关的 ${cited.length} 条记录：`
        : `我翻了你的知识库里最近的 ${cited.length} 条记录：`,
      ...lines,
      '下面是从这些记录出发的建议：',
      ...suggestions.map((line, index) => `${index + 1}. ${line}`),
      formatSources(sources),
    ]
      .filter(Boolean)
      .join('\n'),
    sources,
    grounded: true,
    usedFallback: usedSearch ? undefined : true,
  };
}

/* ------------------------------------------------------------------ */
/* Public entry point                                                  */
/* ------------------------------------------------------------------ */

function isStatsQuestion(query: string): boolean {
  const numberSignal = NUMBER_SIGNAL_RE.test(query);
  const summarySignal = SUMMARY_SIGNAL_RE.test(query);
  if (LOOKUP_ONLY_RE.test(query) && !numberSignal && !summarySignal) return false;
  if (numberSignal || summarySignal) return true;
  // Plan questions read like status questions rather than numeric stats.
  if (detectTopic(query) === 'plan' && /还有|什么|哪些|进度|完成|待办/.test(query)) return true;
  return false;
}

/**
 * Answer a question strictly from the user's knowledge base.
 *
 * Routing (deterministic):
 * - help / blank input → guidance, `grounded: false`.
 * - reflection (「给我建议」「怎么改进」) → cite recent or matching records and
 *   derive every suggestion from them.
 * - stats (「今天花了多少」「最近睡眠怎么样」「计划里还有什么」) → computed from
 *   `lib/insights`; the text states 「依据是「你的 N 条记录」」 and lists the
 *   underlying note ids as sources.
 * - lookup (「我记过…」「关于…」) → `searchKnowledge` hits with quotes + 来源.
 * - nothing relevant → a refusal, `grounded: false`, empty sources.
 *
 * @param notes whole vault (directories / archived / plan items are filtered)
 * @param query the user's question in natural Chinese
 * @param now   "now" anchor for the stats window; pass it in tests
 */
export function groundedAnswer(notes: Note[], query: string, now = new Date()): GroundedAnswer {
  const trimmed = normalizeText(query);
  if (!trimmed) return blankQueryAnswer();
  if (HELP_RE.test(trimmed)) return helpAnswer();
  if (REFLECTION_RE.test(trimmed)) return reflectionReply(notes, trimmed);
  if (isStatsQuestion(trimmed)) return statsReply(notes, trimmed, now);

  const hits = searchKnowledge(notes, trimmed, LOOKUP_LIMIT);
  if (hits.length > 0) return lookupAnswer(notes, hits);
  return refusalAnswer(trimmed);
}
