# 贡献指南

感谢你愿意为麻薯出一份力。麻薯是一个本地优先的生活操作系统：记录、连接、理解。我们更看重「安静、清楚、每天愿意打开」而不是堆功能，请先花几分钟读完这份指南。

当前文档对应 **v1.3.0**：直接写作（目录 / 日历）、聊天优先的悬浮助手、每日提醒、Apple 健康同步中心。v1.3 没有改变数据模型与存储 schema（仍为 274 个用例 / 11 个文件），新增的是内联写作入口、`reminders.ts`、`CalendarScreen`、`HealthSyncScreen` 与三个本地偏好键（`mashu.reminders.v1` / `mashu.reminders.lastNotified.v1` / `mashu.health.lastSync.v1`）。

## 命名约定

- **面向用户的名称统一用「麻薯」**：界面文案、README、截图 alt 文本、错误提示都写「麻薯」。
- **机器名统一用 `mashu`**：仓库/包名 `mashu-notes`、数据库 `mashu`、localStorage 键 `mashu.*`、Service Worker 缓存 `mashu-v1`。
- 更早版本使用过不同的内部代号和数据库名（如 `rixin` / `mochi` / `inkstone`）。它们**只允许出现在迁移代码、兼容说明和旧备份导入逻辑里**；新的代码与文案不要再使用旧名称，也不要把旧存储键当作新功能的一部分。
- 仓库地址：<https://github.com/Frank-max610/mashu-notes>；线上演示：<https://frank-max610.github.io/mashu-notes/>。

## iOS / PWA 交付（零服务器）

最终交付形态是**静态站点**，不是服务器应用：

- `npm run build` 先做类型检查与 Vite 构建，再运行 `scripts/sw-precache.mjs` 把带 hash 的构建产物注入 `dist/sw.js` 的 `PRECACHE`。推送到 `main` 后由 `.github/workflows/deploy-pages.yml` 自动发布到 GitHub Pages。GitHub 只是免费的静态托管：维护者不需要 VPS、数据库、后台进程或密钥，也不做任何服务器运维。
- 用户路径是 Safari 打开 HTTPS 地址 → 分享 → 添加到主屏幕；首次加载后 Service Worker（缓存名 `mashu-v1`）让应用离线可用。联网时重新打开主屏幕图标会拿到新版本（导航请求 network-first），没有更新弹窗或应用商店审核。
- iOS 细节要与代码保持一致：`apple-mobile-web-app-*` meta、`apple-touch-startup-image` 七种尺寸启动图（`npm run splash` 生成到 `public/splash/`）、`display: standalone`、安全区、手机表单 16px（避免 Safari 聚焦缩放）、JSON/Markdown 导出优先走 Web Share 文件分享（可存「文件」/ iCloud，回退普通下载）、离线/联网 toast、首次打开的安装提示。
- `npm run share` 和 `npm run qr` 只是开发者真机调试工具，**不是用户路径**；不要因为调试方便就引入服务器、账号、云函数或任何运行时网络请求。
- 手动测试矩阵：iPhone SE（小屏/安全区）、iPhone 15 尺寸各一遍；Safari 标签页与「添加到主屏幕」后的 standalone 各一遍。至少验证：离线重载、安装卡片与首次提示、16px 输入框不被放大、导出到「文件」、断网/恢复提示。

## 开发环境

- **Node.js 22 LTS 或更新**（Vitest 5 需要 Node 22.12+；Vite 8 最低支持 Node 20.19，CI 固定使用 Node 22）
- npm 10+
- 可选：Python 3 + Pillow（只有重新生成 PWA 图标 / iPhone 启动图时需要，`npm run icons` / `npm run splash`）
- 可选：本机 Chrome / Chromium（只有重新生成 README 截图时需要，`npm run screenshots`；可用 `CHROME_PATH` 指定路径）
- 任意现代浏览器用于开发；主要目标是 **iPhone / iPad Safari**（包括「添加到主屏幕」后的 standalone 模式）。

```bash
# fork 并 clone 之后
npm install
npm run dev        # http://localhost:5173
```

`npm run dev` 默认带 `--host`，同一 Wi-Fi 下的手机可以通过 `http://<电脑局域网 IP>:5173` 打开开发版，方便调试真机上的触控和键盘行为。

`npm run share` 托管的是 `dist/`，所以要先跑一次 `npm run build`；端口被占用时可以 `npm run share -- --port 4174`。它**仅用于开发者真机调试**，不是用户路径；通过 HTTP 局域网地址访问时 Service Worker 不会注册（浏览器要求安全上下文），离线能力需要在 HTTPS 或 localhost 下验证。

常用脚本：

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动 Vite 开发服务器（HMR） |
| `npm run build` | 类型检查 + 生产构建到 `dist/` + 注入 SW 预缓存清单（`scripts/sw-precache.mjs`） |
| `npm run preview` | 预览 `dist/`（http://localhost:4173） |
| `npm run share` | **仅开发者调试**：构建后局域网托管 `dist/`，打印地址与二维码；不是用户路径 |
| `npm run typecheck` | 只跑 `tsc --noEmit` |
| `npm test` | 运行一次 Vitest（当前 274 个用例 / 11 个文件） |
| `npm run test:watch` | Vitest watch 模式 |
| `npm run icons` | 重新生成 `public/icons/` 下的 Mochi Node 品牌图标（需要 Python 3 + Pillow） |
| `npm run splash` | 重新生成 `public/splash/` 下的 iPhone 启动图（需要 Python 3 + Pillow） |
| `npm run qr` | 生成局域网访问地址的二维码 PNG（`docs/screenshots/lan-qr.png` + `lan-url.txt`） |
| `npm run screenshots` | 驱动本机 Chrome 无头模式重新截取 README 截图（需要 Chrome；产物在 `docs/screenshots/`） |

