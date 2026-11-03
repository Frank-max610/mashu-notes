# 贡献指南

感谢你愿意为日新（Rixin）出一份力。这是一个小而专注的项目：记录生活、每天复盘、把数据留在自己手里。我们更看重「安静好用、每天愿意打开」而不是堆功能，请先花几分钟读完这份指南。

## 命名约定

- **面向用户的名称统一用「日新」**（英文 Rixin）：界面文案、README、截图 alt 文本、错误提示都写「日新」。
- **机器名统一用 `rixin`**：仓库/包名 `rixin-notes`、数据库 `rixin`、localStorage 键 `rixin.*`、Service Worker 缓存 `rixin-v1`。
- 更早版本使用过不同的内部代号和数据库名（如 `mochi` / `inkstone`）。它们**只允许出现在迁移代码、兼容说明和旧备份导入逻辑里**；新的代码与文案不要再使用旧名称，也不要把旧存储键当作新功能的一部分。
- 仓库计划更名为 `rixin-notes`；引用仓库地址时使用 <https://github.com/Frank-max610/rixin-notes>，等改名完成后确认链接可访问。

## iOS / PWA 交付（零服务器）

最终交付形态是**静态站点**，不是服务器应用：

- `npm run build` 先做类型检查与 Vite 构建，再运行 `scripts/sw-precache.mjs` 把带 hash 的构建产物注入 `dist/sw.js` 的 `PRECACHE`。推送到 `main` 后由 `.github/workflows/deploy-pages.yml` 自动发布到 GitHub Pages。GitHub 只是免费的静态托管：维护者不需要 VPS、数据库、后台进程或密钥，也不做任何服务器运维。
- 用户路径是 Safari 打开 HTTPS 地址 → 分享 → 添加到主屏幕；首次加载后 Service Worker（缓存名 `rixin-v1`）让应用离线可用。联网时重新打开主屏幕图标会拿到新版本（导航请求 network-first），没有更新弹窗或应用商店审核。
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
| `npm test` | 运行一次 Vitest（当前 202 个用例 / 9 个文件） |
| `npm run test:watch` | Vitest watch 模式 |
| `npm run icons` | 重新生成 `public/icons/` 下的朱砂印章图标（需要 Python 3 + Pillow） |
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
- 样式统一手写 CSS + `src/styles/tokens.css` 里的设计变量，不要硬编码颜色或魔法数字。组件样式文件与组件同名（`GraphView.css`），类名加组件前缀。
- **视觉约定（编辑设计）**：纸色底 + 墨色字 + **朱砂强调色 `#a63d33`**；标题用 `--font-display`（宋体），元信息/编号用 `--font-mono`；1px 细线（hairline）、小圆角（3–10px）、扁平导航。**不要**引入糖果色、粉紫渐变、爱心、彩带、贴纸或 emoji 装饰。图谱是例外：独立的**始终深色仪表盘**，只从 `--graph-*` token 取色（青/琥珀/青绿/紫/石板灰），28px 网格、1px 边、等宽标签。
- 文案克制、准确、可操作：按钮写清动作（「记一笔」「保存记录」），错误提示写清下一步（「请导出备份」），不要卖萌或制造焦虑。
- 触控目标不小于 40px（主要按钮与底部导航 44px+），适配安全区；尊重 `prefers-reduced-motion`；正文与控件对比度至少 WCAG AA。
- 保持运行时依赖精简：目前只有 `react`、`react-dom`、`markdown-it`。新增运行时依赖需要先在 issue 里讨论。
- **不允许**引入遥测、分析、CDN 字体/脚本或任何运行时网络请求；助手、简报不允许接入云端模型——隐私是项目的核心承诺。

## 模块地图与归属

