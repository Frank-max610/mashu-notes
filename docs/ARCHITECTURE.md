# Architecture

麻薯（Mashu）是一个**纯前端、本地优先**的单页应用：一个静态 `index.html` + 打包后的 JS/CSS，没有服务器、没有数据库服务、没有账号系统。这份文档说明代码如何组织、数据如何在浏览器里流动、本地助手与可编辑图谱如何工作，以及哪些地方适合扩展。

当前版本 **0.3.0**：在 0.2.x 的 Markdown 笔记基础上加入了**生活记录**（饮食 / 健康 / 收支 / 日记）、**可编辑生活图谱**和**完全离线的本地助手**，并完成了「纸与墨」视觉重设计。产品名统一为「麻薯」；源码标识与存储键沿用早期内部代号 `mochi`，仅为兼容旧数据。

## 1. 总览

- **一个记录库 = 生活记录 + 扁平笔记。** 没有文件夹、没有附件表；关系来自 Markdown 里的 `[[wiki 链接]]`、用户手动连线以及同一天生活记录之间的时间链。
- **浏览器就是后端。** 持久化在 IndexedDB（数据库 `mochi`，schema v2；不可用时回退 localStorage），写入是防抖的异步批量操作。
- **纯逻辑优先。** 解析、派生关系、搜索、图谱布局、生活统计、助手问答都在 `src/lib/`，不依赖 React 和 DOM，可在 Node 里直接测试；`store.ts`（React hook）、`db.ts` / `prefs.ts` / `exportImport.ts`（浏览器 API 适配）保持薄。
- **助手完全离线。** 规则式启发算法，不联网、不调用模型；同一份记录、同一个输入与 `now` 必然得到同样的结果。
- **零第三方服务。** 运行时不发网络请求，唯一的网络访问来自用户在笔记里主动写入的外链/图片。
- **视觉由设计变量驱动。** 「纸与墨」两套色板、记录类型色、圆角与动效集中在 `src/styles/tokens.css`；装饰性元素克制，动效尊重 `prefers-reduced-motion`。

```text
index.html
   │  <script type="module">
   ▼
src/main.tsx ──挂载（StrictMode）──▶ src/App.tsx（应用外壳：路由 / 主题 / 快速记录 / 图谱编辑 / 助手）
   │                                    │
   │                                    ├── src/screens/*        NotesScreen（首页/今天）、EditorScreen、SettingsScreen（我的）
   │                                    ├── src/components/*     可复用 UI（GraphView、CaptureSheet、AgentPanel、NodeEditorSheet…）
   │                                    ├── src/lib/useRoute.ts  hash 路由（#/notes、#/note/:id、#/graph、#/agent、#/search、#/settings）
   │                                    │
   │                                    └── src/lib/store.ts     useNotes()：内存中的唯一状态源
   │                                            │
   │                                            ├─ loadNotes / saveNotes / …   ← src/lib/db.ts
   │                                            │        └─ IndexedDB `mochi`（schema v2）
   │                                            │              └─（失败时）localStorage `mochi.notes.v1`
   │                                            │
   │                                            └─ 派生查询：links.ts / markdown.ts / search.ts / graph.ts / insights.ts / agent.ts
   │
   └─（生产构建 + 安全上下文）注册 public/sw.js：应用壳离线缓存（内部缓存名 `mochi-v2`）
```

## 2. 请求 / 数据流

### 启动

1. 浏览器加载 `index.html`，执行 `src/main.tsx`，React 挂载根组件；`index.html` 默认 `data-theme="light"`，首屏即浅色纸面。
2. `useNotes()` 初始化（模块级共享 Promise，只执行一次，避免 StrictMode 下重复播种）：
   - `loadNotes()` 打开 IndexedDB `mochi` v2，读出 `notes` 仓库的全部记录；若 db 升级到 v2，会在 `onupgradeneeded` 中逐条用 `normalizeNote()` 补齐 `kind` / `meta` / `manualLinks` / `position` 字段。
   - 若 `mochi` 库为空，会尝试迁移 0.1.x 的旧库与旧 localStorage 记录（见「持久化」）。
   - 空库且从未完成引导（`mochi.onboarded.v1 !== '1'`）时，写入 `seed.ts` 的演示记录并标记已引导。
   - 排序后写入内存状态并 `setReady(true)`；加载完成前显示「正在打开本地记录…」。
   - 调用 `navigator.storage.persist()` 请求持久化存储权限。
3. 各页面从 `useNotes()` 读取 `notes` / `sortedNotes` 与操作函数；`App` 通过 `useRoute()` 订阅 hash 变化决定渲染页面。主题偏好从 localStorage 读出后写入 `<html data-theme>`，并更新 `theme-color` meta（浅色 `#f7f5f0` / 深色 `#1c1e1c`）。
4. 生产构建（`import.meta.env.PROD`）在 `load` 后注册 `sw.js`；只在安全上下文（HTTPS / localhost）成功，失败静默忽略。