提交 PR 前至少跑一遍：

```bash
npm run typecheck && npm test && npm run build
```

## TypeScript 规则

项目开启了 `strict`，并且额外启用：

- `noUnusedLocals` / `noUnusedParameters` —— 不要留下未使用的变量和参数；
- `noFallthroughCasesInSwitch` —— `switch` 分支必须显式 `break` / `return`；
- `noImplicitOverride` —— 覆写成员要写 `override`；
- `isolatedModules` —— 导出类型用 `import type` / `export type`，不要依赖「只导入类型」的副作用；
- `jsx: react-jsx` —— 写 JSX 不需要 `import React`。

约定：

- 不要用 `any` 绕过类型检查；外部输入（IndexedDB、localStorage、导入文件、快捷指令 URL）用 `unknown`，再通过 `normalizeNote` / 解析器收窄。
- 公共 API（`src/lib/*` 的导出函数、组件 props）写明确的类型，而不是靠推断。
- 纯逻辑模块（`links`、`markdown`、`search`、`graph`、`kinds`、`insights`、`brief`、`health`、`agent`）必须保持**同步、无 DOM、无副作用**，可以在 Node 环境里直接被 Vitest 测试。
- **确定性**：`brief.ts` 对同一份记录与同一个 `now` 必须输出同一份简报；`agent.ts` 与 `health.ts` 不使用随机数、不联网；所有日期计算按本地时区。
- 会触碰浏览器 API 的模块（`db`、`store`、`prefs`、`exportImport`）要尽量薄：把可测试的逻辑拆出去，把 I/O 留在这几层。
- 优先使用 `catch {}`（不带绑定）或显式类型收窄，不要默认错误一定是 `Error`。

## 代码风格

没有 ESLint / Prettier 自动格式化，靠约定和 review 保持一致。请模仿现有代码：

- **2 空格缩进**，单个文件不要混用 tab。
- **单引号**、**语句末尾分号**、对象/数组尾逗号。
- 注释和 JSDoc 用**英文**；所有面向用户的字符串用**中文**（项目主语言是中文；未来会做 i18n）。
- 命名：文件用 camelCase（`exportImport.ts`）或 PascalCase（`GraphView.tsx`）；变量/函数 camelCase；类型/组件 PascalCase；常量 UPPER_SNAKE_CASE。
- 优先**具名导出**；目前只有入口组件 `App.tsx` 使用默认导出（供 `main.tsx` 挂载）。
- 纯函数放在 `src/lib`，UI 组件放在 `src/components`，页面级组合放在 `src/screens`。
- 样式统一手写 CSS + `src/styles/tokens.css` 里的**语义 token**，页面/组件不写死颜色、间距、圆角或阴影。组件样式文件与组件同名（`GraphView.css`），类名加组件前缀。

### LifeOS 视觉规则（v1.2，源：设计文档 §04）

- **只用语义 token**：`--bg` / `--surface` / `--surface-2` / `--text` / `--text-muted` / `--border` / `--accent` / `--accent-soft` / `--danger` / `--kind-*`；浅色与深色映射同一批名字，禁止按页面手写颜色。
- **两套主题**：浅色暖纸 `#F7F3EC`（surface `#FCFAF6`、surface-2 `#F1EAE1`、正文 `#2C2925`、次级 `#756D63`、边框 `#E5DBCF`、主色 `#C8783F`、主色浅底 `#F2DFC9`、danger `#B34B36`）；深色暖炭 `#171410`（surface `#211D18`、surface-2 `#28221D`、正文 `#F3ECE4`、次级 `#B8ABA0`、边框 `#3B332C`、主色 `#E6A062`、主色浅底 `#463024`、danger `#D56A56`）。默认浅色。
- **字号只用 scale**：Display 34–38 / H1 28–32 / H2 20–22 / Body 16–17 / Meta 12–13 / Data mono 13–15；不要用圆体或衬线标题。
- **布局**：页面左右 20px；区块间距 28–36；卡片圆角 16–20；按钮 14–16；阴影几乎不可见（`--shadow-1/2`），**禁止 glow/neon/渐变光晕**；`--grad-brand` 不是装饰渐变。
- **控件**：只有 chip 是胶囊；按钮是普通圆角矩形；底部导航固定 66px，激活项是浅色块，导航为 **今日 / 经历 / 图谱 / 助手 / 更多**（图谱在中间）；设置、知识库目录、计划及其余模块从「更多」进入；图标统一一套线性图标（`Icon`，约 2px 视觉线条）。
- **启动与导览**：splash 每次冷启动显示（Mochi Node + 「记录每一天」），约 1.6s；`prefers-reduced-motion` 下 450ms；首启 4 屏新手导览只在 `mashu.onboarded.v1` 不存在时出现，第一屏必须是「生活图谱 / 看见生活的形状」。`?nointro=1` 必须跳过 splash + 导览（截图/自动化）。
- **分类色只用于节点/标签/小面积状态**：日记 `#65788A`、饮食 `#B45D35`、健康 `#627A4E`、财务 `#9A7112`、笔记 `#7D7164`；不要拿它们铺大面积背景。
- **品牌符号**：只用 `MochiNode`（暖色主节点 + 卫星节点 + 细轨道），一屏最多出现一次；**不要**再引入卡通吉祥物、脸、贴纸或 emoji 装饰。
- **动效**：页面进入 220–320ms、按压 120–180ms、sheet ease-out、图谱 settle 1–2s；必须尊重 `prefers-reduced-motion`（tokens 会把时长归零）。
- **空状态**：一个目标 + 一个 CTA，不堆插画或口号；文案平静、具体。
- **触控与对比度**：主要按钮与底部导航至少 44px；正文/控件对比度至少 WCAG AA；适配安全区与 16px 表单。