| 位置 | 职责 | 修改注意 |
| --- | --- | --- |
| `src/lib/types.ts` | 数据模型与公共类型（`Note`、`NoteKind`、`NoteMeta`、`NotePosition`、`RecordDraft`、`AgentPersona`…） | 改 `Note` 字段要考虑存储 schema、导入导出与旧数据兼容 |
| `src/lib/kinds.ts` | 记录类型词表：标签、颜色变量、快捷动作、餐次/健康指标/收支分类、`describeMeta`、默认标题 | 新增类型要同时更新 `NOTE_KINDS`、`KIND_INFO` 与 tokens 里的 `--kind-*` |
| `src/lib/links.ts` | 从 Markdown 派生关系：wiki 链接、标签、反向链接、标题索引 | 纯函数；忽略代码块/行内代码 |
| `src/lib/markdown.ts` | markdown-it 配置、wiki 链接预处理、渲染与纯文本工具 | 安全性关键路径：保持 `html: false` |
| `src/lib/insights.ts` | 生活记录统计：日/周汇总、分类支出、健康序列；只统计生活记录，忽略普通笔记 | 纯函数；日期按本地时区算，时间戳取 `meta.occurredAt ?? createdAt` |
| `src/lib/brief.ts` | 今日简报：`buildDailyBrief(notes, now)` 生成 summary / 昨日复盘 / 今日改进 / 4 个趋势卡 | 纯函数、确定性；对比基准是「昨天之前有记录的最近 7 天」；改规则要补 `tests/brief.test.ts` |
| `src/lib/health.ts` | Apple 健康导入：JSON / CSV / `?health=` URL 载荷解析、单位换算、别名、同日聚合与 `replaceId` 去重 | 纯函数；支持 HealthKit 标识符；改解析/单位要补 `tests/health.test.ts` 样例 |
| `src/lib/agent.ts` | 本地助手：一句话解析、问候、问答与建议、快捷问题 | 纯规则、确定性、不联网；改动要补 `tests/agent.test.ts` 用例 |
| `src/lib/search.ts` | 全文搜索与标题补全 | 纯函数，便于测试 |
| `src/lib/graph.ts` | 图谱构建（wiki / 手动 / 同日边、幽灵节点）与力导向布局 | 纯函数，布局需确定性（不依赖随机）；保存位置要归一化 0..1 |
| `src/lib/db.ts` | IndexedDB（数据库 `rixin`，schema v2）/ localStorage 适配、旧库（`mochi` / `inkstone`）一次性迁移 | 改数据结构时升级 `DB_VERSION` 并在 upgrade 中就地补字段；旧备份必须仍能导入 |
| `src/lib/store.ts` | `useNotes()` 单一状态源：记录 CRUD、图谱位置、手动连线、flush | 写入路径、防抖、`settleWrites` 与删除级联要谨慎 |
| `src/lib/prefs.ts` | 主题、引导、助手人设与印记（`rixin.agent.v1`）、安装提示（`rixin.installHint.v1`）、`normalizeNote` / `makeNote` | 只碰 localStorage，失败要静默降级；旧助手名/旧头像 id 要映射到新默认 |
| `src/lib/seed.ts` | 首次运行的演示记录（生活记录 + 笔记） | 保持小而精，不要伪装成真实数据 |
| `src/lib/exportImport.ts` | JSON（vault v2，`app: 'rixin'`）/ Markdown 导出、JSON 导入（含旧 `mochi` / `inkstone` 备份兼容）、合并 / 替换、`shareOrDownload` | 改格式时同步升 `VAULT_VERSION`，并保证旧版本仍可导入 |
| `src/lib/format.ts` | 相对时间、日期、字节数等展示格式化 | 纯函数 |
| `src/lib/useRoute.ts` | 轻量 hash 路由（`#/today`、`#/records`、`#/graph`、`#/agent`、`#/search`、`#/settings`、`#/note/:id`） | 导航统一用 `navigate` / `replaceRoute`；底部 5 个标签文案在 `TabBar.tsx` |
| `src/components/` | 可复用 UI：BrandSeal、Sparkline、TabBar（扁平 5 标签导航，今日使用 sun 图标）、GraphView（深色仪表盘）、CaptureSheet、AgentPanel、AgentAvatar（8 种印记）、NodeEditorSheet、IosInstallCard 等 | 通过 props / callback 拿数据，不直接访问 `db.ts`；图谱触点较多，改交互要测触摸与鼠标 |
| `src/screens/` | 页面级组件：TodayScreen（今日）、RecordsScreen（记录）、EditorScreen、SettingsScreen（我的/Apple 健康/安装卡片） | 负责布局与交互，数据由上层注入，不直接访问 `db.ts` |
| `src/styles/` | `tokens.css` 设计变量（纸墨、朱砂、宋体/等宽、`--graph-*`）、`base.css` 基础样式与 iOS 16px 规则、`app.css` 外壳样式 | 新颜色/圆角/动效先加 token；不要写糖果色；不要在这里写组件私有样式 |
| `tests/` | Vitest 单元测试（202 个用例 / 9 个文件：agent、brief、exportImport、graph、health、insights、links、markdown、search） | 文件命名为 `*.test.ts`，不要提交调试用的临时测试文件 |
| `scripts/` | Node/Python 工具脚本（图标、启动图、SW 预缓存注入、局域网托管、截图、二维码） | 不参与前端构建；`sw-precache.mjs` 必须在 `vite build` 之后运行 |
| `public/` | 静态资源、PWA manifest 与图标、iPhone 启动图（`splash/`）、`sw.js` | manifest 需与 `index.html` 保持一致；改离线壳资源时同步更新 `sw.js` 的 `CACHE` 版本（当前 `rixin-v1`） |
| `.github/workflows/` | `ci.yml`（typecheck + test + build）、`deploy-pages.yml`（推 main 自动发布 GitHub Pages，维护者无需服务器） | 改构建命令时两个 workflow 都要同步 |

