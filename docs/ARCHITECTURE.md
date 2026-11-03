# Architecture

日新（Rixin）是一个**纯前端、本地优先**的单页应用：一个静态 `index.html` + 打包后的 JS/CSS，没有服务器、没有数据库服务、没有账号系统。这份文档说明代码如何组织、数据如何在浏览器里流动、今日简报与 Apple 健康导入如何工作，以及哪些地方适合扩展。

当前版本 **0.4.0**：完成了品牌与视觉重构（日新 / Rixin、纸墨编辑设计、朱砂印章），把首屏从「记录列表」改为**今日复盘仪表盘**（`brief.ts`），加入 **Apple 健康导入**（`health.ts`）、硬核仪表盘风格图谱与「知几」印记头像，并把存储从旧品牌迁移到 `rixin`（数据库 / localStorage / Service Worker 缓存全部换名，旧数据自动迁移）。

## 1. 总览

- **一个记录库 = 生活记录 + 扁平笔记。** 没有文件夹、没有附件表；关系来自 Markdown 里的 `[[wiki 链接]]`、用户手动连线以及同一天生活记录之间的时间链。
- **浏览器就是后端。** 持久化在 IndexedDB（数据库 `rixin`，schema v2；不可用时回退 localStorage），写入是防抖的异步批量操作。
- **纯逻辑优先。** 解析、派生关系、搜索、图谱布局、生活统计、今日简报、Apple 健康解析、助手问答都在 `src/lib/`，不依赖 React 和 DOM，可在 Node 里直接测试；`store.ts`（React hook）、`db.ts` / `prefs.ts` / `exportImport.ts`（浏览器 API 适配）保持薄。
- **确定性。** 简报、助手、健康解析都是纯函数：同一份记录、同一个输入与同一个 `now` 必得同样的结果；不联网、不调用模型。
- **零第三方服务。** 运行时不发网络请求，唯一的网络访问来自用户在笔记里主动写入的外链/图片。
- **静态交付、零服务器。** 构建产物由 GitHub Actions 自动发布到 GitHub Pages（免费静态托管）；用户从 Safari 安装到主屏幕后离线使用。维护者不需要 VPS、数据库或任何服务器运维。
- **编辑设计 + 独立仪表盘。** 纸墨色板、朱砂强调、宋体标题、等宽标签、1px 细线、小圆角集中在 `src/styles/tokens.css`；生活图谱使用独立的始终深色 `--graph-*` 仪表盘色板。

```text
index.html
   │  <script type="module">
   ▼
src/main.tsx ──挂载（StrictMode）──▶ src/App.tsx（应用外壳：路由 / 主题 / 今日简报 / 快速记录 / 图谱 / 助手 / 健康导入）
   │                                    │
   │                                    ├── src/screens/*        TodayScreen（今日）、RecordsScreen（记录）、EditorScreen、SettingsScreen（我的）
   │                                    ├── src/components/*     可复用 UI（BrandSeal、Sparkline、GraphView、CaptureSheet、AgentPanel…）
   │                                    ├── src/lib/useRoute.ts  hash 路由（#/today、#/records、#/graph、#/agent、#/search、#/settings、#/note/:id）
   │                                    │
   │                                    └── src/lib/store.ts     useNotes()：内存中的唯一状态源
   │                                            │
   │                                            ├─ loadNotes / saveNotes / …   ← src/lib/db.ts
   │                                            │        └─ IndexedDB `rixin`（schema v2）
   │                                            │              └─（失败时）localStorage `rixin.notes.v1`
   │                                            │        └─ 首次打开时迁移旧库 `mochi` / `inkstone`
   │                                            │
   │                                            └─ 派生查询：brief.ts / insights.ts / health.ts / links.ts / markdown.ts / search.ts / graph.ts / agent.ts
   │
   └─（生产构建 + 安全上下文）注册 public/sw.js：应用壳离线缓存（缓存名 `rixin-v1`，构建时注入 hash 资源）
```

## 2. 请求 / 数据流

### 启动

1. 浏览器加载 `index.html`，执行 `src/main.tsx`，React 挂载根组件；`index.html` 默认 `data-theme="light"`，首屏纸色。`<head>` 包含 `apple-mobile-web-app-*` meta 与七种 iPhone 尺寸的 `apple-touch-startup-image` 启动图链接（由 `npm run splash` 生成）。
2. `useNotes()` 初始化（模块级共享 Promise，只执行一次，避免 StrictMode 下重复播种）：
   - `loadNotes()` 打开 IndexedDB `rixin` v2，读出 `notes` 仓库的全部记录；若从 v1 升级，会在 `onupgradeneeded` 中逐条 `normalizeNote()` 补齐字段。
   - 若 `rixin` 库为空，会尝试迁移旧品牌数据库（`mochi` / `inkstone`）与旧 localStorage 记录；合并按 id 去重，写入成功后才删除旧副本（详见「持久化与迁移」）。
   - 读取/迁移旧偏好：主题、引导标记、助手人设、安装提示都从旧键复制到 `rixin.*` 后删除旧键。
   - 空库且从未引导（`rixin.onboarded.v1 !== '1'`）时，写入 `seed.ts` 的演示记录并标记已引导。
   - 排序后写入内存状态并 `setReady(true)`，随后请求 `navigator.storage.persist()`。
3. 各页面从 `useNotes()` 读取记录与操作函数；`App` 通过 `useRoute()` 订阅 hash 变化决定渲染页面。主题偏好写入 `<html data-theme>`，并更新 `theme-color` meta（浅色 `#f4f1ea` / 深色 `#111316`）。
4. 生产构建在 `load` 后注册 `sw.js`；只在安全上下文（HTTPS / localhost）成功，失败静默忽略。

