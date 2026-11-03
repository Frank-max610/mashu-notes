import type { FinanceDirection, HealthMetric, MealSlot, Note, NoteKind, NoteMeta } from './types';

/** Shared vocabulary for life records (labels, colours, emoji, order). */

export const NOTE_KINDS: readonly NoteKind[] = ['diary', 'food', 'health', 'finance', 'note'];

export interface KindInfo {
  label: string;
  /** Short verb shown on buttons and chips. */
  action: string;
  emoji: string;
  /** CSS custom property used by the graph and list accents. */
  accentVar: string;
  accentSoftVar: string;
  hint: string;
}

export const KIND_INFO: Record<NoteKind, KindInfo> = {
  diary: {
    label: '日记',
    action: '写日记',
    emoji: '📔',
    accentVar: '--kind-diary',
    accentSoftVar: '--kind-diary-soft',
    hint: '今天的心情、发生的小事',
  },
  food: {
    label: '饮食',
    action: '记饮食',
    emoji: '🍚',
    accentVar: '--kind-food',
    accentSoftVar: '--kind-food-soft',
    hint: '吃了什么、花了多少、热量',
  },
  health: {
    label: '健康',
    action: '记健康',
    emoji: '🌿',
    accentVar: '--kind-health',
    accentSoftVar: '--kind-health-soft',
    hint: '体重、睡眠、步数、饮水、运动',
  },
  finance: {
    label: '理财',
    action: '记一笔',
    emoji: '💳',
    accentVar: '--kind-finance',
    accentSoftVar: '--kind-finance-soft',
    hint: '支出、收入、记账分类',
  },
  note: {
    label: '笔记',
    action: '写笔记',
    emoji: '📝',
    accentVar: '--kind-note',
    accentSoftVar: '--kind-note-soft',
    hint: '普通 Markdown 笔记',
  },
};

export const MEAL_SLOTS: readonly MealSlot[] = ['早餐', '午餐', '晚餐', '加餐', '夜宵', '未分类'];

export const HEALTH_METRICS: readonly HealthMetric[] = [
  '体重',
  '睡眠',
  '步数',
  '心率',
  '饮水',
  '运动',
  '活动能量',
  '心情',
  '其他',
];

/** Units offered for health metrics (value is stored numerically). */
export const HEALTH_UNITS: Record<HealthMetric, string> = {
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

export const FINANCE_CATEGORIES: readonly string[] = [
  '餐饮',
  '交通',
  '购物',
  '居住',
  '娱乐',
  '医疗',
  '学习',
  '人情',
  '收入',
  '投资',
  '其他',
];

export function isNoteKind(value: unknown): value is NoteKind {
  return typeof value === 'string' && (NOTE_KINDS as readonly string[]).includes(value);
}

export function kindInfo(kind: NoteKind | undefined): KindInfo {
  return KIND_INFO[kind ?? 'note'] ?? KIND_INFO.note;
}

/** Human-readable one-line summary of a record's structured fields. */
export function describeMeta(note: Pick<Note, 'kind' | 'meta'>): string {
  const meta: NoteMeta = note.meta ?? {};
  const parts: string[] = [];
  switch (note.kind) {
    case 'food':
      if (meta.meal && meta.meal !== '未分类') parts.push(meta.meal);
      if (meta.calories) parts.push(`${Math.round(meta.calories)} kcal`);
      if (meta.amount) parts.push(`¥${formatAmount(meta.amount)}`);
      break;
    case 'health':
      if (meta.metric) {
        const unit = meta.unit ?? '';
        const value = meta.value !== undefined ? `${formatAmount(meta.value)}${unit}` : '';
        parts.push([meta.metric, value].filter(Boolean).join(' '));
      }
      break;
    case 'finance':
      if (meta.direction === 'income') parts.push('收入');
      if (meta.amount) parts.push(`¥${formatAmount(meta.amount)}`);
      if (meta.category) parts.push(meta.category);
      break;
    default:
      break;
  }
  if (meta.mood) parts.push(meta.mood);
  return parts.join(' · ');
}

export function formatAmount(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/** Direction helper used by stats and the agent. */
export function financeDirection(note: Note): FinanceDirection {
  return note.meta?.direction ?? 'expense';
}

/** Default title for a record kind when the user leaves it empty. */
export function defaultTitle(kind: NoteKind, now = new Date()): string {
  const hm = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
  switch (kind) {
    case 'food':
      return `饮食记录 ${hm}`;
    case 'health':
      return `健康记录 ${hm}`;
    case 'finance':
      return `收支记录 ${hm}`;
    case 'diary':
      return `${now.getMonth() + 1}月${now.getDate()}日 · 日记`;
    default:
      return '未命名笔记';
  }
}
