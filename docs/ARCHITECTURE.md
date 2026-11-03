# Architecture

麻薯（Mashu）是一个**纯前端、本地优先**的单页应用：一个静态 `index.html` + 打包后的 JS/CSS，没有服务器、没有数据库服务、没有账号系统。这份文档说明 1.0 的 LifeOS 设计系统、知识库目录、页面与数据流、力导向图谱、每日汇总、有依据的助手、今日简报、Apple 健康导入、持久化迁移与扩展点。

当前版本 **1.0.0**：在 0.9 的 LifeOS 视觉与交互之上，加入 **用户自建知识库目录**、**图谱目录层**、**每日汇总**与**有依据的助手**（grounded answers with source ids）。目录笔记/普通记录/计划/归档仍是同一套 `Note` 数据模型；存储（`mashu`）、迁移、导出、Apple 健康与零服务器 PWA 交付保持兼容。

## 1. 总览

- **一个记录库 = 生活记录 + 扁平笔记 + 知识库目录。** 没有文件系统、没有附件表；关系来自 Markdown 里的 `[[wiki 链接]]`、用户手动连线、同一天生活记录之间的时间链，以及用户目录（`meta.directory` + `dirId`）。
- **知识库就是记录库。** 目录笔记、普通笔记、生活记录、模板、计划和归档都存成 `Note`；目录是特殊标记的普通笔记，所以备份/导入自然包含它们。删除目录只解除成员归属，不删除记录。
- **确定性知识能力。** 每日汇总（`digest.ts`）与有依据的助手（`knowledge.ts`）都是纯函数：按目录分组、检索、统计与拒绝都只基于当前 vault 与 `now`；没有模型、网络或随机性。
- **浏览器就是后端。** 持久化在 IndexedDB（数据库 `mashu`，schema v2；不可用时回退 localStorage），写入是防抖的异步批量操作。
- **纯逻辑优先。** 目录、解析、派生关系、搜索、图谱模型、生活统计、今日简报、每日汇总、知识检索、Apple 健康解析、助手问答都在 `src/lib/`，不依赖 React 和 DOM，可在 Node 里直接测试；`store.ts`（React hook）、`db.ts` / `prefs.ts` / `exportImport.ts`（浏览器 API 适配）保持薄。
- **确定性。** 简报、助手、健康解析、图谱初始分布都是纯函数：同一份记录、同一个输入与同一个 `now` 必得同样的结果；不联网、不调用模型。
- **零第三方服务。** 运行时不发网络请求，唯一的网络访问来自用户在笔记里主动写入的外链/图片。
- **静态交付、零服务器。** 构建产物由 GitHub Actions 自动发布到 GitHub Pages（免费静态托管）；用户从 Safari 安装到主屏幕后离线使用。维护者不需要 VPS、数据库或任何服务器运维。
- **LifeOS 视觉。** 全部颜色/间距/圆角来自 `src/styles/tokens.css` 的语义 token：浅色暖纸 `#f7f3ec`、surface `#fcfaf6`、正文 `#2c2925`、主色 `#c8783f`；深色暖炭 `#171410`、surface `#211d18`、正文 `#f3ece4`、主色 `#e6a062`。Display 34–38 / H1 28–32 / Body 16–17 / Meta 12–13 / Data mono 13–15；页边距 20、区块间距 28–36、卡片圆角 16–20、阴影几乎不可见；没有 glow/neon/装饰渐变。

```text
index.html
   │  <script type="module">
   ▼
src/main.tsx ──挂载（StrictMode）──▶ src/App.tsx（应用外壳：路由 / 主题 / 快速记录 / 图谱 / 助手 / 每日汇总 / 健康导入）
   │                                    │
   │                                    ├── src/screens/*        TodayScreen、RecordsScreen、DirectoryScreen、MoreScreen、EditorScreen、SettingsScreen、PlanScreen、ModulesScreens…
   │                                    ├── src/components/*     可复用 UI（MochiNode、RecordRow、GraphView、CaptureSheet、AgentPanel…）
   │                                    ├── src/lib/useRoute.ts  hash 路由（today/records/plan/more/directories/graph/agent/search/settings/note 等）
   │                                    │
   │                                    └── src/lib/store.ts     useNotes()：内存中的唯一状态源
   │                                            │
   │                                            ├─ loadNotes / saveNotes / …   ← src/lib/db.ts
   │                                            │        └─ IndexedDB `mashu`（schema v2）
   │                                            │              └─（失败时）localStorage `mashu.notes.v1`
   │                                            │        └─ 首次打开时迁移旧库 `rixin` / `mochi` / `inkstone`
   │                                            │
   │                                            └─ 派生查询：brief.ts / digest.ts / knowledge.ts / directories.ts / insights.ts / health.ts / links.ts / markdown.ts / search.ts / graph.ts / agent.ts
   │
   └─（生产构建 + 安全上下文）注册 public/sw.js：应用壳离线缓存（缓存名 `mashu-v1`，构建时注入 hash 资源）
```

## 2. 请求 / 数据流

### 启动

1. 浏览器加载 `index.html`，执行 `src/main.tsx`，React 挂载根组件。`index.html` 在首帧前按已存偏好 / `prefers-color-scheme` 设置 `data-theme`；应用的主题偏好**默认浅色**（`#f7f3ec`），可切换深色暖炭 `#171410` 或跟随系统。`<head>` 包含 `apple-mobile-web-app-*` meta、`theme-color` 与七种 iPhone 尺寸的 `apple-touch-startup-image` 启动图链接（由 `npm run splash` 生成）。
2. `useNotes()` 初始化（模块级共享 Promise，只执行一次，避免 StrictMode 下重复播种）：
   - `loadNotes()` 打开 IndexedDB `mashu` v2，读出 `notes` 仓库的全部记录；若从 v1 升级，会在 `onupgradeneeded` 中逐条 `normalizeNote()` 补齐字段。
   - 若 `mashu` 库为空，会尝试迁移更早版本的数据库（`rixin` / `mochi` / `inkstone`）与旧 localStorage 记录；合并按 id 去重，写入成功后才删除旧副本（详见「持久化与迁移」）。
   - 读取/迁移旧偏好：主题、引导标记、助手人设、安装提示都从旧键复制到 `mashu.*` 后删除旧键。
   - 空库且从未引导（`mashu.onboarded.v1 !== '1'`）时，写入 `seed.ts` 的演示记录并标记已引导。
   - 排序后写入内存状态并 `setReady(true)`，随后请求 `navigator.storage.persist()`。
3. 各页面从 `useNotes()` 读取记录与操作函数；`App` 通过 `useRoute()` 订阅 hash 变化决定渲染页面。主题偏好写入 `<html data-theme>`，并更新 `theme-color` meta（浅色 `#f7f3ec` / 深色 `#171410`）。
4. 生产构建在 `load` 后注册 `sw.js`；只在安全上下文（HTTPS / localhost）成功，失败静默忽略。

### 路由与导航

没有路由库，`src/lib/useRoute.ts` 是一个轻量 hash 路由：

| 路由 | 页面 | 底部导航 |
| --- | --- | --- |
| `#/today`（默认） | 今日：小 hero + 单一记录条 + 2×2 指标 + 昨日复盘（1 洞察 + 3 数字 + 展开）+ 轻建议 + 7 日趋势 + 时间线 | 今日 / TODAY |
| `#/records` | 经历：按天时间线、紧凑置顶条、边缘淡出筛选 chips | 经历 / LIFE |
| `#/plan` | 计划：目标/待办与进度（LifeOS 模块） | 计划 / PLAN |
| `#/agent` | 本地助手：Mochi Node + 小麻薯 + 正文流 + 每日汇总 + grounded 来源 | 助手 / AGENT |
| `#/more` | 更多：LifeOS 模块入口（知识库目录/图谱/画像/健康/理财/模板/归档/附件）、设置、帮助 | 更多 / MORE |
| `#/directories` | 知识库目录：创建/颜色/成员/移入移出/删除（从「更多」进入） | （无） |
| `#/graph` | 生活图谱：力导向 + 目录枢纽 + 记录/目录切换 + Node Inspector + 沉浸模式（从「更多」进入） | （无） |
| `#/search` | 搜索：sticky 头 + 复用记录行（from 今日/经历 header） | （无） |
| `#/settings` | 设置：助手 / 外观 / 数据与隐私 / Apple 健康 / 自动化 / 高级设置 / 关于（从「更多」进入） | （无） |
| `#/profile` `#/health` `#/finance` `#/templates` `#/archive` `#/attachments` | 个人画像 / 健康数据 / 理财 / 模板 / 归档 / 附件（LifeOS 模块，从「更多」进入） | （无） |
| `#/note/<id>` | 编辑器：默认阅读，编辑态才显示工具栏 | （无） |

