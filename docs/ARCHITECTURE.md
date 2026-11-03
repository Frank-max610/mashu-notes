# Architecture

Inkstone 是一个**纯前端、本地优先**的单页应用：一个静态 `index.html` + 打包后的 JS/CSS，没有服务器、没有数据库服务、没有账号系统。这份文档说明代码如何组织、数据如何在浏览器里流动，以及哪些地方适合扩展。

## 1. 总览

- **一个笔记库 = 一组扁平笔记。** 没有文件夹、没有附件表、没有关系表；关系全部从 Markdown 文本派生。
- **浏览器就是后端。** 持久化在 IndexedDB（不可用时回退 localStorage），写入是防抖的异步批量操作。
- **React 只负责渲染。** 解析、派生关系、搜索、图谱布局等纯逻辑都在 `src/lib/`，不依赖 React 和 DOM，可以在 Node 里直接测试；`store.ts`（React hook）、`db.ts` / `prefs.ts` / `exportImport.ts`（浏览器 API 适配）也在 `src/lib/`，但保持薄，方便替换和测试纯逻辑。
- **零第三方服务。** 运行时不发网络请求，唯一的网络访问来自用户笔记里主动写入的外链/图片。

```text
index.html
   │  <script type="module">
   ▼
src/main.tsx ──挂载（StrictMode）──▶ src/App.tsx（应用外壳：路由 / 主题 / 操作面板 / Toast）
   │                                    │
   │                                    ├── src/screens/*        笔记列表、编辑器、设置
   │                                    ├── src/components/*     可复用 UI（Icon、TabBar、NoteCard、MarkdownPreview、GraphView、SearchScreen、BacklinksPanel…）
   │                                    ├── src/lib/useRoute.ts  hash 路由（#/notes、#/note/:id、#/graph、#/search、#/settings）
   │                                    │
   │                                    └── src/lib/store.ts     useNotes()：内存中的唯一状态源
   │                                            │
   │                                            ├─ loadNotes / saveNotes / …   ← src/lib/db.ts
   │                                            │        └─ IndexedDB `inkstone`
   │                                            │              └─（失败时）localStorage `inkstone.notes.v1`
   │                                            │
   │                                            └─ 派生查询：links.ts / markdown.ts / search.ts / graph.ts
   │
   └─（生产构建 + 安全上下文）注册 public/sw.js：应用壳离线缓存
```

## 2. 请求 / 数据流

### 启动

1. 浏览器加载 `index.html`，执行 `src/main.tsx`，React 挂载根组件。
2. `useNotes()` 初始化（只执行一次）：
   - `loadNotes()` 打开 IndexedDB `inkstone` v1，读出 `notes` 仓库里的全部笔记；失败则回退读 localStorage。
   - 如果是空库且从未完成引导（`inkstone.onboarded.v1 !== '1'`），写入 `seed.ts` 生成的 10 条演示笔记并标记已引导。
   - `sortNotes()`（置顶优先，其次最近更新）后写入内存状态并 `setReady(true)`。
   - 调用 `navigator.storage.persist()` 请求持久化存储权限（不支持则静默跳过）。
3. 各页面从 `useNotes()` 返回值中读取 `notes` / `sortedNotes` 与操作函数，页面内再按需调用纯函数（图、搜索、反向链接）计算展示数据。`App` 通过 `useRoute()` 订阅 hash 变化决定渲染哪个页面；主题偏好从 localStorage 读出后写入 `<html data-theme>`，并同步更新 `theme-color` meta。
4. 生产构建（`import.meta.env.PROD`）在 `load` 事件后注册 `sw.js`；Service Worker 只在安全上下文（HTTPS / localhost）注册成功，失败会被静默忽略——离线支持只是渐进增强。

### 路由与导航

没有引入路由库，`src/lib/useRoute.ts` 是一个约 80 行的 hash 路由：

| 路由 | 页面 |
| --- | --- |
| `#/notes`（默认） | 笔记列表 |
| `#/note/<id>` | 编辑器 |
| `#/graph` | 关系图谱 |
| `#/search` | 搜索 |
| `#/settings` | 设置 |