### 组件级约定

- `TodayScreen` 是图谱优先的安静驾驶舱：小 hero（问候 + 一个问题）+ 单一自然语言记录条 + **最多 4 个快捷 chips**，然后 **GraphTeaser 是首屏第一视觉锚点**，再是紧凑昨日复盘，最后 **只有 3 条最近记录**。header 右侧保留日历与搜索图标；到提醒时间后可在快捷 chips 之后出现「今天还差一点」提醒卡（由 `reminders.ts` 判定，一天一次）。**不要**恢复独立指标区、7 日 sparkline 区块或长今日时间线（完整时间线在「经历」）。
- `SplashScreen`：品牌首屏（Mochi Node + 麻薯 + 记录每一天 + 进度线），不联网、不读数据；冷启动 1.6s、减少动态效果 450ms，由 `App` 控制计时。
- `Onboarding`：4 屏（生活图谱 → 一句话记录 → 目录 → 有依据的助手），支持跳过/上一步/下一步；第一屏次要 CTA「直接看图谱」，最后一屏主 CTA「开始记录」；完成时写 `mashu.onboarded.v1`，可从「更多 → 新手导览」重播；不得自动重复弹出。
- `GraphTeaser`：今日第一视觉锚点；从 `directoryList(notes)` 取最多 3 个目录与成员计数，画 mini hub/branch；有目录时文案「N 个目录，组成你的生活网络 / 每个小球是一个目录，点开编辑内容」，否则「先建目录」（跳目录页）；可点进图谱。不要把它做成普通列表卡或塞回指标区。
- `DirectoryDetailScreen`：目录内容页（`#/directories/:id`）——顶部是**直接写作面**：textarea 自动聚焦，保存后创建带 `dirId` 的记录并归入该目录（⌘/Ctrl+Enter 也能保存）；新建目录后必须直接进入该目录。下方是成员列表、打开记录、删除目录（成员保留）。图谱小球只是目录索引，详细内容在这里写和编辑；不要再加回「记一笔」CTA 把内容带回快速记录 sheet。
- `FloatingAgent`：可拖动的 persona 小球（头像/名字来自设置）；**点按 = 打开助手对话 `#/agent`（聊天优先），长按 ≈650ms = 打开结构化快速记录 sheet**（v1.2 是反过来，别改回去）；位置持久化 `mashu.floatagent.v1`，只在非图谱/非编辑器路由显示；不要让它遮挡图谱画布或编辑器正文。
- `CalendarScreen`：`#/calendar` 月视图，**周一是一周第一天**（`(first.getDay() + 6) % 7`），每天有记录显示圆点；上/下月 +「今」切换，任意一天可选。选中日内联写作：日记模式保存 `occurredAt`（今天用 `Date.now()`，其他日期用选中日中午），计划模式保存 `dueAt`；日记可选目录。当天记录列表点一条打开编辑器；header 显示记录数与支出。日历只读写本地记录，不要接日历服务或新增数据源。
- `HealthSyncScreen`：`#/health-sync` 同步中心——上次导入时间 `mashu.health.lastSync.v1`、Apple Watch → 健康 → 快捷指令 → 麻薯四步、复制 `?health=` URL、JSON/CSV 文件导入；必须明确写出 PWA 不能读 HealthKit，直连需要 Capacitor + HealthKit + Apple 开发者账号，不要暗示网页版能自动拉取健康数据。
- `RecordsScreen` 用时间线行（`RecordRow`：类型点 + 标题 + 一行摘要 + 时间），置顶收在紧凑条里；筛选 chips 可横向滚动并有边缘淡出；不要回到卡片墙。
- `SearchScreen` 的 header sticky；结果复用 `RecordRow`；`<mark>` 只做轻高亮；空查询显示最近编辑；无结果显示「未找到相关记录」+「清除筛选」。
- `EditorScreen` 阅读优先：默认渲染 Markdown，只有编辑态才显示工具栏和原始 textarea；操作统一进 More（编辑正文/编辑记录信息/置顶/复制 Markdown/导出 .md/删除）；编辑时右上角只留「完成」；关系文案用「连接到 / 来自」。
- `AgentPanel` 去控制台化：`MochiNode` + 小麻薯 + 「本地处理 · 仅你可见」；正文流消息、纯时间 meta、紧凑确认卡；最多 3 个欢迎动作，追问 chips 只在最新消息下。grounded 回答必须渲染可点击的来源 chips（《记录标题》→ 打开本地记录）；每日汇总作为一条 assistant 消息进入对话，带 source chips。
- `DirectoryScreen` 知识库目录：创建/颜色/成员计数/展开成员/移入移出/删除目录（只解除归属，不删除记录）；未分类只显示可移动的记录。
- `GraphView` 是**目录网络**（`directoriesOnly`，v1.2 修正）：每个小球 = 一个用户目录/生活领域，整张网络代表「你」；至少 2 个目录时画中心装饰性「你」节点和 spokes；标签是目录名，小球大小反映内容/连接度。**没有记录节点、没有「记录 / 目录」切换、没有添加/连线工具**；点小球通过 `onOpenDirectory` 进入目录内容页。保留 pan/zoom/pinch、hover 聚焦、沉浸模式；空态「还没有目录」+ 创建目录 CTA。
- `GraphView` 的目录排序/颜色来自 `directories.ts`；网络布局需保持稳定、可解释，不要恢复 note-graph 的节点/边/Node Inspector 语义。
- `SettingsScreen` 的「自动化」包含每日汇总开关、时间（默认 08:00）、立即生成、每日提醒开关与时间（默认 21:00，`mashu.reminders.v1`）与通知权限测试、记录自动收进图谱开关（`mashu.autofile.v1`）与快捷指令提醒说明；设置从「更多」进入。
- `GraphView` 的目录网络交互：拖动/缩放画布、hover 聚焦、点小球进入目录内容页；**没有** 添加/连线/Node Inspector/记录视图切换；沉浸模式隐藏底部导航。
- `CaptureSheet` 渐进披露：一句话 hero、单行解析卡、置信度 <55% 才提示、展开详情用 52px 行、底部固定 52px 保存/取消。
- `SettingsScreen` 用消费级 IA：助手 / 外观 / 数据与隐私 / Apple 健康 / 自动化 / 高级设置 / 关于；技术细节折叠在「高级设置」里；危险操作放最后并二次确认。
- `MochiNode` 是品牌符号，不是装饰插画：保持 1px 细轨道、暖色主节点与 3–4 个卫星点；不要给它加表情或鼠标动画。