- `parseRoute()` / `routeToHash()` 解析与序列化；`navigate()` push 历史记录（手机返回手势可用），`replaceRoute()` 替换当前记录。空 hash 与未知路由都回落到 `today`；旧的 `#/notes` 兼容映射到 `records`。
- 底部导航是 **66px 扁平 5 标签导航**（**今日 / 经历 / 计划 / 助手 / 更多**，带中文标签 + 等宽英文小字），激活项是浅色块；设置、知识库目录、图谱和各 LifeOS 模块从「更多」进入。
- `App` 用 `returnToRef` 记录进入编辑器前的来源页，返回时回到原页面；图谱沉浸模式（`graphFullscreen`）时 `App` 不渲染 `TabBar`，退出后恢复。
- hash 路由让静态托管（含子路径）与局域网地址都不需要服务端 rewrite；`scripts/serve.mjs` 对无扩展名路径做了 SPA fallback。

### 设计系统（v1.0 LifeOS / 设计文档 §04）

- **语义 token**：`:root` 浅色、`:root[data-theme='dark']` 深色，映射同一批变量名：`--bg` / `--surface` / `--surface-2` / `--text` / `--text-muted` / `--border` / `--accent` / `--accent-soft` / `--danger` / `--kind-*`。页面不写死颜色。
- **浅色**：`--bg #f7f3ec`，`--surface #fcfaf6`，`--surface-2 #f1eae1`，正文 `#2c2925`，次级 `#756d63`，边框 `#e5dbcf`，主色 `#c8783f`，主色浅底 `#f2dfc9`，危险色 `#b34b36`。
- **深色（暖炭）**：`--bg #171410`，`--surface #211d18`，`--surface-2 #28221d`，正文 `#f3ece4`，次级 `#b8aba0`，边框 `#3b332c`，主色 `#e6a062`，主色浅底 `#463024`，危险色 `#d56a56`。
- **分类色**（只用于节点/标签/小面积状态）：日记 `#65788a`、饮食 `#b45d35`、健康 `#627a4e`、财务 `#9a7112`、笔记 `#7d7164`；深色有对应的提亮版本。
- **字体与字号**：`--font-sans`（system / PingFang SC，不再用圆体/衬线）；`--font-mono` 等宽；`--text-3xl 36` / `--text-2xl 28` / `--text-xl 21` / `--text-lg 18` / `--text-base 16` / `--text-sm 13` / `--text-xs 12`。Display 34–38 / H1 28–32 / H2 20–22 / Body 16–17 / Meta 12–13 / Data 13–15。
- **布局**：页面左右 20px；区块间距 28–36；圆角 `--radius-xs 8 / s 10 / m 14 / l 18 / xl 20`；按钮 14–16；阴影只有 `--shadow-1/2` 的极轻投影；`--grad-aurora: none`、`--shadow-glow: none`，没有装饰渐变/发光。
- **品牌符号**：`MochiNode`（暖色主节点 + 2–3 个卫星节点 + 细轨道；`breath` 慢呼吸动画），用于页头、助手人设、App 图标、favicon 与启动图；一屏只出现一次，**没有卡通吉祥物/表情/水果帽**。
- **底部导航**：`--tabbar-h: 66px`；激活项是浅色块，标签是中文 + mono 英文；五项为今日/经历/计划/助手/更多。
- **动效**：`--dur-fast 140ms` / `--dur 260ms`；页面进入约 220–320ms、按压 120–180ms、sheet ease-out、图谱 settle 1–2s；`prefers-reduced-motion` 下 token 时长归零。
- **空状态**：一个目标 + 一个 CTA，文案平静；例如图谱空态「记下第一件事 / 图谱会从这里长出来」，今日无数据显示 1 条洞察 + 1 条建议。

### 今日（quiet cockpit）

1. `App` 在 `notes` 变化时 `useMemo(() => buildDailyBrief(api.notes))`，同一次渲染里用 `summarizeRange(notes, 7)` 取 7 日序列。
2. `TodayScreen` 结构：`MochiNode` + 日期 header → 小 hero（`hero-greeting` 问候、`hero-question`「今天发生了什么？」、一句状态）→ 唯一高权重动作 `home-capture`（只有这一条记录栏）→ 2×2 `today-metrics`（支出/摄入/睡眠/记录，4 个数字 + 细分隔线，无卡片）→ 昨日复盘 block（`review-insight` 1 条洞察、`review-numbers` 前 3 个数字、「查看完整复盘」展开 `review-full`）→ 最多 3 条朴素建议（无数据 1 条）→ 近 7 天 sparklines → 今日时间线（最多 8 条）。
3. 简报完全由 `buildDailyBrief(notes, now)` 生成：昨日 vs 昨天之前有记录的最近 7 天；阈值与文案在 `brief.ts` 顶部；8 种指标（支出/热量/睡眠/步数/饮水/日记等）的 review 与 suggestions 有固定上限；无数据时给平静文案。
4. **没有推送服务器**：简报在打开应用时即时生成；固定时间提醒由 iOS「快捷指令 → 自动化 → 每天」打开应用实现。

### 记录、目录与搜索

- `RecordsScreen`：`filter-bar` 是可横向滚动的 chips（边缘 `mask-image` 淡出）；`pinned-list` 是紧凑置顶条；之后按本地日期分组，每组用 `RecordRow`（类型点 + 标题 + 一行结构化摘要 + 时间 + More）。没有卡片墙。
- `SearchScreen`：`search-header` 为 `position: sticky`；输入框 + 标签 chips；查询为空时显示「最近编辑」；结果复用 `RecordRow`，snippet 用 `<mark>` 轻高亮；无结果时显示「未找到相关记录」+「清除筛选」。
- 记录行的 More 菜单由 `App` 的 `ActionSheet` 统一提供（置顶/编辑记录信息/复制 Markdown/导出 .md/删除），Records 与 Search 共用同一套 `RecordRow`。
- `DirectoryScreen`（`#/directories`，从「更多」进入）是知识库目录的唯一管理入口：创建目录（名称 + 8 色目录色板）、展开目录查看成员、把成员「移出」、把未分类记录通过 select 移入目录、删除目录。
- `directories.ts` 的 `isDirectory` 判断 `meta.directory` 且未被归档；`directoryList` 按 `createdAt` 排序；`directoryColor` 默认 `#7d7164`；`countInDirectory` / `notesInDirectory` 只统计非目录、非归档、未计划成员；`unassignedNotes` 排除目录/归档/计划。
- 删除目录由 `App` 处理：先把所有 `dirId === directory.id` 的成员 `assignDirectory(note.id, null)`，再删除目录笔记；**任何成员记录都不会被删除**。目录笔记本身是普通 `Note`（标题=目录名，`content: '#目录'`，`kind: 'note'`，`meta.directory.color`），因此 JSON vault 导出/导入天然包含它。

### 编辑器（reading-first）

