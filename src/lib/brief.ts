import type { Note } from './types';
import { formatAmount } from './kinds';
import {
  dayKeyOf,
  formatMoney,
  noteDayKey,
  summarizeDay,
  summarizeRange,
  type DaySummary,
} from './insights';

/**
 * Daily brief engine for 日新 (Rixin).
 *
 * The first screen of the app is a daily dashboard: yesterday's review on top,
 * today's concrete adjustments below. This module is the brain behind it. It
 * is a pure function over the in-memory vault — no IndexedDB, no network, no
 * timers, no randomness — so the same notes and `now` always produce exactly
 * the same brief (which keeps the UI predictable and the tests deterministic).
 *
 * All numbers come from `lib/insights`, so the dashboard, the agent and the
 * charts can never disagree about "昨天花了多少".
 *
 * Comparison rule: yesterday is compared with the trailing 7 days *before*
 * yesterday (D-8 … D-2). Averages are taken over days that actually recorded
 * that metric, so a sparse week of logging does not look like a spending spike.
 * When there is no history at all the wording stays neutral.
 */

export interface BriefTrend {
  label: string;
  value: string;
  detail?: string;
  tone: 'good' | 'warn' | 'neutral';
}

export interface DailyBrief {
  /** Today, local `YYYY-MM-DD`. */
  dateKey: string;
  /** Yesterday, local `YYYY-MM-DD`. */
  yesterdayKey: string;
  /** One-line headline, e.g. 「昨天记了 9 条，睡得比平均多 0.3 小时」。 */
  summary: string;
  /** 2–4 factual bullets about yesterday. */
  review: string[];
  /** 2–3 concrete actions for today, derived from yesterday's deviations. */
  suggestions: string[];
  /** 4 compact dashboard metrics: 支出 / 摄入 / 睡眠 / 记录. */
  trends: BriefTrend[];
}

/** How many days of history feed the "7 日均值". */
const HISTORY_DAYS = 7;
const REVIEW_LIMIT = 4;
const SUGGESTION_LIMIT = 3;

/** Thresholds from the product brief. */
const SPEND_SPIKE_RATIO = 1.2;
const SPEND_LOW_RATIO = 0.7;
const CALORIE_SPIKE_RATIO = 1.2;
const SLEEP_SHORT_HOURS = 7;
const SLEEP_GOOD_HOURS = 7.5;
const SLEEP_DEVIATION_HOURS = 0.5;
const STEPS_LOW = 5000;
const STEPS_GOOD = 8000;
const WATER_LOW = 1500;

const TREND_LABELS = ['支出', '摄入', '睡眠', '记录'] as const;

function shiftDay(now: Date, deltaDays: number): Date {
  const day = new Date(now.getTime());
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() + deltaDays);
  return day;
}

function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** 「比 7 日均值多 18%」 / 「比 7 日均值少 12%」 / 「与 7 日均值持平」. */
function percentText(current: number, average: number): string {
  if (!(average > 0)) return '与 7 日均值持平';
  const percent = Math.round((current / average - 1) * 100);
  if (percent === 0) return '与 7 日均值持平';
  return percent > 0 ? `比 7 日均值多 ${percent}%` : `比 7 日均值少 ${-percent}%`;
}

/** 「比 7 日均值多 0.3 小时」 for units that are not percentages. */
function diffText(current: number, average: number, unit: string, decimals: number): string {
  const diff = roundTo(current - average, decimals);
  if (diff === 0) return '与 7 日均值持平';
  const amount = formatAmount(Math.abs(diff));
  return diff > 0 ? `比 7 日均值多 ${amount} ${unit}` : `比 7 日均值少 ${amount} ${unit}`;
}

interface YesterdayCounts {
  food: number;
  health: number;
  finance: number;
  diary: number;
  /** Plain Markdown notes written yesterday (not life records). */
  plain: number;
}

/** Kind counts for one local day; plain notes are tracked separately. */
function countKinds(notes: Note[], dateKey: string): YesterdayCounts {
  const counts: YesterdayCounts = { food: 0, health: 0, finance: 0, diary: 0, plain: 0 };
  for (const note of notes) {
    if (noteDayKey(note) !== dateKey) continue;
    switch (note.kind) {
      case 'food':
        counts.food += 1;
        break;
      case 'health':
        counts.health += 1;
        break;
      case 'finance':
        counts.finance += 1;
        break;
      case 'diary':
        counts.diary += 1;
        break;
      case 'note':
        counts.plain += 1;
        break;
      default:
        break;
    }
  }
  return counts;
}

interface HistoryAverages {
  spend?: number;
  calories?: number;
  sleep?: number;
  steps?: number;
  water?: number;
  records?: number;
}

