import type { HealthMetric, Note, NoteMeta } from './types';
import { HEALTH_METRICS, HEALTH_UNITS, formatAmount } from './kinds';
import { dayKeyOf, noteDayKey } from './insights';

/**
 * Apple Health / Apple Watch import adapter for 麻薯 (Mashu).
 *
 * The app is local-first and has no server, so there is no HealthKit bridge
 * here: this module only parses data the user exported or handed over through
 * an Apple Shortcut. It accepts three input shapes —
 *
 *  1. JSON: an array, `{ samples: [...] }` or one Shortcuts-style object;
 *  2. CSV: a header row with `type,date,value[,unit,source,detail]`;
 *  3. a URL payload: base64url-encoded JSON or raw JSON (`?health=...`).
 *
 * Everything is pure and deterministic. Parsed samples carry canonical Chinese
 * units (`步` / `小时` / `bpm` / `kg` / `ml` / `kcal` / `分钟`), which are then
 * folded into ordinary `note` records of kind `health` — same data model as a
 * manually typed record, so the rest of the app needs no special cases.
 */

export type HealthSampleType =
  | 'steps'
  | 'sleep'
  | 'heartRate'
  | 'restingHeartRate'
  | 'weight'
  | 'water'
  | 'activeEnergy'
  | 'workout';

export interface HealthSample {
  type: HealthSampleType;
  value: number;
  unit?: string;
  /** ISO-8601 timestamp of the sample. */
  date: string;
  source?: string;
  detail?: string;
}

export interface HealthParseResult {
  samples: HealthSample[];
  skipped: number;
}

export interface HealthNoteDraft {
  kind: 'health';
  title: string;
  content: string;
  meta: NoteMeta;
  /** Set when an existing health note for the same day + metric should be updated. */
  replaceId?: string;
}

/* ------------------------------------------------------------------ */
/* Canonical units and type aliases                                     */
/* ------------------------------------------------------------------ */

const TYPE_METRIC: Record<HealthSampleType, HealthMetric> = {
  steps: '步数',
  sleep: '睡眠',
  heartRate: '心率',
  restingHeartRate: '心率',
  weight: '体重',
  water: '饮水',
  activeEnergy: '活动能量',
  workout: '运动',
};

const TYPE_UNIT: Record<HealthSampleType, string> = {
  steps: HEALTH_UNITS['步数'],
  sleep: HEALTH_UNITS['睡眠'],
  heartRate: HEALTH_UNITS['心率'],
  restingHeartRate: HEALTH_UNITS['心率'],
  weight: HEALTH_UNITS['体重'],
  water: HEALTH_UNITS['饮水'],
  activeEnergy: HEALTH_UNITS['活动能量'],
  workout: HEALTH_UNITS['运动'],
};

/** Samples that represent a running total are summed per day. */
const SUM_TYPES: ReadonlySet<HealthSampleType> = new Set<HealthSampleType>([
  'steps',
  'water',
  'activeEnergy',
]);