- `EditorScreen` 默认 `mode='preview'`：渲染后的标题 + `MarkdownPreview`；没有眼睛/铅笔/置顶 header 按钮。
- 进入编辑（`mode='edit'`）才出现标题输入、正文 textarea、`EditorToolbar`；右上角显示安静的「完成」，点它回到 preview。
- 所有操作收进 More：`编辑正文` / `编辑记录信息` / `置顶` / `复制 Markdown` / `导出为 .md` / `删除`；编辑中的切换文案由 `App` 的 editorMenu 生成（`完成编辑` 等）。
- 关系面板 `BacklinksPanel` 使用「连接到」（outgoing）与「来自」（backlinks）文案；点击 wiki 链接可跳转或创建。

### 快速记录（progressive disclosure）

- 打开 `CaptureSheet`：一句话 hero + textarea；输入实时调用 `captureDraft(text, kindHint, parserNow)`。
- 解析成功显示一行紧凑 `parse card`（类型 · 餐次 · ¥ · kcal 等）；置信度 **只在 < 55%** 时显示轻提示，不显示百分比。
- 「展开详情」打开结构化字段：52px 紧凑行（餐次/热量/金额/指标等）；再点收起。
- 底部固定 52px「保存记录」+「取消」；sheet 高度：初始 `min-height 46vh`（最大 55vh），解析后最大 72vh，展开详情后最大 88vh（CSS 用 `dvh` 变体）。保存后 `App.createNote()` 并 toast。

### 助手（de-console）

1. `AgentPanel` 页头：`MochiNode` + 人设名（默认「小麻薯」）+「本地处理 · 仅你可见」；不再有 AGENT/YOU 角色标签。
2. 消息是正文流：每条消息上方只有轻量 24h 时间 meta；解析出的记录显示为紧凑确认卡（类型、标题、facts、保存/取消），必须在确认后才写入。
3. 初始最多 3 个欢迎动作；追问 chips 只出现在最新一条助手消息下。
4. 人设（名字 ≤ 12 字 + 8 种节点式头像：节点/轨道/圆环/方点/三点/星点/波纹/网格 + 自定义字符）在「更多 → 设置 → 助手」折叠编辑，存 `mashu.agent.v1`。
5. `agentReply` 仍是完全离线、确定性的规则引擎（capture / summary / advice / help / fallback），不调用模型。
6. 每日汇总与 grounded 回答是额外的一层：见「每日汇总」与「有依据的助手」；回答消息可带可点击的 source chips（《记录标题》→ `onOpenNote`），每日汇总作为一条 assistant 消息放在对话顶部。

### 有依据的助手（`knowledge.ts`）

- **语料规则** `isKnowledgeNote`：排除目录笔记（`meta.directory`）、归档（`archivedAt`）与计划条目（`meta.plan`）；模板仍可被检索但分数乘 `0.35`（空骨架，不应压过真实记录）。
- **检索** `searchKnowledge`：确定性 CJK bigram + 拉丁词检索；标题匹配 120/40 分、标签 26 分、正文 8 分 + 出现次数（上限 5）；返回 `KnowledgeHit { note, score, excerpt }`，excerpt 约 120 字符。
- **路由** `groundedAnswer`：help / reflection（最近摘要）/ stats（支出、健康、饮食、日记、计划等）/ lookup / refusal。lookup 用真实 note 的 excerpt 回答并返回 `sources`；stats 文案以「依据是「你的 N 条记录」」开头并附底层 note ids；没有命中时走 `refusalAnswer`，固定拒绝「你的知识库里没有找到与「X」相关的记录。可以先在经历库记一条，或换个关键词。」——**绝不编造**。
- **UI**：`AgentPanel.send` 先走 `agentReply`（capture/help 保留原流程），其余问题调用 `groundedAnswer` 并把 `sources` 渲染成可点击 chips；`formatSources` 只做文本来源列表。每日汇总的消息也以同样方式显示 source chips（最多 8 条）。
- 检索/回答都在内存中完成，没有网络、模型权重或第三方 SDK；同一份 vault + `now` 产生同一结果。

### 生活图谱（真正的力导向 + 目录层）

- `GraphView` 用 `buildGraph(notes)` 派生节点与四类边；绘制在 Canvas 上。`graph.ts` 负责模型与确定性初始分布，`GraphView` 负责实时仿真/交互。
- **力参数**（文件顶部 `FORCE`，设计文档 §10 范围）：`repulsion 3400`、`linkDistance 82`、`linkStrength 0.014`、`centerStrength 0.0018`、`clusterStrength 0.0045`、`collisionPadding 11`、`velocityDecay 0.45`、`alphaDecay 0.965`、`alphaMin 0.015`、`maxSpeed 24`、`initialAlpha 1`、拖拽 `dragAlpha 0.3`、松手 `releaseAlpha 0.42`；目录层 `directoryAnchorStrength 0.03`、`directoryCenterStrength 0.003`、`memberAttraction 0.012`、`memberKindNudge 0.0018`、`directoryLinkDistance 96`、`directoryLinkStrength 0.02`、`hubRepulsionBoost 1.6`；`LABEL_MIN_SCALE 0.42`、`NODE_MARGIN_MAX 12`。
- **目录枢纽/边**：`graph.ts` 的第四类边 `directory` 把每个有 `dirId` 的成员连到目录笔记；目录节点带目录色（默认 `#7d7164`），在初始分布里排在环上（N 目录 = N 分支），成员初始围绕目录并弱聚集；目录笔记不参与 wiki/manual 内容边，只通过成员关系表达。
- **记录/目录切换**：有目录时图谱顶部出现「记录 / 目录」分段；目录视图只渲染目录枢纽和由成员 wiki/manual 链接推导出的跨目录关系（按目录对去重），完全隐藏普通记录；没有目录时不显示该切换。
- **Node Inspector**：普通节点显示类型、标题、正文摘要、连接数与前 4 个连接，底部「编辑 / 连线 / 删除」；选中目录显示「目录详情」、成员数、成员列表（点击打开记录）与「打开目录」（跳转 `#/directories`）。
- **行为**：拖拽节点会实时影响邻居，松手后仿真回弹并重新平衡；支持拖动画布、滚轮/双指缩放（pinch）；节点半径按 degree：`5 + min(9, sqrt(degree) * 2.4)`（目录枢纽额外更大）；默认只给约 16%（min 4 / max 10）的高 degree 节点与非目录保留标签，目录名常显；悬停或选中节点展开一度邻居，其他节点变暗；画布/标签在缩放过小时隐藏。归档和计划记录在 `buildGraph` 阶段就被排除。
- **模式**：Add（点空白新建）、Link（依次选两个节点，有「选择第一个节点 / 再选第二个节点」提示）、Reset（恢复推荐视图）；图例默认折叠，展开显示类型、目录与幽灵节点。
- **沉浸模式**：图谱右上角切换；`App` 在 `graphFullscreen && route === 'graph'` 时不渲染 `TabBar`，画布全屏；退出恢复导航。
- 写操作仍通过 props 回调：`onMoveNote`（归一化位置防抖保存）、`onCreateNoteAt`、`onLinkNotes`、`onDeleteNote`、`onRequestResetLayout`；`store` 提供 `setNodePosition` / `addManualLink` / `removeManualLink` / `resetNodePositions`。

### 设置（consumer IA）

- 「更多 → 设置」；`SettingsScreen` 区块顺序：**助手 → 外观 → 数据与隐私 → Apple 健康 → 自动化 → 高级设置 → 关于**。
- 助手区块是折叠的 persona 行（点击展开名字、8 个节点式头像、自定义字符）。
- 数据与隐私：导出完整备份、从备份恢复、合并/替换、清空全部记录（危险操作放最后，两次 `window.confirm`）。
- Apple 健康：一行「连接 Apple 健康」+「如何导入？」展开说明；文件导入与复制快捷指令链接。
- 自动化：每日汇总开关（默认开启）、时间 `HH:mm`（默认 08:00）、立即生成今日汇总、以及「快捷指令 → 自动化」固定时间提醒说明。
- 高级设置是 `<details>`：导出为 Markdown、复制快捷指令导入链接、本地存储引擎与用量、数据迁移说明、健康导入 JSON/URL 格式与 HealthKit 限制。
- 关于：版本、项目主页/GitHub、安装卡片、footer「记录 · 连接 · 理解」。
- LifeOS 模块入口在 `MoreScreen`：`modules.ts` 定义经历库/知识库目录/计划/个人画像/健康数据/理财/模板/归档/附件，模块隐藏状态存 `mashu.modules.v1`；固定模块不可隐藏。