/**
 * Averages over the 7 days before yesterday. Only days that recorded a metric
 * participate, so "no record" days do not dilute the baseline.
 */
function historyAverages(days: DaySummary[]): HistoryAverages {
  const recorded = (pick: (day: DaySummary) => number | undefined): number[] => {
    const values: number[] = [];
    for (const day of days) {
      const value = pick(day);
      if (value !== undefined) values.push(value);
    }
    return values;
  };
  return {
    spend: mean(days.filter((day) => day.spend > 0).map((day) => day.spend)),
    calories: mean(days.filter((day) => day.calories > 0).map((day) => day.calories)),
    sleep: mean(recorded((day) => day.sleep)),
    steps: mean(recorded((day) => day.steps)),
    water: mean(recorded((day) => day.water)),
    records: mean(days.filter((day) => day.recordCount > 0).map((day) => day.recordCount)),
  };
}

function sleepHeadline(diff: number): string {
  const hours = formatAmount(roundTo(Math.abs(diff), 1));
  return diff > 0 ? `睡得比平均多 ${hours} 小时` : `睡得比平均少 ${hours} 小时`;
}

/** One-line headline for the dashboard. */
function buildSummary(day: DaySummary, averages: HistoryAverages): string {
  if (day.recordCount === 0) return '昨天没有记录。';

  const parts = [`昨天记了 ${day.recordCount} 条`];
  if (day.sleep !== undefined) {
    const compared =
      averages.sleep !== undefined && Math.abs(day.sleep - averages.sleep) >= 0.05;
    parts.push(
      compared ? sleepHeadline(day.sleep - (averages.sleep as number)) : `睡了 ${formatAmount(day.sleep)} 小时`,
    );
  } else if (
    day.spend > 0 &&
    averages.spend !== undefined &&
    day.spend / averages.spend > SPEND_SPIKE_RATIO
  ) {
    parts.push(`支出比平均多 ${Math.round((day.spend / averages.spend - 1) * 100)}%`);
  } else if (day.diaryCount > 0) {
    parts.push('写了一篇日记');
  } else if (day.steps !== undefined) {
    parts.push(`走了 ${Math.round(day.steps)} 步`);
  }
  return `${parts.join('，')}。`;
}

function moneyBullet(day: DaySummary, average: number | undefined): string {
  if (day.spend <= 0) {
    if (day.income > 0) return `昨天没有支出，收入 ${formatMoney(day.income)}。`;
    return '昨天没有支出记录。';
  }
  let text = `支出 ${formatMoney(day.spend)}`;
  if (average !== undefined && average > 0) {
    const ratio = day.spend / average;
    text += `，${percentText(day.spend, average)}`;
    if (ratio > SPEND_SPIKE_RATIO) text += '，属于超支';
    else if (ratio < SPEND_LOW_RATIO) text += '，比平时克制';
  }
  if (day.income > 0) text += `；另有收入 ${formatMoney(day.income)}`;
  return `${text}。`;
}

function foodBullet(day: DaySummary, average: number | undefined): string {
  const parts: string[] = [];
  if (day.meals > 0) parts.push(`吃了 ${day.meals} 次`);
  if (day.calories > 0) parts.push(`摄入 ${Math.round(day.calories)} kcal`);
  let text = parts.join('，');
  if (day.calories > 0 && average !== undefined && average > 0) {
    text += `，${percentText(day.calories, average)}`;
    if (day.calories / average > CALORIE_SPIKE_RATIO) text += '，比平时吃得多';
  }
  return `${text}。`;
}

function sleepBullet(day: DaySummary, average: number | undefined): string {
  const hours = day.sleep as number;
  let text = `睡眠 ${formatAmount(hours)} 小时`;
  if (average !== undefined) {
    text += `，${diffText(hours, average, '小时', 1)}`;
  } else if (hours < SLEEP_SHORT_HOURS) {
    text += '，不足 7 小时';
  } else if (hours >= SLEEP_GOOD_HOURS) {
    text += '，睡得不错';
  }
  return `${text}。`;
}

function stepsBullet(day: DaySummary, average: number | undefined): string {
  const steps = Math.round(day.steps as number);
  let text = `走了 ${steps} 步`;
  if (average !== undefined) {
    text += `，${diffText(steps, average, '步', 0)}`;
  } else if (steps < STEPS_LOW) {
    text += '，步数偏少';
  } else if (steps >= STEPS_GOOD) {
    text += '，步数充足';
  }
  return `${text}。`;
}

function waterBullet(day: DaySummary, average: number | undefined): string {
  const water = Math.round(day.water as number);
  let text = `喝水 ${water} ml`;
  if (average !== undefined) {
    text += `，${diffText(water, average, 'ml', 0)}`;
  } else if (water < WATER_LOW) {
    text += '，可以再多喝一些';
  }
  return `${text}。`;
}