- `parseRoute()` / `routeToHash()` 负责解析与序列化；`navigate()` push 一条历史记录（手机的返回手势/按键因此可用），`replaceRoute()` 替换当前记录（用于修正空 hash 或笔记被删除后回退）。
- 进入编辑器前，`App` 用 `returnToRef` 记录来源 tab，返回时回到原页面；如果当前笔记被删除，会自动 `replaceRoute` 回来源页。
- hash 路由让静态托管（含子路径）和局域网地址都不需要服务端 rewrite；`scripts/serve.mjs` 对无扩展名路径也做了 SPA fallback。

### 主题

- 主题值是 `prefs.ts` 里的 `ThemeMode`（`dark` / `light` / `system`），持久化在 localStorage `inkstone.theme.v1`。
- `App` 解析 `system`（`prefers-color-scheme`）后把最终主题写到 `<html data-theme>`，`tokens.css` 通过 `:root[data-theme='light']` 切换整套 CSS 变量；同时更新 `<meta name="theme-color">`，让手机浏览器状态栏颜色跟随。
- 默认深色（`index.html` 初始 `data-theme="dark"`），避免首屏闪烁。

### 离线与 Service Worker

`public/sw.js` 是应用壳离线层（Vite 构建时原样复制到 `dist/`）：

- 安装时预缓存 `./`、`./index.html`、`./manifest.webmanifest`、`./icons/icon-192.png`；激活时清理旧版本缓存。
- 导航请求 network-first：在线时取最新页面并写回缓存，离线时回退到缓存的 `index.html`；其他同源 GET 请求 cache-first，命中后返回缓存，否则请求并缓存成功响应。
- 只处理同源请求；不拦截、不缓存跨域资源。
- `CACHE = 'inkstone-v1'` 是手工版本号：改动预缓存列表或需要强制刷新缓存时要递增。
- 注册条件：生产构建 + 安全上下文。开发服务器（`npm run dev`）不注册；通过 HTTP 局域网地址访问时浏览器会拒绝注册。
- Service Worker 只缓存静态资源，**永远不缓存/读取 IndexedDB 或 localStorage 里的笔记**。

### 编辑一条笔记

```text
用户输入
  → updateNote(id, { content })
      → 内存中构造新的 Note（tags 用 extractTags(content) 重新派生，updatedAt = Date.now()）
      → 乐观更新 notesRef / React state（UI 立即刷新，不等待 I/O）
      → dirtyRef 记录待写笔记，scheduleFlush() 防抖 350ms
      → （350ms 后）flush() → saveNotes([...dirty]) → IndexedDB 单事务批量 put
```

- 新建笔记走 `createNote()`，立即 `saveNotes([note])`（不需要防抖）。
- 删除走 `deleteNote()`：先从内存移除并取消该笔记的待写项，再调用 `deleteNoteFromDb(id)`。
- 页面隐藏 / 关闭时（`pagehide`、`beforeunload`、`visibilitychange === 'hidden'`）立即 `flush()`，避免丢最后几秒的输入。
- 写入失败时设置 `storageWarning`（中文提示），UI 提醒用户导出备份。

### 导入 / 导出

- 导出：`exportImport.ts` 从当前 `notes` 生成 JSON（`VaultFile`：`app` / `version` / `exportedAt` / `notes`）或 Markdown 合集 → `downloadText()` 触发浏览器下载。
- 导入：读取用户选择的 JSON → `parseVaultJson()` 校验并逐条 `coerceNote()` 归一化（补 id、时间戳，重新计算 tags）→ 设置页可选两种模式：
  - **合并**：按标题（trim + 小写）合并，同名笔记保留 `updatedAt` 较新的版本，其余新增；
  - **替换**：`replaceAll()` 用文件内容整库覆盖（有二次确认）。
- 单条笔记也可以在操作面板里「复制 Markdown」或「导出为 `.md`」。没有字段级合并与冲突解决（见路线图）。

### 局域网访问

`npm run share` 启动的 `scripts/serve.mjs` 只是一个静态文件服务器：把 `dist/` 托管在 `0.0.0.0:4173` 并打印局域网 URL 与二维码。手机打开后运行的是同一份前端代码，但**数据存在手机浏览器自己的 origin 下**，与电脑上的库互不相通——服务器不接触、也不转发笔记数据。

## 3. 模块地图

### `src/lib/` — 核心逻辑（纯函数 + 浏览器适配层）

