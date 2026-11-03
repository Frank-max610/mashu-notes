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
    minutesAgo: 3,
    pinned: true,
    content: `**麻薯**：一个把每天吃、睡、花、想，连成一张图的本地生活 App。

打开先看**昨日复盘**和**今日建议**，不用翻笔记。

- 一句话记一笔：吃了什么、睡了多久、花了多少
- 所有记录长成一张[[生活图谱]]，随便拖、加、连
- 有想问的，直接找[[助手说明]]
- 数据只在这台手机上，不联网也能用

#开始 #使用`,
  },
  {
    id: 'seed-graph',
    title: '生活图谱',
    minutesAgo: 4 * 60,
    content: `每条记录是一个节点：饮食、健康、收支、日记各有颜色，同一天自动连线。

点节点可以编辑、删除、拖到喜欢的位置；也可以手动连线、重新布局。

相关：[[欢迎来到麻薯]]

#功能 #使用`,
  },
  {
    id: 'seed-agent',
    title: '助手说明',
    minutesAgo: 5 * 60,
    content: `内置助手完全在本机运行：

- 用一句话记一笔，确认后才会保存
- 回答「今天花了多少」「本周睡眠怎么样」这类本机统计
- 名字和头像都可以在「我的」里换

它不是大语言模型，回答范围由本地规则决定，所以稳定、可解释、不联网。

#功能 #智能体`,
  },
  {
    id: 'seed-health-sync',
    title: '连接 Apple 健康',
    minutesAgo: 6 * 60,
    content: `在「我的 → Apple 健康」里可以：

- 导入 Apple 健康导出的 JSON / CSV
- 用「快捷指令」把步数、睡眠、心率、体重发过来

也可以查看原生壳（Xcode + HealthKit）的接入说明。

#健康 #Apple健康`,
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
    return note;
  });
}
