import type {
  HealthMetric,
  MealSlot,
  Note,
  NoteKind,
  NoteMeta,
  RecordDraft,
} from './types';
import { formatAmount } from './kinds';
import {
  formatMoney,
  healthSeries,
  spendingByCategory,
  summarizeDay,
  summarizeRange,
  weekSummaryText,
  type DaySummary,
} from './insights';

/**
 * Mashu's local agent brain.
 *
 * Fully offline Chinese heuristics: a one-line natural-language capture parser
 * (`parseEntry` / `captureDraft`) and a small Q&A layer (`agentReply`) that
 * answers with the same numbers the insights view shows. No network calls, no
 * randomness, no hidden state — the same input and `now` always produce the
 * same reply, which keeps the UI predictable and the tests deterministic.
 */

export type AgentIntent = 'capture' | 'summary' | 'advice' | 'help' | 'fallback';

export interface AgentReply {
  text: string;
  intent: AgentIntent;
  action?: { type: 'createNote'; draft: RecordDraft };
  suggestions?: string[];
}

/** Default prompt chips shown by the agent UI. First four are the core demo. */
export const AGENT_SUGGESTIONS: readonly string[] = [
  '午饭牛肉面 32 元',
  '今天花了多少？',
  '本周饮食总结',
  '最近睡眠怎么样？',
  '奶茶 18 元',
  '给我一点建议',
];

/* ------------------------------------------------------------------ */
/* Text helpers                                                        */
/* ------------------------------------------------------------------ */

const HAS_HAN_RE = /[\u3400-\u9fff\uf900-\ufaff]/;

const QUESTION_RE =
  /[？?]|吗|呢|多少|怎么样|怎么|如何|为什么|为啥|什么|啥|哪个|哪些|建议|帮助|总结|复盘|记了几条|能做什么|怎么用/;

const FILLER_RE =
  /^(?:你好|您好|嗨|hi|hello|hey|在吗|在不在|谢谢|谢啦|多谢|好的|好|嗯+|哦+|噢+|啊+|ok|okay|收到|明白|知道了|了解|哈哈+|hhh+|早上好|中午好|下午好|晚上好|晚安|再见|拜拜|没事|没什么)[呀啊哇哦哈呢吧啦~～。，,!！?？\s]*$/i;

const HEALTH_INCOMPLETE_RE =
  /体重|称重|睡眠|睡了|睡够|步数|走了|走路|万步|喝水|饮水|运动|跑步|健身|游泳|骑车|骑行|锻炼/;

const FOOD_RE =
  /吃|喝|早饭|早餐|午饭|午餐|中饭|晚饭|晚餐|加餐|夜宵|宵夜|奶茶|咖啡|水果|面|饭|鸡|牛|蛋|火锅|烧烤|零食/;

const DIARY_EXPLICIT_RE = /日记|小记|今天记|记录一下|随手记/;

const MOOD_WORDS: readonly string[] = [
  '开心',
  '高兴',
  '快乐',
  '平静',
  '焦虑',
  '兴奋',
  '难过',
  '疲惫',
  '累',
  '烦',
  '放松',
  '满足',
  '郁闷',
  '低落',
  '紧张',
];

function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim();
}

function isMeaningful(text: string): boolean {
  const stripped = text.replace(/[\s\p{P}\p{S}]/gu, '');
  if (stripped.length < 2) return false;
  if (HAS_HAN_RE.test(text)) return true;
  // Pure numbers/symbols are only useful when they carry a money amount.
  return /\d/.test(text);
}

function isQuestion(text: string): boolean {
  return QUESTION_RE.test(text);
}