### iOS / PWA 交付与离线壳

**交付模型：静态站点 + 主屏幕安装，没有服务器。**

- `npm run build` = `tsc --noEmit` + `vite build` + `node scripts/sw-precache.mjs`。最后一步读取 `dist/` 的真实 hash 产物（排除 `sw.js` 与 `splash/`），写入 `dist/sw.js` 的 `PRECACHE`。推送到 `main` 后 `.github/workflows/deploy-pages.yml` 自动发布到 GitHub Pages；GitHub 只是免费静态托管，维护者零服务器运维。
- 用户路径：Safari 打开 HTTPS 地址 → 分享 → 添加到主屏幕；安装后 `display: standalone`。`index.html` 提供 apple meta 与启动图；`manifest.webmanifest` 声明 `name: 麻薯`、`background_color: #f7f3ec`、`theme_color: #f7f3ec`、图标与 standalone。
- **安装引导**：`IosInstallCard` 在「更多 → 设置 → 关于」展示 Safari 步骤、安装状态与在线/离线壳/无需服务器/数据不出设备胶囊；`TodayScreen` 在 iPhone 非 standalone 首次打开显示一行安装提示，关闭状态存 `mashu.installHint.v1`。
- **Service Worker 生命周期**：`install` 预缓存应用壳；`activate` 清旧缓存 + `clients.claim()`；导航 network-first（在线取最新并写回，离线回退缓存的 `index.html`），其他同源 GET cache-first；缓存名 `mashu-v1` 手工递增。结果是**联网时重新打开主屏幕图标即可获得新版本**，没有更新弹窗。
- **离线边界**：只缓存静态资源，不读取/缓存/上传 IndexedDB 或 localStorage 中的记录；断网时今日简报、记录、助手、图谱继续在本地工作。
- **iOS 细节**：安全区 `env(safe-area-inset-*)`；窄屏 `input` / `textarea` / `select` 16px 防聚焦缩放；`online` / `offline` toast；导出走 `shareOrDownload()`（Web Share 文件 → Files/iCloud，回退普通下载）；`navigator.standalone` / `display-mode` 判断安装状态。
- **手动测试矩阵**：iPhone SE 与 iPhone 15 尺寸；Safari 标签页与 standalone 各一遍；覆盖离线重载、安装卡片/提示、16px 不被放大、导出「文件」、断网/恢复 toast、重新联网后加载新版本。

### 今日简报（`brief.ts`）

1. `buildDailyBrief(notes, now)` 完全纯函数：取**昨天**的 `DaySummary`，再取「昨天之前有记录的最近 7 天」（D-8 … D-2）作为对比基准；平均值只对当天有该指标记录的日子求均值，避免稀疏记录带偏。
2. 生成 `summary`（一句话）、`review`（2–4 条事实性复盘）、`suggestions`（2–3 条建议）、`trends`（支出/摄入/睡眠/记录 4 张，含 tone 与 detail）。
3. 阈值在文件顶部：支出 1.2× / 0.7×、热量 1.2×、睡眠 `< 7h` / `≥ 7.5h`、步数 `< 5000` / `≥ 8000`、饮水 `< 1500ml`；所有日期按本地时区。
4. `TodayScreen` 只展示 1 条 insight + 前 3 个数字，完整 review 由「查看完整复盘」展开；建议最多 3 条（无数据 1 条）。
5. **没有推送服务器**；固定时间提醒由 iOS 快捷指令个人自动化「打开麻薯」实现。

### 每日汇总（`digest.ts`）

- **输入**：`buildDailyDigest(notes, now)` 取昨天（`shiftDay(now, -1)`）的知识库记录（排除目录/归档/计划/模板），按 `dirId` 分组；目录顺序按创建时间（`directoryList`），未分类（`UNASSIGNED_SECTION_TITLE = '未分类'`）永远最后且只在有记录时出现。
- **输出**：`DailyDigest { dateKey, generatedAt, sections, summary, suggestions, sourceIds }`；每个 section `DigestSection { dirId, title, color?, count, highlights }`，highlights 是 2–3 条具体事实；summary 一句话；suggestions 2–3 条从昨天事实推导（引用目录/记录名）；`sourceIds` 是底层记录 id（时间顺序）。
- **历史**：`DIGEST_HISTORY_KEY = 'mashu.digest.v1'`，`loadDigestHistory` 按 dateKey 去重、按 generatedAt 取最新、新→旧排序，`DIGEST_HISTORY_MAX = 14` 截断；`saveDigestToHistory` 替换同 dateKey 并持久化。
- **计划**：`DIGEST_SCHEDULE_KEY = 'mashu.digest.schedule.v1'`，`DigestSchedule { enabled, time: 'HH:mm' }`，默认 `DEFAULT_DIGEST_SCHEDULE = { enabled: true, time: '08:00' }`；`getDigestSchedule` / `setDigestSchedule` 带格式校验与私有模式降级；`isDigestDue(now, at)` 在「今天没有 digest 且已到点」时为 true；`msUntilNextDigest` 计算下一次。
- **触发**：`App` 启动时加载历史；`schedule.enabled && isDigestDue(now, schedule.time)` 时生成一次并 `saveDigestToHistory`，否则展示当天已有 digest；「更多 → 设置 → 自动化 → 立即生成今日汇总」调用 `generateDigest` 立即生成并提示去助手查看。
- **UI**：`AgentPanel` 把当天 digest 作为一条 assistant 消息（summary、目录 sections/highlights、suggestions，sourceIds → 可点击来源 chips）；刷新/关闭页面后对话内存清空，但 digest 历史保留在 localStorage。
- **零服务器限制**：应用不会在后台运行；「每天 08:00」是**打开应用后**的判定，不是远程推送。准点提醒依赖 iOS 快捷指令个人自动化打开应用。

### Apple 健康导入（`health.ts`）

- **入口**：「更多 → 设置 → Apple 健康」文件导入或「复制快捷指令导入链接」；`?health=` 前缀用 `decodeHealthPayload` 支持 raw JSON 与 base64url。
- **解析**：JSON（数组 / `{samples|data:[...]}` / Shortcuts 单对象）、CSV（`type,date,value[,unit,source,detail]`）、URL 载荷；类型支持 steps / sleep / heartRate / restingHeartRate / weight / water / activeEnergy / workout；别名含中英文与 HealthKit 标识符；单位换算 lb/磅、g、L、分钟/小时、睡眠推断；无法解析计入 `skipped`。
- **聚合与去重**：`healthSamplesToNotes(samples, existing)` 按「本地日期 + 指标」分组；step/water/activeEnergy 求和，sleep/weight/heartRate/workout 取最新；已有同日同指标记录带 `replaceId`，`App.applyHealthDrafts()` 走 `updateNote` 而不是重复创建。
- **一次性 URL 导入**：处理完从 URL 移除 `?health=` 参数；若在 Safari 打开可能写入另一份网站数据，文档推荐文件导入更可靠。
- **诚实边界**：Web 应用没有 HealthKit 权限，不能直接读健康 App；当前只有「文件 / 快捷指令」两条零服务器路径；原生 iOS 壳是路线图可选项。

## 3. 模块地图

### `src/lib/` — 核心逻辑（纯函数 + 浏览器适配层）