## 模块地图与归属

| 位置 | 职责 | 修改注意 |
| --- | --- | --- |
| `src/lib/types.ts` | 数据模型与公共类型（`Note`、`NoteKind`、`NoteMeta`、`NotePosition`、`RecordDraft`、`AgentPersona`…） | 改 `Note` 字段要考虑存储 schema、导入导出与旧数据兼容 |
| `src/lib/kinds.ts` | 记录类型词表：标签、分类色 token、快捷动作、餐次/健康指标/收支分类、`describeMeta`、默认标题 | 新增类型要同时更新 `NOTE_KINDS`、`KIND_INFO` 与 tokens 里的 `--kind-*` |
| `src/lib/links.ts` | 从 Markdown 派生关系：wiki 链接、标签、反向链接、标题索引 | 纯函数；忽略代码块/行内代码 |
| `src/lib/markdown.ts` | markdown-it 配置、wiki 链接预处理、渲染与纯文本工具 | 安全性关键路径：保持 `html: false` |
| `src/lib/insights.ts` | 生活记录统计：日/周汇总、分类支出、健康序列；只统计生活记录，忽略普通笔记 | 纯函数；日期按本地时区算，时间戳取 `meta.occurredAt ?? createdAt` |
| `src/lib/brief.ts` | 今日简报：`buildDailyBrief(notes, now)` 生成 summary / 昨日复盘 / 今日建议 / 4 个趋势 | 纯函数、确定性；对比基准是「昨天之前有记录的最近 7 天」；改规则要补 `tests/brief.test.ts` |
| `src/lib/digest.ts` | 每日汇总：按目录汇总昨天、highlights/suggestions/sourceIds；历史与计划（`mashu.digest.v1` / `mashu.digest.schedule.v1`，最多 14 条，默认 08:00） | 纯函数、确定性；目录顺序按创建时间，未分类最后；改规则要补 `tests/digest.test.ts` |
| `src/lib/knowledge.ts` | 有依据的助手：确定性 CJK-bigram 检索、lookup/stats/reflection/refusal 路由、source ids；语料排除目录/归档/计划 | 纯函数、确定性；无相关记录必须返回固定拒绝文案，不能编造；补 `tests/knowledge.test.ts` |
| `src/lib/directories.ts` | 知识库目录：`isDirectory` / `directoryList` / 颜色 / 成员 / 未分类（`meta.directory` + `dirId`）；自动归档 `suggestDirectoryForNote` 与开关（`mashu.autofile.v1`） | 删除目录只解除成员归属，绝不删除记录；计划/模板不自动归档 |
| `src/lib/modules.ts` | LifeOS 模块清单、`记经历/计划/更多` 等入口与隐藏状态（`mashu.modules.v1`） | 模块隐藏状态是偏好，不是 vault 数据 |
| `src/lib/health.ts` | Apple 健康导入：JSON / CSV / `?health=` URL 载荷解析、单位换算、别名、同日聚合与 `replaceId` 去重 | 纯函数；支持 HealthKit 标识符；改解析/单位要补 `tests/health.test.ts` 样例 |
| `src/lib/agent.ts` | 本地助手：一句话解析、问候、问答与建议、快捷问题 | 纯规则、确定性、不联网；改动要补 `tests/agent.test.ts` 用例 |
| `src/lib/search.ts` | 全文搜索与标题补全 | 纯函数，便于测试 |
| `src/lib/graph.ts` | 目录网络模型与中心「你」/spokes、确定性布局；旧 note-graph 数据仅保留兼容 | 纯函数；`GraphView` 负责目录网络渲染；旧 note-graph 语义不再用于当前图谱 |
| `src/lib/db.ts` | IndexedDB（数据库 `mashu`，schema v2）/ localStorage 适配、旧库（`rixin` / `mochi` / `inkstone`）一次性迁移 | 改数据结构时升级 `DB_VERSION` 并在 upgrade 中就地补字段；旧备份必须仍能导入 |
| `src/lib/store.ts` | `useNotes()` 单一状态源：记录 CRUD、图谱位置、手动连线、flush | 写入路径、防抖、`settleWrites` 与删除级联要谨慎 |
| `src/lib/prefs.ts` | 主题（默认浅色）、引导、助手人设与节点式头像（`mashu.agent.v1`）、安装提示（`mashu.installHint.v1`）、`normalizeNote` / `makeNote` | 只碰 localStorage，失败要静默降级；旧助手名/旧头像 id 要映射到新默认 |
| `src/lib/reminders.ts` | 每日提醒：设置（`mashu.reminders.v1`，默认开、21:00）、到点判断、今日缺失项（计划到期/缺日记/缺支出）、一天一次闸门（`mashu.reminders.lastNotified.v1`）与提醒文案 | 只碰 localStorage，读写要 try/catch 静默降级；`plansDueToday` / `missingToday` / `reminderText` 保持纯函数；**不要假装有后台推送**——提醒仅在应用打开时判定 |
| `src/lib/seed.ts` | 首次运行的演示记录（生活记录 + 笔记）与 5 个模板目录（身体健康/工作/学习/理财/生活），演示记录按类型归入目录 | 模板目录可删可改名，保持小而精，不要伪装成真实数据 |
| `src/lib/exportImport.ts` | JSON（vault v2，`app: 'mashu'`）/ Markdown 导出、JSON 导入（含旧 `rixin` / `mochi` / `inkstone` 备份兼容）、合并 / 替换、`shareOrDownload` | 改格式时同步升 `VAULT_VERSION`，并保证旧版本仍可导入 |
| `src/lib/format.ts` | 相对时间、日期、字节数等展示格式化 | 纯函数 |
| `src/lib/useRoute.ts` | 轻量 hash 路由（`#/today`、`#/records`、`#/plan`、`#/more`、`#/directories`、`#/graph`、`#/agent`、`#/search`、`#/settings`、`#/calendar`、`#/health-sync`、`#/note/:id` 等） | 导航统一用 `navigate` / `replaceRoute`；底部 5 个标签文案在 `TabBar.tsx`（今日/经历/图谱/助手/更多） |
| `src/components/MochiNode.tsx` | 品牌符号：暖色主节点 + 卫星节点 + 细轨道；`breath` 慢呼吸动画 | 一屏最多一次；只读 token 颜色；不加入脸/表情/插画 |
| `src/components/SplashScreen.tsx` | 冷启动品牌 splash：Mochi Node + 麻薯 + 记录每一天 + 进度线 | 不联网、不读记录；由 App 控制 1.6s/450ms 计时；`?nointro=1` 跳过 |
| `src/components/Onboarding.tsx` | 4 屏图谱优先新手导览：跳过/上一步/下一步、直接看图谱、开始记录 | 只在 `mashu.onboarded.v1` 不存在时自动出现；完成时写该键；可从更多重播 |
| `src/components/GraphTeaser.tsx` | 今日图谱 teaser：最多 3 个目录的 mini hub/branch、计数文案、打开图谱/先建目录 | 从 directories.ts 派生；是今日第一视觉锚点，不引入新数据源 |
| `src/components/RecordRow.tsx` | 可复用记录行：类型点 + 标题 + 一行摘要 + 时间 + More；支持搜索 snippet、置顶样式 | Records 与 Search 共用，改字段要同时检查两处 |
| `src/components/GraphView.tsx` | **目录网络**画布（`directoriesOnly`）：小球=目录、中心「你」+ spokes、pan/zoom/pinch、hover、点球进目录、沉浸模式 | 没有记录节点/记录-目录切换/添加-连线工具；`FORCE` 参数在文件顶部 |
| `src/components/FloatingAgent.tsx` | 可拖动悬浮助手：**tap = 助手对话 `#/agent`，长按 ≈650ms = 结构化快速记录 sheet**、位置 `mashu.floatagent.v1` | 只在非图谱/非编辑器路由显示；位置要 clamp 在视口内；手势语义是 1.3 的聊天优先，不要改回 v1.2 的 tap=记录 |
| `src/screens/DirectoryDetailScreen.tsx` | 目录内容页：顶部直接写作面（自动聚焦、保存带 `dirId`）、成员列表、打开记录、删除目录（成员保留） | 图谱小球只是索引；详细内容都在这里写和编辑；不要恢复「记一笔」CTA |
| `src/components/TabBar.tsx` | 66px 底部导航：今日/经历/图谱/助手/更多；等宽英文小字 | 图谱在中间（primary tab）；第五个 tab 是「更多」；设置/目录/计划在更多里 |
| `src/components/CaptureSheet.tsx` | 渐进式快速记录：一句话解析、紧凑卡、展开详情、固定 52px 保存 | 置信度只在 <55% 提示；sheet 高度用 CSS token |
| `src/components/AgentPanel.tsx` | 助手正文流：Mochi Node + 小麻薯 + 本地处理说明、紧凑确认卡、欢迎动作、最新消息追问 | 不要恢复控制台/AGENT-YOU 样式 |
| `src/components/SearchScreen.tsx` | sticky 搜索头、标签 chips、复用 RecordRow、命中高亮、最近编辑、空态 | 空查询才显示最近；无结果给「清除筛选」 |
| `src/screens/` | 页面级组件：`TodayScreen`（安静驾驶舱 + 提醒卡）、`RecordsScreen`（经历时间线）、`CalendarScreen`（周一起始月历 + 内联写作）、`DirectoryScreen`（知识库目录）、`DirectoryDetailScreen`（目录内直接写）、`HealthSyncScreen`（Apple 健康同步中心）、`MoreScreen`（LifeOS 模块/日历/图谱/设置入口）、`EditorScreen`（阅读优先）、`SettingsScreen`（设置 IA，含自动化提醒）；另有 Plan/Profile/Health/Finance/Templates/Archive 等模块页 | 负责布局与交互，数据由上层注入，不直接访问 `db.ts`；日历只写 `occurredAt`/`dueAt`，不新增数据源 |
| `src/styles/` | `tokens.css` 语义 token（浅色暖纸/深色暖炭/分类色/图谱）、`base.css` 基础样式与 iOS 16px 规则、`app.css` 外壳样式 | 新颜色/间距/圆角/动效先加 token；不要写死品牌色；不要写组件私有样式 |
| `tests/` | Vitest 单元测试（274 个用例 / 11 个文件：agent、brief、digest、exportImport、graph、health、insights、knowledge、links、markdown、search） | 文件命名为 `*.test.ts`，不要提交调试用的临时测试文件 |
| `scripts/` | Node/Python 工具脚本（Mochi Node 图标、启动图、SW 预缓存注入、局域网托管、截图、二维码） | 不参与前端构建；`sw-precache.mjs` 必须在 `vite build` 之后运行 |
| `public/` | 静态资源、PWA manifest 与图标、favicon、iPhone 启动图（`splash/`）、`sw.js` | manifest 需与 `index.html` 保持一致；改离线壳资源时同步更新 `sw.js` 的 `CACHE` 版本（当前 `mashu-v1`） |
| `.github/workflows/` | `ci.yml`（typecheck + test + build）、`deploy-pages.yml`（推 main 自动发布 GitHub Pages，维护者无需服务器） | 改构建命令时两个 workflow 都要同步 |