| 模块 | 职责 | 依赖 |
| --- | --- | --- |
| `types.ts` | 数据契约：`Note`、`NoteSummary`、`WikiLink`、`ResolvedLink`、`Backlink`、`TagCount`、`NotePatch`、`ThemeMode` | 无 |
| `links.ts` | 从 Markdown 派生关系：`maskCode`、`extractWikiLinks`、`extractTags`、`normalizeTitle`、`buildTitleIndex`、`resolveLink`、`outgoingLinks`、`backlinksFor`、`backlinkCounts`、`allTags`、`noteMatches` | `types.ts` |
| `markdown.ts` | markdown-it 实例、wiki 链接预处理与渲染、任务清单规则、`plainText` / `excerpt` / `countWords` | `markdown-it`、`types.ts` |
| `search.ts` | 全文搜索：多关键词 AND、`#tag` 过滤、评分排序、命中片段；标题补全 | `types.ts`、`links.ts`、`markdown.ts`（复用 `plainText` / `excerpt`） |
| `graph.ts` | 由笔记构建节点/边（含幽灵节点）、确定性初始布局、力导向 `tick` / `layoutSync` | `types.ts`、`links.ts` |
| `db.ts` | 持久化适配：`loadNotes`、`saveNotes`、`deleteNoteFromDb`、`replaceAllNotes`、`clearAllNotes`、`storageEstimate`、`requestPersistentStorage`、`getStorageMode` | 浏览器 IndexedDB / localStorage |
| `store.ts` | React 状态源 `useNotes()`：内存缓存、乐观更新、防抖写入、生命周期 flush、`sortNotes` | React、`db.ts`、`links.ts`、`prefs.ts`、`seed.ts` |
| `prefs.ts` | 主题与引导标记的 localStorage 读写；`makeId()` / `makeNote()` 工厂 | `types.ts`、`links.ts` |
| `seed.ts` | 首次运行的演示笔记（展示链接、标签、任务、幽灵节点） | `types.ts`、`prefs.ts` |
| `exportImport.ts` | `VaultFile` JSON 导出/解析、Markdown 合集、下载与文件选择、文件名时间戳 | `types.ts`、`links.ts`、`prefs.ts` |
| `format.ts` | 相对时间与字节数的展示格式化 | 无 |
| `useRoute.ts` | 轻量 hash 路由：`parseRoute` / `routeToHash` / `navigate` / `replaceRoute` / `useRoute` | React |

依赖方向是单向的：**UI → store → db / 纯函数核心**，纯函数之间只允许 `types.ts` 和 `links.ts` 这类底层模块被更上层引用，绝不反向依赖 `db.ts` / `store.ts`。

### `src/components/` 与 `src/screens/`

- `components/` 是可复用、**道具驱动**的 UI：Icon（内联 SVG 图标集）、TabBar（底部导航）、NoteCard（笔记卡片）、MarkdownPreview（渲染 + wiki 链接点击）、GraphView（Canvas 力导向图）、SearchScreen（搜索页）、BacklinksPanel（出链/反向链接）、EditorToolbar（编辑工具栏）、ActionSheet（底部操作面板）等。它们通过 props 接收 `Note[]` 和回调，不直接读写数据库。
- `screens/` 是页面级组合：NotesScreen（列表 + 标签筛选）、EditorScreen（编辑 / 预览切换、字数、反向链接）、SettingsScreen（导入导出、存储占用、主题、清空数据）。它们负责布局与交互，数据由 `App` 通过 props 注入。
- 样式是手写 CSS：`src/styles/tokens.css` 定义深/浅色变量、间距、圆角、动效时长与安全区；`base.css` 放 reset 与通用类；组件私有样式放在同名 `.css` 文件里、类名带组件前缀；`app.css` 放应用外壳与页面级样式。没有 CSS 框架。

## 4. 数据模型

唯一持久化的实体是笔记（`src/lib/types.ts`）：