/** Alias → canonical type. Keys are lower-cased with spaces/punctuation removed. */
const TYPE_ALIASES: Readonly<Record<string, HealthSampleType>> = {
  stepcount: 'steps',
  steps: 'steps',
  step: 'steps',
  步数: 'steps',
  步: 'steps',
  走路: 'steps',
  sleep: 'sleep',
  sleepanalysis: 'sleep',
  sleepduration: 'sleep',
  睡眠: 'sleep',
  睡觉: 'sleep',
  heartrate: 'heartRate',
  heart: 'heartRate',
  心率: 'heartRate',
  pulse: 'heartRate',
  restingheartrate: 'restingHeartRate',
  restingrate: 'restingHeartRate',
  restingpulse: 'restingHeartRate',
  静息心率: 'restingHeartRate',
  bodymass: 'weight',
  weight: 'weight',
  mass: 'weight',
  体重: 'weight',
  称重: 'weight',
  dietarywater: 'water',
  water: 'water',
  waterintake: 'water',
  饮水: 'water',
  喝水: 'water',
  activeenergyburned: 'activeEnergy',
  activeenergy: 'activeEnergy',
  activecalories: 'activeEnergy',
  活动能量: 'activeEnergy',
  活动热量: 'activeEnergy',
  workout: 'workout',
  workouts: 'workout',
  exercise: 'workout',
  运动: 'workout',
  锻炼: 'workout',
  // HealthKit identifiers (Apple Health exports / Shortcuts can send these).
  hkquantitytypeidentifierstepcount: 'steps',
  hkquantitytypeidentifierheartrate: 'heartRate',
  hkquantitytypeidentifierrestingheartrate: 'restingHeartRate',
  hkquantitytypeidentifierbodymass: 'weight',
  hkquantitytypeidentifierdietarywater: 'water',
  hkquantitytypeidentifieractiveenergyburned: 'activeEnergy',
  hkcategorytypeidentifiersleepanalysis: 'sleep',
  hkworkouttypeidentifier: 'workout',
};

/** Normalize an alias key: lower case, drop spaces and separators. */
function aliasKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s_\-./]+/g, '');
}

function resolveType(raw: unknown): HealthSampleType | undefined {
  if (typeof raw !== 'string') return undefined;
  return TYPE_ALIASES[aliasKey(raw)];
}

function textOf(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/* ------------------------------------------------------------------ */
/* Value and date parsing                                               */
/* ------------------------------------------------------------------ */

function parseNumber(raw: unknown): number | undefined {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw !== 'string') return undefined;
  const match = /-?\d+(?:\.\d+)?/.exec(raw.replace(/,/g, ''));
  if (!match) return undefined;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : undefined;
}