### 路由与导航

没有路由库，`src/lib/useRoute.ts` 是一个轻量 hash 路由：

| 路由 | 页面 | 底部导航 |
| --- | --- | --- |
| `#/today`（默认） | 今日：昨日复盘 + 今日改进 + 4 张 7 日趋势卡 + 快捷记录 + 今日时间线 | 今日 / TODAY |
| `#/records` | 记录：全量列表、按天分组、类型筛选、空状态 | 记录 / RECORDS |
| `#/graph` | 生活图谱（深色仪表盘） | 图谱 / GRAPH |
| `#/agent` | 本地助手（知几） | 助手 / AGENT |
| `#/search` | 搜索（今日/记录页头部的搜索图标进入） | （无） |
| `#/settings` | 我的：助手人设、Apple 健康、数据、存储、外观、安装卡片 | 我的 / ME |
| `#/note/<id>` | 编辑器 | （无） |

- `parseRoute()` / `routeToHash()` 解析与序列化；`navigate()` push 历史记录（手机返回手势可用），`replaceRoute()` 替换当前记录。空 hash 与未知路由都回落到 `today`；旧的 `#/notes` 兼容映射到 `records`。
- 底部导航是**扁平 5 等分导航**（今日 / 记录 / 图谱 / 助手 / 我的），每项带中文标签 + 等宽英文小字；没有中央悬浮按钮，快速记录入口在「今日」快捷按钮与「记录」页的「记一笔」。
- `App` 用 `returnToRef` 记录进入编辑器前的来源页，返回时回到原页面。
- hash 路由让静态托管（含子路径）与局域网地址都不需要服务端 rewrite；`scripts/serve.mjs` 对无扩展名路径做了 SPA fallback。

### 主题与编辑设计

- 主题值 `ThemeMode`（`light` / `dark` / `system`），持久化在 `rixin.theme.v1`；「我的 → 外观」用分段控件切换。
- `tokens.css`：`:root` 是纸色浅色（`--bg: #f4f1ea`、墨色文字、**朱砂 `--accent: #a63d33`**、按记录类型分配的 `--kind-*`）；`:root[data-theme='dark']` 是墨色夜间模式。字体分三套：`--font-sans`（正文）、`--font-display`（宋体标题）、`--font-mono`（等宽元信息/编号）。
- 几何：`--radius-xs` 3px → `--radius-xl` 10px，1px hairline 边框，极轻阴影；没有糖果渐变、没有大圆角、没有 glows。
- **图谱不受主题影响**：`GraphView` 只读 `--graph-*`（`--graph-panel: #0a0c10`、`--graph-grid`、`--graph-node-1..5` 霓虹色、`--graph-ghost`、`--graph-edge`、`--graph-text`），始终深色，和纸墨主界面形成「编辑部 + 仪表盘」的对比。
- 动效仅用于状态反馈，`prefers-reduced-motion` 下时长归零；正文与控件对比度按 WCAG AA 检查，触控目标保持 40px 以上。

### iOS / PWA 交付与离线壳

**交付模型：静态站点 + 主屏幕安装，没有服务器。**

- `npm run build` = `tsc --noEmit` + `vite build` + `node scripts/sw-precache.mjs`。最后一步读取 `dist/` 的真实 hash 产物（排除 `sw.js` 与 `splash/`），把它们写进 `dist/sw.js` 的 `PRECACHE`，这样离线壳能缓存完整应用。推送到 `main` 后 `.github/workflows/deploy-pages.yml` 自动发布到 GitHub Pages；GitHub 只是免费静态托管，维护者零服务器运维。
- 用户路径：Safari 打开 HTTPS 地址 → 分享 → 添加到主屏幕；安装后 `display: standalone`。`index.html` 提供 apple meta 与启动图，`manifest.webmanifest` 声明 `name: 日新`、`theme_color: #a63d33`、`background_color: #f4f1ea`、图标与 standalone。
- **安装引导**：`IosInstallCard` 渲染「我的 → 装到 iPhone 上」卡片（Safari 三步步骤、是否已安装、在线/离线壳/无需服务器/数据不出设备状态胶囊）；`TodayScreen` 在 iPhone 非 standalone 首次打开时显示一行安装提示，关闭状态存 `rixin.installHint.v1`。
- **Service Worker 生命周期**：`install` 预缓存应用壳（开发版是基础清单，正式版由 `sw-precache.mjs` 注入全部 hash 资源），`activate` 清理旧缓存并 `clients.claim()`；导航 network-first（在线取最新页面并写回缓存，离线回退缓存的 `index.html`），其他同源 GET cache-first。缓存名 `rixin-v1` 手工递增。结果是**联网时重新打开主屏幕图标即可获得新版本**，没有更新弹窗。
- **离线边界**：只缓存静态资源，不读取/缓存/上传 IndexedDB 或 localStorage 中的记录；断网时今日简报、记录、助手、图谱继续在本地工作。
- **iOS 细节**：安全区 `env(safe-area-inset-*)`；窄屏 `input` / `textarea` / `select` 16px 防聚焦缩放；`online` / `offline` toast；导出走 `shareOrDownload()`（Web Share 文件 → Files/iCloud，回退普通下载）；`navigator.standalone` / `display-mode` 判断安装状态。
- **手动测试矩阵**：iPhone SE 与 iPhone 15 尺寸；Safari 标签页与 standalone 各一遍；覆盖离线重载、安装卡片/提示、16px 不被放大、导出「文件」、断网/恢复 toast、重新联网后加载新版本。