```ts
export interface Note {
  /** Stable unique id (uuid). */
  id: string;
  /** Human readable title, also the anchor for [[wiki links]]. */
  title: string;
  /** Markdown body, without the H1 title. */
  content: string;
  /** Derived `#tags` from `content`, kept in sync on every save. */
  tags: string[];
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
  /** Pinned notes sort first. */
  pinned: boolean;
}
```

约定与不变量：

- `id` 创建后不变（`crypto.randomUUID()`，不可用时用时间戳 + 随机串兜底）。
- `title` 是人可读标题，同时是 `[[wiki 链接]]` 的解析锚点；不要求唯一，但解析时同名笔记取 `updatedAt` 最新的一条。
- `content` 是 Markdown 正文，标题单独存字段；正文里出现的 H1 不会反向修改标题。编辑器只编辑 `content`。
- `tags` 是**派生字段**：每次保存时用 `extractTags(content)` 重新计算，不手工维护。这样导入外部数据、直接改正文都不会让标签失真。
- `updatedAt` 在内容/标题变化时刷新，仅切换置顶不刷新；排序规则是「置顶在前，然后 `updatedAt` 降序」。

其余类型都是投影或查询结果，不落库：`NoteSummary`（列表/图谱/搜索用的轻量投影）、`ResolvedLink`（解析到笔记的出链）、`Backlink`（来源 + 引用次数）、`TagCount`（标签 + 显示形式 + 次数）。持久化格式只有 `VaultFile`（导出文件），版本号为 `1`。

## 5. 派生关系设计

这是项目的核心设计：**笔记内容（Markdown）是唯一事实来源，所有关系都是即时计算出来的。** 不维护链接表、标签表或图结构，因此不存在「关系数据和正文不同步」的问题，导入/导出/删除都是整条笔记一起移动。

### Wiki 链接

- 语法：`[[目标]]`、`[[目标|别名]]`；目标两侧空白会被 trim。
- 先 `maskCode()` 把围栏代码块与行内代码替换成等长空格（保留换行），保证代码里的 `[[not a link]]`、`` `[[x]]` `` 不被当成链接。
- 匹配用的正则：`/\[\[([^[\]\n]+?)(?:\|([^[\]\n]+?))?\]\]/g`。
- 解析目标时用 `normalizeTitle()`（trim + 合并空白 + 转小写）做大小写/空白容错；`resolveLink()` 额外容忍目标末尾的 `.md` 后缀。
- 解析失败的目标视为「悬空链接」：出链面板里标记为「未创建」，图谱里生成幽灵节点，点击即可创建同名笔记（`ensureNote`）。

### 标签

- 正则要求 `#` 前面是行首或空白/常见中英文标点，标签体允许字母、数字、CJK、`_`、`-`、`/`；纯数字标签被拒绝（与 Obsidian 行为一致）。
- 同样先 `maskCode()`，代码块里的 `#not-a-tag` 不会被统计。
- 去重不区分大小写；`allTags()` 聚合时保留首次出现的显示形式（`label`）与全小写分组键（`tag`），按使用次数降序。

### 反向链接与图谱

- 反向链接：`backlinksFor(note, notes)` 扫描所有笔记的 wiki 链接，统计对当前标题的引用次数，按「引用次数 → 更新时间」排序。
- 出链去重（按目标标题），因此同一目标链接多次只显示一次，但计数保留。
- 图谱：节点 = 笔记 + 幽灵节点（未创建的链接目标），边 = 解析成功的 wiki 链接；自链接跳过，平行边去重；节点度数 = 关联边数（决定节点大小）。幽灵节点 id 形如 `ghost:<规范化标题>`，与真实笔记 id 空间隔离。
- 计算入口都是纯函数（`outgoingLinks` / `backlinksFor` / `backlinkCounts` / `buildGraph`），UI 在渲染时按当前 `notes` 调用即可。

### 复杂度

每次派生都是 O(笔记数 × 单条正文长度) 级别：对个人知识库（几十到几千条）足够快；一次编辑只影响被编辑笔记的派生字段（tags），其余查询在需要时重算。未来数据量上来后可加「按 `updatedAt` 失效的缓存」「增量索引」或在 Worker 中计算。

## 6. 持久化

### IndexedDB

```ts
const DB_NAME = 'inkstone';
const DB_VERSION = 1;
const STORE = 'notes';        // keyPath: 'id'，索引：updatedAt
```

- `openDatabase()` 惰性打开并缓存 Promise；`onupgradeneeded` 时创建对象仓库与 `updatedAt` 索引。
- 读写都包在单个事务里：`saveNotes` 对一批笔记执行 `put`，`replaceAllNotes` 先 `clear()` 再批量 `put`，`clearAllNotes` 即 `replaceAllNotes([])`。
- 任何一步抛错（隐私模式、被禁用、配额不足、版本冲突）都回退到 localStorage：`saveNotes` 在回退路径里按 id 合并后整体写回；`replaceAllNotes` / `clearAllNotes` 直接写入传入的数组。下一次 IndexedDB 可用时，`loadNotes` 会把 localStorage 里的笔记合并进 IndexedDB 并清除回退键。
- `openDatabase()` 打开失败时不会缓存失败的 Promise，后续调用会重试。

