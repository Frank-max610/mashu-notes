import type { Note, NoteMeta } from './types';
import { makeNote } from './prefs';

/**
 * First-run demo vault for 麻薯. It contains a week of life records so the
 * daily brief, the dashboard trends and the life graph are meaningful from the
 * very first launch, plus a couple of Markdown notes explaining the app.
 */

interface SeedSpec {
  id: string;
  title: string;
  content: string;
  kind?: Note['kind'];
  meta?: NoteMeta;
  minutesAgo: number;
  pinned?: boolean;
}

const DAY = 24 * 60;

/** Fixed values keep the demo deterministic across machines. */
const DAYS: ReadonlyArray<{
  offset: number;
  steps: number;
  sleep: number;
  weight?: number;
  lunch: number;
  lunchKcal: number;
  dinner: number;
  dinnerKcal: number;
  coffee: number;
  diary: boolean;
}> = [
  { offset: 6, steps: 6480, sleep: 6.6, weight: 52.8, lunch: 26, lunchKcal: 610, dinner: 24, dinnerKcal: 520, coffee: 18, diary: false },
  { offset: 5, steps: 9102, sleep: 7.4, weight: 52.7, lunch: 31, lunchKcal: 680, dinner: 19, dinnerKcal: 480, coffee: 0, diary: false },
  { offset: 4, steps: 5120, sleep: 6.2, weight: 52.6, lunch: 24, lunchKcal: 560, dinner: 28, dinnerKcal: 640, coffee: 22, diary: true },
  { offset: 3, steps: 8740, sleep: 7.6, weight: 52.6, lunch: 35, lunchKcal: 720, dinner: 21, dinnerKcal: 500, coffee: 18, diary: true },
  { offset: 2, steps: 7230, sleep: 7.1, weight: 52.5, lunch: 29, lunchKcal: 640, dinner: 26, dinnerKcal: 560, coffee: 0, diary: false },
  { offset: 1, steps: 4680, sleep: 6.4, weight: 52.4, lunch: 28, lunchKcal: 700, dinner: 30, dinnerKcal: 620, coffee: 18, diary: true },
  { offset: 0, steps: 8321, sleep: 7.2, weight: 52.4, lunch: 32, lunchKcal: 620, dinner: 22, dinnerKcal: 540, coffee: 18, diary: true },
];

function daySpecs(spec: (typeof DAYS)[number]): SeedSpec[] {
  const day = spec.offset;
  const at = (hour: number, minute = 0) => (spec.offset + 1) * DAY - hour * 60 - minute;
  const id = (suffix: string) => `seed-${suffix}-d${day}`;
  return [
    {
      id: id('sleep'),
      kind: 'health',
      title: `睡眠 ${spec.sleep.toFixed(1)} 小时`,
      content: 'Apple 健康 · 睡眠记录\n\n#健康 #睡眠',
      meta: { metric: '睡眠', value: spec.sleep, unit: '小时' },
      minutesAgo: at(23) + 16 * 60,
    },
    {
      id: id('steps'),
      kind: 'health',
      title: `步数 ${spec.steps} 步`,
      content: 'Apple 健康 · 步数记录\n\n#健康 #步数',
      meta: { metric: '步数', value: spec.steps, unit: '步' },
      minutesAgo: at(22) + 10 * 60,
    },
    ...(spec.weight
      ? [
          {
            id: id('weight'),
            kind: 'health' as const,
            title: `体重 ${spec.weight} kg`,
            content: '晨间称重\n\n#健康 #体重',
            meta: { metric: '体重' as const, value: spec.weight, unit: 'kg' },
            minutesAgo: at(7) + 40 * 60,
          },
        ]
      : []),
    {
      id: id('lunch'),
      kind: 'food',
      title: '午餐',
      content: '工作日午餐\n\n#饮食 #午餐',
      meta: { meal: '午餐', calories: spec.lunchKcal, amount: spec.lunch, dishes: ['套餐'] },
      minutesAgo: at(12) + 20 * 60,
    },
    {
      id: id('dinner'),
      kind: 'food',
      title: '晚餐',
      content: '自己做或楼下吃一点\n\n#饮食 #晚餐',
      meta: { meal: '晚餐', calories: spec.dinnerKcal, amount: spec.dinner, dishes: ['家常菜'] },
      minutesAgo: at(19) + 10 * 60,
    },
    ...(spec.coffee
      ? [
          {
            id: id('coffee'),
            kind: 'finance' as const,
            title: `咖啡 ¥${spec.coffee}`,
            content: '下午一杯咖啡\n\n#理财 #餐饮',
            meta: { amount: spec.coffee, category: '餐饮', direction: 'expense' as const },
            minutesAgo: at(15) + 30 * 60,
          },
        ]
      : []),
    ...(spec.diary
      ? [
          {
            id: id('diary'),
            kind: 'diary' as const,
            title: `${spec.offset === 0 ? '今日' : `${spec.offset} 天前`}记录`,
            content: `## 一点记录\n\n- 今天走了 ${spec.steps} 步\n- 睡得${spec.sleep >= 7 ? '还可以' : '有点少'}\n\n#日记`,
            meta: {},
            minutesAgo: at(21) + 40 * 60,
          },
        ]
      : []),
  ];
}