| 模块 | 职责 | 依赖 |
| --- | --- | --- |
| `types.ts` | 数据契约：`NoteKind`、`NoteMeta`、`NotePosition`、`Note`、`NoteSummary`、`RecordDraft`、`AgentPersona`、`ThemeMode` 等 | 无 |
| `kinds.ts` | 记录类型词表：`NOTE_KINDS`、`KIND_INFO`（标签/动作/分类色变量）、`MEAL_SLOTS`、`HEALTH_METRICS` / `HEALTH_UNITS`、`FINANCE_CATEGORIES`、`describeMeta`、`defaultTitle` | `types.ts` |
| `links.ts` | 从 Markdown 派生关系：wiki 链接、标签、反向链接、标题索引 | `types.ts` |
| `markdown.ts` | markdown-it 实例、wiki 链接预处理与渲染、任务清单规则、`plainText` / `excerpt` / `countWords` | `markdown-it`、`types.ts` |
| `insights.ts` | 生活统计：`summarizeDay` / `summarizeRange`、`healthSeries`、`spendingByCategory`、`weekSummaryText`、`formatMoney`、`dayKeyOf` / `noteDayKey` | `types.ts`、`kinds.ts` |
| `brief.ts` | 今日简报：`buildDailyBrief(notes, now)` → `summary` / `review` / `suggestions` / `trends`；阈值与文案规则 | `types.ts`、`insights.ts`、`kinds.ts` |
| `digest.ts` | 每日汇总：`buildDailyDigest(notes, now)`（按目录分组、highlights/suggestions/sourceIds）、history（`mashu.digest.v1`，最多 14、按 dateKey 去重）、schedule（`mashu.digest.schedule.v1`，默认开启 08:00）、`isDigestDue` | `types.ts`、`directories.ts`、`insights.ts`、`knowledge.ts` |
| `knowledge.ts` | 有依据的助手：`searchKnowledge` / `groundedAnswer`（help/reflection/stats/lookup/refusal）、source ids、CJK bigram 检索；语料排除目录/归档/计划 | `types.ts`、`directories.ts`、`kinds.ts`、`insights.ts`、`markdown.ts` |
| `directories.ts` | 知识库目录：`isDirectory` / `directoryList` / `directoryColor` / `countInDirectory` / `notesInDirectory` / `unassignedNotes`；8 色目录色板 | `types.ts` |
| `modules.ts` | LifeOS 模块清单（经历库/目录/计划/画像/健康/理财/模板/归档/附件）、隐藏状态 `mashu.modules.v1` | `useRoute.ts`、`Icon` |
| `health.ts` | Apple 健康导入：`parseHealthJson` / `parseHealthCsv` / `decodeHealthPayload`、单位与别名、`healthSamplesToNotes`（同日聚合 + `replaceId` 去重） | `types.ts`、`kinds.ts`、`insights.ts` |
| `agent.ts` | 本地助手：`parseEntry` / `captureDraft`、`agentGreeting` / `agentReply`、快捷问题 | `types.ts`、`kinds.ts`、`insights.ts` |
| `search.ts` | 全文搜索：多关键词 AND、`#tag` 过滤、评分排序、命中片段 | `types.ts`、`links.ts`、`markdown.ts` |
| `graph.ts` | 图谱模型：`buildGraph`（wiki / manual / day / directory 四类边、目录枢纽、幽灵节点）、`seedPositions`、确定性 `tick`、`layoutSync` | `types.ts`、`links.ts`、`directories.ts` |
| `db.ts` | 持久化：IndexedDB `mashu` v2、localStorage 回退、旧库（`rixin` / `mochi` / `inkstone`）一次性迁移、恢复逻辑 | 浏览器 IndexedDB / localStorage |
| `store.ts` | React 状态源 `useNotes()`：缓存、乐观更新、防抖写入、`settleWrites`、图谱位置/手动连线、`archiveNote` / `assignDirectory`、生命周期 flush | React、`db.ts`、`links.ts`、`prefs.ts`、`seed.ts` |
| `prefs.ts` | 主题（默认浅色）、引导、助手人设与节点式头像、安装提示的 `mashu.*` 读写与旧键 adopted；`normalizeNote` / `makeNote` / `AGENT_AVATARS` | `types.ts`、`kinds.ts`、`links.ts` |
| `seed.ts` | 首次运行的演示记录（生活记录 + 笔记） | `types.ts`、`prefs.ts` |
| `exportImport.ts` | `VaultFile`（vault v2，`app: 'mashu'`）JSON 导出/解析、旧备份导入、`mergeVaultNotes`、Markdown 合集、`shareOrDownload` | `types.ts`、`prefs.ts` |
| `format.ts` | 相对时间、日期、字节数等展示格式化 | 无 |
| `useRoute.ts` | 轻量 hash 路由（today / records / plan / more / directories / graph / agent / search / settings / note 等） | React |

依赖方向单向：**UI → store → db / 纯函数核心**。`brief.ts` 与 `agent.ts` 都依赖 `insights.ts`，保证「今日数字」与「助手回答」使用同一套统计。

### `src/components/` 与 `src/screens/`

- `components/` 是道具驱动 UI：
  - `MochiNode`（品牌符号：主节点 + 卫星节点 + 细轨道，`breath` 慢呼吸）、`RecordRow`（类型点 + 标题 + 一行摘要 + 时间 + More，支持搜索 snippet/置顶）、`Sparkline`（7 日趋势 SVG）、`TabBar`（66px 5 标签：今日/经历/计划/助手/更多）。
  - `GraphView`（力导向画布：仿真/拖拽/pan/zoom/pinch/稀疏标签/Node Inspector/目录枢纽与记录/目录切换/目录 inspector/添加/连线/重置/图例/沉浸）。
  - `CaptureSheet`（一句话快速记录 + 紧凑解析卡 + 展开详情 + 固定保存）。
  - `AgentPanel`（Mochi Node 人设 + 正文流消息 + 紧凑确认卡 + 欢迎动作 + 最新追问 + 每日汇总 + grounded source chips）、`AgentAvatar`（节点式头像 + 自定义字符）。
  - `NodeEditorSheet`、`IosInstallCard`、`Icon`、`EditorToolbar`、`MarkdownPreview`、`BacklinksPanel`、`SearchScreen`。
- `screens/`：`TodayScreen`（安静驾驶舱）、`RecordsScreen`（经历时间线）、`DirectoryScreen`（知识库目录）、`MoreScreen`（LifeOS 模块/图谱/设置入口）、`EditorScreen`（阅读优先）、`SettingsScreen`（设置 IA）、`PlanScreen` 与 `ModulesScreens`（画像/健康/理财/模板/归档/附件）。
- 样式：`tokens.css`（语义 token）、`base.css`（reset、通用类、动效降级、iOS 16px）、`app.css`（外壳/页面/图谱）；组件私有样式与组件同名并带前缀。没有 UI 框架。

## 4. 数据模型

唯一持久化的实体仍是 `Note`（`src/lib/types.ts`），1.0 扩展了可选字段但未升 schema：

```ts
export type NoteKind = 'note' | 'diary' | 'food' | 'health' | 'finance';

export interface NotePlan {
  status: 'todo' | 'doing' | 'done';
  dueAt?: number;
}

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
  archivedAt?: number;     // 归档时间；归档记录不进入经历/图谱/知识语料
  dirId?: string;          // 所属知识库目录（用户创建）
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
  directory?: { color?: string }; // 目录笔记标记；title = 目录名
  plan?: NotePlan;                // 计划条目；不进入知识语料/图谱
}
```

辅助类型：`NotePosition { x, y }`；`RecordDraft`；`AgentPersona { name, avatar }`；`DailyBrief` / `BriefTrend`；`DailyDigest` / `DigestSection` / `DigestSchedule`；`KnowledgeHit` / `GroundedSource` / `GroundedAnswer`；`HealthSampleType` / `HealthSample` / `HealthParseResult` / `HealthNoteDraft`。

目录语义（`directories.ts`）：