### 路由与导航

没有路由库，`src/lib/useRoute.ts` 是一个轻量 hash 路由：

| 路由 | 页面 | 底部导航 |
| --- | --- | --- |
| `#/notes`（默认） | 首页：今天概览 + 按天分组记录列表 | 笔记 |
| `#/note/<id>` | 编辑器 | （无） |
| `#/graph` | 生活图谱 | 图谱 |
| `#/agent` | 本地助手 | 助手 |
| `#/search` | 搜索（首页搜索图标进入） | （无） |
| `#/settings` | 我的（助手人设 / 数据 / 存储 / 外观） | 我的 |

- `parseRoute()` / `routeToHash()` 解析与序列化；`navigate()` push 历史记录（手机返回手势可用），`replaceRoute()` 替换当前记录（修正空 hash、记录被删除后回退）。
- 底部导航是悬浮胶囊：左侧「笔记 / 图谱」，中央圆形「＋」打开快速记录，右侧「助手 / 我的」。搜索不占导航位，由首页搜索图标进入 `#/search`。
- `App` 用 `returnToRef` 记录进入编辑器前的来源页，返回时回到原页面。
- hash 路由让静态托管（含子路径）与局域网地址都不需要服务端 rewrite；`scripts/serve.mjs` 对无扩展名路径做了 SPA fallback。

### 主题与视觉

- 主题值 `ThemeMode`（`light` / `dark` / `system`），持久化在 `mochi.theme.v1`；「我的 → 外观」用分段控件切换。
- `tokens.css`：`:root` 是浅色「纸」色板（暖白底、鼠尾草绿强调色、按记录类型分配的 `--kind-*` 颜色），`:root[data-theme='dark']` 是深色「墨」色板；圆角 10–28px、克制的阴影与缓动。
- `index.html` 的 `theme-color` 与 App 主题切换保持同步，手机状态栏颜色跟随。
- 动效仅用于状态反馈（面板进出、按钮按压、图谱节点高亮），不追逐装饰性；`prefers-reduced-motion` 下时长归零，图谱直接渲染静态布局。正文与控件的对比度按 WCAG AA 检查，触控目标保持 40px 以上。

### 编辑一条记录

```text
用户输入（标题 / 正文 / 结构化字段）
  → updateNote(id, patch)
      → 内存中构造新的 Note（tags 用 extractTags(content) 重新派生，structural 变化才刷新 updatedAt）
      → 乐观更新 notesRef / React state（UI 立即刷新）
      → dirtyRef 记录待写记录，scheduleFlush() 防抖 350ms
      → （350ms 后）flush() → saveNotes([...dirty]) → IndexedDB 单事务批量 put
```

- 新建走 `createNote(NoteInput)`，立即 `saveNotes([note])`（不防抖）。
- 删除走 `deleteNote()`：先移除记录并清理其他记录中指向它的 `manualLinks`，等已有写入落盘（`settleWrites`）后再删除；返回布尔值供 UI 提示失败。
- 页面隐藏 / 关闭时（`pagehide`、`beforeunload`、`visibilitychange === 'hidden'`）立即 `flush()`。
- 写入失败时 `flush()` 会把待写批次放回 `dirtyRef` 重试，并设置 `storageWarning` 提示导出备份。

### 快速记录（CaptureSheet）

1. 用户点底部「＋」或在首页点「记饮食 / 记健康 / 记一笔 / 写日记」，`App` 打开 `CaptureSheet`（可带 `initialKind`）。
2. 输入框内容变化时实时调用 `captureDraft(text, kindHint, now)`：本地助手把一句话解析为 `{ kind, title, content, meta, confidence }`。
3. 面板下方显示解析预览、置信度和按类型出现的快捷字段（餐次、热量、金额、指标、数值/单位、收支方向、分类）；用户修改快捷字段会合并进 meta，所见即所存。
4. 点「保存记录」（或桌面端 Cmd/Ctrl+Enter）后 `App` 调 `createNote()` 写入，关闭面板并 toast 提示；无解析结果时也可手动选类型保存。

### 助手对话（AgentPanel）

1. `AgentPanel` 挂载时调用 `agentGreeting(notes)` 生成问候与快捷问题；消息只存在组件 state（刷新即清空，不持久化）。
2. 发送消息 → `agentReply(text, notes, now)` 分类为 `capture` / `summary` / `advice` / `help` / `fallback`：
   - `capture` 返回 `action.createNote` 草稿，面板渲染成确认卡片（保存 / 取消），确认后才调用 `onSaveDraft()`；
   - `summary` / `advice` 直接返回本地统计生成的文字与继续追问的胶囊；
   - 输入框处理中文输入法 composition，回车不会误发送。