const NOTES: SeedSpec[] = [
  {
    id: 'seed-welcome',
    title: '欢迎来到麻薯',
    minutesAgo: 1,
    pinned: true,
    content: `麻薯是你的本地 Life OS：记录发生在你身上的事，再把它们连成图。\n\n- 今日：一句话记录 + 昨日复盘\n- 经历库：所有记录的时间线\n- 计划 / 个人画像 / 健康数据 / 理财：自动汇总的模块\n- 图谱 / 助手：看见关系，问出答案\n\n#开始 #使用`,
  },
  {
    id: 'seed-help-start',
    title: '开始这里',
    minutesAgo: 2,
    pinned: false,
    content: `欢迎来到麻薯 LifeOS。\n\n- 先点“今日”里的一句话记录条，记下今天发生的一件事\n- 计划模块用来放目标与待办\n- 个人画像、健康数据、理财会自动从记录里汇总\n- 所有模块都是模板，可以隐藏或删掉\n\n#使用手册`,
  },
  {
    id: 'seed-template-diary',
    title: '模板 · 每日日记',
    minutesAgo: 30,
    content: `## 今天的三件事\n\n1. \n2. \n3. \n\n## 今天的感觉\n\n\n\n## 明天想试试\n\n\n\n#模板 #日记`,
  },
  {
    id: 'seed-template-review',
    title: '模板 · 周复盘',
    minutesAgo: 40,
    content: `## 本周记录\n\n- 做了什么：\n- 学到什么：\n- 卡在哪里：\n\n## 下周调整\n\n- \n\n#模板 #复盘`,
  },
  {
    id: 'seed-template-expense',
    title: '模板 · 大额支出复盘',
    minutesAgo: 45,
    content: `金额：\n分类：\n为什么花：\n值不值：\n下次怎么选：\n\n#模板 #理财`,
  },
  {
    id: 'seed-plan-reading',
    title: '读《置身事内》',
    minutesAgo: 50,
    content: '本周读完前两章，做一页笔记。\n\n#计划',
  },
  {
    id: 'seed-plan-walk',
    title: '每天走 8000 步',
    minutesAgo: 55,
    content: '连续 5 天，晚饭后散步 20 分钟。\n\n#计划',
  },
];

/** Build the demo vault with stable relative timestamps. */
export function createSeedNotes(): Note[] {
  const now = Date.now();
  const life = DAYS.flatMap(daySpecs);
  return [...NOTES, ...life].map((seed) => {
    const occurredAt = now - seed.minutesAgo * 60_000;
    const note = makeNote({
      title: seed.title,
      content: seed.content,
      kind: seed.kind ?? 'note',
      meta: { ...seed.meta, occurredAt },
    });
    note.id = seed.id;
    note.createdAt = occurredAt;
    note.updatedAt = occurredAt;
    note.pinned = seed.pinned ?? false;
    if (seed.id === 'seed-plan-reading') note.meta.plan = { status: 'doing', dueAt: occurredAt + 3 * 86_400_000 };
    if (seed.id === 'seed-plan-walk') note.meta.plan = { status: 'todo', dueAt: occurredAt + 86_400_000 };
    return note;
  });
}