/** 2–4 factual yesterday bullets, most relevant first. */
function buildReview(
  day: DaySummary,
  averages: HistoryAverages,
  counts: YesterdayCounts,
): string[] {
  if (day.recordCount === 0) {
    const bullets = ['昨天没有记录。'];
    if (counts.plain > 0) bullets.push(`写了 ${counts.plain} 条普通笔记。`);
    if (averages.records !== undefined) {
      bullets.push(`之前有记录的日子日均 ${formatAmount(roundTo(averages.records, 1))} 条。`);
    } else {
      bullets.push('近 7 天还没有可对比的记录。');
    }
    return bullets.slice(0, REVIEW_LIMIT);
  }

  const bullets: string[] = [];
  const breakdown: string[] = [];
  if (counts.food > 0) breakdown.push(`饮食 ${counts.food} 条`);
  if (counts.health > 0) breakdown.push(`健康 ${counts.health} 条`);
  if (counts.finance > 0) breakdown.push(`收支 ${counts.finance} 笔`);
  if (counts.diary > 0) breakdown.push(`日记 ${counts.diary} 篇`);
  bullets.push(
    breakdown.length > 0
      ? `昨天记了 ${day.recordCount} 条记录：${breakdown.join('、')}。`
      : `昨天记了 ${day.recordCount} 条记录。`,
  );

  bullets.push(moneyBullet(day, averages.spend));
  if (day.meals > 0 || day.calories > 0) bullets.push(foodBullet(day, averages.calories));
  if (day.sleep !== undefined) bullets.push(sleepBullet(day, averages.sleep));
  if (day.steps !== undefined) bullets.push(stepsBullet(day, averages.steps));
  if (day.water !== undefined) bullets.push(waterBullet(day, averages.water));
  if (day.diaryCount > 0) bullets.push(`写了 ${day.diaryCount} 篇日记。`);
  if (counts.plain > 0) bullets.push(`另外记了 ${counts.plain} 条笔记。`);

  return bullets.slice(0, REVIEW_LIMIT);
}

/**
 * 2–3 concrete actions for today. Deviations come first (sleep, spending,
 * calories, steps, water, diary), then strengths worth keeping, then neutral
 * recording prompts so there are always at least two suggestions.
 */
function buildSuggestions(day: DaySummary, averages: HistoryAverages): string[] {
  const candidates: string[] = [];

  if (day.recordCount === 0) {
    candidates.push('晚上花一分钟记一笔：吃了什么、花了多少，或睡了多久。');
  }

  const sleepShort =
    day.sleep !== undefined &&
    (day.sleep < SLEEP_SHORT_HOURS ||
      (averages.sleep !== undefined && day.sleep < averages.sleep - SLEEP_DEVIATION_HOURS));
  if (sleepShort) candidates.push('今晚提前 30 分钟上床，争取睡满 7 小时。');

  const spendSpike =
    day.spend > 0 &&
    averages.spend !== undefined &&
    averages.spend > 0 &&
    day.spend / averages.spend > SPEND_SPIKE_RATIO;
  if (spendSpike) {
    candidates.push(
      `今天把支出控制在 ${formatMoney(Math.round(averages.spend as number))} 左右，花之前先记下用途。`,
    );
  }

  const calorieSpike =
    day.calories > 0 &&
    averages.calories !== undefined &&
    averages.calories > 0 &&
    day.calories / averages.calories > CALORIE_SPIKE_RATIO;
  if (calorieSpike) candidates.push('晚餐清淡一些，少加一次餐。');

  if (day.steps !== undefined && day.steps < STEPS_LOW) {
    candidates.push('今天找一段 20 分钟的路走一走，把步数补到 5000 以上。');
  }
  if (day.water !== undefined && day.water < WATER_LOW) {
    candidates.push('今天分几次喝够 1500 ml 水，三餐后各一杯。');
  }
  if (day.recordCount > 0 && day.diaryCount === 0) {
    candidates.push('睡前写两句复盘：今天最值得记住的一件事是什么？');
  }

  if (day.sleep !== undefined && day.sleep >= SLEEP_GOOD_HOURS) {
    candidates.push('昨晚睡得不错，今晚尽量在同一时间入睡。');
  }
  if (day.steps !== undefined && day.steps >= STEPS_GOOD) {
    candidates.push('昨天走够了步数，今天再走一段维持这个节奏。');
  }
  if (
    day.spend > 0 &&
    averages.spend !== undefined &&
    averages.spend > 0 &&
    day.spend / averages.spend < SPEND_LOW_RATIO
  ) {
    candidates.push('昨天比平时省，今天继续顺手记下每笔支出。');
  }
  if (day.diaryCount > 0) {
    candidates.push('把今天的心情也写进日记，明天的复盘会更完整。');
  }

  candidates.push('今天先记一笔，明天的复盘会更准。');
  candidates.push('如果今天不方便记全，先记下睡眠和步数两项。');

  const unique = candidates.filter((line, index) => candidates.indexOf(line) === index);
  return unique.slice(0, SUGGESTION_LIMIT);
}