3. 「更换头像和名字」跳转到「我的」的助手人设设置，保存到 `mochi.agent.v1`。

### 生活图谱编辑

1. `GraphView` 用 `buildGraph(notes)` 派生节点与三类边，并在画布上做力导向布局；指纹（id + 标题 + 正文哈希 + 类型/元数据/位置/手动连线）变化时才重建。
2. 交互模式：
   - `idle`：点节点选中（由 `App` 打开 `NodeEditorSheet`），再次点同一节点打开笔记；拖动节点在拖动结束后通过 `onMoveNote(id, position)` 归一化保存位置；点空白取消选择。
   - `add`：点画布空白处，把点击位置传给 `onCreateNoteAt(position)`，打开记录信息面板新建记录。
   - `connect`：依次点两个节点，通过 `onLinkNotes(source, target)` 建立手动连线。
   - 工具栏另有放大 / 缩小 / 适应画布 / 重新布局（`onRequestResetLayout` 清除已保存位置）。
3. 保存位置后 `store.setNodePosition()` 更新记录并防抖写入；重新加载时该节点以 `fixed` 状态固定在画布上。

### 导入 / 导出

- 导出：`exportImport.ts` 生成 JSON `VaultFile`（`app: 'mochi'`、`version: 2`、`exportedAt`、`notes`）或 Markdown 合集 → `downloadText()` 下载；「我的」页文件名形如 `mashu-<时间戳>.json` / `.md`。
- 导入：`parseVaultJson()` 兼容「带 `notes` 数组的对象」与「裸笔记数组」，逐条经 `normalizeNote()` 归一化（补 id、时间戳、kind/meta/manualLinks/position，重复 id 分配新 id）→ 两种模式：
  - **合并**：`mergeVaultNotes()` 按标题（trim + 小写）合并，同名保留 `updatedAt` 较新的版本，其余追加；已有记录不会被丢弃。
  - **替换**：`replaceAll()` 整库覆盖（二次确认）。
- **向后兼容**：v2 解析不校验顶层 `app` 标识，因此 0.1.x / 0.2.x 的旧 JSON 备份（vault v1、甚至裸数组）都能导入；0.1.x 的旧浏览器存储会在启动时自动迁移。
- 单条记录可在操作面板「复制 Markdown」或「导出为 `.md`」。没有字段级冲突解决（见路线图）。

### 局域网、工具脚本与部署

- `npm run share` → `scripts/serve.mjs`：只读静态文件服务器，把 `dist/` 托管在 `0.0.0.0:4173`，打印本机地址、局域网 URL 与终端二维码；每台设备使用各自 origin 下的独立记录库。
- `npm run qr` → `scripts/qr.mjs`：用 `qrcode` 生成 `docs/screenshots/lan-qr.png` 与 `lan-url.txt`，二维码只含 URL。
- `npm run screenshots` → `scripts/screenshots.mjs`：驱动本机 Chrome（DevTools 协议，无 Puppeteer）按路由截图到 `docs/screenshots/`；可用 `CHROME_PATH` 指定浏览器。
- `npm run icons` → `scripts/make_icons.py`：Python + Pillow 生成 PWA 图标。
- `.github/workflows/deploy-pages.yml`：推送到 `main` 或手动触发后构建 `dist/` 并发布到 GitHub Pages（计划地址 <https://frank-max610.github.io/mashu-notes/>）；`base: './'` 保证子路径可用，hash 路由不需要服务端 rewrite。

## 3. 模块地图

### `src/lib/` — 核心逻辑（纯函数 + 浏览器适配层）