- 目录笔记 = `meta.directory` 存在且未归档的 `Note`；`title` 是目录名，`meta.directory.color` 是可选 8 色之一。
- 普通记录通过 `dirId` 指向目录；`isDirectory` / `directoryList` / `directoryColor` / `countInDirectory` / `notesInDirectory` / `unassignedNotes` 都忽略归档、计划与目录自身（未分类列表也会排除计划）。
- 删除目录 = 先把成员 `assignDirectory(id, null)` 再删除目录笔记；成员记录永不删除。
- 目录笔记/普通记录都随 `toVaultJson(notes)` 全量序列化，导入经 `normalizeNote()` 恢复 `meta.directory` / `dirId` / `archivedAt` / `meta.plan`。

约定与不变量：

- `id` 创建后不变；导入中的重复 id 在 `normalizeNote()` 中重新分配；所有入库/迁移/导入都先经 `normalizeNote()`。
- `title` 是 wiki 链接锚点；不要求唯一，同名取 `updatedAt` 最新。
- `tags` 派生自正文；`kind` 缺省 `note`；`meta.occurredAt` 是统计与「今天/昨天」分组的基准时间（缺省回退 `createdAt`）。
- `manualLinks` 是无向、去重的记录 id；删除记录时级联清理。
- `position` 存在即固定图谱节点；`updatedAt` 在内容/标题/类型/meta 变化时刷新。

## 5. 派生关系、统计与图谱

### 链接、标签与反向链接

- `[[目标]]` / `[[目标|别名]]`：先 `maskCode()` 屏蔽代码块/行内代码，再解析；`normalizeTitle()` 容错大小写/空白，`resolveLink()` 容忍 `.md` 后缀。
- 悬空链接在出链面板标「未创建」，图谱中生成幽灵节点，点击可创建同名记录。
- `#标签`：`#` 前须为行首/空白/常见标点；标签体允许字母、数字、CJK、`_`、`-`、`/`；纯数字拒绝。
- 反向链接 `backlinksFor()` 扫描所有记录正文，按引用次数 → 更新时间排序；编辑器以「连接到 / 来自」展示。

### 生活统计（`insights.ts`）

- 只统计 `kind !== 'note'` 的生活记录；日期按本地时区；时间戳取 `meta.occurredAt`（> 0）否则 `createdAt`。
- `summarizeDay()`：`spend`、`income`、`calories`、`meals`、`sleep` / `weight` / `steps` / `water` / `exercise`（当天最新）、`mood`、`diaryCount`、`recordCount`、`noteIds`。
- `summarizeRange(notes, days, now)` 生成最近 N 天的日汇总；`healthSeries()` 生成逐日健康序列；`spendingByCategory()` 汇总分类支出（收入不计）。

### 生活图谱（`graph.ts` + `GraphView.tsx`）

- 节点：一条记录一个节点，携带 `kind`、保存位置（存在则固定）、`degree`；悬空 wiki 目标生成幽灵节点（`ghost:<规范化标题>`）。
- 四类无向边（按加入顺序去重）：`wiki` 解析成功的 `[[链接]]`；`manual` 手动连线（同对已有 wiki 边则升级为 manual）；`day` 同一本地日期内生活记录按时间相邻串联；`directory` 成员 note → 所属目录 hub。目录笔记不参与 wiki/manual 内容边；归档和计划在 `buildGraph` 阶段排除。
- 初始分布：`seedPositions()` 黄金角螺旋 + 固定点；`tick()` 确定性版本用于无实时交互时的布局；实时仿真在 `GraphView` 中按上面的 `FORCE` 参数运行。
- 视觉：节点颜色来自 `--kind-*` 分类色；边为 warm 细线（wiki 实线、manual 更亮 + 中点刻度、day 虚线）；幽灵节点虚线菱形；标签/网格使用 `--graph-*`；浅色/深色都是暖色画布，无 neon。

## 6. 今日简报（`brief.ts` 细节）

纯函数、确定性、无 I/O。核心步骤：

1. 用 `summarizeDay(notes, yesterday)` 得到昨天；用 `summarizeRange(notes, 9, now)` 取 D-8 … D-2 的「有记录日」求每个指标的均值（只对有该指标记录的天数求平均）。
2. 生成 `summary`、`review`（支出/饮食/睡眠/步数/饮水/日记，最多 4 条事实句）与 `suggestions`（偏差优先，其次肯定做得好的地方，最后用中性记录提示兜底，取前 3 条，至少 2 条）。
3. `trends` 固定四张（支出/摄入/睡眠/记录），带 `value`、`detail`、`tone`（good/warn/neutral）；`TodayScreen` 用 2×2 数字 + 近 7 天 sparkline。
4. 阈值：支出 1.2× / 0.7×、热量 1.2×、睡眠 `< 7h` / `≥ 7.5h`、步数 `< 5000` / `≥ 8000`、饮水 `< 1500ml`；无历史时中性文案。
5. **没有推送服务器**；固定时间提醒由 iOS 快捷指令个人自动化「打开麻薯」实现。

## 7. Apple 健康导入（`health.ts` 细节）

- **输入**：JSON 数组 / `{samples|data}` / Shortcuts 单对象；CSV 表头 `type,date,value[,unit,source,detail]`；`?health=` raw JSON 或 base64url。
- **归一化**：样本 → `HealthSample`；别名覆盖中英文与 HealthKit ID；数值/日期容忍 ISO 字符串、毫秒/秒时间戳、`YYYY-MM-DD`；失败样本计入 `skipped`。
- **单位**：体重 lb/磅/g/克 → kg；饮水 L/升 → ml；运动分钟/小时 → 分钟；睡眠小时/分钟/无单位推断；心率/步数/活动能量按原生单位。
- **聚合**：按「本地日期 + 指标」分组；steps/water/activeEnergy 求和，sleep/weight/heartRate/workout 取最新。
- **去重**：已有同日同指标记录时草稿带 `replaceId`；应用走 `updateNote`，因此可安全重复导入。
- **入口**：「更多 → 设置 → Apple 健康」文件选择或复制快捷指令链接；`?health=` 处理成功后从 URL 移除。
- **诚实边界**：没有 HealthKit 直连；当前只有文件/快捷指令两条零服务器路径。

## 8. 本地助手（`agent.ts`）

完全离线、确定性：一句话解析（`parseEntry` / `captureDraft`）+ 问答（`agentGreeting` / `agentReply`，intent 为 capture / summary / advice / help / fallback）。回答读取 `insights.ts` 的数字，简报读取同一来源。

人设：默认「小麻薯」+ `node` 节点式头像；`prefs.ts` 的 `AGENT_AVATARS` 提供节点/轨道/圆环/方点/三点/星点/波纹/网格 8 种预设 + 自定义字符，存 `mashu.agent.v1`；旧助手名/头像 id 映射到新默认。助手不是 LLM；路线图包含可选的设备本地小模型适配器（默认关闭、不联网）。

## 9. 可编辑图谱的 UI 契约