如果你要改的是公共 API（`types.ts` 的接口、组件 props、存储格式、导出信封），请同时在 PR 描述里说明影响范围与迁移方式。

## 测试

- 测试框架是 **Vitest**，配置见 `vitest.config.ts`：`environment: 'node'`，只收集 `tests/**/*.test.ts`。当前共 **274 个用例 / 11 个文件**：`agent`、`brief`、`digest`、`exportImport`、`graph`、`health`、`insights`、`knowledge`、`links`、`markdown`、`search`。
- 测试重点在纯逻辑层。解析、评分、排序、布局、统计、简报、导入合并这类容易出边界的逻辑必须先写测试再实现。
- 简报（`brief.test.ts`）请用固定的 `now` 与固定记录做确定性断言，覆盖：无历史数据、稀疏记录、睡眠/支出/步数/饮水/卡路里的偏差、复盘条数 2–4 与建议 2–3 的边界。
- 健康导入（`health.test.ts`）请覆盖：JSON / CSV / base64url 三种输入；HealthKit 标识符与中英文别名；lb / g / L / 分钟 / 小时换算；同日求和 vs 取最新；已有记录时 `replaceId` 去重；无效输入跳过计数。
- 助手相关改动请用固定 `now`，覆盖：一句话解析、金额/热量/单位抽取、问句不误判为记录、今天/本周小结与空数据。
- 统计相关改动请覆盖：本地时区跨天、`occurredAt` 缺省回退、多种记录混合、收入不计入支出。
- 图谱相关改动请覆盖：目录网络的目录排序/颜色、中心「你」的绘制条件（≥2 目录）、点小球路由到目录内容页、pan/zoom/pinch、空态；不再有记录节点/边/Node Inspector，不要恢复旧 note-graph 测试语义。目录/自动归档的纯函数仍由 `tests/graph.test.ts`、`tests/directories` 相关用例覆盖。
- 日历相关改动请覆盖日期语义：`occurredAt` 决定日记归到哪一天、`dueAt` 决定计划属于哪一天；补写历史日期（选中日中午）与今天（当前时间）都要验证本地时区一致性；周一为一周第一天的月历偏移（`(first.getDay()+6)%7`）与月末补空格要有边界用例。
- 提醒相关改动请覆盖纯判断：`plansDueToday`（未完成、未归档、无 dueAt 视为今天到期、有 dueAt 只算今天结束前）、`missingToday`（日记/支出是否缺席）、`reminderText`（组合顺序与无内容返回 null），以及设置解析的容错降级；`shouldShowReminder` / `markReminderShown` 碰 localStorage，测试时注入假存储或只测纯计算部分，不要把「应用打开时提醒」写成后台推送。
- 知识库相关改动请覆盖：`digest.test.ts`（按目录分组、未分类最后、2–3 highlights/suggestions、sourceIds、14 条历史去重与 schedule 默认/时间）和 `knowledge.test.ts`（检索、lookup/stats/source ids、无依据拒绝、目录/归档/计划排除）。
- 测试里请覆盖：空输入、中文文本、代码块内的「假链接」、大小写与空白差异、旧版备份兼容。
- 不要为了测试引入新的运行时依赖；如果确实需要新测试工具（例如 DOM 测试环境），先在 issue 里讨论。
- UI 交互目前没有自动化测试，修改 UI 时请在 PR 里附上真机/窄屏截图或录屏，并确认浅色 / 深色 / 图谱画布和 `prefers-reduced-motion` 都正常。