### 今日简报（`brief.ts`）

1. `App` 在 `notes` 变化时 `useMemo(() => buildDailyBrief(api.notes))`，同一次渲染里用 `summarizeRange(notes, 7)` 取 4 条 sparkline 序列。
2. `buildDailyBrief(notes, now)` 完全纯函数：
   - 先取**昨天**的 `DaySummary`（来自 `insights.ts`），再取「昨天之前有记录的最近 7 天」（D-8 … D-2）作为对比基准；平均值只对**当天有该指标记录**的日子求均值，避免稀疏记录把均值带偏。
   - 生成 `summary`（一句话）、`review`（2–4 条事实性的昨日复盘）、`suggestions`（2–3 条今日改进）、`trends`（支出 / 摄入 / 睡眠 / 记录 4 张卡，含 tone 与 detail）。
   - 规则阈值集中在文件顶部：支出高于 7 日均值 1.2 倍视为偏高、低于 0.7 倍视为节省；热量 1.2 倍；睡眠 < 7h 视为偏少、≥ 7.5h 视为不错、偏差 0.5h 才在文案里比较；步数 < 5000 提示多走、≥ 8000 肯定；饮水 < 1500ml 提示补水。所有日期按本地时区。
3. `TodayScreen` 渲染「昨日复盘 / REVIEW」与「今日改进 / ADJUST」两段、4 张带 `Sparkline` 的趋势卡、快捷记录按钮和今日时间线；完整列表在「记录」页。
4. **没有推送服务器**：简报在打开应用时即时生成。需要固定时间提醒时，用户用 iOS「快捷指令 → 自动化 → 每天」添加「打开日新」——到点由系统打开应用，简报仍在本地生成。

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
- 删除走 `deleteNote()`：先移除记录并清理其他记录中指向它的 `manualLinks`，等已有写入落盘（`settleWrites`）后再删除；返回布尔值供 UI 提示。
- 页面隐藏 / 关闭时（`pagehide`、`beforeunload`、`visibilitychange === 'hidden'`）立即 `flush()`；写入失败时批次放回 `dirtyRef` 重试并提示导出备份。

### 快速记录（CaptureSheet）

1. 在「今日」快捷按钮或「记录」页点「记一笔」，`App` 打开 `CaptureSheet`（可带 `initialKind`）。
2. 输入内容变化时实时调用 `captureDraft(text, kindHint, now)`，把一句话解析为 `{ kind, title, content, meta, confidence }`。
3. 面板显示解析预览、置信度与按类型的快捷字段（餐次、热量、金额、指标、数值/单位、收支方向、分类）；用户修改字段会合并进 meta，所见即所存。
4. 点「保存记录」（或桌面 Cmd/Ctrl+Enter）后 `App` 调 `createNote()`，关闭面板并 toast。

### 助手对话（AgentPanel）

1. 默认人设是「知几」+ 印章印记；`AgentPanel` 挂载时调用 `agentGreeting(notes)` 生成问候与快捷问题，消息只存在组件 state（刷新即清空）。
2. `agentReply(text, notes, now)` 分类为 `capture` / `summary` / `advice` / `help` / `fallback`：`capture` 返回草稿确认卡片（保存 / 取消），`summary` / `advice` 直接返回本地统计文字与追问胶囊。
3. 人设（名字 ≤ 12 字 + 8 种印记或自定义字符）在「我的 → 智能体」编辑，存 `rixin.agent.v1`。

### 生活图谱编辑

1. `GraphView` 用 `buildGraph(notes)` 派生节点与三类边，再以确定性力导向布局绘制在 Canvas 上；画布是**始终深色仪表盘**（28px 网格、编辑器角落框线、等宽标签、1px 边）。
2. 视觉：节点按类型取 `--graph-node-1..5`（日记青、饮食琥珀、健康青绿、理财紫、笔记石板灰）；wiki 边细实线、manual 边更亮并在中点画刻度、day 边虚线；幽灵节点是虚线菱形。
3. 交互（受控组件，所有写操作回调 `App`）：点节点选中并在 `NodeEditorSheet` 编辑/删除；再次点同一节点打开笔记；拖动结束用归一化坐标持久化；工具栏「添加」后点空白处新建；「连线」依次点两个节点建立手动连线；另有放大 / 缩小 / 适应 / 重新布局。
4. `store.setNodePosition()` / `addManualLink()` / `removeManualLink()` / `resetNodePositions()` 负责持久化；位置 0..1 归一化。

### Apple 健康导入（`health.ts`）

1. 入口在「我的 → Apple 健康」：①选择 Apple 健康风格的 JSON/CSV 文件（`parseHealthJson` / `parseHealthCsv`）；②复制 `?health=` 前缀，用「快捷指令」拼 URL（`decodeHealthPayload` 支持 raw JSON 与 base64url）。
2. 解析器把输入归一化为 `HealthSample[]`：
   - 支持 `steps` / `sleep` / `heartRate` / `restingHeartRate` / `weight` / `water` / `activeEnergy` / `workout`；别名包含中英文与 HealthKit 标识符（如 `HKQuantityTypeIdentifierStepCount`）。
   - 单位换算：体重 lb/磅 → kg、g → kg；饮水 L/升 → ml；运动分钟/小时归一成分钟；睡眠支持小时/分钟/无单位推断。
   - 无法解析的样本计入 `skipped`，不会中断整批导入。