| 模块 | 职责 | 依赖 |
| --- | --- | --- |
| `types.ts` | 数据契约：`NoteKind`、`NoteMeta`、`NotePosition`、`Note`、`NoteSummary`、`RecordDraft`、`AgentPersona`、`ThemeMode` 等 | 无 |
| `kinds.ts` | 记录类型词表：`NOTE_KINDS`、`KIND_INFO`（标签/动作/emoji/颜色变量）、`MEAL_SLOTS`、`HEALTH_METRICS` / `HEALTH_UNITS`、`FINANCE_CATEGORIES`、`describeMeta`、`defaultTitle`、`formatAmount` | `types.ts` |
| `links.ts` | 从 Markdown 派生关系：wiki 链接、标签、反向链接、标题索引 | `types.ts` |
| `markdown.ts` | markdown-it 实例、wiki 链接预处理与渲染、任务清单规则、`plainText` / `excerpt` / `countWords` | `markdown-it`、`types.ts` |
| `insights.ts` | 生活统计：`summarizeDay` / `summarizeRange`、`healthSeries`、`spendingByCategory`、`weekSummaryText`、`formatMoney`、`dayKeyOf` / `noteDayKey` | `types.ts`、`kinds.ts` |
| `agent.ts` | 本地助手：`parseEntry` / `captureDraft`、`agentGreeting` / `agentReply`、`AGENT_SUGGESTIONS`、`AgentIntent` / `AgentReply` | `types.ts`、`kinds.ts`、`insights.ts` |
| `search.ts` | 全文搜索：多关键词 AND、`#tag` 过滤、评分排序、命中片段；标题补全 | `types.ts`、`links.ts`、`markdown.ts` |
| `graph.ts` | 生活图谱：`buildGraph`（wiki / manual / day 三类边、幽灵节点）、`seedPositions`、`tick`、`layoutSync` | `types.ts`、`links.ts` |
| `db.ts` | 持久化适配：`loadNotes` / `saveNotes` / `deleteNoteFromDb` / `replaceAllNotes` / `clearAllNotes` / `storageEstimate` / `requestPersistentStorage` / `getStorageMode`；schema v2 升级与旧库迁移 | 浏览器 IndexedDB / localStorage |
| `store.ts` | React 状态源 `useNotes()`：内存缓存、乐观更新、防抖写入、`settleWrites`、图谱位置与手动连线操作、生命周期 flush、`sortNotes` | React、`db.ts`、`links.ts`、`prefs.ts`、`seed.ts` |
| `prefs.ts` | 主题、引导标记、助手人设（`mochi.agent.v1`）读写；`normalizeNote` / `makeNote` / `makeId`；`AGENT_AVATARS` | `types.ts`、`kinds.ts`、`links.ts` |
| `seed.ts` | 首次运行的演示记录（生活记录 + 笔记，含链接与示例数据） | `types.ts`、`prefs.ts` |
| `exportImport.ts` | `VaultFile`（vault v2）JSON 导出/解析、`normalizeNote` 归一化、`mergeVaultNotes`、Markdown 合集、下载与文件选择 | `types.ts`、`prefs.ts` |
| `format.ts` | 相对时间、日期、字节数等展示格式化 | 无 |
| `useRoute.ts` | 轻量 hash 路由：`parseRoute` / `routeToHash` / `navigate` / `replaceRoute` / `useRoute` | React |

依赖方向单向：**UI → store → db / 纯函数核心**。`agent.ts` 依赖 `insights.ts`（回答与今日概览使用同一套数字），`insights.ts` / `kinds.ts` 是更底层的纯函数，绝不反向依赖 store 或 db。

### `src/components/` 与 `src/screens/`

- `components/` 是可复用、**道具驱动**的 UI：
  - `TabBar`（悬浮胶囊导航 + 中央＋记录）、`NoteCard`、`Icon`、`ActionSheet`、`EditorToolbar`、`MarkdownPreview`、`BacklinksPanel`、`SearchScreen`；
  - `GraphView`（Canvas 生活图谱：选择、拖动、添加、连线、缩放、重新布局）；
  - `CaptureSheet`（一句话快速记录 + 快捷字段 + 解析预览）；
  - `AgentPanel`（本地助手聊天与草稿确认）、`AgentAvatar`（预设/自定义 emoji 头像，`mochi` 预设使用吉祥物 SVG）；
  - `NodeEditorSheet`（新增/编辑节点：标题、类型、结构化字段、手动连线、删除）；
  - `Mascot`（内联 SVG 吉祥物，仅作为可选头像与少量空状态使用）。
- `screens/` 是页面级组合：`NotesScreen`（首页：今天概览、快捷记录、类型筛选、按天分组）、`EditorScreen`（Markdown 编辑/预览、类型徽章、字数、反向链接、打开记录信息）、`SettingsScreen`（我的：助手人设、数据导入导出、存储占用、外观、关于）。
- 样式手写 CSS：`tokens.css` 提供色板/类型色/圆角/动效/安全区变量，`base.css` 放 reset、通用类与动效降级，`app.css` 放外壳与页面样式；组件私有样式与组件同名并带前缀。没有 CSS 框架。

## 4. 数据模型

唯一持久化的实体是 `Note`（`src/lib/types.ts`），普通笔记与生活记录共用同一结构：

```ts
export type NoteKind = 'note' | 'diary' | 'food' | 'health' | 'finance';

export interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  kind: NoteKind;
  meta: NoteMeta;
  manualLinks: string[];
  position?: NotePosition; // 归一化 0..1
}

export interface NoteMeta {
  occurredAt?: number;
  meal?: MealSlot;
  calories?: number;
  dishes?: string[];
  metric?: HealthMetric;
  value?: number;
  unit?: string;
  mood?: string;
  amount?: number;
  category?: string;
  direction?: 'expense' | 'income';
  detail?: string;
}
```