### localStorage

| 键 | 内容 |
| --- | --- |
| `inkstone.notes.v1` | 整库笔记的 JSON 数组（仅在 IndexedDB 不可用时使用） |
| `inkstone.theme.v1` | `dark` / `light` / `system` |
| `inkstone.onboarded.v1` | 是否已完成首次引导（`'1'`），决定是否写入演示笔记 |

所有 localStorage 访问都包在 `try/catch` 里，读取失败按默认值处理，写入失败静默忽略——存储不可用时应用仍能运行，只是无法持久化。

### 写入时机与可靠性

- 编辑：内存乐观更新 + 350ms 防抖批量写；`flush()` 会先清定时器再写 `dirtyRef` 里的笔记，失败则保留提示。
- 立即写：新建、删除、导入（整库替换）、清空。
- 生命周期兜底：`pagehide`、`beforeunload`、`visibilitychange(hidden)` 都触发 `flush()`。
- 首次启动后调用 `navigator.storage.persist()`；设置页可通过 `storageEstimate()` 展示占用/配额。
- 已知限制：不做跨标签页同步（另一个标签页的修改不会实时合并，后写覆盖）；不做事务级回滚；导出是唯一的备份手段。

## 7. 渲染管线

```text
content
  │ 1. preprocessWikiLinks()
  │    [[目标|别名]] → [别名](wiki:<encodeURIComponent(目标)>)
  ▼
markdown-it（html:false, linkify:true, breaks:true, typographer:true）
  │ 2. inline / block 解析（代码块、行内代码保持原样，不产生链接）
  │ 3. 自定义 link_open：
  │      wiki: 链接 → <a class="wiki-link [is-missing]" data-wiki-target role="link">
  │      http(s) 链接 → 加 target="_blank" rel="noopener noreferrer nofollow"
  │ 4. 自定义 core 规则：行首 "- [ ]" / "- [x]" 文本 → 只读复选框
  ▼
HTML 字符串 → `MarkdownPreview` 注入 DOM
  │ 5. 点击 data-wiki-target：已存在 → 跳转；不存在 → 创建后跳转
```

`MarkdownPreview` 用 `dangerouslySetInnerHTML` 注入渲染结果（安全性完全依赖上面「关闭原始 HTML + 协议校验 + 属性转义」的策略），并用 `useMemo` 缓存标题索引与 HTML，避免每次输入都重建；wiki 链接点击通过容器上的事件委托处理（`closest('a.wiki-link')` → `data-wiki-target` → `resolveLink`）。

安全策略（纵深防御，不依赖第三方 sanitizer）：

- `html: false`：Markdown 里的原始 HTML 会被转义为文本，不能注入脚本或事件属性。
- markdown-it 默认的链接协议校验会拦截 `javascript:`、`vbscript:`、`file:` 和 `data:`（图片类 data URI 除外）。
- 自定义 wiki 链接目标经过 `escapeHtml()` 后才写入属性，避免引号逃逸。
- 外部链接统一加 `rel="noopener noreferrer nofollow"`。
- 渲染结果的 `class`/属性均由代码生成，不拼接用户可控的任意 HTML。
- 残余风险：用户在笔记里写的远程图片 URL 仍会被浏览器加载（这是用户主动内容），隐私说明中已注明。

除块级渲染 `renderMarkdown()` 外，还有 `plainText()`（去语法后的可读文本，摘要与搜索片段共用）、`excerpt()`（列表卡片摘要，默认 120 字）、`countWords()`（CJK 按字、拉丁按词计数）。

## 8. 状态管理（`useNotes`）

`useNotes()` 是应用里唯一的状态源，暴露：

- 状态：`notes`、`sortedNotes`、`ready`、`storageMode`、`storageWarning`。
- 操作：`createNote`、`updateNote`、`deleteNote`、`togglePin`、`replaceAll`、`clearAll`、`ensureNote`、`findByTitle`、`flush`、`usage`。

内部使用 `notesRef` 保存最新数组（事件回调里避免闭包过期）、`dirtyRef` 保存待写 Map、`timerRef` 保存防抖定时器。`alreadySorted()` 会先判断更新后的笔记在排序中是否移位，避免每次击键都重排整个列表导致编辑中列表跳动。`sortedNotes` 用 `useMemo` 缓存。

