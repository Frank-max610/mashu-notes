# Mochi · 麻薯 🍡

**「把想法揉成一颗颗软乎乎的麻薯」**

一个软萌、本地优先、手机可用的开源 Markdown 笔记本。没有后端、没有账号、没有云，笔记只属于你。

**在线试用（HTTPS，可添加到主屏幕并离线使用）**：<https://frank-max610.github.io/mochi-notes/>
**仓库**：[github.com/Frank-max610/mochi-notes](https://github.com/Frank-max610/mochi-notes) · 当前版本 **v0.2.0**

[![Live demo](https://img.shields.io/badge/demo-live-ff9db4.svg)](https://frank-max610.github.io/mochi-notes/)
[![License: MIT](https://img.shields.io/badge/License-MIT-ff9db4.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb.svg?logo=react&logoColor=1b1b24)](https://react.dev/)

---

## 为什么做这个项目

- **Obsidian 很棒，但对「随手记」有点重。** 插件、库、同步配置都要学，手机端启动和切换不够快。
- **数据应该属于自己。** 很多笔记应用把内容放在云端，需要账号，导出还处处受限。
- **手机的浏览器已经足够强。** 一个静态页面就能提供接近原生 App 的体验，为什么还要装一个 App？
- **记笔记应该软一点。** 大多数知识库工具都太「冷硬」了：一打开就是文件夹树和配置面板，还没写就先有压力。

Mochi 想换一种姿势：不搭一座冷冰冰的档案馆，而是**把想法一颗颗揉出来，串成软乎乎的一碗**。打开就能写，写完就变可爱。

## 名字的由来

> **Obsidian 是黑曜石，Mochi 是软乎乎的麻薯团子。**

- 每一条笔记，就是**一颗麻薯**——圆滚滚、有弹性，写坏了也能捏回去。
- 用 `[[双向链接]]` 把麻薯们串起来，想法就有了黏性。
- 关系图谱，就是**一碗麻薯**：谁和谁挨着、谁是还没捏出来的那一颗，一眼就能看见。
- 吉祥物是一只**草莓牛奶团子**，戴着一顶小草莓帽；新笔记诞生时，会「啵」地冒出一串爱心和小草莓。

Mochi（麻薯）在中文和日语里都指软糯的糯米团子。我们喜欢这个词：它不宏大，但亲切；不冰冷，但能装下很多东西。于是有了这句 tagline——**「把想法揉成一颗颗软乎乎的麻薯」**。

## 功能

| 功能 | 说明 |
| --- | --- |
| **双向链接与反向链接** | 正文里写 `[[笔记名]]` 或 `[[笔记名\|别名]]` 即可链接；每条笔记自动生成出链与反向链接。目标笔记还不存在时，会显示成一颗「还没捏出来」的虚位麻薯。 |
| **标签** | 正文里的 `#标签` 自动识别并索引，支持中文、`-`、`_`、`/`，按使用次数聚合，可当筛选条件。 |
| **全文搜索** | 按标题、正文关键词搜索，结果按相关度排序并显示命中片段；支持 `#标签` 过滤。 |
| **关系图谱（一碗麻薯）** | 力导向布局的 Canvas 图谱：被引用越多的麻薯越大，未创建的链接显示为灰色「幽灵麻薯」，点一下就把它捏出来。 |
| **Markdown 编辑与预览** | 编辑 / 预览切换，支持标题、粗斜体、删除线、引用、列表、任务清单、表格、代码块等常用语法。原始 HTML 不执行。 |
| **本地优先存储** | IndexedDB 持久化（数据库 `mochi`），不可用时自动回退到 localStorage；断网也能读写，没有服务器参与。 |
| **导出与导入** | 一键导出 **JSON**（无损备份，可再导入）和 **Markdown 合集**（方便阅读，或迁移到 Obsidian 等工具）；导入支持 JSON，可按标题合并或整库替换，也能直接吃下 0.1.x 的旧版备份。 |
| **草莓牛奶 / 芋泥夜双主题** | 默认是甜甜的草莓牛奶浅色主题；深色是软糯的芋泥夜。也可以跟随系统。 |
| **麻薯吉祥物与小花样** | 空状态、加载页都有麻薯陪着你；新建笔记时会冒出爱心与小草莓，按钮和卡片都有软弹的按压反馈。 |
| **移动优先的胶囊界面** | 底部胶囊导航、中央「＋」捏一颗新麻薯、40px 以上触控目标（底部导航与主按钮 44px+）、安全区适配、贴着键盘的编辑工具栏；桌面浏览器同样好用。 |
| **PWA 与离线** | 提供 Web App Manifest、iOS / Android 主屏幕 meta 和 Service Worker：生产构建在 HTTPS / localhost 下缓存应用壳，可离线打开；添加到主屏幕后以独立窗口运行。 |
| **零后端** | 纯静态产物，可以部署到任意静态托管（GitHub Pages、Vercel、Netlify……），也可以只在本机或局域网里跑。 |

## 截图

> 截图由 `npm run screenshots` 驱动本机 Chrome 生成；0.2.0 的软萌视觉以实际运行效果为准。

| 笔记列表（草莓牛奶） | 一碗麻薯 · 关系图谱 | 编辑器（预览） |
| :---: | :---: | :---: |
| ![移动端笔记列表](docs/screenshots/mobile-notes.png) | ![关系图谱](docs/screenshots/graph.png) | ![编辑器预览](docs/screenshots/editor.png) |

| 编辑器（编辑态） | 搜索 | 我的（设置） |
| :---: | :---: | :---: |
| ![编辑器编辑态](docs/screenshots/editor-edit.png) | ![搜索](docs/screenshots/search.png) | ![设置](docs/screenshots/settings.png) |

| 空状态 · 草莓牛奶 | 深色主题 · 芋泥夜 |
| :---: | :---: |
| ![空状态](docs/screenshots/empty-notes.png) | ![芋泥夜主题](docs/screenshots/dark-notes.png) |

## 快速开始

环境要求：**Node.js 22 LTS 或更新**。Vite 8 的最低要求是 Node 20.19，但测试运行器 Vitest 5 需要 Node 22.12+，CI 也使用 Node 22；建议直接用当前 LTS。

```bash
# 1. 把麻薯带回家
git clone https://github.com/Frank-max610/mochi-notes.git
cd mochi-notes
npm install

# 2. 启动开发服务器（http://localhost:5173）
npm run dev

# 3. 生产构建，产物在 dist/
npm run build

# 4. 预览生产构建（http://localhost:4173）
npm run preview
```

不想装环境？直接打开[在线演示](https://frank-max610.github.io/mochi-notes/)就能玩。

首次打开会写入一小份演示笔记（10 条，包含双向链接、标签和任务清单），方便你马上看到图谱和搜索的效果。在「我的」里清空后不会再自动生成。

常用命令一览：

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发服务器，默认 `http://localhost:5173`，同时监听局域网（`--host`） |
| `npm run build` | 先跑 TypeScript 类型检查，再用 Vite 构建到 `dist/` |
| `npm run preview` | 本地预览 `dist/`，默认 `http://localhost:4173` |
| `npm run share` | 在局域网分享 `dist/`（默认 `0.0.0.0:4173`，可用 `-- --port 4174` 换端口），打印访问地址和二维码 |
| `npm run typecheck` | 只做 TypeScript 类型检查 |
| `npm test` | 运行 95 个 Vitest 单元测试（纯逻辑层） |
| `npm run test:watch` | 以 watch 模式运行测试 |
| `npm run icons` | 重新生成 `public/icons/` 下的 PWA 图标（需要 Python 3 + Pillow） |
| `npm run qr` | 生成局域网访问地址的二维码 PNG（`docs/screenshots/lan-qr.png`） |
| `npm run screenshots` | 用本机 Chrome 无头模式重新截取 README 截图（需要 Chrome） |

## 在手机上试用（局域网）

不用部署、不用装 App：把构建产物放到局域网里，手机扫码就能打开。

```bash
npm run build
npm run share
```

`npm run share` 会在 `0.0.0.0:4173` 上托管 `dist/`，并在终端里打印本机地址、**局域网 URL 和二维码**（端口被占用时可以 `npm run share -- --port 4174`）。确保手机和电脑连在同一个 Wi-Fi，用手机相机扫码（或手动输入终端里的局域网地址）即可打开。它只服务静态文件，不接触你的笔记数据。

Windows / Linux 上同样可用；如果只想拿到可分享的二维码图片，构建并托管之后运行 `npm run qr` 会生成 `docs/screenshots/lan-qr.png`。

终端输出形如：

```text
  麻薯  Mochi 已启动

  本机访问    http://localhost:4173
  手机访问    http://192.168.1.23:4173   （手机与电脑需连接同一 Wi-Fi）

  用手机扫描二维码打开：
  ██▀▄…（二维码）…
  按 Ctrl+C 停止服务。
```

> **HTTP-on-LAN 注意事项**
>
> 生产构建会注册 Service Worker（`public/sw.js`）来缓存应用壳，但浏览器只在 `https://` 或 `localhost` 等安全上下文里允许注册。通过 `http://192.168.x.x:4173` 访问时可以正常使用应用（在线模式），断网后无法重新打开，Android 也不会出现「安装应用」提示；**笔记数据仍然保存在手机浏览器自己的 IndexedDB 里，不会上传到电脑或任何服务器**。部署到 HTTPS 后即可获得完整的离线体验。

### 把 Mochi 添加到主屏幕

**iOS（Safari）**

1. 用 Safari 打开 Mochi（局域网地址或部署后的 HTTPS 地址）。
2. 点底部工具栏的「分享」按钮。
3. 选择「添加到主屏幕」。
4. 确认名称后点「添加」，之后从主屏幕图标启动即可。

**Android（Chrome / Edge）**

1. 用浏览器打开 Mochi。
2. 点右上角菜单（⋮）。
3. 选择「添加到主屏幕」（部分浏览器显示为「安装应用」）。
4. 确认后从主屏幕启动。

添加到主屏幕后，应用会以 `standalone` 模式启动，看不到浏览器地址栏，更像一个原生 App；在 HTTPS / localhost 下配合 Service Worker 还能离线打开。通过局域网 HTTP 添加的只是快捷入口（每次打开仍需联网加载页面）。不同设备的笔记库互相独立：手机上的麻薯只存在手机浏览器里。

## 数据与隐私

- **没有后端、没有账号、没有遥测。** 应用不依赖任何服务端接口，也不会发起统计或 API 请求；除加载应用自身的静态文件外，运行时的网络访问只来自你在笔记里主动写入的外链或图片地址。
- **所有笔记保存在浏览器本地。** 默认使用 IndexedDB（数据库名 `mochi`，版本 1，对象仓库 `notes`）；隐私模式或存储被禁用时回退到 localStorage（`mochi.notes.v1`）。首次加载时会请求浏览器授予持久化存储权限，降低被自动清理的概率。
- **每个设备、每个地址都是独立的库。** `localhost`、`127.0.0.1`、局域网 IP、部署域名在浏览器看来是不同的 origin，数据互不相通。固定使用同一个地址访问。
- **旧数据会自动搬家。** 0.1.x 的本地笔记（旧 IndexedDB / localStorage 两处）会在首次打开 0.2.0 时自动迁移，主题和引导标记也会保留；旧版导出的 JSON 备份同样可以直接导入。仍建议升级前先导出一次备份。
- **应用壳缓存不含笔记。** 生产构建的 Service Worker 只在安全上下文下缓存 HTML/CSS/JS 等静态资源（缓存名 `mochi-v1`）；IndexedDB 和 localStorage 中的笔记不会被写入缓存，也不会离开设备。
- **备份靠导出。** 「我的」页可以随时导出 JSON（无损，可再导入）或 Markdown 合集。清除浏览器站点数据会删除笔记，建议定期导出备份。
- **局域网分享只暴露应用文件。** `npm run share` 提供的是静态构建产物，笔记数据始终留在各自设备的浏览器里。

更完整的说明见 [docs/PRIVACY.md](docs/PRIVACY.md)。

## 项目结构

```text
mochi-notes/
├── .github/workflows/
│   ├── ci.yml                    # GitHub Actions：typecheck + test + build
│   └── deploy-pages.yml          # 构建并发布到 GitHub Pages
├── docs/
│   ├── ARCHITECTURE.md           # 架构、数据流与扩展点
│   ├── PRIVACY.md                # 隐私说明
│   └── screenshots/              # 应用截图（npm run screenshots / npm run qr 生成）
├── public/
│   ├── icons/                    # PWA 图标（npm run icons 生成）
│   ├── manifest.webmanifest      # PWA 清单
│   └── sw.js                     # Service Worker：应用壳离线缓存（mochi-v1）
├── scripts/
│   ├── make_icons.py             # 生成 192/512/maskable 等图标（Python + Pillow）
│   ├── qr.mjs                    # 生成局域网访问二维码 PNG
│   ├── screenshots.mjs           # 用本机 Chrome 截取 README 截图
│   └── serve.mjs                 # 局域网托管 dist/ + 二维码
├── src/
│   ├── components/               # 可复用 UI（Icon、TabBar、NoteCard、Mascot、HeartBurst、MarkdownPreview、GraphView…）
│   ├── screens/                  # 页面级组件（笔记列表、编辑器、我的）
│   ├── lib/                      # 核心逻辑（纯函数 + 浏览器适配层，UI 无关）
│   │   ├── types.ts              # 数据模型与公共类型
│   │   ├── links.ts              # wiki 链接、标签、反向链接等派生关系
│   │   ├── markdown.ts           # markdown-it 渲染管线
│   │   ├── db.ts                 # IndexedDB / localStorage 持久化
│   │   ├── store.ts              # useNotes() 单一状态源
│   │   ├── prefs.ts              # 主题、引导标记、ID / Note 工厂
│   │   ├── seed.ts               # 首次运行的演示笔记
│   │   ├── search.ts             # 全文搜索（纯函数）
│   │   ├── graph.ts              # 图谱构建与力导向布局（纯函数）
│   │   ├── exportImport.ts       # JSON / Markdown 导入导出
│   │   ├── format.ts             # 时间 / 字节 / 数字格式化
│   │   └── useRoute.ts           # 轻量 hash 路由
│   ├── styles/
│   │   ├── tokens.css            # 设计变量（草莓牛奶 / 芋泥夜、药丸圆角、弹跳缓动、安全区）
│   │   ├── base.css              # reset 与共享基础样式
│   │   └── app.css               # 应用外壳与页面样式
│   ├── App.tsx                   # 应用外壳：路由、主题、操作面板、麻薯动效
│   └── main.tsx                  # React 挂载入口 + Service Worker 注册
├── tests/                        # Vitest 单元测试（95 个用例）
├── index.html                    # HTML 入口与 PWA meta
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
├── CONTRIBUTING.md
├── LICENSE
└── README.md
```

## 技术选型

| 层面 | 选择 | 原因 |
| --- | --- | --- |
| UI | **React 19 + TypeScript strict** | 组件化、hooks 管理状态；strict 模式把大量问题挡在编译期 |
| 构建 | **Vite 8** | 快速开发服务器与静态构建；`base: './'` 让产物可以部署到任意路径 |
| Markdown | **markdown-it 15** | 可靠、可扩展的 CommonMark 实现；关闭 `html`，从源头避免注入 |
| 存储 | **原生 IndexedDB + localStorage 回退** | 零依赖、容量大；隐私模式等场景仍有兜底 |
| 状态 | **单一 `useNotes()` hook** | 内存乐观更新 + 防抖写入，输入不等 I/O |
| 视觉 | **手写 CSS + 设计变量** | 不引入 UI 框架，包体小；`tokens.css` 提供草莓牛奶 / 芋泥夜两套色板、药丸圆角与弹跳缓动 |
| 吉祥物 | **内联 SVG + CSS 动画** | 麻薯、爱心、按钮反馈都不依赖图片或网络，离线也可爱 |
| 图标 | **内联 SVG** | 不依赖图标字体和网络，离线可用 |
| 测试 | **Vitest（node 环境）** | 95 个纯逻辑用例，无需浏览器 DOM |
| 局域网分享 | **静态文件服务脚本 + qrcode-terminal** | 手机扫码即可试用，无需部署 |
| 二维码 / 截图 | **qrcode + 本机 Chrome（DevTools 协议）** | 图片类产物按需生成，不进入运行时依赖 |
| 离线 | **Service Worker（生产构建）** | 缓存应用壳，HTTPS / localhost 下可离线打开；不参与笔记存储 |
| 部署 | **GitHub Actions → GitHub Pages** | 推送到 `main` 自动构建发布，在线演示常驻 |

运行时依赖只有 `react`、`react-dom`、`markdown-it` 三个。没有路由库、状态库、UI 框架和后端。

## 部署

- **GitHub Pages（推荐）**：仓库自带 `.github/workflows/deploy-pages.yml`，推送到 `main`（或手动 `workflow_dispatch`）后自动构建 `dist/` 并发布到 Pages，线上地址是 <https://frank-max610.github.io/mochi-notes/>。Vite 的 `base: './'` 让产物在 `/<repo>/` 子路径下也能正常加载。
- **任意静态托管**：`npm run build` 后把 `dist/` 整个传上去即可（Vercel、Netlify、Cloudflare Pages……），不需要任何服务端环境变量。
- **本机 / 局域网**：`npm run share` 见上文。

## FAQ

### 如何同步到其他设备？

当前没有云同步。最简单的做法：在「我的」里「导出全部笔记（JSON）」→ 用 AirDrop、网盘或微信传到另一台设备 → 在「我的」里导入。通过局域网在手机上打开的是**手机自己的独立笔记库**，不会和电脑同步。云同步、WebDAV、Git 备份都在路线图里。

### 会不会丢数据？

笔记存在浏览器存储里，正常使用不会丢。风险主要来自：手动清除浏览器站点数据、使用隐私/无痕模式、存储空间不足。应用会自动请求持久化存储权限，并在保存失败时提示你立即导出备份。**最稳妥的习惯仍然是定期导出 JSON 备份**——数据只有一份在家的时候，备份就不是可选项。从 0.1.x 升级到 0.2.0 时，旧版本地数据会自动迁移，旧版 JSON 备份也可以直接导入；升级前导出一次备份会更稳妥。

### 和 Obsidian 有什么区别？

Obsidian 是黑曜石，Mochi 是麻薯——一个把知识库做成冷硬可靠的档案馆，一个把知识库做成软乎乎的团子。Mochi 更轻：没有插件生态、没有本地文件夹 vault（笔记存在浏览器存储里，而不是一堆 `.md` 文件）、没有内置同步。它把 Markdown、双向链接、搜索、图谱、手机书写这几件事做顺，适合快速记录和个人小知识库。如果你需要文件级 Markdown、插件和成熟的多端同步，Obsidian 仍然是更好的选择；Mochi 的定位是「打开就想写」的轻量替代。

### 支持哪些 Markdown 语法？

标题、粗体/斜体、删除线、引用、有序/无序列表、任务清单（`- [ ]`，预览中只展示状态）、表格、围栏代码块、行内代码、链接、`[[wiki 链接]]`、`#标签`。出于安全考虑禁用原始 HTML；暂时没有代码高亮、图片上传或文件夹层级（见路线图）。

### 需要联网吗？

不需要后端。Mochi 没有任何服务端调用，运行时的所有逻辑都在浏览器里。开发时用的 `npm run dev` 只是本机静态服务器；构建后的 `dist/` 可以放在任意静态托管上。生产构建会注册 Service Worker，在 HTTPS / localhost 下首次加载后即可离线打开；通过局域网 HTTP 访问时是在线模式，需要网络加载页面，但笔记数据始终在本地。

### 我的笔记会被上传吗？

不会。仓库里没有遥测、分析、广告或崩溃上报代码，也没有任何写死的第三方接口。只有你在笔记里主动写入的外链或网络图片，才会在预览时由浏览器去加载。

### Mochi 会咬人吗？

只会轻轻咬一口你的拖延症。🍓

### 如何删除所有数据？

「我的」页提供「清空全部笔记」；也可以在浏览器设置里清除该站点的数据。删除前请先导出 JSON 备份，操作不可恢复。

## 路线图

已完成：

- [x] Markdown 编辑 / 预览
- [x] 双向链接、出链与反向链接
- [x] 标签提取、标签筛选
- [x] 全文搜索
- [x] 力导向关系图谱（含幽灵节点）
- [x] IndexedDB 本地存储 + localStorage 回退
- [x] JSON 导出 / 导入（按标题合并或整库替换），兼容 0.1.x 旧备份
- [x] 单条笔记导出 `.md` / 复制 Markdown
- [x] Markdown 合集导出
- [x] 移动优先界面，草莓牛奶 / 芋泥夜双主题
- [x] Hash 路由与浏览器后退手势
- [x] PWA manifest、Service Worker 应用壳离线（HTTPS / localhost）
- [x] 0.2.0 视觉重设计：麻薯吉祥物、爱心迸发、胶囊导航与弹跳微交互
- [x] GitHub Pages 在线演示与自动部署，截图 / 二维码生成脚本

计划中：

- [ ] 离线更新提示与缓存版本管理
- [ ] 云同步 / WebDAV / Git 备份
- [ ] 导入 Markdown 合集（目前导入只支持 JSON）
- [ ] 本地文件夹 vault（File System Access API，直接读写 `.md` 文件）
- [ ] 图片 / 附件上传
- [ ] 代码块语法高亮
- [ ] 插件系统与自定义主题
- [ ] 更多麻薯表情与节日皮肤
- [ ] 英文界面（i18n）
- [ ] UI 交互测试（当前测试集中在纯逻辑层）

## 参与贡献

欢迎 issue、PR、表情包和截图反馈。开发环境、代码风格、测试要求和提交规范见 [CONTRIBUTING.md](CONTRIBUTING.md)。

```bash
npm run typecheck && npm test && npm run build
```

## 许可证

[MIT](LICENSE) © 2026 Mochi contributors

---

## English

**Mochi (麻薯)** is a soft, mobile-first, local-first, open-source Markdown notebook — a lighter, cuter take on Obsidian that runs entirely in your browser.

**Tagline:** “Roll your thoughts into soft little mochi.”

- Every note is a mochi ball; `[[wiki links]]` string them together, and the force-directed graph is a whole bowl of mochi (including ghost mochi for notes you haven't created yet).
- `#tags`, full-text search, a Markdown editor with preview (tables, task lists, fenced code), JSON / Markdown export, and JSON import (merge or replace; 0.1.x backups are still welcome).
- Strawberry-milk light theme and taro-night dark theme, macaron pill UI, a squishy mochi mascot, and a heart burst when a new note is born.
- Notes live in IndexedDB (localStorage fallback). No backend, no account, no telemetry. A PWA manifest plus a service worker make it installable and offline-capable on HTTPS/localhost.
- Try the [live demo](https://frank-max610.github.io/mochi-notes/), or run it on a phone over your LAN: `npm run build && npm run share`, then scan the QR code on the same Wi-Fi.
- MIT licensed. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and [CONTRIBUTING.md](CONTRIBUTING.md) to get involved.