## 如何新增一个功能

推荐路径：**先纯逻辑，再组件，最后接线**。

1. **想清楚数据从哪来。** 优先从 `Note.content` 或已有的 `NoteMeta` 派生，不要新增需要手动同步的冗余字段。
2. **写纯逻辑模块。** 在 `src/lib/` 新建 `myFeature.ts`（或扩展已有模块），输入输出都是普通数据，不碰 React 和 DOM。
3. **先写测试。** 在 `tests/myFeature.test.ts` 写失败用例，`npm run test:watch` 看着它变绿。
4. **做组件。** 在 `src/components/` 新建 `MyFeature.tsx` + `MyFeature.css`，道具驱动、具名导出、样式加前缀；触控目标 44px+，适配安全区、浅色/深色、`prefers-reduced-motion`；只用语义 token。
5. **接线。** 在页面级组件或 `App.tsx` 里把 store 的数据和 callback 传进去；需要新增页面时，在 `src/lib/useRoute.ts` 的 `Route` / `parseRoute` / `routeToHash` 中登记路由，并在 `TabBar.tsx` 补导航。需要新增 store 方法时，在 `store.ts` 的 `NotesApi` 里补充并考虑持久化。
6. **考虑存储兼容。** 如果新增持久化字段：升级 `db.ts` 的 `DB_VERSION` 并在 upgrade 中就地补默认值、同步更新 `prefs.ts` 的 `normalizeNote`、必要时升 `VAULT_VERSION` 并写迁移测试；旧版（含更早品牌的）JSON 备份必须仍能导入。
7. **考虑离线壳。** 新增顶层静态资源时确认构建后 `sw-precache.mjs` 会把它写入 `PRECACHE`（`splash/` 由 iOS 直接读取，被有意排除）；手改缓存策略时递增 `sw.js` 的 `CACHE` 版本（当前 `mashu-v1`）。
8. **更新文档与截图。** 用户可见的功能更新 README 功能表/路线图；架构改动更新 `docs/ARCHITECTURE.md`；数据或隐私相关更新 `docs/PRIVACY.md`（尤其是 Apple 健康与导出）；UI 改完跑 `npm run screenshots` 刷新截图（需要先构建并在另一个终端运行 `npm run share`）。