3. `healthSamplesToNotes(samples, existing)` 聚合为「每个本地日期 + 每个健康指标一条草稿」：步数/饮水/活动能量按天求和（running total），睡眠/体重/心率/运动取最新值；若已有同一天同指标的记录，草稿带 `replaceId`。
4. `App.applyHealthDrafts()` 执行：有 `replaceId` 的走 `updateNote()`，否则 `createNote()`；因此重复导入不会产生重复记录。导入完成 toast 显示条数。
5. `?health=` 是一次性导入：处理完从 URL 删除该 query 参数（保留 hash），避免刷新重复导入；如果用户用 Safari 打开而不是主屏幕应用，iOS 可能把数据写进另一份存储，所以文档推荐**文件导入更可靠**。

### 导入 / 导出

- 导出：`exportImport.ts` 生成 JSON `VaultFile`（`app: 'rixin'`、`version: 2`、`exportedAt`、`notes`）或 Markdown 合集 → `shareOrDownload()`：支持 Web Share 文件分享时打开 iOS 分享面板（可存「文件」/ iCloud 云盘），否则回退普通下载；「我的」页文件名形如 `rixin-<时间戳>.json` / `.md`。
- 导入：`parseVaultJson()` 兼容「带 `notes` 数组的对象」与「裸笔记数组」，逐条经 `normalizeNote()` 归一化；合并按标题保留较新版本，替换为整库覆盖（二次确认）。解析不强制校验顶层 `app`，因此 0.1.x / 0.3.x 的旧备份也能导入。
- 单条记录可「复制 Markdown」或「导出为 `.md`」；没有字段级冲突解决（见路线图）。

### 局域网、工具脚本与部署

- `npm run share` → `scripts/serve.mjs`：**仅开发者真机调试**的只读静态文件服务器，把 `dist/` 托管在 `0.0.0.0:4173` 并打印局域网 URL 与二维码；通过 HTTP 局域网访问无法注册 Service Worker。不是用户路径。
- `npm run qr` → `scripts/qr.mjs`：生成 `docs/screenshots/lan-qr.png` 与 `lan-url.txt`，二维码只含 URL。
- `npm run screenshots` → `scripts/screenshots.mjs`：驱动本机 Chrome（DevTools 协议，无 Puppeteer）按 12 个场景截图到 `docs/screenshots/`。
- `npm run icons` / `npm run splash` → Python + Pillow 生成朱砂印章 PWA 图标与七种 iPhone 启动图。
- `npm run build` 末尾的 `scripts/sw-precache.mjs` 把 `dist/` 的 hash 资源注入 `dist/sw.js` 的 `PRECACHE`（`sw.js` 自身与 `splash/` 排除，启动图由 iOS 直接读取）。
- `.github/workflows/deploy-pages.yml`：推 `main` 或手动触发后构建并发布 GitHub Pages（<https://frank-max610.github.io/rixin-notes/>）。唯一正式部署路径，零服务器运维。

## 3. 模块地图

### `src/lib/` — 核心逻辑（纯函数 + 浏览器适配层）

| 模块 | 职责 | 依赖 |
| --- | --- | --- |
| `types.ts` | 数据契约：`NoteKind`、`NoteMeta`、`NotePosition`、`Note`、`NoteSummary`、`RecordDraft`、`AgentPersona`、`ThemeMode` 等 | 无 |
| `kinds.ts` | 记录类型词表：`NOTE_KINDS`、`KIND_INFO`（标签/动作/颜色变量）、`MEAL_SLOTS`、`HEALTH_METRICS` / `HEALTH_UNITS`、`FINANCE_CATEGORIES`、`describeMeta`、`defaultTitle` | `types.ts` |
| `links.ts` | 从 Markdown 派生关系：wiki 链接、标签、反向链接、标题索引 | `types.ts` |
| `markdown.ts` | markdown-it 实例、wiki 链接预处理与渲染、任务清单规则、`plainText` / `excerpt` / `countWords` | `markdown-it`、`types.ts` |
| `insights.ts` | 生活统计：`summarizeDay` / `summarizeRange`、`healthSeries`、`spendingByCategory`、`weekSummaryText`、`formatMoney`、`dayKeyOf` / `noteDayKey` | `types.ts`、`kinds.ts` |
| `brief.ts` | 今日简报：`buildDailyBrief(notes, now)` → `summary` / `review` / `suggestions` / `trends`；阈值与文案规则 | `types.ts`、`insights.ts`、`kinds.ts` |
| `health.ts` | Apple 健康导入：`parseHealthJson` / `parseHealthCsv` / `decodeHealthPayload`、单位与别名、`healthSamplesToNotes`（同日聚合 + `replaceId` 去重） | `types.ts`、`kinds.ts`、`insights.ts` |
| `agent.ts` | 本地助手：`parseEntry` / `captureDraft`、`agentGreeting` / `agentReply`、快捷问题 | `types.ts`、`kinds.ts`、`insights.ts` |
| `search.ts` | 全文搜索：多关键词 AND、`#tag` 过滤、评分排序、命中片段 | `types.ts`、`links.ts`、`markdown.ts` |
| `graph.ts` | 生活图谱：`buildGraph`（wiki / manual / day 三类边、幽灵节点）、`seedPositions`、`tick`、`layoutSync` | `types.ts`、`links.ts` |
| `db.ts` | 持久化：IndexedDB `rixin` v2、localStorage 回退、旧库 `mochi` / `inkstone` 一次性迁移、恢复逻辑 | 浏览器 IndexedDB / localStorage |
| `store.ts` | React 状态源 `useNotes()`：缓存、乐观更新、防抖写入、`settleWrites`、图谱位置/手动连线、生命周期 flush | React、`db.ts`、`links.ts`、`prefs.ts`、`seed.ts` |
| `prefs.ts` | 主题、引导、助手人设/印记、安装提示的 `rixin.*` 读写与旧键 adopted；`normalizeNote` / `makeNote` / `AGENT_AVATARS` | `types.ts`、`kinds.ts`、`links.ts` |
| `seed.ts` | 首次运行的演示记录（生活记录 + 笔记） | `types.ts`、`prefs.ts` |
| `exportImport.ts` | `VaultFile`（vault v2，`app: 'rixin'`）JSON 导出/解析、旧备份导入、`mergeVaultNotes`、Markdown 合集、`shareOrDownload` | `types.ts`、`prefs.ts` |
| `format.ts` | 相对时间、日期、字节数等展示格式化 | 无 |
| `useRoute.ts` | 轻量 hash 路由（today / records / graph / agent / search / settings / note） | React |