辅助类型：`NotePosition { x: number; y: number }`（0..1）、`RecordDraft`（助手/快速记录产出的草稿：`kind` / `title` / `content` / `meta` / `confidence`）、`AgentPersona { name, avatar }`、`NoteInput`（创建参数）、`NotePatch`（可编辑字段：标题 / 正文 / 置顶 / 类型 / meta）。

约定与不变量：

- `id` 创建后不变；导入文件中的重复 id 会在 `normalizeNote()` 中被重新分配，避免 `put` 覆盖；所有入库、迁移与导入的记录都会先经 `normalizeNote()` 补齐字段。
- `title` 是 `[[wiki 链接]]` 的解析锚点；不要求唯一，解析同名记录时取 `updatedAt` 最新的一条。
- `tags` 是派生字段：每次保存时用 `extractTags(content)` 重新计算。
- `kind` 缺省为 `note`；旧数据经 `normalizeNote()` 自动补齐。
- `meta` 所有字段可选，按类型使用；`occurredAt` 为该记录发生时间（缺省回退 `createdAt`），统计与「今天/昨天」分组都以它为准。
- `manualLinks` 存目标记录 id（无向、去重）；删除记录时会级联清理其他记录中指向它的 id。
- `position` 为归一化坐标；存在即表示用户固定了节点位置，布局与拖动都遵守它。
- `updatedAt` 在内容 / 标题 / 类型 / meta 变化时刷新；仅切换置顶或图谱位置不刷新。

## 5. 派生关系、统计与图谱

### 链接、标签与反向链接

- `[[目标]]` / `[[目标|别名]]`：先 `maskCode()` 屏蔽代码块与行内代码，再用正则解析；`normalizeTitle()` 做 trim / 合并空白 / 小写容错，`resolveLink()` 额外容忍 `.md` 后缀。
- 悬空链接在出链面板标记「未创建」，在图谱里生成幽灵节点，点击可创建同名记录。
- `#标签`：`#` 前须为行首或空白/常见中英文标点；标签体允许字母、数字、CJK、`_`、`-`、`/`；纯数字标签被拒绝；同样先屏蔽代码。
- 反向链接：`backlinksFor()` 扫描所有记录正文中的 wiki 链接，按「引用次数 → 更新时间」排序；出链按目标去重但保留计数。

### 生活统计（`insights.ts`）

- 只统计 `kind !== 'note'` 的生活记录；普通笔记不计入支出/热量/睡眠等数字。
- 日期按**本地时区**计算（`dayKeyOf` / `startOfDay`），时间戳取 `meta.occurredAt`（有效且 > 0）否则 `createdAt`。
- `summarizeDay(notes, date)` 返回：`spend`（饮食金额 + 理财支出）、`income`（理财收入）、`calories`、`meals`、`sleep` / `weight` / `steps` / `water` / `exercise`（当天最新一次健康记录的值）、`mood`（当天最后一条带心情的记录）、`diaryCount`、`recordCount`、`noteIds`。
- `summarizeRange(notes, days, now)` 生成最近 N 天的日汇总；`healthSeries()` 生成某健康指标的逐日序列（只保留有值的日期）；`spendingByCategory()` 汇总分类支出（饮食默认「餐饮」、理财支出默认「其他」，收入不计入）。
- 首页的「今天」卡片、助手的回答、未来的图表页都读取同一组函数，保证数字一致。

### 生活图谱（`graph.ts`）

- 节点：一条记录一个节点，携带 `kind`、保存位置（若存在则 `fixed`）、度数；未创建链接的目标生成幽灵节点（`ghost:<规范化标题>`，只能被打开/创建，不可编辑）。
- 三类无向边（按加入顺序去重）：
  1. `wiki`：正文中解析成功的 `[[链接]]`；
  2. `manual`：`manualLinks` 中按 id 解析成功的手动连线；同一对节点若已有 wiki 边，则把类型升级为 `manual`；
  3. `day`：同一本地日期内、`kind !== 'note'` 的生活记录按时间排序后**相邻串联**（不会重复已存在的节点对）。
- 自链接跳过；`degree` 为该节点关联的唯一边数，驱动节点大小。
- 布局：`seedPositions()` 用确定性黄金角螺旋铺开自由节点，已保存位置的节点按 0..1 映射为固定点；`tick()` 做 O(n²) 斥力 + 边弹簧 + 轻微向心，带阻尼、限速与边界约束，固定节点不动；`layoutSync()` 用于减少动效时的一次性布局。坐标做了纵横比补偿，竖屏手机也能铺满画布。

## 6. 本地助手（`agent.ts`）

完全离线、确定性的规则引擎，分两层：