function shorten(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max)}…`;
}

function withHashtags(text: string, tags: readonly string[]): string {
  return `${text.trim()}\n\n${tags.map((tag) => `#${tag}`).join(' ')}`;
}

function detectMood(text: string): string | undefined {
  for (const word of MOOD_WORDS) {
    if (text.includes(word)) return word;
  }
  return undefined;
}

/** Strip amounts (money/calories) so titles and dish extraction stay clean. */
function stripAmounts(text: string): string {
  return text
    .replace(/(\d+(?:\.\d+)?)\s*(?:元|块钱|块|rmb)/gi, ' ')
    .replace(/[￥¥]\s*\d+(?:\.\d+)?/g, ' ')
    .replace(/(\d+(?:\.\d+)?)\s*(?:千卡|大卡|卡路里|kcal|卡)/gi, ' ');
}

/* ------------------------------------------------------------------ */
/* Capture parsing — shared extractors                                 */
/* ------------------------------------------------------------------ */

interface MoneyMatch {
  amount: number;
  index: number;
  raw: string;
}

const MONEY_SUFFIX_RE = /(\d+(?:\.\d+)?)\s*(?:元|块钱|块|rmb)/gi;
const MONEY_PREFIX_RE = /[￥¥]\s*(\d+(?:\.\d+)?)/g;

/** First money expression in the text (`32 元`, `32块`, `¥32`, `￥32`). */
function extractMoney(text: string): MoneyMatch | null {
  const matches: MoneyMatch[] = [];
  let match: RegExpExecArray | null;

  MONEY_SUFFIX_RE.lastIndex = 0;
  while ((match = MONEY_SUFFIX_RE.exec(text)) !== null) {
    const amount = Number(match[1]);
    if (Number.isFinite(amount) && amount > 0) {
      matches.push({ amount, index: match.index, raw: match[0] });
    }
  }

  MONEY_PREFIX_RE.lastIndex = 0;
  while ((match = MONEY_PREFIX_RE.exec(text)) !== null) {
    const amount = Number(match[1]);
    if (Number.isFinite(amount) && amount > 0) {
      matches.push({ amount, index: match.index, raw: match[0] });
    }
  }

  if (matches.length === 0) return null;
  matches.sort((a, b) => a.index - b.index);
  return matches[0];
}

function extractCalories(text: string): number | undefined {
  const match = /(\d+(?:\.\d+)?)\s*(?:千卡|大卡|卡路里|kcal|卡)/i.exec(text);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function detectMeal(text: string, now: Date): MealSlot {
  if (/早餐|早饭/.test(text)) return '早餐';
  if (/午餐|午饭|中饭|中午/.test(text)) return '午餐';
  if (/晚餐|晚饭/.test(text)) return '晚餐';
  if (/加餐|下午茶|零食/.test(text)) return '加餐';
  if (/夜宵|宵夜/.test(text)) return '夜宵';
  const hour = now.getHours();
  if (hour < 10) return '早餐';
  if (hour < 15) return '午餐';
  if (hour < 20) return '晚餐';
  return '夜宵';
}

/** Best-effort dish list: split the text after removing amounts and meal words. */
function extractDishes(text: string): string[] {
  const cleaned = stripAmounts(text)
    .replace(/早餐|早饭|午餐|午饭|中饭|晚餐|晚饭|加餐|下午茶|夜宵|宵夜/g, ' ')
    .replace(/今天|昨天|刚才|刚刚|早上|上午|中午|下午|晚上/g, ' ')
    .replace(/[，,。.!！?？、;；:：/\\()（）[\]【】\-—]/g, ' ');
  const parts = cleaned.split(/\s+|和|跟|与|还有/);
  const dishes: string[] = [];

  for (const raw of parts) {
    let part = raw.trim();
    part = part.replace(/^(?:我|吃了|喝了|吃|喝|点了|来了一份|来了一碗|要了|打包了|打包)/, '');
    part = part.replace(/^(?:一份|一碗|一杯|一个|两个|三个|几个|碗|杯|份|个|只|块|瓶|盘|根|片)+/, '');
    part = part.replace(/(?:了|的)$/, '');
    if (!part || part.length > 12) continue;
    if (/^[\d.]+$/.test(part)) continue;
    if (!dishes.includes(part)) dishes.push(part);
  }

  return dishes.slice(0, 3);
}

/* ------------------------------------------------------------------ */
/* Capture parsing — family builders                                   */
/* ------------------------------------------------------------------ */

function buildFoodDraft(text: string, now: Date): RecordDraft {
  const money = extractMoney(text);
  const calories = extractCalories(text);
  const meal = detectMeal(text, now);
  const dishes = extractDishes(text);
  const mood = detectMood(text);

  const dishLabel = dishes.length > 0 ? dishes.slice(0, 2).join('、') : shorten(stripAmounts(text), 10) || '一餐';
  const meta: NoteMeta = { meal };
  if (money) meta.amount = money.amount;
  if (calories !== undefined) meta.calories = calories;
  if (dishes.length > 0) meta.dishes = dishes;
  if (mood) meta.mood = mood;

  return {
    kind: 'food',
    title: `${meal} · ${dishLabel}`,
    content: withHashtags(text, ['饮食']),
    meta,
    confidence: money || calories !== undefined || dishes.length > 0 ? 0.85 : 0.6,
  };
}

const INCOME_RE = /工资|奖金|收入|分红|报销|收到|进账|收款|退款|赚了|赚/;

const EXPENSE_CATEGORY_RULES: readonly { category: string; pattern: RegExp }[] = [
  { category: '餐饮', pattern: /吃饭|外卖|奶茶|咖啡|早餐|午饭|午餐|晚饭|晚餐|夜宵|宵夜|米饭|面|火锅|餐/ },
  { category: '交通', pattern: /打车|出租车|地铁|公交|高铁|火车|机票|油费|加油|停车|单车|车费/ },
  { category: '居住', pattern: /房租|水费|电费|物业|燃气|宽带/ },
  { category: '娱乐', pattern: /电影|游戏|演出|门票|唱歌|KTV|旅行|旅游/ },
  { category: '医疗', pattern: /药|医院|挂号|看病|体检/ },
  { category: '学习', pattern: /书|课程|学习|培训|考试|文具/ },
  { category: '人情', pattern: /红包|礼物|请客|份子|礼金/ },
  { category: '购物', pattern: /买|淘宝|京东|衣服|鞋|数码|超市|化妆|家居/ },
];

const FINANCE_TITLE_STRIP_RE =
  /今天|昨天|刚才|刚刚|早上|上午|中午|下午|晚上|花了|花掉|花|付了|支付|消费|支出|收入|收到|进账|赚了|赚|买了|买|大概|大约|左右|块钱|元|钱|rmb|了|的/gi;

function detectExpenseCategory(text: string): string {
  for (const rule of EXPENSE_CATEGORY_RULES) {
    if (rule.pattern.test(text)) return rule.category;
  }
  return '其他';
}

function buildFinanceDraft(text: string, money: MoneyMatch | null): RecordDraft {
  const income = INCOME_RE.test(text);
  const category = income ? '收入' : detectExpenseCategory(text);
  const direction = income ? 'income' : 'expense';

  const description = money
    ? text
        .replace(money.raw, ' ')
        .replace(/[￥¥]\s*\d+(?:\.\d+)?/g, ' ')
        .replace(FINANCE_TITLE_STRIP_RE, ' ')
        .replace(/[，,。.!！?？、;；:：/\\()（）[\]【】]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : shorten(text, 12);
  const label = description ? shorten(description, 12) : income ? '收入' : '支出';

  const meta: NoteMeta = { category, direction };
  if (money) meta.amount = money.amount;
  const mood = detectMood(text);
  if (mood) meta.mood = mood;

  const tags = category === '其他' ? ['理财'] : ['理财', category];
  return {
    kind: 'finance',
    title: money ? `${label} ${formatMoney(money.amount)}` : label,
    content: withHashtags(text, tags),
    meta,
    confidence: money ? 0.85 : 0.5,
  };
}

interface HealthExtraction {
  metric: HealthMetric;
  value?: number;
  unit?: string;
  mood?: string;
  title: string;
}

function extractWeight(text: string): HealthExtraction | null {
  const keyword = /体重|称重/.test(text);
  const keywordMatch = /(?:体重|称重)[^\d]{0,6}(\d+(?:\.\d+)?)\s*(kg|公斤|斤)?/i.exec(text);
  const kgMatch = /(\d+(?:\.\d+)?)\s*(?:kg|公斤)/i.exec(text);
  const jinMatch = keyword ? /(\d+(?:\.\d+)?)\s*斤/.exec(text) : null;

  let raw: number | undefined;
  if (keywordMatch) {
    raw = Number(keywordMatch[1]);
    if (keywordMatch[2] === '斤') raw /= 2;
  } else if (kgMatch) {
    raw = Number(kgMatch[1]);
    // Without the 体重 keyword, only accept plausible human weights.
    if (!(raw >= 25 && raw <= 300)) return null;
  } else if (jinMatch) {
    raw = Number(jinMatch[1]) / 2;
  } else {
    return null;
  }
  if (!Number.isFinite(raw) || raw <= 0 || raw > 400) return null;

  const kg = Math.round(raw * 10) / 10;
  return { metric: '体重', value: kg, unit: 'kg', title: `体重 ${formatAmount(kg)} kg` };
}

function extractSleepHours(text: string): HealthExtraction | null {
  const match =
    /(?:睡眠|睡了|睡够|睡)[^\d]{0,6}(\d+(?:\.\d+)?)\s*(?:个)?(?:小时|钟头|h|hr|hours)/i.exec(text) ??
    /(\d+(?:\.\d+)?)\s*(?:个)?(?:小时|h)\s*(?:的觉|睡眠)/i.exec(text);
  if (!match) return null;
  const hours = Number(match[1]);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) return null;
  return { metric: '睡眠', value: hours, unit: '小时', title: `睡眠 ${formatAmount(hours)} 小时` };
}

function extractSteps(text: string): HealthExtraction | null {
  const keywordMatch =
    /(?:步数|走了|走路|散步|健走)[^\d]{0,6}(\d+(?:\.\d+)?)\s*(万步|万|步)/.exec(text) ??
    /(\d+(?:\.\d+)?)\s*(万步|万|步)/.exec(text);
  if (!keywordMatch) return null;
  let value = Number(keywordMatch[1]);
  if (keywordMatch[2] === '万' || keywordMatch[2] === '万步') value *= 10000;
  if (!Number.isFinite(value) || value <= 0 || value > 200000) return null;
  value = Math.round(value);
  return { metric: '步数', value, unit: '步', title: `步数 ${value} 步` };
}

function extractWater(text: string): HealthExtraction | null {
  const hasWaterContext =
    /水/.test(text) &&
    (/喝水|饮水|水量|水杯/.test(text) || /喝[^，。!?；\n]{0,12}水/.test(text));
  if (!hasWaterContext) return null;

  const match =
    /(?:喝水|饮水|水量)[^\d]{0,4}(\d+(?:\.\d+)?)\s*(ml|毫升|杯)/i.exec(text) ??
    /(\d+(?:\.\d+)?)\s*(ml|毫升)\s*水/i.exec(text) ??
    /(\d+(?:\.\d+)?)\s*杯\s*水/.exec(text);
  if (!match) return null;

  let value = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  if (unit !== 'ml' && unit !== '毫升') value *= 250; // 杯 ≈ 250ml
  if (!Number.isFinite(value) || value <= 0 || value > 10000) return null;
  value = Math.round(value);
  return { metric: '饮水', value, unit: 'ml', title: `饮水 ${value} ml` };
}

function exerciseLabel(text: string): string {
  const labels: readonly [string, string][] = [
    ['跑步', '跑步'],
    ['跑了', '跑步'],
    ['游泳', '游泳'],
    ['健身', '健身'],
    ['骑行', '骑行'],
    ['骑车', '骑行'],
    ['快走', '快走'],
    ['徒步', '徒步'],
    ['散步', '散步'],
    ['走路', '走路'],
    ['走了', '走路'],
  ];
  for (const [word, label] of labels) {
    if (text.includes(word)) return label;
  }
  return '运动';
}

function extractExercise(text: string): HealthExtraction | null {
  if (!/运动|跑步|跑了|健身|游泳|骑车|骑行|锻炼|散步|快走|徒步|走了|走路/.test(text)) return null;
  const match = /(\d+(?:\.\d+)?)\s*(分钟|min|小时|h|公里|km)/i.exec(text);
  if (!match) return null;

  let value = Number(match[1]);
  let unit = match[2].toLowerCase();
  if (!Number.isFinite(value) || value <= 0) return null;
  if (unit === '小时' || unit === 'h') {
    value = Math.round(value * 60);
    unit = '分钟';
  } else if (unit === 'min') {
    unit = '分钟';
  } else if (unit === 'km') {
    unit = '公里';
  }
  return {
    metric: '运动',
    value,
    unit,
    title: `${exerciseLabel(text)} ${formatAmount(value)} ${unit}`,
  };
}

/** Metric-specific extraction; returns null when no metric can be understood. */
function extractHealth(text: string): HealthExtraction | null {
  const weight = extractWeight(text);
  if (weight) return weight;
  const sleep = extractSleepHours(text);
  if (sleep) return sleep;
  const steps = extractSteps(text);
  if (steps) return steps;
  const water = extractWater(text);
  if (water) return water;
  const exercise = extractExercise(text);
  if (exercise) return exercise;

  if (/心情/.test(text)) {
    const mood = detectMood(text);
    if (mood) return { metric: '心情', mood, title: `心情 · ${mood}` };
  }
  return null;
}

function buildHealthDraft(text: string, extraction: HealthExtraction): RecordDraft {
  const meta: NoteMeta = { metric: extraction.metric };
  if (extraction.value !== undefined) meta.value = extraction.value;
  if (extraction.unit) meta.unit = extraction.unit;
  const mood = extraction.mood ?? detectMood(text);
  if (mood) meta.mood = mood;
  const tags = extraction.metric === '其他' ? ['健康'] : ['健康', extraction.metric];
  return {
    kind: 'health',
    title: extraction.title,
    content: withHashtags(text, tags),
    meta,
    confidence: extraction.metric === '心情' ? 0.75 : 0.85,
  };
}

function diaryTitle(text: string): string {
  const firstLine = (text.split('\n')[0] ?? '').replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim();
  return shorten(firstLine || '今日记录', 18);
}

function buildDiaryDraft(text: string, explicit: boolean): RecordDraft {
  const mood = detectMood(text);
  const meta: NoteMeta = {};
  if (mood) meta.mood = mood;
  return {
    kind: 'diary',
    title: diaryTitle(text),
    content: withHashtags(text, ['日记']),
    meta,
    confidence: explicit ? 0.7 : 0.5,
  };
}

function buildNoteDraft(text: string): RecordDraft {
  return {
    kind: 'note',
    title: shorten((text.split('\n')[0] ?? '') || '未命名笔记', 18),
    content: text,
    meta: {},
    confidence: 0.6,
  };
}

/* ------------------------------------------------------------------ */
/* Public capture API                                                  */
/* ------------------------------------------------------------------ */

/**
 * Turn one line of natural language into a life record.
 * Returns `null` for questions, greetings, blank text and gibberish.
 */
export function parseEntry(text: string, now = new Date()): RecordDraft | null {
  const clean = normalizeText(text);
  if (!clean || FILLER_RE.test(clean) || !isMeaningful(clean) || isQuestion(clean)) return null;

  // Health first: words like 喝/走 overlap with food, and metrics are precise.
  const health = extractHealth(clean);
  if (health) return buildHealthDraft(clean, health);

  const money = extractMoney(clean);
  if (HEALTH_INCOMPLETE_RE.test(clean) && !money) return null;

  if (FOOD_RE.test(clean)) return buildFoodDraft(clean, now);

  if (money) return buildFinanceDraft(clean, money);
  if (!HAS_HAN_RE.test(clean)) return null;

  return buildDiaryDraft(clean, DIARY_EXPLICIT_RE.test(clean));
}

/**
 * Like `parseEntry`, but when the user already picked a kind (quick-capture
 * sheet) we coerce the draft to that kind and still extract amount/value/units.
 */
export function captureDraft(
  text: string,
  kindHint?: NoteKind,
  now = new Date(),
): RecordDraft | null {
  const clean = normalizeText(text);
  if (!clean || FILLER_RE.test(clean) || !isMeaningful(clean) || isQuestion(clean)) return null;
  if (!kindHint) return parseEntry(text, now);

  switch (kindHint) {
    case 'food':
      return buildFoodDraft(clean, now);
    case 'finance':
      return buildFinanceDraft(clean, extractMoney(clean));
    case 'health':
      return coerceHealthDraft(clean);
    case 'diary':
      return buildDiaryDraft(clean, true);
    case 'note':
      return buildNoteDraft(clean);
    default:
      return parseEntry(text, now);
  }
}

/** Coerce arbitrary text into a health record, using generic units as fallback. */
function coerceHealthDraft(text: string): RecordDraft {
  const extraction = extractHealth(text) ?? extractGenericHealth(text);
  if (extraction) return buildHealthDraft(text, extraction);
  return {
    kind: 'health',
    title: shorten(text.replace(/\s+/g, ' '), 18),
    content: withHashtags(text, ['健康']),
    meta: { metric: '其他' },
    confidence: 0.5,
  };
}

function extractGenericHealth(text: string): HealthExtraction | null {
  const match = /(\d+(?:\.\d+)?)\s*(kg|公斤|斤|小时|h|步|万步|ml|毫升|杯|分钟|min|公里|km)/i.exec(
    text,
  );
  if (!match) return null;
  const raw = Number(match[1]);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const unit = match[2].toLowerCase();

  switch (unit) {
    case 'kg':
    case '公斤': {
      const kg = Math.round(raw * 10) / 10;
      return { metric: '体重', value: kg, unit: 'kg', title: `体重 ${formatAmount(kg)} kg` };
    }
    case '斤': {
      const kg = Math.round((raw / 2) * 10) / 10;
      return { metric: '体重', value: kg, unit: 'kg', title: `体重 ${formatAmount(kg)} kg` };
    }
    case '小时':
    case 'h':
      return {
        metric: '睡眠',
        value: raw,
        unit: '小时',
        title: `睡眠 ${formatAmount(raw)} 小时`,
      };
    case '步': {
      const steps = Math.round(raw);
      return { metric: '步数', value: steps, unit: '步', title: `步数 ${steps} 步` };
    }
    case '万步': {
      const steps = Math.round(raw * 10000);
      return { metric: '步数', value: steps, unit: '步', title: `步数 ${steps} 步` };
    }
    case 'ml':
    case '毫升': {
      const ml = Math.round(raw);
      return { metric: '饮水', value: ml, unit: 'ml', title: `饮水 ${ml} ml` };
    }
    case '杯': {
      const ml = Math.round(raw * 250);
      return { metric: '饮水', value: ml, unit: 'ml', title: `饮水 ${ml} ml` };
    }
    case '分钟':
    case 'min': {
      const minutes = Math.round(raw);
      return { metric: '运动', value: minutes, unit: '分钟', title: `运动 ${minutes} 分钟` };
    }
    case '公里':
    case 'km':
      return {
        metric: '运动',
        value: raw,
        unit: '公里',
        title: `运动 ${formatAmount(raw)} 公里`,
      };
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Agent Q&A                                                           */
/* ------------------------------------------------------------------ */

type SummaryScope = 'today' | 'yesterday' | 'week' | 'month';
type SummaryTopic =
  | 'money'
  | 'income'
  | 'diet'
  | 'sleep'
  | 'weight'
  | 'steps'
  | 'water'
  | 'mood'
  | 'records'
  | 'overview';

const HELP_RE = /帮助|能做什么|你能做什么|会做什么|你会什么|怎么用|使用说明|\bhelp\b/i;
const CAPTURE_COMMAND_RE = /^(?:帮我|请)?(?:记一笔|记录一下|记一下|新增|添加|新建)/;
const SUMMARY_TOPIC_RE =
  /花费|花了|支出|消费|收入|工资|赚|进账|吃|饮食|吃喝|热量|摄入|卡路里|睡眠|睡了|体重|步数|走路|喝水|饮水|心情|记录|记账/;
const SUMMARY_SIGNAL_RE = /[？?]|多少|几|怎么样|如何|总结|复盘|看看|查一下|统计|吗|呢|什么|啥/;
const ADVICE_RE =
  /建议|怎么样|健康吗|超支|该不该|该少|该多|该怎么|要不要|正常吗|合理吗|太多|是不是|怎么办/;

function shiftDate(date: Date, deltaDays: number): Date {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + deltaDays);
  return next;
}

function scopeLabel(scope: SummaryScope): string {
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

function detectSummaryScope(input: string): SummaryScope {
  if (/昨天|昨日/.test(input)) return 'yesterday';
  if (/本月|这个月/.test(input)) return 'month';
  if (/本周|这周|这个星期|最近|近七天|近 7 天/.test(input)) return 'week';
  return 'today';
}

function detectSummaryTopic(input: string): SummaryTopic {
  if (/收入|工资|奖金|赚|进账/.test(input)) return 'income';
  if (/体重|称重/.test(input)) return 'weight';
  if (/睡眠|睡了|困/.test(input)) return 'sleep';
  if (/步数|走路|万步/.test(input)) return 'steps';
  if (/喝水|饮水/.test(input)) return 'water';
  if (/心情|情绪/.test(input)) return 'mood';
  if (/花费|支出|花了|消费|超支|账|钱/.test(input)) return 'money';
  if (/吃|饮食|热量|摄入|卡路里|餐/.test(input)) return 'diet';
  if (/记录|记了几条/.test(input)) return 'records';
  return 'overview';
}

function detectSummaryIntent(input: string): boolean {
  if (/总结|复盘|统计/.test(input)) return true;
  if (/记了几条|记了多少条|记录了几条/.test(input)) return true;
  return SUMMARY_TOPIC_RE.test(input) && SUMMARY_SIGNAL_RE.test(input);
}

function fillSuggestions(preferred: string[], min = 2, max = 4): string[] {
  const picks = [...new Set(preferred.filter(Boolean))];
  for (const fallback of AGENT_SUGGESTIONS) {
    if (picks.length >= min) break;
    if (!picks.includes(fallback)) picks.push(fallback);
  }
  return picks.slice(0, max);
}

function sumDay(days: DaySummary[], field: 'spend' | 'income' | 'calories' | 'meals' | 'diaryCount' | 'recordCount'): number {
  return days.reduce((total, day) => total + day[field], 0);
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function moneyText(days: DaySummary[], label: string, top?: { category: string; amount: number }): string {
  if (sumDay(days, 'recordCount') === 0) return `${label}还没有记录。`;
  const spend = sumDay(days, 'spend');
  const income = sumDay(days, 'income');
  if (spend <= 0) {
    if (income > 0) return `${label}收入 ${formatMoney(income)}，没有支出记录。`;
    return `${label}没有支出记录。`;
  }
  if (top) {
    return `${label}支出 ${formatMoney(spend)}，最多的是${top.category}（${formatMoney(top.amount)}）。`;
  }
  return `${label}支出 ${formatMoney(spend)}。`;
}

function incomeText(days: DaySummary[], label: string): string {
  const income = sumDay(days, 'income');
  if (income <= 0) return `${label}没有收入记录。`;
  return `${label}收入 ${formatMoney(income)}。`;
}

function dietText(days: DaySummary[], label: string): string {
  const meals = sumDay(days, 'meals');
  const calories = sumDay(days, 'calories');
  if (meals === 0 && calories === 0) return `${label}还没有饮食记录。`;
  const parts: string[] = [];
  if (meals > 0) parts.push(`${meals} 顿饮食`);
  if (calories > 0) parts.push(`摄入 ${Math.round(calories)} kcal`);
  return `${label}记了 ${parts.join('，')}。`;
}

interface SummaryWindow {
  days: DaySummary[];
  label: string;
  scope: SummaryScope;
  windowDays: number;
  top?: { category: string; amount: number };
}

function summaryWindow(notes: Note[], scope: SummaryScope, now: Date): SummaryWindow {
  const windowDays = scope === 'month' ? Math.max(1, now.getDate()) : scope === 'week' ? 7 : 1;
  const anchor = scope === 'yesterday' ? shiftDate(now, -1) : now;
  const days =
    scope === 'today' || scope === 'yesterday'
      ? [summarizeDay(notes, anchor)]
      : summarizeRange(notes, windowDays, now);
  const top = spendingByCategory(notes, windowDays, anchor)[0];
  return { days, label: scopeLabel(scope), scope, windowDays, top };
}

function sleepText(window: SummaryWindow, notes: Note[], now: Date): string {
  if (window.scope === 'today' || window.scope === 'yesterday') {
    const value = window.days[0]?.sleep;
    if (value === undefined) return `${window.label}还没有睡眠记录。`;
    return `${window.label}睡眠 ${formatAmount(value)} 小时。`;
  }
  const series = healthSeries(notes, '睡眠', window.windowDays, now);
  if (series.length === 0) return `${window.label}还没有睡眠记录。`;
  const average = roundTo(series.reduce((total, item) => total + item.value, 0) / series.length, 1);
  return `${window.label}睡眠平均 ${formatAmount(average)} 小时（${series.length} 天有记录）。`;
}

function weightText(window: SummaryWindow, notes: Note[], now: Date): string {
  if (window.scope === 'today' || window.scope === 'yesterday') {
    const value = window.days[0]?.weight;
    if (value !== undefined) return `${window.label}体重 ${formatAmount(value)} kg。`;
  }
  const series = healthSeries(notes, '体重', window.windowDays, now);
  const latest = series[series.length - 1];
  if (!latest) return '还没有体重记录。';
  return `最近一次体重 ${formatAmount(latest.value)} kg。`;
}

function stepsText(window: SummaryWindow, notes: Note[], now: Date): string {
  if (window.scope === 'today' || window.scope === 'yesterday') {
    const value = window.days[0]?.steps;
    if (value === undefined) return `${window.label}还没有步数记录。`;
    return `${window.label}走了 ${Math.round(value)} 步。`;
  }
  const series = healthSeries(notes, '步数', window.windowDays, now);
  if (series.length === 0) return `${window.label}还没有步数记录。`;
  const average = Math.round(series.reduce((total, item) => total + item.value, 0) / series.length);
  return `${window.label}日均 ${average} 步。`;
}

function waterText(window: SummaryWindow, notes: Note[], now: Date): string {
  if (window.scope === 'today' || window.scope === 'yesterday') {
    const value = window.days[0]?.water;
    if (value === undefined) return `${window.label}还没有饮水记录。`;
    return `${window.label}喝水 ${Math.round(value)} ml。`;
  }
  const series = healthSeries(notes, '饮水', window.windowDays, now);
  if (series.length === 0) return `${window.label}还没有饮水记录。`;
  const average = Math.round(series.reduce((total, item) => total + item.value, 0) / series.length);
  return `${window.label}日均喝水 ${average} ml。`;
}

function moodText(window: SummaryWindow): string {
  if (window.scope === 'today' || window.scope === 'yesterday') {
    const value = window.days[0]?.mood;
    if (!value) return `${window.label}还没有心情记录。`;
    return `${window.label}的心情：${value}。`;
  }
  for (let index = window.days.length - 1; index >= 0; index -= 1) {
    const value = window.days[index]?.mood;
    if (value) return `最近的心情：${value}。`;
  }
  return `${window.label}还没有心情记录。`;
}

function recordsText(days: DaySummary[], label: string, scope: SummaryScope): string {
  const records = sumDay(days, 'recordCount');
  if (records === 0) return `${label}还没有记录。`;
  const meals = sumDay(days, 'meals');
  const diary = sumDay(days, 'diaryCount');
  if (scope === 'today' || scope === 'yesterday') {
    const parts: string[] = [];
    if (meals > 0) parts.push(`饮食 ${meals} 次`);
    if (diary > 0) parts.push(`日记 ${diary} 篇`);
    return parts.length > 0
      ? `${label}记了 ${records} 条记录（${parts.join('，')}）。`
      : `${label}记了 ${records} 条记录。`;
  }
  return `${label}记了 ${records} 条记录。`;
}

function monthSummaryText(notes: Note[], now: Date): string {
  const days = summarizeRange(notes, now.getDate(), now);
  const records = sumDay(days, 'recordCount');
  if (records === 0) return '这个月还没有记录。';

  const spend = sumDay(days, 'spend');
  const income = sumDay(days, 'income');
  const meals = sumDay(days, 'meals');
  const calories = sumDay(days, 'calories');
  const top = spendingByCategory(notes, now.getDate(), now)[0];

  const lines: string[] = [`这个月记了 ${records} 条记录。`];
  const money: string[] = [];
  if (spend > 0) money.push(`支出 ${formatMoney(spend)}`);
  if (income > 0) money.push(`收入 ${formatMoney(income)}`);
  if (money.length > 0) lines.push(`· ${money.join('，')}`);
  lines.push(`· 饮食 ${meals} 次，摄入 ${Math.round(calories)} kcal`);
  if (top) lines.push(`· 花得最多的是 ${top.category}（${formatMoney(top.amount)}）`);
  return lines.join('\n');
}

function overviewText(notes: Note[], window: SummaryWindow, now: Date): string {
  if (window.scope === 'week') return weekSummaryText(notes, now);
  if (window.scope === 'month') return monthSummaryText(notes, now);

  const day = window.days[0];
  if (!day || day.recordCount === 0) return `${window.label}还没有记录。`;

  const lines: string[] = [`${window.label}：`];
  const money: string[] = [];
  if (day.spend > 0) money.push(`支出 ${formatMoney(day.spend)}`);
  if (day.income > 0) money.push(`收入 ${formatMoney(day.income)}`);
  if (money.length > 0) lines.push(`· ${money.join('，')}`);
  if (day.meals > 0 || day.calories > 0) {
    lines.push(`· 饮食 ${day.meals} 次，摄入 ${Math.round(day.calories)} kcal`);
  }
  if (day.sleep !== undefined) lines.push(`· 睡眠 ${formatAmount(day.sleep)} 小时`);
  lines.push(`· 记了 ${day.recordCount} 条记录`);
  return lines.join('\n');
}

function summaryReply(input: string, notes: Note[], now: Date): AgentReply {
  const scope = detectSummaryScope(input);
  const topic = detectSummaryTopic(input);
  const window = summaryWindow(notes, scope, now);

  let text: string;
  switch (topic) {
    case 'money':
      text = moneyText(window.days, window.label, window.top);
      break;
    case 'income':
      text = incomeText(window.days, window.label);
      break;
    case 'diet':
      text = dietText(window.days, window.label);
      break;
    case 'sleep':
      text = sleepText(window, notes, now);
      break;
    case 'weight':
      text = weightText(window, notes, now);
      break;
    case 'steps':
      text = stepsText(window, notes, now);
      break;
    case 'water':
      text = waterText(window, notes, now);
      break;
    case 'mood':
      text = moodText(window);
      break;
    case 'records':
      text = recordsText(window.days, window.label, scope);
      break;
    default:
      text = overviewText(notes, window, now);
      break;
  }

  return {
    text,
    intent: 'summary',
    suggestions: fillSuggestions(['今天花了多少？', '本周饮食总结', '最近睡眠怎么样？'], 2, 3),
  };
}

function adviceReply(input: string, notes: Note[], now: Date): AgentReply {
  const week = summarizeRange(notes, 7, now);
  const spend = sumDay(week, 'spend');
  const top = spendingByCategory(notes, 7, now)[0];
  const records = sumDay(week, 'recordCount');

  let text: string;
  if (/睡|累|困/.test(input)) {
    const series = healthSeries(notes, '睡眠', 7, now);
    if (series.length === 0) {
      text = '先记几天睡眠吧，趋势会比单看一天更有用。';
    } else {
      const average = roundTo(series.reduce((total, item) => total + item.value, 0) / series.length, 1);
      text =
        average < 7
          ? `最近 7 天睡眠平均 ${formatAmount(average)} 小时，比 7 小时少一些。今晚可以试着早一点休息。`
          : `最近 7 天睡眠平均 ${formatAmount(average)} 小时，看起来还不错，保持规律就好。`;
    }
  } else if (/吃|饮食|健康|体重/.test(input)) {
    const meals = sumDay(week, 'meals');
    text =
      meals > 0
        ? `最近 7 天记了 ${meals} 顿饮食。规律记录比精确计算更有用，先保持节奏就好。`
        : '先随手记下每天吃了什么，几天之后就能看出自己的规律。';
  } else if (/花|支出|超支|钱|收入/.test(input)) {
    if (spend > 0) {
      const topPart = top ? `，最多的是${top.category}` : '';
      text = `最近 7 天支出 ${formatMoney(spend)}${topPart}。先记清楚，再决定从哪里调整，会更轻松。`;
    } else {
      text = '还没有足够的支出记录。先记几天，我再帮你看哪里可以调整。';
    }
  } else if (records === 0) {
    text = '可以先从「记三天」开始：吃了什么、花了多少、睡了多久。有了记录，再看趋势会清楚很多。';
  } else {
    text = '先保持记录就好。等有了几天的数据，我可以帮你看支出、饮食和睡眠的趋势。';
  }

  return {
    text,
    intent: 'advice',
    suggestions: fillSuggestions(['今天花了多少？', '最近睡眠怎么样？'], 2, 3),
  };
}

function describeDraft(draft: RecordDraft): string {
  const extras: string[] = [];
  if (draft.kind === 'food') {
    if (typeof draft.meta.amount === 'number' && draft.meta.amount > 0) {
      extras.push(formatMoney(draft.meta.amount));
    }
    if (typeof draft.meta.calories === 'number' && draft.meta.calories > 0) {
      extras.push(`${Math.round(draft.meta.calories)} kcal`);
    }
  }
  return extras.length > 0 ? `${draft.title}（${extras.join('，')}）` : draft.title;
}

function captureReply(draft: RecordDraft): AgentReply {
  // The confirm card owns 保存/取消; these chips are follow-up questions.
  const followUps: string[] =
    draft.kind === 'health'
      ? ['最近睡眠怎么样？', '今天记了几条？']
      : draft.kind === 'diary'
        ? ['今天记了几条？', '本周饮食总结']
        : ['今天花了多少？', '本周饮食总结'];
  return {
    text: `帮你记一笔：${describeDraft(draft)}。确认后保存。`,
    intent: 'capture',
    action: { type: 'createNote', draft },
    suggestions: fillSuggestions(followUps, 2, 3),
  };
}

function fallbackReply(notes: Note[], now: Date): AgentReply {
  const summary = summarizeDay(notes, now);
  const text =
    summary.recordCount > 0
      ? '这句我还没太明白。可以记一笔，比如「奶茶 18 元」，或者问我「今天花了多少？」。'
      : '我还没听明白。可以先用一句话记一笔，比如「午饭牛肉面 32 元」，或者问我「今天花了多少？」。';
  return {
    text,
    intent: 'fallback',
    suggestions: fillSuggestions(['奶茶 18 元', '今天花了多少？'], 2, 3),
  };
}

function greetingForHour(hour: number): string {
  if (hour < 5) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function greetingSuggestions(notes: Note[], now: Date): string[] {
  const summary = summarizeDay(notes, now);
  const picks: string[] = [];
  if (summary.spend > 0) picks.push('今天花了多少？');
  if (summary.meals > 0 || summary.calories > 0) picks.push('本周饮食总结');
  if (summary.sleep !== undefined) picks.push('最近睡眠怎么样？');
  if (summary.recordCount === 0) picks.push('午饭牛肉面 32 元');
  picks.push('奶茶 18 元', '今天花了多少？');
  return fillSuggestions(picks, 2, 4);
}

/**
 * Warm opening message for the agent panel. Uses today's summary one-liner and
 * 2–4 contextual prompt chips.
 */
export function agentGreeting(notes: Note[], now = new Date()): AgentReply {
  const summary = summarizeDay(notes, now);
  const greeting = greetingForHour(now.getHours());
  let text: string;

  if (summary.recordCount === 0) {
    text = `${greeting}。今天还没有记录，想记点什么，或者问我今天花了多少。`;
  } else {
    const parts: string[] = [];
    if (summary.spend > 0) parts.push(`支出 ${formatMoney(summary.spend)}`);
    if (summary.calories > 0) parts.push(`摄入 ${Math.round(summary.calories)} kcal`);
    if (summary.sleep !== undefined) parts.push(`睡眠 ${formatAmount(summary.sleep)} 小时`);
    const detail = parts.length > 0 ? `：${parts.join('，')}` : '';
    text = `${greeting}。今天已经记了 ${summary.recordCount} 条${detail}。`;
  }

  return { text, intent: 'summary', suggestions: greetingSuggestions(notes, now) };
}

/**
 * Main entry point for the chat box: classify the message, answer with local
 * insights or return a capture action. Purely deterministic given `notes`/`now`.
 */
export function agentReply(input: string, notes: Note[], now = new Date()): AgentReply {
  const text = normalizeText(input);

  if (!text) {
    return {
      text: '我在。想记点什么，或者问问我今天的花费、饮食和睡眠。',
      intent: 'fallback',
      suggestions: fillSuggestions([], 2, 3),
    };
  }

  if (HELP_RE.test(text)) {
    return {
      text: '我可以帮你用一句话记下饮食、健康、收支和日记；回答今天或本周的花费、饮食、睡眠；也能做简单的小结。所有计算都在本地完成，不联网。',
      intent: 'help',
      suggestions: fillSuggestions(AGENT_SUGGESTIONS.slice(0, 3), 2, 3),
    };
  }

  if (CAPTURE_COMMAND_RE.test(text)) {
    const rest = text.replace(CAPTURE_COMMAND_RE, '').trim();
    const draft = rest ? parseEntry(rest, now) : null;
    if (draft && draft.confidence >= 0.4) return captureReply(draft);
    if (!rest) {
      return {
        text: '好，想记什么？直接说一句，比如「午饭牛肉面 32 元」或「跑步 30 分钟」。',
        intent: 'fallback',
        suggestions: fillSuggestions(['午饭牛肉面 32 元', '跑步 30 分钟'], 2, 3),
      };
    }
  }

  if (detectSummaryIntent(text)) return summaryReply(text, notes, now);
  if (ADVICE_RE.test(text)) return adviceReply(text, notes, now);

  const draft = parseEntry(text, now);
  if (draft && draft.confidence >= 0.45) return captureReply(draft);

  return fallbackReply(notes, now);
}