依赖方向单向：**UI → store → db / 纯函数核心**。`brief.ts` 与 `agent.ts` 都依赖 `insights.ts`，保证「今日卡片」与「助手回答」使用同一套数字；纯函数模块绝不反向依赖 store 或 db。

### `src/components/` 与 `src/screens/`

- `components/` 是可复用、**道具驱动**的 UI：
  - `BrandSeal`（朱砂印章 svg）、`Sparkline`（7 日趋势必 SVG）、`TabBar`（扁平 5 标签导航，今日使用 sun 图标）；
  - `GraphView`（Canvas 深色仪表盘：选择、拖动、添加、连线、缩放、重新布局）；
  - `CaptureSheet`（一句话快速记录 + 快捷字段 + 解析预览）；
  - `AgentPanel`（知几对话与草稿确认）、`AgentAvatar`（8 种几何印记或自定义字符）；
  - `NodeEditorSheet`（新增/编辑节点：标题、类型、结构化字段、手动连线、删除）；
  - `IosInstallCard`（Safari 安装步骤与状态胶囊）、`NoteCard`、`Icon`、`EditorToolbar`、`MarkdownPreview`、`BacklinksPanel`、`SearchScreen`。
- `screens/` 是页面级组合：`TodayScreen`（品牌印章/日期、昨日复盘、今日改进、4 张趋势卡、快捷记录、今日时间线）、`RecordsScreen`（全量列表、类型筛选、按天分组、空状态）、`EditorScreen`（Markdown 编辑/预览、记录信息入口、反向链接）、`SettingsScreen`（我的：智能体人设、Apple 健康、安装卡片、数据导入导出、存储、外观、关于）。
- 样式手写 CSS：`tokens.css`（纸墨/朱砂/字体/几何/`--graph-*`）、`base.css`（reset、通用类、动效降级、iOS 16px 规则）、`app.css`（外壳与页面）；组件私有样式与组件同名并带前缀。没有 CSS 框架。

## 4. 数据模型

唯一持久化的实体仍是 `Note`（`src/lib/types.ts`），0.4 未改表结构：

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

辅助类型：

- `NotePosition { x, y }`（0..1）；`RecordDraft`（助手/快速记录的草稿：`kind` / `title` / `content` / `meta` / `confidence`）；`AgentPersona { name, avatar }`。
- `brief.ts`：`DailyBrief { dateKey, yesterdayKey, summary, review[], suggestions[], trends[] }`、`BriefTrend { label, value, detail?, tone }`。
- `health.ts`：`HealthSampleType`（steps / sleep / heartRate / restingHeartRate / weight / water / activeEnergy / workout）、`HealthSample`、`HealthParseResult { samples, skipped }`、`HealthNoteDraft { kind: 'health', title, content, meta, replaceId? }`。

约定与不变量：

- `id` 创建后不变；导入中的重复 id 在 `normalizeNote()` 中重新分配；所有入库/迁移/导入都先经 `normalizeNote()`。
- `title` 是 wiki 链接锚点；不要求唯一，同名取 `updatedAt` 最新。
- `tags` 派生自正文；`kind` 缺省 `note`；`meta.occurredAt` 是统计与「今天/昨天」分组的基准时间（缺省回退 `createdAt`）。
- `manualLinks` 是无向、去重的记录 id；删除记录时级联清理。
- `position` 存在即固定图谱节点；`updatedAt` 在内容/标题/类型/meta 变化时刷新。

## 5. 派生关系、统计与图谱

### 链接、标签与反向链接

- `[[目标]]` / `[[目标|别名]]`：先 `maskCode()` 屏蔽代码块与行内代码，再解析；`normalizeTitle()` 容错大小写/空白，`resolveLink()` 容忍 `.md` 后缀。
- 悬空链接在出链面板标「未创建」，图谱中生成幽灵节点，点击可创建同名记录。
- `#标签`：`#` 前须为行首/空白/常见标点；标签体允许字母、数字、CJK、`_`、`-`、`/`；纯数字拒绝。
- 反向链接 `backlinksFor()` 扫描所有记录正文，按引用次数 → 更新时间排序。

### 生活统计（`insights.ts`）

- 只统计 `kind !== 'note'` 的生活记录；日期按本地时区；时间戳取 `meta.occurredAt`（> 0）否则 `createdAt`。
- `summarizeDay()`：`spend`（饮食金额 + 理财支出）、`income`、`calories`、`meals`、`sleep` / `weight` / `steps` / `water` / `exercise`（当天最新）、`mood`（当天最后一条带心情）、`diaryCount`、`recordCount`、`noteIds`。
- `summarizeRange(notes, days, now)` 生成最近 N 天的日汇总；`healthSeries()` 生成逐日健康序列（只保留有值的日期）；`spendingByCategory()` 汇总分类支出（饮食默认餐饮、理财支出默认其他，收入不计）。