`GraphView` 是受控组件，所有写操作经回调交给 `App` / `store`：

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
  onDeleteNote?: (id: string) => void;
  onRequestResetLayout?: () => void;
  onOpenDirectory?: (id: string) => void;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
}
```

- `onSelectNote` 打开 Node Inspector；`onOpenNote` 从 inspector「编辑」/双击打开编辑器；`onMoveNote` 归一化位置防抖保存；`onCreateNoteAt` 新建；`onLinkNotes` 手动连线；`onDeleteNote` 删除；`onRequestResetLayout` 恢复自动布局；`fullscreen` / `onToggleFullscreen` 控制沉浸模式。
- 画布只读 `--graph-*` 与 `--kind-*` token；节点半径按 degree；标签稀疏；幽灵节点虚线；图例可折叠；沉浸模式时 `App` 不渲染底部导航。

## 10. 持久化与迁移

### IndexedDB（`mashu`，schema v2）

```ts
const DB_NAME = 'mashu';
const DB_VERSION = 2;
const STORE = 'notes';        // keyPath: 'id'，索引：updatedAt
const LEGACY_DB_NAMES = ['rixin', 'mochi', 'inkstone'];
```

- `onupgradeneeded` 创建对象仓库与 `updatedAt` 索引；若 `oldVersion < 2`，用游标把每条记录 `normalizeNote()` 重写，补齐字段。
- 读写单事务；`replaceAllNotes` 先 `clear()` 再批量 `put`；`clearAllNotes` 即清空。
- 失败回退 localStorage（`mashu.notes.v1`）；下次成功打开时把回退记录合并进 IndexedDB，确认写入成功后才清理回退键。
- **迁移链**：`mashu` 为空时，依次读取旧 localStorage 记录（`rixin.notes.v1` / `mochi.notes.v1` / `inkstone.notes.v1`）与旧 IndexedDB（`rixin` / `mochi` / `inkstone`），按 id 合并后写入 `mashu`；只有写入成功后 `cleanupLegacyStorage()` 才删除旧库/旧键，失败保留旧副本。
- `openDatabase()` 打开失败不缓存失败 Promise，后续调用会重试。

### localStorage

| 键 | 内容 |
| --- | --- |
| `mashu.notes.v1` | 整库记录 JSON（仅 IndexedDB 不可用时） |
| `mashu.theme.v1` | `light` / `dark` / `system`（默认 `light`） |
| `mashu.onboarded.v1` | 是否已完成首次引导（`'1'`） |
| `mashu.agent.v1` | 助手人设 `{ name, avatar }` |
| `mashu.installHint.v1` | iPhone 首次安装提示是否已关闭 |
| `mashu.digest.v1` | 每日汇总历史（新→旧、按 dateKey 去重、最多 14 条） |
| `mashu.digest.schedule.v1` | 每日汇总计划 `{ enabled, time: 'HH:mm' }`（默认开启，08:00） |
| `mashu.modules.v1` | LifeOS 模块隐藏列表（偏好，不是 vault 数据） |

`prefs.ts` 首次读取时 adoption 旧键（`rixin.theme.v1` / `rixin.agent.v1` / `rixin.installHint.v1` / `mochi.*` / `inkstone.*` 等）到 `mashu.*` 并删除旧键。`rixin` / `mochi` / `inkstone` 只作为历史内部代号出现在迁移代码与说明里，不再是产品名。

### 导出格式（vault v2）

```ts
interface VaultFile {
  app: 'mashu';      // 导入时不强制校验，旧备份也可导入
  version: 2;
  exportedAt: string;
  notes: Note[];
}
```

- JSON 无损保留 `kind` / `meta`（含 `meta.directory` / `meta.plan`）/ `manualLinks` / `position` / `dirId` / `archivedAt`；设置页文件名形如 `mashu-<时间戳>.json`；导出走 `shareOrDownload()`（iOS 分享面板 → Files/iCloud，回退下载）。
- 目录笔记是普通笔记，因此会自动进入 JSON vault；归档与计划字段也会随记录保存。导入统一 `normalizeNote()`；兼容 v2、v1 与裸数组，更早品牌（`rixin` / `mochi` / `inkstone`）备份同样可导入；合并按标题、替换整库覆盖。

### Service Worker 缓存

- `public/sw.js` 的 `CACHE = 'mashu-v1'`；开发清单只有基础壳，正式构建后由 `scripts/sw-precache.mjs` 把 `dist/` 的全部 hash 资源（排除 `sw.js` 与 `splash/`）注入 `PRECACHE`。
- 导航 network-first / 同源 GET cache-first / `activate` 清旧缓存 + `clients.claim()`；更新在联网重开时生效，没有弹窗。

### 写入时机与可靠性

- 编辑：乐观更新 + 350ms 防抖；`flush()` 清定时器后写 `dirtyRef`，失败时把批次放回待写并提示。
- 立即写：新建、删除（等待已有写入落盘，防止晚到写入复活记录）、导入替换、清空。
- 生命周期兜底：`pagehide`、`beforeunload`、`visibilitychange(hidden)`。
- 首次启动请求持久化存储权限；「更多 → 设置 → 高级设置」展示存储引擎与 `storageEstimate()`。

## 11. 渲染管线

Markdown 渲染沿用安全管线：

```text
content
  │ 1. preprocessWikiLinks()：[[目标|别名]] → [别名](wiki:<encodeURIComponent(目标)>)
  ▼
markdown-it（html:false, linkify:true, breaks:true, typographer:true）
  │ 2. wiki: 链接 → <a class="wiki-link [is-missing]" data-wiki-target>
  │    http(s) 链接 → target="_blank" rel="noopener noreferrer nofollow"
  │ 3. 行首 "- [ ]" / "- [x]" → 只读复选框
  ▼
