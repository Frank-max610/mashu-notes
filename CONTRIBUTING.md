# 贡献指南

感谢你愿意为 Mochi（麻薯）出一份力。这是一个小而专注的项目，我们更看重「把核心体验做对、做得软乎乎」，而不是堆功能。请先花几分钟读完这份指南。

## 开发环境

- **Node.js 22 LTS 或更新**（Vitest 5 需要 Node 22.12+；Vite 8 最低支持 Node 20.19，CI 固定使用 Node 22）
- npm 10+
- 可选：Python 3 + Pillow（只有重新生成 PWA 图标时需要，`npm run icons`）
- 可选：本机 Chrome / Chromium（只有重新生成 README 截图时需要，`npm run screenshots`；可用 `CHROME_PATH` 指定路径）
- 任意现代浏览器；调试移动端体验时推荐用真机 + 局域网访问（见下文）

```bash
# fork 并 clone 之后
npm install
npm run dev        # http://localhost:5173
```

`npm run dev` 默认带 `--host`，同一 Wi-Fi 下的手机可以通过 `http://<电脑局域网 IP>:5173` 打开开发版，方便调试真机上的触控和键盘行为。

`npm run share` 托管的是 `dist/`，所以要先跑一次 `npm run build`；端口被占用时可以 `npm run share -- --port 4174`。注意通过 HTTP 局域网地址访问时 Service Worker 不会注册（浏览器要求安全上下文），离线能力需要在 HTTPS 或 localhost 下验证。

常用脚本：

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动 Vite 开发服务器（HMR） |
| `npm run build` | 类型检查 + 生产构建到 `dist/` |
| `npm run preview` | 预览 `dist/`（http://localhost:4173） |
| `npm run share` | 构建后局域网托管 `dist/`，打印地址与二维码，便于手机实机测试 |
| `npm run typecheck` | 只跑 `tsc --noEmit` |
| `npm test` | 运行一次 Vitest（当前 95 个用例） |
| `npm run test:watch` | Vitest watch 模式 |
| `npm run icons` | 重新生成 `public/icons/` 下的 PWA 图标（需要 Python 3 + Pillow） |
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

- 不要用 `any` 绕过类型检查；外部输入用 `unknown`，再逐步收窄（参考 `src/lib/exportImport.ts` 的 `coerceNote`）。
- 公共 API（`src/lib/*` 的导出函数、组件 props）写明确的类型，而不是靠推断。
- 纯逻辑模块（`links`、`markdown`、`search`、`graph`）必须保持**同步、无 DOM、无副作用**，这样它们能在 Node 环境里直接被 Vitest 测试。
- 会触碰浏览器 API 的模块（`db`、`store`、`prefs`、`exportImport`）要尽量薄：把可测试的逻辑拆出去，把 I/O 留在这几层。
- 优先使用 `catch {}`（不带绑定）或显式类型收窄，不要默认错误一定是 `Error`。

## 代码风格

没有 ESLint / Prettier 自动格式化，靠约定和 review 保持一致。请模仿现有代码：

- **2 空格缩进**，单个文件不要混用 tab。
- **单引号**、**语句末尾分号**、对象/数组尾逗号。
- 注释和 JSDoc 用**英文**；所有面向用户的字符串用**中文**（项目主语言是中文；未来会做 i18n）。
- 命名：文件用 camelCase（`exportImport.ts`）或 PascalCase（`Mascot.tsx`）；变量/函数 camelCase；类型/组件 PascalCase；常量 UPPER_SNAKE_CASE。
- 优先**具名导出**（`export function Mascot`）；目前只有入口组件 `App.tsx` 使用默认导出（供 `main.tsx` 挂载）。
- 纯函数放在 `src/lib`，UI 组件放在 `src/components`，页面级组合放在 `src/screens`。
- 样式统一手写 CSS + `src/styles/tokens.css` 里的设计变量（颜色、间距、圆角、时长、缓动），不要硬编码颜色或魔法数字。组件样式文件与组件同名（`GraphView.css`），类名加组件前缀（`.graph-view__node`）。
- **视觉约定**：默认草莓牛奶浅色主题（`:root`），芋泥夜深色主题挂在 `:root[data-theme='dark']`；圆角优先用 `--radius-*` 药丸值，动效优先用 `--ease-bounce`，但必须尊重 `prefers-reduced-motion`。吉祥物与装饰（麻薯、爱心）一律用内联 SVG / CSS 实现，不引入图片或网络字体。
- 文案可以软萌，但要**清楚、可操作**：按钮写清动作（「捏一颗新麻薯」），错误提示写清下一步（「请导出备份」），不要只卖萌。
- 保持运行时依赖精简：目前只有 `react`、`react-dom`、`markdown-it`。新增运行时依赖需要先在 issue 里讨论。
- **不允许**引入遥测、分析、CDN 字体/脚本或任何运行时网络请求——隐私是项目的核心承诺。