function spendTrend(day: DaySummary, averages: HistoryAverages): BriefTrend {
  const value = formatMoney(day.spend);
  if (day.spend <= 0) {
    return { label: TREND_LABELS[0], value, detail: '昨天没有支出记录', tone: 'neutral' };
  }
  if (averages.spend === undefined || averages.spend <= 0) {
    return { label: TREND_LABELS[0], value, detail: '近 7 天没有支出记录', tone: 'neutral' };
  }
  const ratio = day.spend / averages.spend;
  const tone: BriefTrend['tone'] =
    ratio > SPEND_SPIKE_RATIO ? 'warn' : ratio < SPEND_LOW_RATIO ? 'good' : 'neutral';
  return { label: TREND_LABELS[0], value, detail: percentText(day.spend, averages.spend), tone };
}

function calorieTrend(day: DaySummary, averages: HistoryAverages): BriefTrend {
  const value = `${Math.round(day.calories)} kcal`;
  if (day.calories <= 0) {
    return { label: TREND_LABELS[1], value, detail: '昨天没有饮食记录', tone: 'neutral' };
  }
  if (averages.calories === undefined || averages.calories <= 0) {
    return { label: TREND_LABELS[1], value, detail: '近 7 天没有饮食记录', tone: 'neutral' };
  }
  const tone: BriefTrend['tone'] =
    day.calories / averages.calories > CALORIE_SPIKE_RATIO ? 'warn' : 'neutral';
  return {
    label: TREND_LABELS[1],
    value,
    detail: percentText(day.calories, averages.calories),
    tone,
  };
}

function sleepTrend(day: DaySummary, averages: HistoryAverages): BriefTrend {
  if (day.sleep === undefined) {
    return { label: TREND_LABELS[2], value: '—', detail: '昨天没有睡眠记录', tone: 'neutral' };
  }
  const hours = day.sleep;
  const tone: BriefTrend['tone'] =
    hours < SLEEP_SHORT_HOURS ? 'warn' : hours >= SLEEP_GOOD_HOURS ? 'good' : 'neutral';
  const detail =
    averages.sleep === undefined
      ? '近 7 天没有睡眠记录'
      : diffText(hours, averages.sleep, '小时', 1);
  return { label: TREND_LABELS[2], value: `${formatAmount(hours)} 小时`, detail, tone };
}

function recordsTrend(day: DaySummary, averages: HistoryAverages): BriefTrend {
  const value = `${day.recordCount} 条`;
  if (day.recordCount === 0) {
    return { label: TREND_LABELS[3], value, detail: '昨天没有记录', tone: 'neutral' };
  }
  if (averages.records === undefined) {
    return { label: TREND_LABELS[3], value, detail: '近 7 天没有可比记录', tone: 'neutral' };
  }
  const tone: BriefTrend['tone'] = day.recordCount > averages.records ? 'good' : 'neutral';
  return {
    label: TREND_LABELS[3],
    value,
    detail: diffText(day.recordCount, averages.records, '条', 1),
    tone,
  };
}

function buildTrends(day: DaySummary, averages: HistoryAverages): BriefTrend[] {
  return [
    spendTrend(day, averages),
    calorieTrend(day, averages),
    sleepTrend(day, averages),
    recordsTrend(day, averages),
  ];
}

/**
 * Build the daily brief for the dashboard.
 *
 * @param notes whole vault (only life records participate in the numbers)
 * @param now   "today" anchor; defaults to the current time
 */
export function buildDailyBrief(notes: Note[], now = new Date()): DailyBrief {
  const todayKey = dayKeyOf(now);
  const yesterday = shiftDay(now, -1);
  const yesterdayKey = dayKeyOf(yesterday);
  const yesterdaySummary = summarizeDay(notes, yesterday);
  const history = summarizeRange(notes, HISTORY_DAYS, shiftDay(now, -2));
  const averages = historyAverages(history);
  const counts = countKinds(notes, yesterdayKey);

  return {
    dateKey: todayKey,
    yesterdayKey,
    summary: buildSummary(yesterdaySummary, averages),
    review: buildReview(yesterdaySummary, averages, counts),
    suggestions: buildSuggestions(yesterdaySummary, averages),
    trends: buildTrends(yesterdaySummary, averages),
  };
}