/** Accept epoch ms, epoch seconds, ISO strings and `YYYY-MM-DD` variants. */
function parseDateMs(raw: unknown): number | undefined {
  if (typeof raw === 'number') return normalizeEpoch(raw);
  if (typeof raw !== 'string') return undefined;
  const text = raw.trim();
  if (!text) return undefined;
  if (/^\d{8}$/.test(text)) {
    const year = Number(text.slice(0, 4));
    const month = Number(text.slice(4, 6));
    const day = Number(text.slice(6, 8));
    const parsed = new Date(year, month - 1, day).getTime();
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return normalizeEpoch(Number(text));
  const normalized = text.replace(/[年月]/g, '-').replace(/日/g, ' ');
  const parsed = new Date(normalized).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeEpoch(value: number): number | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  // Epoch seconds are ~1e9 today, epoch milliseconds ~1e12.
  const ms = value < 1e11 ? value * 1000 : value;
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/* ------------------------------------------------------------------ */
/* Unit conversion into canonical units                                 */
/* ------------------------------------------------------------------ */

function unitKey(unit: string | undefined): string {
  return (unit ?? '').trim().toLowerCase();
}

function isMinuteUnit(unit: string): boolean {
  return ['min', 'mins', 'minute', 'minutes', '分钟', '分'].includes(unit);
}

function isHourUnit(unit: string): boolean {
  return ['h', 'hr', 'hrs', 'hour', 'hours', '小时', '钟头'].includes(unit);
}

function convertValue(
  type: HealthSampleType,
  value: number,
  unit: string | undefined,
): { value: number; unit: string } | undefined {
  if (!Number.isFinite(value)) return undefined;
  const key = unitKey(unit);

  switch (type) {
    case 'steps': {
      const steps = Math.round(value);
      if (!(steps > 0 && steps <= 200000)) return undefined;
      return { value: steps, unit: TYPE_UNIT.steps };
    }
    case 'sleep': {
      let hours: number;
      if (isMinuteUnit(key)) hours = value / 60;
      else if (isHourUnit(key)) hours = value;
      else hours = value > 24 ? value / 60 : value; // no unit: >24 can only be minutes
      if (!(hours > 0 && hours <= 24)) return undefined;
      return { value: roundTo(hours, 2), unit: TYPE_UNIT.sleep };
    }
    case 'heartRate':
    case 'restingHeartRate': {
      const bpm = Math.round(value);
      if (!(bpm >= 20 && bpm <= 300)) return undefined;
      return { value: bpm, unit: TYPE_UNIT.heartRate };
    }
    case 'weight': {
      let kg = value;
      if (['lb', 'lbs', 'pound', 'pounds', '磅'].includes(key)) kg = value * 0.45359237;
      else if (['g', 'gram', 'grams', '克'].includes(key)) kg = value / 1000;
      else if (key === '斤') kg = value / 2;
      if (!(kg > 0 && kg <= 400)) return undefined;
      return { value: roundTo(kg, 1), unit: TYPE_UNIT.weight };
    }
    case 'water': {
      let ml = value;
      if (['l', 'liter', 'liters', 'litre', 'litres', '升'].includes(key)) ml = value * 1000;
      if (!(ml > 0 && ml <= 20000)) return undefined;
      return { value: Math.round(ml), unit: TYPE_UNIT.water };
    }
    case 'activeEnergy': {
      let kcal = value;
      if (['kj', 'kilojoule', 'kilojoules', '千焦'].includes(key)) kcal = value / 4.184;
      if (!(kcal > 0 && kcal <= 20000)) return undefined;
      return { value: Math.round(kcal), unit: TYPE_UNIT.activeEnergy };
    }
    case 'workout': {
      if (['km', '公里', '千米', 'mile', 'miles', '英里'].includes(key)) {
        const km = ['mile', 'miles', '英里'].includes(key) ? value * 1.609344 : value;
        if (!(km > 0 && km <= 500)) return undefined;
        return { value: roundTo(km, 2), unit: '公里' };
      }
      let minutes = value;
      if (isHourUnit(key)) minutes = value * 60;
      else if (isMinuteUnit(key)) minutes = value;
      if (!(minutes > 0 && minutes <= 1440)) return undefined;
      return { value: Math.round(minutes), unit: TYPE_UNIT.workout };
    }
    default:
      return undefined;
  }
}

/* ------------------------------------------------------------------ */
/* Raw item → canonical sample                                          */
/* ------------------------------------------------------------------ */

interface HealthRawItem {
  type?: unknown;
  value?: unknown;
  date?: unknown;
  unit?: unknown;
  source?: unknown;
  detail?: unknown;
}

function normalizeRawItem(raw: unknown): HealthSample | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const item = raw as Record<string, unknown>;

  const type = resolveType(
    item.type ?? item.metric ?? item.kind ?? item.healthType ?? item.identifier,
  );
  if (!type) return undefined;

  const rawValue = parseNumber(
    item.value ?? item.amount ?? item.count ?? item.quantity ?? item.total,
  );
  if (rawValue === undefined) return undefined;

  const dateMs = parseDateMs(
    item.date ?? item.startDate ?? item.start ?? item.timestamp ?? item.time ?? item.endDate,
  );
  if (dateMs === undefined) return undefined;

  const converted = convertValue(type, rawValue, textOf(item.unit));
  if (!converted) return undefined;

  const sample: HealthSample = {
    type,
    value: converted.value,
    unit: converted.unit,
    date: new Date(dateMs).toISOString(),
  };
  const source = textOf(item.source);
  if (source) sample.source = source;
  const detail = textOf(item.detail ?? item.activity ?? item.label ?? item.name);
  if (detail) sample.detail = detail;
  return sample;
}

/** Turn a JSON root value into the list of raw items it contains. */
function jsonItems(root: unknown): unknown[] | undefined {
  if (Array.isArray(root)) return root;
  if (root && typeof root === 'object') {
    const obj = root as Record<string, unknown>;
    if (Array.isArray(obj.samples)) return obj.samples;
    if (Array.isArray(obj.data)) return obj.data;
    return [root];
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Public parsers                                                       */
/* ------------------------------------------------------------------ */

/**
 * Parse Apple Health JSON. Accepts an array, `{ samples: [...] }` (or `data`),
 * or one Shortcuts-style object with `type/value/date/unit/source/detail`.
 * Invalid items only increase `skipped`; they never throw.
 */
export function parseHealthJson(text: string): HealthParseResult {
  const source = typeof text === 'string' ? text.trim() : '';
  if (!source) return { samples: [], skipped: 0 };

  let root: unknown;
  try {
    root = JSON.parse(source);
  } catch {
    return { samples: [], skipped: 1 };
  }

  const items = jsonItems(root);
  if (!items) return { samples: [], skipped: 1 };

  const samples: HealthSample[] = [];
  let skipped = 0;
  for (const item of items) {
    const sample = normalizeRawItem(item);
    if (sample) samples.push(sample);
    else skipped += 1;
  }
  return { samples, skipped };
}

/** Split one CSV line, honouring double-quoted cells and `""` escapes. */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

const COLUMN_ALIASES: Readonly<Record<'type' | 'date' | 'value' | 'unit' | 'source' | 'detail', readonly string[]>> = {
  type: ['type', '类型', 'metric', 'kind'],
  date: ['date', '日期', '时间', 'startdate', 'start'],
  value: ['value', '数值', '值', 'amount'],
  unit: ['unit', '单位'],
  source: ['source', '来源', 'device'],
  detail: ['detail', '备注', '说明', 'activity'],
};

function findColumn(header: string[], names: readonly string[]): number {
  const normalized = header.map((cell) => cell.trim().toLowerCase());
  for (const name of names) {
    const index = normalized.indexOf(name);
    if (index !== -1) return index;
  }
  return -1;
}

/**
 * Parse a CSV export with a header row:
 * `type,date,value[,unit][,source][,detail]`. Column names are matched
 * case-insensitively (Chinese aliases are accepted too). Rows that cannot be
 * understood only increase `skipped`.
 */
export function parseHealthCsv(text: string): HealthParseResult {
  const source = typeof text === 'string' ? text.replace(/^\uFEFF/, '') : '';
  const lines = source.split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { samples: [], skipped: 0 };

  const header = parseCsvLine(lines[0]);
  const columns = {
    type: findColumn(header, COLUMN_ALIASES.type),
    date: findColumn(header, COLUMN_ALIASES.date),
    value: findColumn(header, COLUMN_ALIASES.value),
    unit: findColumn(header, COLUMN_ALIASES.unit),
    source: findColumn(header, COLUMN_ALIASES.source),
    detail: findColumn(header, COLUMN_ALIASES.detail),
  };
  const rows = lines.slice(1);

  if (columns.type === -1 || columns.date === -1 || columns.value === -1) {
    // A header without type/date/value cannot describe a single row.
    return { samples: [], skipped: rows.length > 0 ? rows.length : 1 };
  }

  const samples: HealthSample[] = [];
  let skipped = 0;
  const pick = (cells: string[], index: number): string | undefined => {
    if (index === -1) return undefined;
    const cell = cells[index];
    if (cell === undefined) return undefined;
    const trimmed = cell.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };

  for (const row of rows) {
    const cells = parseCsvLine(row);
    const sample = normalizeRawItem({
      type: pick(cells, columns.type),
      date: pick(cells, columns.date),
      value: pick(cells, columns.value),
      unit: pick(cells, columns.unit),
      source: pick(cells, columns.source),
      detail: pick(cells, columns.detail),
    } satisfies HealthRawItem);
    if (sample) samples.push(sample);
    else skipped += 1;
  }
  return { samples, skipped };
}

/* ------------------------------------------------------------------ */
/* URL payload (Apple Shortcuts)                                        */
/* ------------------------------------------------------------------ */

function decodeBase64Url(payload: string): string | undefined {
  const normalized = payload.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!normalized) return undefined;
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}

function tryParseJsonText(text: string): HealthParseResult | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  return parseHealthJson(trimmed);
}

/**
 * Decode the `?health=` URL parameter used by the Apple Shortcut. The payload
 * may be raw JSON or base64url-encoded JSON (UTF-8 aware, so Chinese aliases
 * such as 步数 survive). Unrecognised payloads return `skipped: 1`.
 */
export function decodeHealthPayload(payload: string): HealthParseResult {
  const text = typeof payload === 'string' ? payload.trim() : '';
  if (!text) return { samples: [], skipped: 0 };

  const direct = tryParseJsonText(text);
  if (direct) return direct;

  // The parameter may still be URL-encoded when it is read from a raw string.
  if (/%[0-9a-f]{2}/i.test(text)) {
    try {
      const decoded = decodeURIComponent(text);
      if (decoded !== text) {
        const fromUri = tryParseJsonText(decoded);
        if (fromUri) return fromUri;
      }
    } catch {
      // Fall through to the base64url branch.
    }
  }

  const decodedBase64 = decodeBase64Url(text);
  if (decodedBase64 !== undefined) {
    const fromBase64 = tryParseJsonText(decodedBase64);
    if (fromBase64) return fromBase64;
  }

  return { samples: [], skipped: 1 };
}

/* ------------------------------------------------------------------ */
/* Samples → health note drafts                                         */
/* ------------------------------------------------------------------ */

const METRIC_ORDER: ReadonlyMap<HealthMetric, number> = new Map(
  HEALTH_METRICS.map((metric, index): [HealthMetric, number] => [metric, index]),
);

function metricRank(metric: HealthMetric): number {
  return METRIC_ORDER.get(metric) ?? HEALTH_METRICS.length;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Local `YYYY-MM-DD HH:mm` for the note content. */
function localStamp(ts: number): string {
  const date = new Date(ts);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

const WORKOUT_LABELS: ReadonlyArray<readonly [RegExp, string]> = [
  [/run/i, '跑步'],
  [/walk/i, '步行'],
  [/cycl|bike|bicycle/i, '骑行'],
  [/swim/i, '游泳'],
  [/yoga/i, '瑜伽'],
  [/hik/i, '徒步'],
  [/row/i, '划船'],
  [/strength|weight|力量/i, '力量训练'],
];

function workoutLabel(sample: HealthSample): string {
  const detail = textOf(sample.detail);
  if (detail) {
    if (/[\u3400-\u9fff]/.test(detail)) return detail.slice(0, 12);
    for (const [pattern, label] of WORKOUT_LABELS) {
      if (pattern.test(detail)) return label;
    }
  }
  return '运动';
}

function draftTitle(latest: PreparedSample): string {
  const { value, unit, metric, type } = latest;
  switch (metric) {
    case '步数':
      return `步数 ${Math.round(value)} 步`;
    case '睡眠':
      return `睡眠 ${formatAmount(value)} 小时`;
    case '心率':
      return type === 'restingHeartRate'
        ? `静息心率 ${Math.round(value)} bpm`
        : `心率 ${Math.round(value)} bpm`;
    case '体重':
      return `体重 ${formatAmount(value)} kg`;
    case '饮水':
      return `饮水 ${Math.round(value)} ml`;
    case '活动能量':
      return `活动能量 ${Math.round(value)} kcal`;
    case '运动': {
      const label = workoutLabel(latest.sample);
      return unit === '公里'
        ? `${label} ${formatAmount(value)} 公里`
        : `${label} ${Math.round(value)} 分钟`;
    }
    default:
      return `${metric} ${formatAmount(value)}`;
  }
}

function draftContent(
  title: string,
  latest: PreparedSample,
  count: number,
): string {
  const source = textOf(latest.sample.source) ?? 'Apple 健康';
  const lines = [`${title}（${localStamp(latest.ts)}）`];
  if (count > 1) lines.push(`合并 ${count} 条样本。`);
  lines.push(`来源：${source}`);
  return `${lines.join('\n')}\n\n#健康 #Apple健康`;
}

interface PreparedSample {
  sample: HealthSample;
  /** Position in the input array, used as a deterministic tie-breaker. */
  index: number;
  type: HealthSampleType;
  metric: HealthMetric;
  value: number;
  unit: string;
  ts: number;
  dayKey: string;
}

function prepareSample(sample: HealthSample, index: number): PreparedSample | undefined {
  if (!sample || typeof sample !== 'object') return undefined;
  const type = resolveType(sample.type);
  if (!type) return undefined;
  const metric = TYPE_METRIC[type];
  const ts = parseDateMs(sample.date);
  if (ts === undefined) return undefined;
  const rawValue = parseNumber(sample.value);
  if (rawValue === undefined) return undefined;
  const converted = convertValue(type, rawValue, sample.unit);
  if (!converted) return undefined;
  return {
    sample,
    index,
    type,
    metric,
    value: converted.value,
    unit: converted.unit,
    ts,
    dayKey: dayKeyOf(new Date(ts)),
  };
}

/** Timestamp used to find the newest existing note for a day. */
function noteTimestamp(note: Note): number {
  const occurredAt = note.meta?.occurredAt;
  if (typeof occurredAt === 'number' && Number.isFinite(occurredAt) && occurredAt > 0) {
    return occurredAt;
  }
  return Number.isFinite(note.createdAt) ? note.createdAt : 0;
}

/**
 * Fold parsed samples into health note drafts.
 *
 * Aggregation rule (deterministic, one draft per local day + metric):
 *  - `steps` / `water` / `activeEnergy` are running totals per day → sum;
 *  - `sleep` / `weight` / `heartRate` / `workout` are point values → latest wins.
 * If the vault already has a health note for the same day + metric, the draft
 * carries `replaceId` so the caller updates it instead of creating a duplicate.
 */
export function healthSamplesToNotes(samples: HealthSample[], existing: Note[]): HealthNoteDraft[] {
  const groups = new Map<string, PreparedSample[]>();
  samples.forEach((sample, index) => {
    const prepared = prepareSample(sample, index);
    if (!prepared) return;
    const key = `${prepared.dayKey}|${prepared.metric}`;
    const group = groups.get(key);
    if (group) group.push(prepared);
    else groups.set(key, [prepared]);
  });

  const ordered = [...groups.values()].sort((a, b) => {
    const first = a[0];
    const second = b[0];
    if (first.dayKey !== second.dayKey) return first.dayKey < second.dayKey ? -1 : 1;
    return metricRank(first.metric) - metricRank(second.metric);
  });

  const existingHealth = existing.filter((note) => note.kind === 'health');
  const drafts: HealthNoteDraft[] = [];

  for (const group of ordered) {
    const sorted = [...group].sort((a, b) => a.ts - b.ts || a.index - b.index);
    const latest = sorted[sorted.length - 1];
    const isSum = SUM_TYPES.has(latest.type);
    const value = isSum
      ? Math.round(group.reduce((total, item) => total + item.value, 0))
      : latest.value;

    const title = draftTitle({ ...latest, value });
    const meta: NoteMeta = {
      metric: latest.metric,
      value,
      unit: latest.unit,
      occurredAt: latest.ts,
    };
    const detail = textOf(latest.sample.detail);
    if (detail) meta.detail = detail;

    const draft: HealthNoteDraft = {
      kind: 'health',
      title,
      content: draftContent(title, latest, group.length),
      meta,
    };

    const target = existingHealth
      .filter((note) => note.meta?.metric === latest.metric && noteDayKey(note) === latest.dayKey)
      .sort((a, b) => noteTimestamp(a) - noteTimestamp(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .pop();
    if (target) draft.replaceId = target.id;

    drafts.push(draft);
  }

  return drafts;
}