页面组件不要各自持有笔记副本；需要派生数据时，用 `notes` 调用 `links.ts` / `search.ts` / `graph.ts` 的纯函数。

## 9. 性能

当前设计面向**个人知识库**（几十到几千条笔记、单条正文通常几 KB）：

- **全量内存**：启动时整库读入内存，之后所有列表、搜索、图谱都在内存中计算，无分页、无虚拟滚动。几千条以内流畅。
- **写入不阻塞输入**：乐观更新 + 350ms 防抖批量写；`pagehide` 兜底。
- **避免无谓重排**：`alreadySorted()` 让编辑中的列表保持稳定；`sortedNotes` 记忆化。
- **派生计算按需**：反向链接/图谱只在对应视图渲染时计算；每次调用内部重建一次标题索引（O(n)）。
- **图谱布局**：Canvas 2D + `requestAnimationFrame`，力导向每帧 O(n²) 斥力计算，适合数百节点；`prefers-reduced-motion` 下直接渲染静态布局。节点规模变大时需要空间网格/四叉树或 Web Worker（路线图）。
- **搜索**：线性扫描标题/正文，查询时计算；个人库规模下毫秒级。数据量增长后可考虑倒排索引。
- **渲染**：Markdown 只在预览/编辑切换时渲染；编辑态是纯文本 `textarea`，不逐击键重渲染 HTML。
- **可优化点**：按 `updatedAt` 缓存派生结果、图布局与搜索索引、长列表虚拟化（`content-visibility`）、大库启动时按需加载。

## 10. 扩展点

| 扩展点 | 位置 | 做法 |
| --- | --- | --- |
| 新存储后端（OPFS、File System Access、远端同步） | `src/lib/db.ts` | 实现同一组 `loadNotes` / `saveNotes` / `deleteNoteFromDb` / `replaceAllNotes` / `clearAllNotes` 函数，`store.ts` 无需改动 |
| 新页面 / 新 tab | `src/lib/useRoute.ts` + `src/App.tsx` | 在 `Route` / `TabName` / `parseRoute` / `routeToHash` 中登记路由与 `TabBar` 入口，页面组件放在 `src/screens/` |
| 新派生关系（例如「未链接的提及」、标签图谱） | `src/lib/links.ts` 或新的纯逻辑模块 | 输入 `Note[]`，输出普通数据；保持同步、无 DOM，先写测试 |
| 新 Markdown 能力（脚注、公式、高亮） | `src/lib/markdown.ts` | 通过 markdown-it 插件扩展；任何会放宽 HTML/协议限制的改动必须先过安全评审 |
| wiki 链接的展示与解析 | `RenderContext`（`titles` / `resolveTitle`） | 传入标题索引后，未创建的链接会自动带 `is-missing` 样式；点击行为由预览层处理 |
| 新 store 能力（批量移动、撤销） | `src/lib/store.ts` 的 `NotesApi` | 沿用「乐观更新 + dirty 防抖 + flush」模式，保证生命周期兜底生效 |
| 新页面 / 新面板 | `src/screens/`、`src/components/` | 组件保持 props 驱动；页面只组合，不直接访问 `db.ts` |
| 离线与安装（PWA） | `public/sw.js` + `src/main.tsx` 注册 + `public/manifest.webmanifest` | 调整预缓存/缓存策略时递增 `CACHE` 版本；仅 HTTPS / localhost 生效，改动需同步 README 与隐私说明 |
| 云同步 | 新模块（例如 `sync.ts`）建立在 `db.ts` 之上 | 需要设计版本向量/冲突解决；在此之前保持「导出 → 导入」的显式同步方式 |

## 11. 已知限制

- Service Worker 只在生产构建 + 安全上下文（HTTPS / localhost）下注册；通过 HTTP 局域网访问没有离线能力。缓存版本号是手工递增的，也没有「新版本可用」提示或自动重载。
- 没有同步与冲突解决：多设备通过导入手动迁移；多标签页并发编辑后写覆盖。
- 没有文件夹、附件、图片上传；正文里的图片只能引用外部 URL。
- 导入只支持 JSON（Markdown 目前只是导出格式），且合并策略是按标题覆盖、没有字段级合并。
- 所有派生计算在主线程完成；超大库（数万条）会有明显卡顿。
- 浏览器清站点数据即删除笔记；`localStorage` 回退模式容量约 5MB。

更多关于数据与隐私的细节见 [PRIVACY.md](PRIVACY.md)。
