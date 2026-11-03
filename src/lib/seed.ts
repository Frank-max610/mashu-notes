import type { Note } from './types';
import { makeNote } from './prefs';

/**
 * First-run demo vault for Mochi. Small on purpose: it shows wiki links, tags,
 * graph edges, task lists and one dangling link (so "create a note from a broken
 * link" is discoverable) without pretending to be a real notebook.
 */

interface SeedSpec {
  /** Stable ids keep deep links and screenshots reproducible. */
  id: string;
  title: string;
  content: string;
  /** Minutes before "now". */
  minutesAgo: number;
}

const SEEDS: SeedSpec[] = [
  {
    id: 'seed-welcome',
    title: '欢迎来到 Mochi',
    minutesAgo: 6,
    content: `这里是 **Mochi（麻薯）** 呀 🍡 一个软乎乎、只属于你的 Markdown 小本子。

所有笔记都揉进这台设备里，不联网也能慢慢写。

试试这些入口：

- [[Markdown 小抄]] —— 会这几招就够啦
- [[双向链接]] —— 用 [[名字]] 把麻薯串起来
- [[关系图谱]] —— 看看你的一碗麻薯
- [[本地优先]] —— 为什么数据要待在自己口袋里

> 小提示：点底部中间的 **＋** 捏一颗新麻薯；长按卡片可以置顶或删掉。

#开始 #开心`,
  },
  {
    id: 'seed-markdown',
    title: 'Markdown 小抄',
    minutesAgo: 42,
    content: `# 一点点就够啦

**粗粗的**、*软软的*、~~划掉~~、\`小代码\`

\`\`\`js
const mochi = "软乎乎";
\`\`\`

- 圆圆的列表
- 第二颗
  - 里面还能再放一颗

1. 第一颗
2. 第二颗

| 魔法 | 效果 |
| --- | --- |
| \`[[名字]]\` | 把麻薯串起来 |
| \`#标签\` | 给麻薯贴口味 |
| \`- [ ]\` | 记下要做的事 |

- [x] 打开 Mochi
- [ ] 写下今天的第一颗麻薯
- [ ] 去图谱里转一转

#写作 #语法`,
  },
  {
    id: 'seed-backlinks',
    title: '双向链接',
    minutesAgo: 120,
    content: `用两个方括号 \`[[名字]]\` 就能把两颗麻薯串起来～

- 串到已经有的麻薯：[[关系图谱]]
- 串到还没捏的麻薯：[[还没捏的麻薯]]（点一下就能捏出来）

被串到的麻薯底部会自动出现 **反向链接**，想法就这样慢慢连成一张网 ♡

#功能 #写作`,
  },
  {
    id: 'seed-graph',
    title: '关系图谱',
    minutesAgo: 200,
    content: `图谱把每颗麻薯画成小球，把 \`[[链接]]\` 画成糖丝～

- 球越大，说明被串到的次数越多
- 灰色虚线圈 = 还没捏出来的麻薯
- 点小球打开笔记，拖空白处挪动画面

它可以回答一个甜甜的问题：**我的小本子里，谁是孤零零的那颗？**

相关：[[双向链接]]、[[本地优先]]、[[欢迎来到 Mochi]]

#功能`,
  },
  {
    id: 'seed-local',
    title: '本地优先',
    minutesAgo: 300,
    content: `本地优先（local-first）就是：

1. 麻薯放在自己口袋里，断网也能吃；
2. 不要账号、不连云端；
3. 随时能整个打包带走。

Mochi 把笔记存在浏览器的 IndexedDB 里，还能导出 JSON / Markdown，换设备也不慌。

相关：[[手机上的小本子]]、[[关于开源]]

#理念`,
  },
  {
    id: 'seed-mobile',
    title: '手机上的小本子',
    minutesAgo: 480,
    content: `在手机上记东西，最重要的是 **快** 和 **软**。

Mochi 的界面为单手设计：底部导航、圆圆的按钮、贴着键盘的快捷工具栏，还有底部中间那颗 **＋** 捏麻薯按钮。

把它添加到主屏幕，看起来就和一个可爱的原生 App 一样：

- iOS Safari：分享 → 添加到主屏幕
- Android Chrome：菜单 → 添加到主屏幕

进一步阅读：[[Mochi 使用小贴士]]

#移动端 #使用`,
  },
  {
    id: 'seed-tips',
    title: 'Mochi 使用小贴士',
    minutesAgo: 720,
    content: `**小手势**

- 编辑器右上角可以切换「编辑 / 预览」
- 工具栏插入粗体、标题、列表、代码块、双向链接
- 长按笔记卡片：置顶、复制、删除
- 搜索支持标题、正文和 #标签

**小保险**

设置里可以随时把全部麻薯打包导出成 JSON，或导出 Markdown 合集。

相关：[[欢迎来到 Mochi]]、[[Markdown 小抄]]

#使用`,
  },
  {
    id: 'seed-inbox',
    title: '灵感口袋',
    minutesAgo: 1500,
    content: `随手丢进来，之后再慢慢整理。

- 一个只属于我的、能在手机上写字的小本子
- 用 \`[[链接]]\` 代替文件夹
- [[待整理的小想法]]
- 把每天的小开心连成一颗颗麻薯

#收集`,
  },
  {
    id: 'seed-daily',
    title: '今日份心情',
    minutesAgo: 90,
    content: `## 今天

- [x] 打开 Mochi
- [x] 写下第一颗麻薯
- [ ] 去 [[关系图谱]] 转一转
- [ ] 导出一次备份

## 一点小想法

本子的价值不在于存了多少，而在于 **重新遇到** 了多少。

#日记`,
  },
  {
    id: 'seed-open',
    title: '关于开源',
    minutesAgo: 2400,
    content: `Mochi 以 MIT 协议开源：可以自由使用、修改、分享，也可以自己捏一只新的。

它不追求复刻 Obsidian 的全部功能，只想把最核心的几件事做软、做好：

- 纯本地 Markdown
- 双向链接与反向链接
- 图谱与搜索
- 手机上舒服地写

相关：[[本地优先]]、[[欢迎来到 Mochi]]

#开源`,
  },
];

/** Build the demo vault with stable relative timestamps. */
export function createSeedNotes(): Note[] {
  const now = Date.now();
  return SEEDS.map((seed, index) => {
    const note = makeNote({ title: seed.title, content: seed.content });
    note.id = seed.id;
    const updatedAt = now - seed.minutesAgo * 60_000;
    note.createdAt = updatedAt;
    note.updatedAt = updatedAt;
    note.pinned = index === 0;
    return note;
  });
}