### 生活图谱（`graph.ts`）

- 节点：一条记录一个节点，携带 `kind`、保存位置（存在则 `fixed`）、度数；悬空 wiki 目标生成幽灵节点（`ghost:<规范化标题>`）。
- 三类无向边（按加入顺序去重）：`wiki` 解析成功的 `[[链接]]`；`manual` 手动连线（若同对已有 wiki 边则升级为 manual）；`day` 同一本地日期内生活记录按时间相邻串联。
- 自链接跳过；`degree` 驱动节点大小；`seedPositions()` 黄金角螺旋 + 固定点；`tick()` O(n²) 斥力 + 弹簧 + 向心 + 阻尼；`layoutSync()` 用于减少动效时一次性布局。

## 6. 今日简报（`brief.ts` 细节）

纯函数、确定性、无 I/O。核心步骤：

1. 用 `summarizeDay(notes, yesterday)` 得到昨天；用 `summarizeRange(notes, 9, now)` 取 D-8 … D-2 的「有记录日」求每个指标的均值（只对有该指标记录的天数求平均）。
2. 生成 `summary`（例如「昨天记了 9 条，睡得比平均多 0.3 小时」）、`review`（支出 / 饮食 / 睡眠 / 步数 / 饮水 / 日记，最多 4 条事实句）与 `suggestions`（睡眠、支出、热量、步数、饮水、日记等偏差优先，其次肯定做得好的地方，最后用中性记录提示兜底，取前 3 条，至少 2 条）。
3. `trends` 固定四张卡（支出 / 摄入 / 睡眠 / 记录），每张带 `value`、`detail`、`tone`（good/warn/neutral），供 `TodayScreen` 配 7 日 sparkline 渲染。
4. 阈值：支出 1.2× / 0.7×、热量 1.2×、睡眠 `< 7h` / `≥ 7.5h`、步数 `< 5000` / `≥ 8000`、饮水 `< 1500ml`；无历史时用中性文案。
5. **没有推送服务器**；固定时间提醒由 iOS 快捷指令个人自动化「打开日新」实现，属于系统能力。

## 7. Apple 健康导入（`health.ts` 细节）

- **输入**：JSON（数组 / `{samples|data:[...]}` / Shortcuts 单对象）、CSV（表头 `type,date,value[,unit,source,detail]`）、`?health=` URL 载荷（raw JSON 或 base64url，UTF-8 感知）。
- **归一化**：样本 → `HealthSample`；类型别名表覆盖中英文与 HealthKit 标识符；数值/日期解析容忍 ISO 字符串、毫秒/秒时间戳、`YYYY-MM-DD`；无法解析的样本计入 `skipped`。
- **单位**：体重 lb/磅/g/克 → kg；饮水 L/升 → ml；运动分钟/小时 → 分钟；睡眠小时/分钟/无单位推断；心率/步数/活动能量按原生单位。
- **聚合**：按「本地日期 + 指标」分组；`steps` / `water` / `activeEnergy` 是 running total → 求和；`sleep` / `weight` / `heartRate` / `workout` → 取当天最新。生成 `HealthNoteDraft`。
- **去重**：若库中已有同日同指标的 health 记录，草稿带 `replaceId`；`App.applyHealthDrafts()` 对有 `replaceId` 的走 `updateNote`，否则 `createNote`，因此可安全重复导入。
- **入口**：文件选择（`accept=.json,.csv,.txt`）或「复制快捷指令导入链接」；`?health=` 处理成功后从 URL 移除该参数。若在 Safari 而不是主屏幕应用打开，iOS 可能使用另一份网站数据，因此文档建议优先文件导入。
- **诚实边界**：Web 应用没有 HealthKit 权限，不能直接读健康 App；当前只有「文件 / 快捷指令」两条零服务器路径。原生 iOS 壳（Xcode + HealthKit）是路线图可选项，仓库不包含。

## 8. 本地助手（`agent.ts`）