## 模块地图与归属

| 位置 | 职责 | 修改注意 |
| --- | --- | --- |
| `src/lib/types.ts` | 数据模型与公共类型（`Note`、`NoteSummary`、`Backlink`、`ThemeMode`…） | 改 `Note` 字段要考虑导入导出与旧数据兼容 |
| `src/lib/links.ts` | 从 Markdown 派生关系：wiki 链接、标签、反向链接、标题索引 | 纯函数；忽略代码块/行内代码 |
| `src/lib/markdown.ts` | markdown-it 配置、wiki 链接预处理、渲染与纯文本工具 | 安全性关键路径：保持 `html: false` |
| `src/lib/search.ts` | 全文搜索与标题补全 | 纯函数，便于测试 |
| `src/lib/graph.ts` | 图谱构建与力导向布局 | 纯函数，布局需确定性（不依赖随机） |
| `src/lib/db.ts` | IndexedDB（`mochi`）/ localStorage 适配 | 数据模型或版本变化时同步升级 `DB_VERSION`；旧备份必须仍能导入 |
| `src/lib/store.ts` | `useNotes()` 单一状态源 | 写入路径、防抖、flush 逻辑改动要谨慎 |
| `src/lib/prefs.ts` | 主题（`mochi.theme.v1`）、引导标记（`mochi.onboarded.v1`）、`makeId` / `makeNote` | 只碰 localStorage，失败要静默降级 |
| `src/lib/seed.ts` | 首次运行的演示笔记 | 保持小而精，不要伪装成真实知识库 |
| `src/lib/exportImport.ts` | JSON / Markdown 导出、JSON 导入（含旧备份兼容）、合并 / 替换 | 格式变更需兼容旧版本文件 |
| `src/lib/format.ts` | 相对时间、日期、字节数等展示格式化 | 纯函数 |
| `src/lib/useRoute.ts` | 轻量 hash 路由（`#/notes`、`#/note/:id`、`#/graph`、`#/search`、`#/settings`） | 导航统一用 `navigate` / `replaceRoute`，不要手写 `location.hash`；底部标签文案在 `TabBar.tsx` |
| `src/components/` | 可复用 UI 组件（含 `Mascot.tsx` 麻薯吉祥物、`HeartBurst.tsx` 新建笔记的爱心迸发） | 通过 props / callback 拿数据，不直接访问 `db.ts`；吉祥物变体集中在 `Mascot.tsx` |
| `src/screens/` | 页面级组件（笔记列表、编辑器、我的） | 负责布局与交互，数据由上层注入，不直接访问 `db.ts` |
| `src/styles/` | `tokens.css` 设计变量、`base.css` 基础样式、`app.css` 应用外壳样式 | 新颜色/圆角/动效先加 token；不要在这里写组件私有样式 |
| `tests/` | Vitest 单元测试（当前 95 个用例） | 文件命名为 `*.test.ts`，不要提交调试用的临时测试文件（CI 会执行 `tests/` 下所有测试） |
| `scripts/` | Node/Python 工具脚本（图标、局域网托管、截图、二维码） | 不参与前端构建，不引入浏览器运行时依赖 |
| `public/` | 静态资源、PWA manifest 与图标、`sw.js` | manifest 需与 `index.html` 保持一致；改动离线壳资源时同步更新 `sw.js` 的 `PRECACHE` 与 `CACHE` 版本（当前 `mochi-v1`） |
| `.github/workflows/` | `ci.yml`（typecheck + test + build）、`deploy-pages.yml`（推 main 自动发布 GitHub Pages） | 改构建命令时两个 workflow 都要同步 |

如果你要改的是公共 API（`types.ts` 的接口、组件 props），请同时在 PR 描述里说明影响范围。

## 测试

- 测试框架是 **Vitest**，配置见 `vitest.config.ts`：`environment: 'node'`，只收集 `tests/**/*.test.ts`。当前共 **95 个用例**（`links`、`markdown`、`search`、`graph`、`exportImport`）。
- 目前测试重点在纯逻辑层。这类逻辑必须先写测试再实现，尤其是解析、排序、评分、布局、导入合并这类容易出边界问题的函数。
- 测试里请覆盖：空输入、中文文本、代码块内的「假链接」、大小写与空白差异、边界长度、旧版备份兼容。
- 不要为了测试引入新的运行时依赖；如果确实需要新测试工具（例如 DOM 测试环境），先在 issue 里讨论。
- UI 交互目前没有自动化测试，修改 UI 时请在 PR 里附上真机/窄屏截图或录屏，并确认浅色（草莓牛奶）与深色（芋泥夜）都好看。