HTML 字符串 → MarkdownPreview 注入 DOM（点击 data-wiki-target 跳转/创建）
```

安全策略：`html: false`、markdown-it 协议校验拦截 `javascript:` / `vbscript:` / `file:` / `data:`、wiki 目标 `escapeHtml()`、外链 `rel="noopener noreferrer nofollow"`、渲染类名/属性由代码生成。残余风险只有用户主动写入的远程图片 URL。

阅读态直接渲染 `MarkdownPreview`；编辑态才出现 textarea。记录行摘要由 `kinds.describeMeta()` 生成；趋势用 `Sparkline`（纯 SVG）；图谱用 Canvas 2D 单独绘制；品牌符号 `MochiNode` 是内联 SVG，不引入外部图片。

## 12. 状态管理（`useNotes`）

- 状态：`notes`、`sortedNotes`、`ready`、`storageMode`、`storageWarning`。
- 操作：`createNote`、`updateNote`、`deleteNote`（返回布尔）、`togglePin`、`archiveNote`、`replaceAll`、`clearAll`、`ensureNote`、`findByTitle`、`flush`、`usage`；图谱相关 `setNodePosition`、`addManualLink`、`removeManualLink`、`resetNodePositions`；目录相关 `assignDirectory`。
- 内部：`notesRef`、`dirtyRef`、`timerRef`（350ms 防抖）、`inFlightRef`；`settleWrites()` 在删除/替换前等待落盘；`sortedNotes` 用 `useMemo`。
- 界面状态（主题、toast、快速记录、节点编辑、选中节点、编辑器 More/编辑态、图谱沉浸模式、助手人设、安装提示）留在 `App` / 组件或 `prefs`，不进入 vault。
- 简报与 7 日序列在 `App` 用 `useMemo` 计算；健康导入由 `App` 的 `importHealthText` / URL effect 调用纯解析器，再写 store。

## 13. 性能

面向个人记录库（几十到几千条记录）：

- **全量内存**：启动整库读入；列表、搜索、统计、简报、图谱模型都在内存中计算，无分页/虚拟滚动。
- **确定性计算按需**：`brief.ts` 与 `insights.ts` 是 O(n) 纯函数，按 `notes` 变化 `useMemo` 缓存。
- **写入不阻塞输入**：乐观更新 + 350ms 防抖 + 生命周期 flush；删除前等待落盘。
- **健康导入**：解析 O(samples)，聚合按「日期+指标」排序后聚合；只在导入时执行。
- **图谱**：模型变化才重建；实时仿真用 RAF，松手后 alpha 衰减（`releaseAlpha 0.42`、`alphaDecay 0.965`、`alphaMin 0.015`），1–2s 内 settle；固定节点不参与积分；O(n²) 斥力适合数百节点，更大规模需要空间网格/Worker（路线图）。
- **视觉**：卡片阴影几乎不可见、无 blur/glow；MochiNode/节点式头像都是轻量内联 SVG/文本；`prefers-reduced-motion` 下时长归零。
- **助手**：O(文本长度) 规则 + O(n) 统计，无网络/无模型推理。
- **SW 缓存**：构建时静态注入 hash 清单。
- **可优化点**：派生结果缓存、长列表虚拟化、图布局 Worker、增量索引、sparkline/图表数据缓存。

## 14. 扩展点

| 扩展点 | 位置 | 做法 |
| --- | --- | --- |
| 新记录类型 | `types.ts` → `kinds.ts` → `tokens.css` → `prefs.normalizeNote` | 更新 `NoteKind`、`NOTE_KINDS` / `KIND_INFO`、`--kind-*` 与 `GraphView` 分类色，检查列表/指标/简报/助手/节点编辑 |
| 新简报规则 | `src/lib/brief.ts` | 加阈值/文案并补 `tests/brief.test.ts`；保持 deterministic |
| 新目录规则 | `src/lib/directories.ts` + `DirectoryScreen` + `store.assignDirectory` | 目录是普通笔记（`meta.directory`）；删除只解除成员归属，不删除记录 |
| 新每日汇总规则 | `src/lib/digest.ts` | 按目录分组、highlights/suggestions/sourceIds、14 条历史与 schedule；补 `tests/digest.test.ts`；无网络/无后台 |
| 新知识检索/回答 | `src/lib/knowledge.ts` | 语料排除目录/归档/计划；无命中必须走固定 refusal；补 `tests/knowledge.test.ts` |
| 新健康别名 / 单位 | `src/lib/health.ts` | 扩展 `TYPE_ALIASES` / `convertValue`，补 `tests/health.test.ts` |
| 新节点式头像 / Mochi Node 细节 | `prefs.ts` 的 `AGENT_AVATARS` + `AgentAvatar.tsx` / `MochiNode.tsx` | 只用语义 token 颜色；一屏最多一个 Mochi Node；不引入图片 |
| 新图谱交互 | `GraphView` props → `App` 接线 → `store` 持久化方法 | 受控组件；`FORCE` 参数在文件顶部；补 `tests/graph.test.ts` 模型测试 |
| 原生 HealthKit 壳 | 新目录（如 `ios/`，Swift + HealthKit）+ 复用 web 构建 | 需要 Apple 开发者账号、权限文案与审核；不改变零服务器 PWA 路径 |
| 新存储后端 / 迁移 | `src/lib/db.ts` + `prefs.normalizeNote` | 升 `DB_VERSION` 就地补字段；改导出格式同步升 `VAULT_VERSION` 并兼容旧备份 |
| 本地小模型（local LLM）适配器 | 新模块（如 `agent-local-llm.ts`） | 默认关闭、设备本地运行，保持离线与隐私边界 |
| 更丰富图表 | `insights.ts` / `brief.ts` + 新图表组件 | 复用 `DaySummary` / `healthSeries`，不新增数据源 |
| 离线与安装（PWA） | `public/sw.js` + `src/main.tsx` + `manifest` + `index.html` | 调整缓存策略时同步 `sw-precache.mjs` 与 `CACHE` 版本（当前 `mashu-v1`） |
| 云同步 | 新模块（如 `sync.ts`）建立在 `db.ts` 之上 | 需要版本向量/冲突解决；在此之前保持「导出 → 导入」 |

## 15. 已知限制

- 助手是规则式本地助手，**不是大语言模型**；简报是确定性规则，不是 AI 建议。
- Web 应用**不能直接读取 HealthKit**：当前只有文件导入与 `?health=` 快捷指令 URL；原生 iOS 壳只是路线图。
- 没有推送服务器；固定时间提醒依赖 iOS 快捷指令个人自动化。
- iOS PWA 的更新语义是「打开时拉取」：联网时重新打开主屏幕图标加载新版本，没有应用内更新弹窗；离线只能使用最近缓存的应用壳，`CACHE` 版本手工递增。
- `?health=` URL 载荷可能留在 Safari 历史记录/剪贴板；更稳妥也更私密的方式是文件导入（见 PRIVACY）。
- iOS 浏览器存储受系统策略影响：清除 Safari / 网站数据可能删除记录；删除主屏幕图标通常只移除入口，不等于备份。
- 没有 iCloud / 云同步：导出到「文件」/ iCloud 云盘只是手动备份；换手机需要导出再导入。
- 没有同步与冲突解决：多设备靠导出/导入迁移；多标签页并发编辑后写覆盖。
- 每日汇总没有后台任务或远程推送：只在应用打开且过了选定时间后生成一次；准点提醒依赖 iOS 快捷指令自动化。
- 有依据的助手是确定性的关键词/bigram 检索，不是语义向量或大模型；它会引用真实记录并拒绝无依据问题，但覆盖面受记录措辞影响。
- 知识库目录目前是单层（没有嵌套目录/拖拽移动目录）；目录名与颜色是普通笔记字段。
- 没有文件夹、附件、图片上传；导入只支持 JSON（Markdown 只是导出格式），目录是单层知识库目录。
- 图表目前只有 7 日 sparkline；完整图表页、CSV 其他数据导入、Markdown 合集导入在路线图中。
- 图谱实时仿真与所有派生计算都在主线程；数万条记录时会有明显卡顿；O(n²) 斥力需要限制在数百节点。
- 浏览器清站点数据即删除记录；`localStorage` 回退模式容量约 5MB。
- 启动图覆盖当前七种 iPhone 尺寸；新机型需要更新 `npm run splash` 的尺寸表。
- `npm run screenshots` / `qr` / `splash` / `icons` 依赖本机 Chrome / Python 环境，属于发布工具。
- 设计稿标注快速记录 sheet 约 46/52/77vh；当前 CSS 实际是 46vh 最小、55vh 基础、72vh 解析、88vh 展开（以代码为准）。
- 图标组件 `Icon` 的默认 `strokeWidth` 是 1.7（视觉上按约 2px 线条处理）；设计文档写作“2px-stroke set”。

## 16. 测试与验证

- **单元测试**：Vitest（node 环境）共 **274 个用例 / 11 个文件**：`agent`、`brief`、`digest`、`exportImport`、`graph`、`health`、`insights`、`knowledge`、`links`、`markdown`、`search`。纯逻辑（目录/检索/汇总、简报规则、健康解析/换算/去重、图谱边/布局、导入合并）必须先测后改。
- **手动矩阵**：iPhone SE 与 iPhone 15 尺寸；Safari 标签页与「添加到主屏幕」standalone 各一遍。至少覆盖：离线重载、安装卡片与首次提示、16px 输入不缩放、导出「文件」、断网/恢复 toast、联网重开后加载新版本。
- **视觉回归**：浅色暖纸与深色暖炭各走一遍今日/经历/计划/更多/搜索/图谱/助手/编辑器/设置；确认语义 token、66px 导航（今日/经历/计划/助手/更多）、Mochi Node、目录色、稀疏标签与无 glow/neon；`prefers-reduced-motion` 下不播放动效。
- **交互回归**：Today 单一记录条、2×2 指标、复盘展开；经历时间线/置顶/边缘淡出；Search sticky/高亮/空态；Editor 默认阅读/编辑工具栏/More；Capture 展开详情与 52px 保存；Graph 拖拽邻居/回弹/pan/zoom/inspector/连线提示/目录切换/目录 inspector/沉浸模式隐藏导航；Directory 创建/颜色/成员/删目录不删记录；Settings 自动化汇总与清空二次确认。
- **知识回归**：`digest.test.ts`（按目录分组、未分类最后、2–3 highlights/suggestions、sourceIds、14 条历史去重、schedule 默认 08:00/时间解析）与 `knowledge.test.ts`（检索、lookup/stats/source ids、无依据拒绝、目录/归档/计划排除、help/capture 不变）。
- **功能回归**：健康 JSON/CSV/URL 三种导入路径、同日重复导入不产生重复记录、简报空数据/稀疏数据文案、迁移链（`rixin` / `mochi` / `inkstone` → `mashu`）后记录与偏好不丢。
- **发布校验**：`npm run typecheck && npm test && npm run build`；构建后确认 `dist/sw.js` 的 `PRECACHE` 已注入 hash 资源、`dist/splash/` 存在七张启动图。

更多关于数据与隐私的细节见 [PRIVACY.md](PRIVACY.md)。
