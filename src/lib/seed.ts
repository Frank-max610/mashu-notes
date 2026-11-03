import type { Note } from './types';
import { makeNote } from './prefs';

/**
 * First-run demo vault. Small on purpose: it shows wiki links, tags, graph
 * edges, task lists and a dangling link (so "create note from a broken link"
 * is discoverable) without pretending to be a real knowledge base.
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
    title: '欢迎来到 Inkstone',
    minutesAgo: 6,
    content: `这是 **Inkstone（砚）**，一个本地优先、手机可用的开源 Markdown 知识库。

所有笔记都保存在这台设备里，不上传、不联网也能写。试试这些入口：

- [[Markdown 速查]] —— 支持哪些语法
- [[双向链接]] —— 用 \`[[笔记名]]\` 串起想法
- [[关系图谱]] —— 看看你的知识长什么样
- [[本地优先]] —— 为什么数据应该属于你

> 小提示：点右下角的 **+** 新建笔记；底部标签栏切换列表、图谱、搜索和设置。

#开始 #使用`,
  },
  {
    id: 'seed-markdown',
    title: 'Markdown 速查',
    minutesAgo: 42,
    content: `# 常用语法

**粗体**、*斜体*、~~删除线~~、\`行内代码\`

\`\`\`js
const note = "代码块也支持高亮排版";
\`\`\`

- 无序列表
- 第二项
  - 支持嵌套

1. 有序列表
2. 第二项

| 语法 | 说明 |
| --- | --- |
| \`[[笔记名]]\` | 双向链接 |
| \`#标签\` | 标签 |
| \`- [ ]\` | 待办 |

任务清单：

- [x] 安装 Inkstone
- [ ] 写下第一条笔记
- [ ] 连上关系图谱看看

#写作 #语法`,
  },
  {
    id: 'seed-backlinks',
    title: '双向链接',
    minutesAgo: 120,
    content: `用两个方括号就能链接另一条笔记：\`[[笔记名]]\`。

- 链接到已存在的笔记：[[关系图谱]]
- 链接到还不存在的笔记：[[未来的笔记]]（打开后会提示你新建）

被链接的笔记底部会自动出现 **反向链接**，于是想法不再散落，而是长成一张网。

如果链接目标只写了一半，编辑器会自动提示候选标题。

#功能 #写作`,
  },
  {
    id: 'seed-graph',
    title: '关系图谱',
    minutesAgo: 200,
    content: `图谱把笔记画成节点，把 \`[[链接]]\` 画成边。

- 节点越大，说明被引用得越多
- 灰色的虚线圈表示 **还没创建的笔记**
- 点节点即可跳转，点空白处拖动画布

它适合回答一个问题：**我的知识库里什么东西是孤岛？**

相关：[[双向链接]]、[[本地优先]]、[[欢迎来到 Inkstone]]

#功能`,
  },
  {
    id: 'seed-local-first',
    title: '本地优先',
    minutesAgo: 300,
    content: `本地优先（local-first）意味着：

1. 数据在主设备上，断网也能读写；
2. 不依赖任何账号或云服务；
3. 随时可以完整导出，不被平台锁定。

Inkstone 把笔记存在浏览器的 IndexedDB 里，并提供 JSON / Markdown 导出。手机和电脑是各自独立的库——想同步时，导出再导入即可。

相关：[[手机上的知识库]]、[[关于开源]]

#理念`,
  },
  {
    id: 'seed-mobile',
    title: '手机上的知识库',
    minutesAgo: 480,
    content: `在手机上记录，重点是 **快**。

Inkstone 的界面为单手操作设计：底部导航、大按钮、浮动新建键、编辑器里贴着键盘的快捷工具栏。

把它添加到主屏幕，看起来就和原生 App 一样：

- iOS Safari：分享 → 添加到主屏幕
- Android Chrome：菜单 → 添加到主屏幕

进一步阅读：[[Inkstone 使用技巧]]

#移动端 #使用`,
  },
  {
    id: 'seed-tips',
    title: 'Inkstone 使用技巧',
    minutesAgo: 720,
    content: `**快捷键 / 操作**

- 编辑器顶部可切换「编辑 / 预览」
- 工具栏插入粗体、标题、列表、代码块、链接
- 长按笔记卡片可以置顶或删除
- 搜索框支持标题和正文关键词

**数据安全**

设置页可以随时导出全部笔记为 JSON，或导出为 Markdown 合集备份。

相关：[[欢迎来到 Inkstone]]、[[Markdown 速查]]

#使用`,
  },
  {
    id: 'seed-inbox',
    title: '灵感箱',
    minutesAgo: 1500,
    content: `随手收集，之后再整理。

- 一个只属于我的、能在手机上写字的开源笔记工具
- 用 \`[[链接]]\` 代替文件夹
- [[待整理的想法]]
- 把每天的想法连成一张网

#收集`,
  },
  {
    id: 'seed-daily',
    title: '每日笔记 · 2026-11-03',
    minutesAgo: 90,
    content: `## 今天

- [x] 把 Inkstone 打开
- [x] 写下第一条笔记
- [ ] 试试 [[关系图谱]]
- [ ] 导出一次备份

## 想法

知识库的价值不在于存了多少，而在于 **重新遇到** 了多少。

#日记`,
  },
  {
    id: 'seed-open-source',
    title: '关于开源',
    minutesAgo: 2400,
    content: `Inkstone 以 MIT 协议开源：可以自由使用、修改、分发。

它不追求复刻 Obsidian 的全部功能，只想把最核心的几件事做好：

- 纯本地 Markdown
- 双向链接与反向链接
- 图谱与搜索
- 手机上顺畅书写

相关：[[本地优先]]、[[欢迎来到 Inkstone]]

#开源`,
  },
];

/** Build the demo vault with stable relative timestamps. */
export function createSeedNotes(): Note[] {
  const now = Date.now();
  const notes: Note[] = SEEDS.map((seed, index) => {
    const note = makeNote({ title: seed.title, content: seed.content });
    note.id = seed.id;
    const updatedAt = now - seed.minutesAgo * 60_000;
    note.createdAt = updatedAt;
    note.updatedAt = updatedAt;
    note.pinned = index === 0;
    return note;
  });
  return notes;
}