### 常见改动的落点

- **新增记录类型**：`types.ts` 的 `NoteKind` → `kinds.ts` 的 `NOTE_KINDS` / `KIND_INFO` → `tokens.css` 的 `--kind-*` 与图谱节点色 → `normalizeNote` 的 kind 校验 → 列表/筛选/图谱/统计/简报/助手/节点编辑面板。
- **新增简报规则**：`brief.ts` 的规则与阈值 → `tests/brief.test.ts` → 必要时在 `TodayScreen` 复盘/建议区增补展示；保持 deterministic。
- **新增健康别名 / 单位**：`health.ts` 的 `TYPE_ALIASES` / `convertValue` → `tests/health.test.ts` 样例；不要让解析器产生重复记录（同日靠 `replaceId`）。
- **新增节点式头像 / Mochi Node 细节**：`prefs.ts` 的 `AGENT_AVATARS` → `AgentAvatar.tsx` 的 glyph / `MochiNode.tsx` 的主/卫星节点；保持语义 token 颜色，不引入图片资源。
- **新增图谱交互**：`GraphView` 的 props 回调 → `App.tsx` 接线 → `store.ts` 的持久化方法 → `tests/graph.test.ts`；同时手动验证拖拽邻居、pan/zoom 与 inspector。
- **新增目录/图谱目录规则**：`directories.ts`（创建/颜色/成员/未分类）→ `store.assignDirectory` / `archiveNote` → `graph.ts` 目录边/初始分布 → `GraphView` 目录视图/inspector → `tests/graph.test.ts`。
- **新增汇总/知识检索规则**：`digest.ts` / `knowledge.ts` 的纯函数 → `tests/digest.test.ts` / `tests/knowledge.test.ts` → Assistant 消息/来源 chips / 设置自动化。保持 deterministic、无网络、无模型。
- **新增日历/内联写作入口**：`CalendarScreen` 的选中日与 `occurredAt`/`dueAt` → `App.tsx` 的 `onSaveDiary` / `onCreatePlan` → `api.createNote` / `assignDirectory`；目录内容页的直接写作在 `DirectoryDetailScreen` → `App` 的 `onSaveContent`（`createNote` 后 `assignDirectory`）。不要新增日历服务，也不要绕过 `normalizeNote`。
- **调整每日提醒**：`reminders.ts`（`getReminderSettings` / `setReminderSettings` / `plansDueToday` / `missingToday` / `shouldShowReminder` / `markReminderShown` / `reminderText`）→ `SettingsScreen` 自动化区块 → `TodayScreen` 提醒卡；一天一次的闸门键是 `mashu.reminders.lastNotified.v1`，设置键是 `mashu.reminders.v1`；通知权限只是本地申请，不要引入推送服务。
- **调整健康同步中心**：`HealthSyncScreen`（`#/health-sync`，上次导入 `mashu.health.lastSync.v1`）→ `App.tsx` 的 `importHealthText` / `?health=` effect → `health.ts` 纯解析；入口在健康模块与设置 Apple 健康区块。必须保持「PWA 不能读 HealthKit、数据全本地」的说明，不新增网络请求。
- **调整视觉**：只改 `tokens.css` 与组件 CSS，避免在组件里写死颜色/圆角/阴影；浅色、深色与图谱暖色画布三套都要检查。

## 提交信息规范

