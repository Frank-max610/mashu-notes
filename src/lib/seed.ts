import type { Note, NoteMeta } from './types';
import { makeNote } from './prefs';

/**
 * First-run demo vault. It mixes classic Markdown notes with a few days of life
 * records (food / health / finance / diary) so the life graph, the agent and
 * the daily overview are useful from the very first launch.
 */

interface SeedSpec {
  id: string;
  title: string;
  content: string;
  /** Minutes before "now". */
  minutesAgo: number;
  kind?: Note['kind'];
  meta?: NoteMeta;
  pinned?: boolean;
}

const HOUR = 60;

const SEEDS: SeedSpec[] = [
  /* ---------------- classic notes ---------------- */
  {
    id: 'seed-welcome',
    title: '欢迎来到麻薯',
    minutesAgo: 6,
    pinned: true,
    content: `这里是 **麻薯**，一个只属于你的本地生活本 + Markdown 笔记。

- 吃的、睡的、花的、想写的，都可以丢在这里；
- 点底部中间的 **＋** 用一句话记一笔，比如「午饭牛肉面 32 元」；
- 所有记录会在 [[生活图谱]] 里连起来，还能自己拖动、添加、连线；
- 有什么想问的，去 **助手** 找你的小管家。

> 数据全部留在这台设备里，不联网也能用。

#开始 #使用`,
  },
  {
    id: 'seed-markdown',
    title: 'Markdown 小抄',
    minutesAgo: 42 * 60,
    content: `# 一点点就够啦

**粗体**、*斜体*、~~删除线~~、\`小代码\`

- 圆点列表
- 第二项

1. 第一项
2. 第二项

| 语法 | 效果 |
| --- | --- |
| \`[[名字]]\` | 双向链接 |
| \`#标签\` | 标签 |

- [x] 打开麻薯
- [ ] 用一句话记一笔
- [ ] 去生活图谱看看

#写作 #语法`,
  },
  {
    id: 'seed-graph',
    title: '生活图谱',
    minutesAgo: 3 * 60,
    content: `图谱把每条记录画成一个点：

- 🍚 饮食、🌿 健康、💳 收支、📔 日记，各有自己的颜色
- 同一天的多条记录会自动串在一起
- 长按/点选一个点，可以**编辑、删除、拉一条线**到另一个点
- 把点拖到你喜欢的位置，下次打开还在那儿

相关：[[欢迎来到麻薯]]

#功能 #使用`,
  },
  {
    id: 'seed-links',
    title: '双向链接',
    minutesAgo: 5 * 60,
    content: `用两个方括号 \`[[名字]]\` 就能把笔记串起来～

被串到的笔记底部会自动出现**反向链接**。

#功能`,
  },
  {
    id: 'seed-agent',
    title: '助手能做什么',
    minutesAgo: 4 * 60,
    content: `内置助手（名字和头像都能改）会帮你：

- 用一句话记一笔：「晚上跑了 5 公里」「奶茶 18 块」
- 回答本地问题：「今天花了多少？」「本周睡眠怎么样？」
- 顺手做点小结：今天一共记了几条、花在哪、吃了多少

它**不联网**，只在你的设备上算。相关：[[欢迎来到麻薯]]

#功能 #智能体`,
  },
  {
    id: 'seed-inbox',
    title: '灵感口袋',
    minutesAgo: 14 * 60,
    content: `随手丢进来，之后再慢慢整理。

- 用 \`[[链接]]\` 代替文件夹
- [[待整理的小想法]]
- 把每天的小事连成一张网

#收集`,
  },
  {
    id: 'seed-open',
    title: '关于开源',
    minutesAgo: 25 * 60,
    content: `麻薯以 MIT 协议开源：可以自由使用、修改、分享。

它把「记生活」和「写笔记」放在同一个本地小本子里：

- 纯本地 Markdown + 结构化生活记录
- 生活图谱可自由编辑
- 内置一个不联网的小助手

#开源 #理念`,
  },

  /* ---------------- today's life records ---------------- */
  {
    id: 'seed-sleep-today',
    kind: 'health',
    title: '睡眠 7.2 小时',
    minutesAgo: 13 * HOUR,
    content: '睡得还行，早上自然醒。\n\n#健康 #睡眠',
    meta: { metric: '睡眠', value: 7.2, unit: '小时', occurredAt: 0 },
  },
  {
    id: 'seed-weight-today',
    kind: 'health',
    title: '体重 52.4 kg',
    minutesAgo: 12 * HOUR,
    content: '晨起称重。\n\n#健康 #体重',
    meta: { metric: '体重', value: 52.4, unit: 'kg' },
  },
  {
    id: 'seed-breakfast',
    kind: 'food',
    title: '早餐 · 豆浆油条',
    minutesAgo: 11 * HOUR,
    content: '楼下早餐店的豆浆油条，吃得很满足。\n\n#饮食 #早餐',
    meta: { meal: '早餐', calories: 480, amount: 8, dishes: ['豆浆', '油条'] },
  },
  {
    id: 'seed-lunch',
    kind: 'food',
    title: '午餐 · 牛肉面',
    minutesAgo: 8 * HOUR,
    content: '公司附近的牛肉面，加了一份卤蛋。\n\n#饮食 #午餐',
    meta: { meal: '午餐', calories: 620, amount: 32, dishes: ['牛肉面', '卤蛋'] },
  },
  {
    id: 'seed-coffee',
    kind: 'finance',
    title: '咖啡 ¥18',
    minutesAgo: 6 * HOUR,
    content: '下午一杯拿铁，续命。\n\n#理财 #餐饮',
    meta: { amount: 18, category: '餐饮', direction: 'expense' },
  },
  {
    id: 'seed-steps',
    kind: 'health',
    title: '步数 8321 步',
    minutesAgo: 2 * HOUR,
    content: '下班走了一段路回家。\n\n#健康 #步数',
    meta: { metric: '步数', value: 8321, unit: '步' },
  },
  {
    id: 'seed-dinner',
    kind: 'food',
    title: '晚餐 · 番茄鸡蛋面',
    minutesAgo: 1 * HOUR,
    content: '自己煮的面，番茄放得有点多。\n\n#饮食 #晚餐',
    meta: { meal: '晚餐', calories: 540, amount: 22, dishes: ['番茄鸡蛋面'] },
  },
  {
    id: 'seed-metro',
    kind: 'finance',
    title: '地铁 ¥6',
    minutesAgo: 10 * HOUR,
    content: '通勤。\n\n#理财 #交通',
    meta: { amount: 6, category: '交通', direction: 'expense' },
  },
  {
    id: 'seed-diary-today',
    kind: 'diary',
    title: '今日份心情',
    minutesAgo: 100,
    content: `## 今天

- [x] 好好吃了早饭
- [x] 把 [[欢迎来到麻薯]] 看完了
- [ ] 明天早点睡

## 一点小想法

本子的价值不在于存了多少，而在于**重新遇到**了多少。

#日记`,
  },

  /* ---------------- yesterday ---------------- */
  {
    id: 'seed-lunch-yesterday',
    kind: 'food',
    title: '午餐 · 鸡腿饭',
    minutesAgo: 32 * HOUR,
    content: '昨天的午饭。\n\n#饮食 #午餐',
    meta: { meal: '午餐', calories: 700, amount: 28, dishes: ['鸡腿饭'] },
  },
  {
    id: 'seed-sleep-yesterday',
    kind: 'health',
    title: '睡眠 6.4 小时',
    minutesAgo: 37 * HOUR,
    content: '睡得有点少。\n\n#健康 #睡眠',
    meta: { metric: '睡眠', value: 6.4, unit: '小时' },
  },
  {
    id: 'seed-salary',
    kind: 'finance',
    title: '工资 ¥8500',
    minutesAgo: 30 * HOUR,
    content: '这个月工资到账。\n\n#理财 #收入',
    meta: { amount: 8500, category: '收入', direction: 'income' },
  },
  {
    id: 'seed-diary-yesterday',
    kind: 'diary',
    title: '昨天的小记',
    minutesAgo: 28 * HOUR,
    content: '加班到很晚，但还是走了一段路回家。\n\n#日记',
  },
];

/** Build the demo vault with stable relative timestamps. */
export function createSeedNotes(): Note[] {
  const now = Date.now();
  return SEEDS.map((seed) => {
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