## 如何新增一个功能

推荐路径：**先纯逻辑，再组件，最后接线**。

1. **想清楚数据从哪来。** 优先从 `Note.content` 派生，不要新增需要同步维护的冗余字段。关系型数据（链接、标签、搜索、图谱）都应该是 Markdown 的纯函数。
2. **写纯逻辑模块。** 在 `src/lib/` 新建 `myFeature.ts`（或扩展已有模块），输入输出都是普通数据，不碰 React 和 DOM。
3. **先写测试。** 在 `tests/myFeature.test.ts` 写失败用例，`npm run test:watch` 看着它变绿。
4. **做组件。** 在 `src/components/` 新建 `MyFeature.tsx` + `MyFeature.css`，道具驱动、具名导出、样式加前缀；触控目标不小于 40px（底部导航与主按钮 44px+），适配安全区、草莓牛奶 / 芋泥夜两套主题和 `prefers-reduced-motion`。
5. **接线。** 在页面级组件或 `App.tsx` 里把 store 的数据和 callback 传进去；需要新增页面时，在 `src/lib/useRoute.ts` 的 `Route` / `parseRoute` / `routeToHash` 中登记路由，并在 `TabBar.tsx` 补导航。需要新增 store 方法时，在 `store.ts` 的 `NotesApi` 里补充并考虑持久化。
6. **考虑离线壳。** 如果新增了需要离线可用的顶层静态资源（图标、manifest、入口 HTML 等），同步更新 `public/sw.js` 的 `PRECACHE` 列表并把 `CACHE` 版本号加一，否则老用户可能一直命中旧缓存。
7. **更新文档。** 用户可见的功能更新 README 功能表/路线图；架构层面的改动更新 `docs/ARCHITECTURE.md`；涉及数据或隐私的改动更新 `docs/PRIVACY.md`；改完 UI 记得跑 `npm run screenshots` 刷新截图（需要先构建并在另一个终端运行 `npm run share`）。

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

`scope` 用模块名，例如 `links`、`markdown`、`store`、`graph`、`search`、`mascot`、`a11y`、`readme`、`ci`。示例：

```text
feat(mascot): add sleepy variants for empty states
fix(store): flush pending edits when the page is hidden
test(links): ignore wiki links inside fenced code blocks
docs(readme): document the HTTP-on-LAN caveat
ci: cache npm downloads in the workflow
```

一个 PR 尽量只做一件事；逻辑改动和格式化改动分开提交。

## PR 检查清单

提交 PR 前逐项确认：

- [ ] `npm run typecheck` 通过
- [ ] `npm test` 通过（新逻辑有对应测试）
- [ ] `npm run build` 通过
- [ ] 没有提交 `node_modules/`、`dist/`、`.npm-cache/`、`.npm-logs/`、`.chrome-profile/` 等生成物
- [ ] 没有新增未讨论的运行时依赖
- [ ] 没有引入任何遥测、分析或运行时网络请求
- [ ] UI 改动在 375px 宽度下检查过，并在草莓牛奶 / 芋泥夜两种主题下检查过
- [ ] 交互改动在手机（或 DevTools 移动模拟 + 真机局域网）上验证过，且尊重 `prefers-reduced-motion`
- [ ] 涉及离线壳/静态资源的改动，已更新 `sw.js` 的缓存列表与版本
- [ ] 新增/变更的用户可见文案是中文，软萌但清楚
- [ ] 相关文档（README / ARCHITECTURE / PRIVACY）已同步
- [ ] PR 描述写清「改了什么、为什么、怎么验证的」，UI 改动附截图
- [ ] 提交信息符合 Conventional Commits

## Issue 与沟通

- 提 bug 前先搜索已有 issue；请附上浏览器/系统版本、复现步骤、期望行为，以及**当前使用的存储方式**（IndexedDB 还是 localStorage 回退，「我的」页可见）。
- **不要在公开 issue 里粘贴真实笔记内容或完整备份文件**。需要提供数据时请自行脱敏或使用演示笔记。
- 新功能建议先开 issue 讨论范围，避免写完 PR 才发现方向不一致。特别大的改动（同步、插件系统、存储格式、视觉体系）请先达成共识。
- 安全或隐私问题请不要公开提交 issue，先通过维护者的 GitHub 主页联系方式私下沟通。
- Review 时对事不对人；维护者可能会为了保持项目精简而拒绝某些功能，这不代表你的贡献没有价值。

## 许可证

贡献的代码会以 [MIT](LICENSE) 协议发布。提交 PR 即表示你同意在该协议下分发你的贡献。