使用 [Conventional Commits](https://www.conventionalcommits.org/)，主题用英文、祈使句、不超过约 72 字符：

```text
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

常用 `type`：

- `feat` 新功能
- `fix` 修复 bug
- `docs` 文档
- `test` 测试
- `refactor` 重构（不改变行为）
- `perf` 性能优化
- `style` 格式/样式调整（不改变逻辑）
- `chore` 杂项（依赖、工具）
- `ci` CI 配置

`scope` 用模块名，例如 `today`、`records`、`graph`、`agent`、`editor`、`capture`、`settings`、`brand`、`tokens`、`store`、`a11y`、`readme`、`ci`。示例：

```text
feat(graph): inspector actions and link step hints
style(tokens): switch to LifeOS semantic tokens
docs(readme): explain the v1.1 graph-first launch
fix(editor): keep reading mode before first edit
```

一个 PR 尽量只做一件事；逻辑改动和格式化改动分开提交。

## PR 检查清单

提交 PR 前逐项确认：

- [ ] `npm run typecheck` 通过
- [ ] `npm test` 通过（274 个用例；新逻辑有对应测试）
- [ ] `npm run build` 通过（包含 `sw-precache.mjs` 注入）
- [ ] 没有提交 `node_modules/`、`dist/`、`.npm-cache/`、`.npm-logs/`、`.chrome-profile/` 等生成物
- [ ] 没有新增未讨论的运行时依赖
- [ ] 没有引入遥测、分析、运行时网络请求或云端模型调用，也没有引入服务器/账号/云函数（零服务器交付约束）
- [ ] iOS/PWA 改动验证过：Safari 标签页 + 添加到主屏幕、断网重载、安装卡片与首次提示、16px 输入框不被放大、导出到「文件」
- [ ] UI 改动在 375px 宽度下检查过，并在浅色 / 深色 / 图谱画布三种外观下检查过
- [ ] 视觉改动只使用语义 token：没有写死颜色/圆角/阴影；没有渐变光晕、neon、卡通吉祥物或 emoji 装饰；没有回到大卡片墙或大 hero
- [ ] 导航顺序是 今日 / 经历 / **图谱** / 助手 / 更多（图谱在中间）；设置/目录/计划在「更多」；chips 是唯一胶囊；底部导航保持 66px
- [ ] 启动/导览改动验证过：冷启动 splash 约 1.6s（减少动态效果 450ms）、4 屏图谱优先导览只在 `mashu.onboarded.v1` 缺失时出现、跳过/上一步/下一步、直接看图谱、开始记录、更多→新手导览可重播、`?nointro=1` 同时跳过
- [ ] 今日布局保持：hero + 一句话记录 + ≤4 quick chips + GraphTeaser 第一视觉锚点 + 紧凑复盘 + 3 条最近记录；不恢复 指标区/7 日 sparkline/长今日时间线
- [ ] 目录改动验证过：创建/颜色/成员/移入移出/删除只解除归属；目录笔记随备份导入导出
- [ ] 直接写作验证过：目录内容页 textarea 自动聚焦、保存后记录带 `dirId` 出现在目录与图谱、⌘/Ctrl+Enter 可保存、新建目录直接进入、新建计划直接打开编辑器；没有残留「记一笔」CTA
- [ ] 图谱改动验证过：目录网络（小球=目录、中心「你」、点小球进目录内容页）、无记录节点/记录-目录切换/添加-连线工具、空态创建目录
- [ ] 日历验证过：周一起始的月视图、记录圆点、上/下月与「今」、任意一天可写、日记存 `occurredAt`（可选目录）、计划存 `dueAt`、当天列表打开编辑器、今日 header 与「更多 → 日历」入口
- [ ] 提醒验证过：默认开启 21:00（`mashu.reminders.v1`）、到点后今日卡（到期计划/缺日记/缺支出）、写日记/日历/关闭动作、`mashu.reminders.lastNotified.v1` 一天一次、通知权限测试；界面文案诚实说明「只在应用打开时提醒」
- [ ] 浮动助手验证过：拖动/位置持久化、**tap 打开助手对话**、**长按打开结构化记录 sheet**、图谱/编辑器隐藏、persona 头像名
- [ ] 自动整理验证过：按类型/内容/目录名匹配、显式目录优先、计划/模板排除、toast 去向、设置开关 `mashu.autofile.v1`
- [ ] 每日汇总验证过：按目录分组、未分类最后、历史最多 14 条、默认开启 08:00、开关/改时间/立即生成、source chips
- [ ] 有依据的助手验证过：lookup 引用真实记录、统计「依据 N 条记录」、无依据固定拒绝文案、来源 chips 打开本地记录、capture/help 不变
- [ ] 编辑器改动验证过：默认阅读态、编辑态工具栏、More 操作、连接到/来自
- [ ] 快速记录改动验证过：紧凑解析卡、置信度 <55% 才提示、展开详情 52px 行、固定 52px 保存
- [ ] 空状态保持「一个目标 + 一个 CTA」，文案平静
- [ ] 吉祥物已彻底移除；品牌只使用 Mochi Node
- [ ] Apple 健康相关改动验证过：JSON/CSV/URL 三种入口、单位换算、同日去重；同步中心显示上次导入 `mashu.health.lastSync.v1`、可复制 `?health=`、文件导入；文案明确 PWA 不能读 HealthKit、直连需原生壳 + 开发者账号；测试数据使用脱敏样例
- [ ] 涉及存储格式的改动：版本号、迁移（含更早品牌的旧库/旧键）、旧备份导入与 `normalizeNote` 都已覆盖
- [ ] 涉及离线壳/静态资源的改动，已确认 `sw-precache.mjs` 或 `CACHE` 版本正确
- [ ] 新增/变更的用户可见文案是中文，清楚、当前品牌名只有「麻薯」
- [ ] 相关文档（README / ARCHITECTURE / PRIVACY）已同步
- [ ] PR 描述写清「改了什么、为什么、怎么验证的」，UI 改动附截图
- [ ] 提交信息符合 Conventional Commits

## Issue 与沟通

- 提 bug 前先搜索已有 issue；请附上浏览器/系统版本、复现步骤、期望行为，以及**当前使用的存储方式**（IndexedDB 还是 localStorage 回退，「设置 → 高级设置」可见）。
- **不要在公开 issue 里粘贴真实生活记录、Apple 健康导出或完整备份文件**——收支、体重、睡眠、心率等信息很私人。需要提供数据时请使用演示记录或自行脱敏的样例 JSON/CSV。
- 新功能建议先开 issue 讨论范围，避免写完 PR 才发现方向不一致。特别大的改动（同步、插件系统、存储格式、Apple Health 直连方案、视觉体系）请先达成共识。
- 安全或隐私问题请不要公开提交 issue，先通过维护者的 GitHub 主页联系方式私下沟通。
- Review 时对事不对人；维护者可能会为了保持项目精简而拒绝某些功能，这不代表你的贡献没有价值。

## 许可证

贡献的代码会以 [MIT](LICENSE) 协议发布。提交 PR 即表示你同意在该协议下分发你的贡献。