1. **一句话解析**：`parseEntry(text, now)` 与 `captureDraft(text, kindHint, now)`：
   - 先规范化文本，过滤问候 / 空白 / 纯问句；健康词优先（避免「喝水」被当成饮食），再按饮食、金额、日记的顺序识别；
   - 抽取金额（`元` / `块` / `￥`）、热量（`大卡` / `kcal`）、餐次、菜品、健康指标与单位（kg / 斤 / 小时 / 步 / 万步 / ml / 杯 / 分钟 / 公里）、心情词；
   - 产出 `RecordDraft`（类型、标题、正文、meta、`confidence`）；快速记录面板传入 `kindHint` 时会把草稿强制为所选类型并尽量补字段；
   - 问句与寒暄返回 `null`，不会误生成记录。中文是主要解析目标。
2. **问答层**：`agentGreeting(notes, now)` 生成按时段问候 + 今日摘要 + 2–4 个快捷问题；`agentReply(input, notes, now)` 分类并回答：
   - `capture`：解析成草稿，返回 `action.createNote`，由 UI 渲染确认卡片；
   - `summary`：识别今天 / 昨天 / 本周 / 本月 × 支出 / 收入 / 饮食 / 睡眠 / 体重 / 步数 / 饮水 / 心情 / 记录条数 / 总览，读取 `insights.ts` 的数字生成回答；
   - `advice`：基于最近 7 天睡眠、饮食、支出给出一两句温和建议；
   - `help`：说明能力边界（可记什么、能回答什么、完全本地）；
   - `fallback`：引导用户换一种说法或直接记一笔。
   每次回答附带 2–4 个可继续提问的建议胶囊。

实现约束：无网络、无随机数、无隐藏状态；同一输入、同一份记录、同一个 `now` 必然得到相同结果（测试用固定 `now` 断言）。助手不是大语言模型，回答范围与措辞由规则决定；路线图中规划可选的**设备本地小模型适配器**（默认关闭，仍不联网）。

人设：`prefs.ts` 提供 8 个预设头像（`mochi` / 猫猫 / 叶子 / 太阳 / 星星 / 书本 / 茶茶 / 饭碗）与自定义 emoji；名字限 12 字，保存在 `mochi.agent.v1`。`AgentPanel` 的聊天记录只存在组件内存中，刷新即清空。

## 7. 可编辑图谱的 UI 契约

`GraphView` 是受控组件，所有写操作通过回调交给 `App` / `store`：

```ts
interface GraphViewProps {
  notes: Note[];
  activeNoteId?: string | null;
  selectedNoteId?: string | null;
  onSelectNote: (id: string | null) => void;
  onOpenNote?: (id: string) => void;
  onMoveNote: (id: string, position: NotePosition) => void;
  onCreateNoteAt: (position: NotePosition) => void;
  onLinkNotes: (sourceId: string, targetId: string) => void;
  onRequestResetLayout?: () => void;
}
```

`App` 的接线：

- `onSelectNote(id)` → 打开/关闭 `NodeEditorSheet`；
- `onMoveNote` → `store.setNodePosition(id, position)`（归一化后防抖写入；`null` 可清除）；
- `onCreateNoteAt` → 打开 `NodeEditorSheet` 的新建模式，并把点击位置作为新记录的 `position`；
- `onLinkNotes` → `store.addManualLink(source, target)`；
- `onRequestResetLayout` → `store.resetNodePositions()` 清空所有保存位置。

`NodeEditorSheet` 负责：标题、类型选择、按类型显示的结构化字段（餐次/热量/金额/分类/指标/数值/单位/心情）、手动连线选择器（可增删）、保存与删除；已有记录还会显示「打开笔记」。新建时由图谱位置决定初始坐标。

## 8. 持久化与导入导出

### IndexedDB（schema v2）

```ts
const DB_NAME = 'mochi';
const DB_VERSION = 2;
const STORE = 'notes';        // keyPath: 'id'，索引：updatedAt
```

- 首次创建对象仓库与 `updatedAt` 索引；`onupgradeneeded` 中若 `oldVersion < 2`，用游标遍历全部记录并 `normalizeNote()` 重写，补齐 `kind` / `meta` / `manualLinks` / `position`——就地升级，不丢旧数据。
- 读写包在单事务里：`saveNotes` 批量 `put`；`replaceAllNotes` 先 `clear()` 再批量 `put`；`clearAllNotes` 即 `replaceAllNotes([])`。
- 任何一步失败（隐私模式、被禁用、配额、版本冲突）回退 localStorage：`saveNotes` 按 id 合并后整体写回；`replaceAllNotes` / `clearAllNotes` 直接写入传入数组；`loadNotes` 下次成功打开时会把 localStorage 中的记录合并进 IndexedDB，只有确认写入成功才清理回退键。
- **0.1.x 迁移**：`mochi` 库为空时，读取早期版本的旧数据库与旧 localStorage 键（按 id 合并），把主题/引导标记复制到 `mochi.*`，写入成功后删除旧库；写入失败则保留旧库。旧版 JSON 备份同样可直接导入。
- `openDatabase()` 失败不缓存失败的 Promise，后续调用会重试。