如果你要改的是公共 API（`types.ts` 的接口、组件 props、存储格式、导出信封），请同时在 PR 描述里说明影响范围与迁移方式。

## 测试

- 测试框架是 **Vitest**，配置见 `vitest.config.ts`：`environment: 'node'`，只收集 `tests/**/*.test.ts`。当前共 **202 个用例 / 9 个文件**：`agent`、`brief`、`exportImport`、`graph`、`health`、`insights`、`links`、`markdown`、`search`。
- 测试重点在纯逻辑层。解析、评分、排序、布局、统计、简报、导入合并这类容易出边界的逻辑必须先写测试再实现。
- 简报（`brief.test.ts`）请用固定的 `now` 与固定记录做确定性断言，覆盖：无历史数据、稀疏记录、睡眠/支出/步数/饮水/卡路里的偏差、复盘条数 2–4 与建议 2–3 的边界。
- 健康导入（`health.test.ts`）请覆盖：JSON / CSV / base64url 三种输入；HealthKit 标识符与中英文别名；lb / g / L / 分钟 / 小时换算；同日求和 vs 取最新；已有记录时 `replaceId` 去重；无效输入跳过计数。
- 助手相关改动请用固定 `now`，覆盖：一句话解析、金额/热量/单位抽取、问句不误判为记录、今天/本周小结与空数据。
- 统计相关改动请覆盖：本地时区跨天、`occurredAt` 缺省回退、多种记录混合、收入不计入支出。
- 图谱相关改动请覆盖：wiki / 手动 / 同日三种边、去重优先级、幽灵节点、保存位置与固定节点布局。
- 测试里请覆盖：空输入、中文文本、代码块内的「假链接」、大小写与空白差异、旧版备份兼容。
- 不要为了测试引入新的运行时依赖；如果确实需要新测试工具（例如 DOM 测试环境），先在 issue 里讨论。
- UI 交互目前没有自动化测试，修改 UI 时请在 PR 里附上真机/窄屏截图或录屏，并确认浅色 / 深色 / 图谱仪表盘都正常。

## 如何新增一个功能

推荐路径：**先纯逻辑，再组件，最后接线**。

1. **想清楚数据从哪来。** 优先从 `Note.content` 或已有的 `NoteMeta` 派生，不要新增需要手动同步的冗余字段。
2. **写纯逻辑模块。** 在 `src/lib/` 新建 `myFeature.ts`（或扩展已有模块），输入输出都是普通数据，不碰 React 和 DOM。
3. **先写测试。** 在 `tests/myFeature.test.ts` 写失败用例，`npm run test:watch` 看着它变绿。
4. **做组件。** 在 `src/components/` 新建 `MyFeature.tsx` + `MyFeature.css`，道具驱动、具名导出、样式加前缀；触控目标 40px+，适配安全区、浅色/深色、`prefers-reduced-motion`；只用 tokens 里的颜色与圆角。
5. **接线。** 在页面级组件或 `App.tsx` 里把 store 的数据和 callback 传进去；需要新增页面时，在 `src/lib/useRoute.ts` 的 `Route` / `parseRoute` / `routeToHash` 中登记路由，并在 `TabBar.tsx` 补导航。需要新增 store 方法时，在 `store.ts` 的 `NotesApi` 里补充并考虑持久化。
6. **考虑存储兼容。** 如果新增持久化字段：升级 `db.ts` 的 `DB_VERSION` 并在 upgrade 中就地补默认值、同步更新 `prefs.ts` 的 `normalizeNote`、必要时升 `VAULT_VERSION` 并写迁移测试；旧的 JSON 备份必须仍能导入。
7. **考虑离线壳。** 新增顶层静态资源时确认构建后 `sw-precache.mjs` 会把它写入 `PRECACHE`（`splash/` 由 iOS 直接读取，被有意排除）；手改缓存策略时递增 `sw.js` 的 `CACHE` 版本（当前 `rixin-v1`）。
8. **更新文档与截图。** 用户可见的功能更新 README 功能表/路线图；架构改动更新 `docs/ARCHITECTURE.md`；数据或隐私相关更新 `docs/PRIVACY.md`（尤其是 Apple 健康与导出）；UI 改完跑 `npm run screenshots` 刷新截图（需要先构建并在另一个终端运行 `npm run share`）。

### 常见改动的落点