仍完全离线、确定性：一句话解析（`parseEntry` / `captureDraft`）+ 问答（`agentGreeting` / `agentReply`，intent 为 capture / summary / advice / help / fallback）。回答读取 `insights.ts` 的数字，简报读取同一来源，两者不会打架。默认人设「知几」+ 印章印记；`prefs.ts` 存 `rixin.agent.v1`，并把旧版本的助手名/头像映射到新默认。助手不是 LLM；路线图包含可选的设备本地小模型适配器（默认关闭、不联网）。

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
  onRequestResetLayout?: () => void;
}
```

- `onSelectNote` → 打开/关闭 `NodeEditorSheet`；`onMoveNote` → `store.setNodePosition()`（归一化防抖写入）；`onCreateNoteAt` → 新建模式并带位置；`onLinkNotes` → `store.addManualLink()`；`onRequestResetLayout` → `store.resetNodePositions()`。
- 画布绘制只读 `--graph-*` token；`GRID_SIZE = 28`；节点按 `KIND_COLOR_VARS` 映射霓虹色；`ghost` 画虚线菱形；`wiki` / `manual` / `day` 三种边分别用细实线、亮线 + 中点刻度、虚线绘制。

## 10. 持久化与迁移

### IndexedDB（`rixin`，schema v2）

```ts
const DB_NAME = 'rixin';
const DB_VERSION = 2;
const STORE = 'notes';        // keyPath: 'id'，索引：updatedAt
const LEGACY_DB_NAMES = ['mochi', 'inkstone'];
```

- `onupgradeneeded` 创建对象仓库与 `updatedAt` 索引；若 `oldVersion < 2`，用游标把每条记录 `normalizeNote()` 重写，补齐 `kind` / `meta` / `manualLinks` / `position`。
- 读写单事务；`replaceAllNotes` 先 `clear()` 再批量 `put`；`clearAllNotes` 即清空。
- 失败回退 localStorage（`rixin.notes.v1`）；下次成功打开时把回退记录合并进 IndexedDB，确认写入成功后才清理回退键。
- **旧库迁移**：`rixin` 为空时，依次读取旧 localStorage 记录（`mochi.notes.v1` / `inkstone.notes.v1`）与旧 IndexedDB（`mochi` / `inkstone`），按 id 合并后写入 `rixin`；只有写入成功后 `cleanupLegacyStorage()` 才删除旧库/旧键，失败则保留旧副本。
- `openDatabase()` 打开失败不缓存失败 Promise，后续调用会重试。

### localStorage

| 键 | 内容 |
| --- | --- |
| `rixin.notes.v1` | 整库记录 JSON（仅 IndexedDB 不可用时） |
| `rixin.theme.v1` | `light` / `dark` / `system` |
| `rixin.onboarded.v1` | 是否已完成首次引导（`'1'`） |
| `rixin.agent.v1` | 助手人设 `{ name, avatar }` |
| `rixin.installHint.v1` | iPhone 首次安装提示是否已关闭 |

`prefs.ts` 会在首次读取时 adoption 旧键（`mochi.theme.v1` / `mochi.agent.v1` / `mochi.installHint.v1` / `inkstone.theme.v1` 等）到 `rixin.*` 并删除旧键。`mochi` / `inkstone` 只作为历史内部代号出现在迁移代码与说明里，不再是产品名。

### 导出格式（vault v2）

```ts
interface VaultFile {
  app: 'rixin';      // 导入时不强制校验，旧备份也可导入
  version: 2;
  exportedAt: string;
  notes: Note[];
}
```

- JSON 无损保留 `kind` / `meta` / `manualLinks` / `position`；「我的」页文件名形如 `rixin-<时间戳>.json`；导出走 `shareOrDownload()`（iOS 分享面板 → Files/iCloud，回退下载）。
- 导入统一 `normalizeNote()`；兼容 v2、v1 与裸数组，旧 `mochi` / `inkstone` 备份同样可导入；合并按标题、替换整库覆盖。

### Service Worker 缓存

- `public/sw.js` 的 `CACHE = 'rixin-v1'`；开发清单只有基础壳，正式构建后由 `scripts/sw-precache.mjs` 把 `dist/` 的全部 hash 资源（排除 `sw.js` 与 `splash/`）注入 `PRECACHE`。
- 导航 network-first / 同源 GET cache-first / `activate` 清旧缓存 + `clients.claim()`；更新在联网重开时生效，没有弹窗。

### 写入时机与可靠性

- 编辑：乐观更新 + 350ms 防抖；`flush()` 清定时器后写 `dirtyRef`，失败时把批次放回待写并提示。
- 立即写：新建、删除（等待已有写入落盘，防止晚到写入复活记录）、导入替换、清空。
- 生命周期兜底：`pagehide`、`beforeunload`、`visibilitychange(hidden)`。
- 首次启动请求持久化存储权限；「我的」页展示 `storageEstimate()`。

## 11. 渲染管线

Markdown 渲染沿用原有安全管线：

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

生活记录摘要由 `kinds.describeMeta()` 生成；今日趋势卡用 `Sparkline`（纯 SVG，按 values 画折线）；图谱用 Canvas 2D 单独绘制，不复用 DOM 渲染。

## 12. 状态管理（`useNotes`）

- 状态：`notes`、`sortedNotes`、`ready`、`storageMode`、`storageWarning`。
- 操作：`createNote`、`updateNote`、`deleteNote`（返回布尔）、`togglePin`、`replaceAll`、`clearAll`、`ensureNote`、`findByTitle`、`flush`、`usage`；图谱相关 `setNodePosition`、`addManualLink`、`removeManualLink`、`resetNodePositions`。
- 内部：`notesRef`（最新数组）、`dirtyRef`（待写 Map）、`timerRef`（350ms 防抖）、`inFlightRef`（当前写入）；`settleWrites()` 在删除/替换前等待落盘；`sortedNotes` 用 `useMemo`。
- 界面状态（主题、toast、快速记录、节点编辑、选中节点、助手人设、安装提示）留在 `App` 或 `prefs`，不进入 vault。
- 简报与 7 日序列在 `App` 用 `useMemo` 基于 `notes` 计算；健康导入由 `App` 的 `importHealthText` / URL effect 调用纯解析器，再写 store。

## 13. 性能

面向个人记录库（几十到几千条记录）：

- **全量内存**：启动整库读入；列表、搜索、统计、简报、图谱都在内存中计算，无分页/虚拟滚动。
- **确定性计算按需**：`brief.ts` 与 `insights.ts` 是 O(n) 纯函数，按 `notes` 变化 `useMemo` 缓存；首页、助手、图谱共用同一数据源。
- **写入不阻塞输入**：乐观更新 + 350ms 防抖 + 生命周期 flush；删除前等待落盘。
- **健康导入**：解析 O(samples)，聚合按「日期+指标」分组 O(samples log samples)（排序）；只在导入时执行。
- **图谱**：指纹变化才重建模型；Canvas 2D + RAF；拖动结束才持久化；固定节点不参与积分；O(n²) 斥力适合数百节点，更大规模需要空间网格/Worker（路线图）。
- **助手**：O(文本长度) 规则匹配 + O(n) 统计，无网络/无模型推理，毫秒级。
- **SW 缓存**：构建时静态注入 hash 清单，运行时不做额外计算。
- **可优化点**：派生结果按 `updatedAt` 缓存、长列表虚拟化、图布局 Worker、增量索引、sparkline/图表数据缓存。

## 14. 扩展点

| 扩展点 | 位置 | 做法 |
| --- | --- | --- |
| 新记录类型 | `types.ts` → `kinds.ts` → `tokens.css` → `prefs.normalizeNote` | 更新 `NoteKind`、`NOTE_KINDS` / `KIND_INFO`、`--kind-*` 与图谱 `--graph-node-*`，并检查列表/图表/简报/助手/节点编辑 |
| 新简报规则 | `src/lib/brief.ts` | 加阈值/文案并补 `tests/brief.test.ts`；保持 deterministic、只用本地记录 |
| 新健康别名 / 单位 | `src/lib/health.ts` | 扩展 `TYPE_ALIASES` / `convertValue`，补 `tests/health.test.ts`；保持同日聚合与 `replaceId` 语义 |
| 新印记头像 | `prefs.ts` 的 `AGENT_AVATARS` + `AgentAvatar.tsx` | 24px 网格、1.5px 线条、只用 token 色 |
| 新图谱交互 | `GraphView` props → `App` 接线 → `store` 持久化方法 | 受控组件；布局逻辑留在 `graph.ts` 并测试 |
| 原生 HealthKit 壳 | 新目录（例如 `ios/`，Swift + HealthKit）+ 复用现有 web 构建 | 需要 Apple 开发者账号、权限文案与审核；不改变现有零服务器 PWA 路径 |
| 新存储后端 / 迁移 | `src/lib/db.ts` + `prefs.normalizeNote` | 升 `DB_VERSION` 就地补字段；改导出格式同步升 `VAULT_VERSION` 并兼容旧备份 |
| 本地小模型（local LLM）适配器 | 新模块（例如 `agent-local-llm.ts`） | 默认关闭、设备本地运行，保持离线与隐私边界 |
| 更丰富图表 | `insights.ts` / `brief.ts` + 新图表组件 | 复用 `DaySummary` / `healthSeries`，不新增数据源 |
| 离线与安装（PWA） | `public/sw.js` + `src/main.tsx` + `manifest` + `index.html` | 调整缓存策略时同步 `sw-precache.mjs` 与 `CACHE` 版本（当前 `rixin-v1`） |
| 云同步 | 新模块（例如 `sync.ts`）建立在 `db.ts` 之上 | 需要版本向量/冲突解决；在此之前保持「导出 → 导入」 |

## 15. 已知限制

- 助手是规则式本地助手，**不是大语言模型**；简报是确定性规则，不是 AI 建议。
- Web 应用**不能直接读取 HealthKit**：当前只有文件导入与 `?health=` 快捷指令 URL；原生 iOS 壳只是路线图。
- 没有推送服务器；固定时间提醒依赖 iOS 快捷指令个人自动化。
- iOS PWA 的更新语义是「打开时拉取」：联网时重新打开主屏幕图标加载新版本，没有应用内更新弹窗；离线只能使用最近缓存的应用壳，`CACHE` 版本手工递增。
- `?health=` URL 载荷可能留在 Safari 历史记录/剪贴板；更稳妥也更私密的方式是文件导入（见 PRIVACY）。
- iOS 浏览器存储受系统策略影响：清除 Safari / 网站数据可能删除记录；删除主屏幕图标通常只移除入口，不等于备份。
- 没有 iCloud / 云同步：导出到「文件」/ iCloud 云盘只是手动备份；换手机需要导出再导入。
- 没有同步与冲突解决：多设备靠导出/导入迁移；多标签页并发编辑后写覆盖。
- 没有文件夹、附件、图片上传；导入只支持 JSON（Markdown 只是导出格式）。
- 图表目前只有 7 日 sparkline；完整图表页、CSV 其他数据导入、Markdown 合集导入在路线图中。
- 图谱力导向布局与所有派生计算都在主线程；数万条记录时会有明显卡顿。
- 浏览器清站点数据即删除记录；`localStorage` 回退模式容量约 5MB。
- 启动图覆盖当前七种 iPhone 尺寸；新机型需要更新 `npm run splash` 的尺寸表。
- `npm run screenshots` / `qr` / `splash` / `icons` 依赖本机 Chrome / Python 环境，属于发布工具。

## 16. 测试与验证

- **单元测试**：Vitest（node 环境）共 **202 个用例 / 9 个文件**：`agent`、`brief`、`exportImport`、`graph`、`health`、`insights`、`links`、`markdown`、`search`。纯逻辑（简报规则、健康解析/换算/去重、图谱边、导入合并）必须先测后改。
- **手动矩阵**：iPhone SE（小屏/安全区）与 iPhone 15 尺寸；Safari 标签页与「添加到主屏幕」standalone 各一遍。至少覆盖：离线重载、安装卡片与首次提示、16px 输入不缩放、导出「文件」、断网/恢复 toast、联网重开后加载新版本。
- **功能回归**：健康 JSON/CSV/URL 三种导入路径、同日重复导入不产生重复记录、简报在空数据/稀疏数据下的文案、图谱三类边与幽灵菱形、旧库迁移后记录与偏好不丢。
- **发布校验**：`npm run typecheck && npm test && npm run build`；构建后确认 `dist/sw.js` 的 `PRECACHE` 已注入 hash 资源、`dist/splash/` 存在七张启动图。

更多关于数据与隐私的细节见 [PRIVACY.md](PRIVACY.md)。