### localStorage

| 键 | 内容 |
| --- | --- |
| `mochi.notes.v1` | 整库记录的 JSON 数组（仅在 IndexedDB 不可用时使用） |
| `mochi.theme.v1` | `light` / `dark` / `system` |
| `mochi.onboarded.v1` | 是否已完成首次引导（`'1'`） |
| `mochi.agent.v1` | 助手人设 `{ name, avatar }` |

> `mochi` 是历史内部代号，保留是为了兼容旧数据；产品名与界面统一为「麻薯」。

### 导出格式（vault v2）

```ts
interface VaultFile {
  app: 'mochi';      // 内部标识，导入时不强制校验
  version: 2;        // v1 备份仍可导入
  exportedAt: string;
  notes: Note[];
}
```

- JSON 无损保留 `kind` / `meta` / `manualLinks` / `position`；「我的」页导出文件名为 `mashu-<时间戳>.json`。
- 导入统一走 `normalizeNote()`：补 id（重复 id 重新分配）、时间戳、tags、kind/meta/manualLinks/position；兼容 v2、v1 与裸数组。
- 合并模式按标题（trim + 小写）匹配，仅在导入记录更新时替换；替换模式整库覆盖。没有字段级合并或冲突解决。
- Markdown 合集是单向导出格式，面向阅读/迁移，暂不支持导回。

### 写入时机与可靠性

- 编辑：内存乐观更新 + 350ms 防抖批量写；`flush()` 清定时器后写 `dirtyRef`，失败时把批次放回待写并提示。
- 立即写：新建、删除（删除前等待已有写入完成，防止晚到的防抖写入复活记录）、导入替换、清空。
- 生命周期兜底：`pagehide`、`beforeunload`、`visibilitychange(hidden)`。
- 首次启动请求持久化存储权限；「我的」页展示 `storageEstimate()` 的占用/配额。
- 已知限制：不做跨标签页实时同步（后写覆盖）；不做事务级回滚；导出是唯一备份手段。

## 9. 渲染管线

Markdown 渲染沿用原有管线：

```text
content
  │ 1. preprocessWikiLinks()
  │    [[目标|别名]] → [别名](wiki:<encodeURIComponent(目标)>)
  ▼
markdown-it（html:false, linkify:true, breaks:true, typographer:true）
  │ 2. inline / block 解析（代码块、行内代码保持原样）
  │ 3. 自定义 link_open：
  │      wiki: 链接 → <a class="wiki-link [is-missing]" data-wiki-target role="link">
  │      http(s) 链接 → target="_blank" rel="noopener noreferrer nofollow"
  │ 4. 自定义 core 规则：行首 "- [ ]" / "- [x]" → 只读复选框
  ▼
HTML 字符串 → MarkdownPreview 注入 DOM
  │ 5. 点击 data-wiki-target：已存在 → 跳转；不存在 → 创建后跳转
```

安全策略（纵深防御，不依赖第三方 sanitizer）：

- `html: false`：原始 HTML 被转义为文本，不能注入脚本或事件属性；
- markdown-it 默认协议校验拦截 `javascript:` / `vbscript:` / `file:` / `data:`（图片 data URI 除外）；
- wiki 链接目标经 `escapeHtml()` 再写入属性；外部链接统一 `rel="noopener noreferrer nofollow"`；
- 渲染结果中的 `class` / 属性均由代码生成，不拼接用户可控 HTML；
- 残余风险：用户主动写入的远程图片 URL 会被浏览器加载，隐私说明已注明。

生活记录在列表/面板中的展示不经过 Markdown：`kinds.ts` 的 `describeMeta()` 生成一行结构化摘要（如「午餐 · 620 kcal · ¥32」），`format.ts` 负责时间与数字格式化。

## 10. 状态管理（`useNotes`）

`useNotes()` 是应用里唯一的状态源：

- 状态：`notes`、`sortedNotes`、`ready`、`storageMode`、`storageWarning`。
- 操作：`createNote`、`updateNote`、`deleteNote`（返回是否成功）、`togglePin`、`replaceAll`、`clearAll`、`ensureNote`、`findByTitle`、`flush`、`usage`；以及图谱相关：`setNodePosition`、`addManualLink`、`removeManualLink`、`resetNodePositions`。
- 内部：`notesRef` 保存最新数组（回调里避免闭包过期）、`dirtyRef` 待写 Map、`timerRef` 防抖定时器、`inFlightRef` 当前写入；`settleWrites()` 用于删除/替换前等待落盘。`alreadySorted()` 避免编辑时列表跳动，`sortedNotes` 用 `useMemo`。
- 界面状态（主题、toast、操作面板、快速记录面板、节点编辑面板、当前选中节点、助手人设）留在 `App` 的本地 state 或 `prefs`，不进入 vault。