- **新增记录类型**：`types.ts` 的 `NoteKind` → `kinds.ts` 的 `NOTE_KINDS` / `KIND_INFO` → `tokens.css` 的 `--kind-*` 与图谱 `--graph-node-*` → `normalizeNote` 的 kind 校验 → 列表/筛选/图谱/统计/简报/助手/节点编辑面板。
- **新增简报规则**：`brief.ts` 的规则与阈值 → `tests/brief.test.ts` → 必要时在 `TodayScreen` 增补展示；保持 deterministic。
- **新增健康别名 / 单位**：`health.ts` 的 `TYPE_ALIASES` / `convertValue` → `tests/health.test.ts` 样例；不要让解析器产生重复记录（同日靠 `replaceId`）。
- **新增印记头像**：`prefs.ts` 的 `AGENT_AVATARS` → `AgentAvatar.tsx` 的 sigil 绘制；保持 24px 网格、1.5px 线条、无糖果色。
- **新增图谱交互**：`GraphView` 的 props 回调 → `App.tsx` 接线 → `store.ts` 的持久化方法 → `tests/graph.test.ts`。
- **调整视觉**：只改 `tokens.css` 与组件 CSS，避免在组件里写死颜色；纸墨主题、深色主题与图谱仪表盘三套都要检查。

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

`scope` 用模块名，例如 `brief`、`health`、`today`、`records`、`graph`、`agent`、`sigil`、`design`、`store`、`a11y`、`readme`、`ci`。示例：

```text
feat(brief): compare yesterday with the trailing 7 logged days
feat(health): dedupe same-day metrics with replaceId
test(brief): cover empty history and sparse weeks
style(tokens): drop the last candy gradients
docs(readme): explain the Rixin name and Apple Health limits
```

一个 PR 尽量只做一件事；逻辑改动和格式化改动分开提交。

## PR 检查清单

提交 PR 前逐项确认：

- [ ] `npm run typecheck` 通过
- [ ] `npm test` 通过（202 个用例；新逻辑有对应测试）
- [ ] `npm run build` 通过（包含 `sw-precache.mjs` 注入）
- [ ] 没有提交 `node_modules/`、`dist/`、`.npm-cache/`、`.npm-logs/`、`.chrome-profile/` 等生成物
- [ ] 没有新增未讨论的运行时依赖
- [ ] 没有引入遥测、分析、运行时网络请求或云端模型调用，也没有引入服务器/账号/云函数（零服务器交付约束）
- [ ] iOS/PWA 改动验证过：Safari 标签页 + 添加到主屏幕、断网重载、安装卡片与首次提示、16px 输入框不被放大、导出到「文件」
- [ ] UI 改动在 375px 宽度下检查过，并在浅色 / 深色 / 图谱仪表盘三种外观下检查过
- [ ] 视觉改动只改 token / 组件 CSS，没有引入糖果色、粉紫渐变、emoji 装饰或大圆角
- [ ] Apple 健康相关改动验证过：JSON/CSV/URL 三种入口、单位换算、同日去重；测试数据使用脱敏样例
- [ ] 涉及存储格式的改动：版本号、迁移、旧备份导入与 `normalizeNote` 都已覆盖
- [ ] 涉及离线壳/静态资源的改动，已确认 `sw-precache.mjs` 或 `CACHE` 版本正确
- [ ] 新增/变更的用户可见文案是中文，安静、清楚、不含旧产品名
- [ ] 相关文档（README / ARCHITECTURE / PRIVACY）已同步
- [ ] PR 描述写清「改了什么、为什么、怎么验证的」，UI 改动附截图
- [ ] 提交信息符合 Conventional Commits

## Issue 与沟通

- 提 bug 前先搜索已有 issue；请附上浏览器/系统版本、复现步骤、期望行为，以及**当前使用的存储方式**（IndexedDB 还是 localStorage 回退，「我的」页可见）。
- **不要在公开 issue 里粘贴真实生活记录、Apple 健康导出或完整备份文件**——收支、体重、睡眠、心率等信息很私人。需要提供数据时请使用演示记录或自行脱敏的样例 JSON/CSV。
- 新功能建议先开 issue 讨论范围，避免写完 PR 才发现方向不一致。特别大的改动（同步、插件系统、存储格式、Apple Health 直连方案）请先达成共识。
- 安全或隐私问题请不要公开提交 issue，先通过维护者的 GitHub 主页联系方式私下沟通。
- Review 时对事不对人；维护者可能会为了保持项目精简而拒绝某些功能，这不代表你的贡献没有价值。

## 许可证

贡献的代码会以 [MIT](LICENSE) 协议发布。提交 PR 即表示你同意在该协议下分发你的贡献。