## 11. 性能

面向个人记录库（几十到几千条记录）：

- **全量内存**：启动时整库读入；列表、搜索、统计、图谱都在内存中计算，无分页/虚拟滚动。几千条以内流畅。
- **写入不阻塞输入**：乐观更新 + 350ms 防抖 + 生命周期 flush；删除前等待写入落盘。
- **统计按需且一致**：`insights.ts` 的 O(n) 纯函数在页面渲染时计算并 `useMemo` 缓存；首页、助手、未来图表共用同一来源。
- **图谱**：只对「指纹」变化重建图模型；布局用 Canvas 2D + `requestAnimationFrame`，拖动结束才持久化位置，固定节点不参与积分；减少动效时一次性布局。O(n²) 斥力适合数百节点，更大规模需要空间网格 / Worker（路线图）。
- **助手**：O(文本长度) 的规则匹配 + O(n) 统计，无网络、无模型推理，毫秒级返回；聊天消息只存组件内存。
- **搜索**：线性扫描标题/正文；个人库规模下足够快，未来可加倒排索引。
- **渲染**：Markdown 只在预览模式渲染；编辑态是纯文本 `textarea`；类型徽章与结构化摘要为轻量 DOM。
- **可优化点**：派生结果按 `updatedAt` 缓存、长列表虚拟化、图布局 Worker、增量索引。

## 12. 扩展点

| 扩展点 | 位置 | 做法 |
| --- | --- | --- |
| 新记录类型 | `types.ts` → `kinds.ts` → `tokens.css` → `prefs.normalizeNote` | 更新 `NoteKind`、`NOTE_KINDS` / `KIND_INFO`、`--kind-*` 颜色，并检查列表/图谱/统计/助手/节点编辑面板 |
| 新助手意图 / 解析规则 | `src/lib/agent.ts` | 扩展识别规则并返回 `AgentReply`；用固定 `now` 补 `tests/agent.test.ts`；需要时在 `AgentPanel` 增加展示 |
| 新图谱交互 | `GraphView` props → `App` 接线 → `store` 持久化方法 | 保持受控组件；位置/连线写入 store，纯布局逻辑留在 `graph.ts` 并测试 |
| 新存储字段 / 后端 | `src/lib/db.ts` + `prefs.normalizeNote` | 升 `DB_VERSION` 并在 upgrade 中就地补默认值；若改导出格式同步升 `VAULT_VERSION` 并保证旧备份可导入；新后端实现同一组 db 函数即可 |
| 新 Markdown 能力 | `src/lib/markdown.ts` | 通过 markdown-it 插件扩展；任何放宽 HTML/协议限制的改动必须先过安全评审 |
| 新统计 / 图表 | `src/lib/insights.ts` | 新增纯函数并复用 `DaySummary`；UI 图表页读同一组数字 |
| 新主题 / 视觉调整 | `src/styles/tokens.css` | 只改 token；深浅两套都要检查对比度与触控目标 |
| 离线与安装（PWA） | `public/sw.js` + `src/main.tsx` + `manifest` | 调整预缓存/缓存策略时递增 `CACHE` 版本（当前 `mochi-v2`），同步 README 与隐私说明 |
| 本地小模型（local LLM）适配器 | 新模块（例如 `agent-local-llm.ts`） | 默认关闭、完全在设备本地运行；必须保持离线与隐私边界，并明确 UI 提示 |
| 云同步 | 新模块（例如 `sync.ts`）建立在 `db.ts` 之上 | 需要设计版本向量/冲突解决；在此之前保持「导出 → 导入」的显式同步方式 |

## 13. 已知限制

- 助手是规则式本地助手，**不是大语言模型**；理解范围和措辞由规则决定，中文是主要解析目标。
- Service Worker 只在生产构建 + 安全上下文（HTTPS / localhost）注册；通过 HTTP 局域网访问没有离线能力。缓存版本手工递增，没有「新版本可用」提示。
- 没有同步与冲突解决：多设备靠导出/导入迁移；多标签页并发编辑后写覆盖。
- 没有文件夹、附件、图片上传；正文里的图片只能引用外部 URL。
- 导入只支持 JSON（Markdown 只是导出格式）；合并按标题覆盖，没有字段级合并。
- 统计函数已就绪，但尚无独立图表页；CSV 导入、Markdown 合集导入在路线图中。
- 图谱力导向布局与派生统计都在主线程；数万条记录时会有明显卡顿。
- 浏览器清站点数据即删除记录；`localStorage` 回退模式容量约 5MB。
- `npm run screenshots` / `npm run qr` 依赖本机 Chrome / Node 环境，属于发布工具。

更多关于数据与隐私的细节见 [PRIVACY.md](PRIVACY.md)。
