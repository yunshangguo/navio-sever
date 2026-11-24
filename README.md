# Navio Server · Windows 宿主机 Web 书签导航

参考同类 PHP + MySQL 书签导航站的思路，重做成 **跑在 Windows 宿主机上的 Web 服务**（本项目定名 Navio）：

- **桌面 exe 不再显示书签界面**，只显示「服务端控制台」（端口、账号密码、数据/数据库管理、安全、日志）。
- **浏览器 / 手机远程访问** `http://<宿主机IP>:9200` 使用完整的书签导航页。
- **数据仍然只写在宿主机的 JSON 文件里**，没有 MySQL、没有 Docker、不依赖外部服务。
- **图标五级降级**：官网真实 favicon（94 枚离线内置、统一规格、纯透明无底色）→ 在线抓取 → 151 枚品牌/分类自绘 SVG → 渐变首字母，不会清一色字母块。
- **阶段 2 第一批已交付**：待办 / 日历 / 天气 / 记事本 4 个可编辑组件，数据与书签同存一个 JSON 文件。
- **阶段 5 已交付**（分组形态已被阶段 10 取代）：公共书签合并为「常用 / 更多」两个分组；搜索栏内置 7 个搜索引擎（百度 / 谷歌 / 必应 / 360 / 搜狗 / DuckDuckGo / GitHub），可随时切换并联网搜索。
- **阶段 6 已交付**：94 个推荐书签全部改用**各网站自己的官方 favicon**（构建期抓取、随包内置、离线可用），不再是自绘图标；151 枚自绘 SVG 仅作最后兜底。
- **阶段 7 已交付**：图标容器改为**纯透明**（去掉每站随机彩色渐变色块），94 枚 favicon 在构建期归一化成统一 **128×128 透明 PNG**，视觉大小完全一致；圆形/方形等品牌原生形状与配色原样保留。
- **阶段 8 已交付**：单个书签可独立设 `1x1 / 2x1 / 1x2 / 2x2` 占格，CSS Grid dense 布局，改动只落在自己的个人快照。
- **阶段 9 / 10 已交付**（分组形态已被阶段 11 取代）：项目彻底改名 **Navio**；默认公共模板以你在页面上手动删减后留下的 **58 个站点**为权威目录，拆成「常用 + 9 个系统预设分类」；首页第一屏只显示「常用」，点分类导航条才切到该分类。详见「阶段 10」章节（历史）。
- **阶段 11 已交付**（分类栏形态已被阶段 12 部分取代）：51 个站点全部归入唯一「常用」分类，分类移到左侧竖栏、搜索栏下方横条隐藏，系统预设一批分类图标。详见「阶段 11」章节。
- **阶段 12 已交付**（当前最终形态）：**单个书签图标可自定义背景颜色**，系统预设 12 项色板（含「无背景」）可选，默认仍是纯透明、视觉零变化；**左侧公共分类与自建标签改为同一个连续列表**，不再用分区标题、说明文字和彩色图标强调区别。详见「阶段 12」章节。

---

## 架构

```
┌─ Windows 宿主机 ───────────────────────────────────────────┐
│  Navio.exe (Electron 主进程)                              │
│   ├─ HTTP(S) 服务  src/server.js   0.0.0.0:9200  ← 远程访问 │
│   │    ├─ 静态托管 renderer/  (登录页 + 书签页)             │
│   │    ├─ /api/*  用户接口（20+ 路由）                     │
│   │    └─ 鉴权 / 会话 / 限流 / IP 白名单 / HTTPS           │
│   ├─ 服务端控制台 console.html  ← 桌面端唯一窗口            │
│   │    └─ 管理操作只走本地 IPC，不通过端口暴露              │
│   ├─ 系统托盘（关窗 = 隐藏到托盘、服务继续跑）              │
│   │    右键：打开控制台 / 设置… / 浏览器打开 / 重启服务 /    │
│   │          图形模式切换 / 退出（停止服务）；双击恢复窗口   │
│   └─ dataDir/                                              │
│        data.json      全部书签/分组/设置/组件/用户空间       │
│        users.json     账号（scrypt 加盐哈希）               │
│        sessions.json  会话                                 │
│        server.json    端口/绑定/安全配置                    │
│        backups/      滚动备份   favicons/  wallpapers/      │
└────────────────────────────────────────────────────────────┘
         ▲ HTTP                        ▲ HTTP
     家里电脑浏览器                手机 / 外网（需端口转发）
```

**关键设计**：`renderer/navio-http.js` 在浏览器里实现了与 Electron `preload.js` 完全相同的 `window.navio` 接口，所以 1711 行书签 UI 一套代码两端通用，不需要维护两份前端。

**管理面隔离**：`console.html / console.js / console.css` 由 Electron 用 `loadFile` 本地加载；HTTP 服务对这三个路径一律返回 404（即使已登录）。所有管理操作只走本地 IPC，公网侧不存在任何管理端点。

---

## 快速开始

### 开发态

源码位于 **`C:\AI使用\navio-win`**（已从 C 盘迁出；`node_modules` 与 Electron 运行时均为实体副本，不再依赖其它项目）。

```bat
cd /d C:\AI使用\navio-win
node_modules\electron\dist\electron.exe .
```

### 打包态（免安装目录版）

```
C:\AI使用\NavioServer\win-unpacked\Navio.exe
C:\AI使用\NavioServer\Navio-2.0.0-win-x64.zip

> v2 唯一交付目录为 `C:\AI使用\NavioServer`；`D:\navio-dist` 是 v1 遗留构建输出，可忽略。
```

双击 exe → 弹出「服务端控制台」→ 服务自动在 9200 端口启动 → 点「在浏览器中打开」或访问 `http://127.0.0.1:9200`。

### 首次登录

首次启动会生成随机管理员密码，写在数据目录的 **`INITIAL_ADMIN.txt`**：

```
用户名: admin
密码:   <随机>
```

控制台「账号密码」页也会直接显示。登录后请立刻点右上角「修改密码」，然后删掉 `INITIAL_ADMIN.txt`。

### 远程访问

| 场景 | 做法 |
|---|---|
| 本机 | `http://127.0.0.1:9200` |
| 同一局域网 | `http://<宿主机局域网IP>:9200`（控制台「概览」页会列出所有地址） |
| Windows 防火墙拦截 | 管理员 PowerShell 执行控制台「服务与端口」页给出的 `New-NetFirewallRule` 命令 |
| 公网 | 路由器端口转发 / 内网穿透 + **必须**改掉初始密码；建议启用 HTTPS 并配 IP 白名单 |
| 已有 Nginx / frp | 反代到 9200，并在「访问安全」里开启「信任 X-Forwarded-For」 |

> 端口、绑定地址、HTTPS 证书、开机自启都在控制台里改，改完点「保存并重启服务」。

---

## 桌面控制台功能

| 页签 | 内容 |
|---|---|
| 概览 | 服务状态、监听地址、协议、运行时长、在线会话、请求数、访问地址一键复制、启动/停止/重启 |
| 服务与端口 | 端口、绑定地址、开机自启、HTTPS 证书路径、防火墙放行命令 |
| 访问安全 | 登录开关、会话有效期、失败锁定次数/时长、IP 白名单、反向代理设置、明文 HTTP 风险提示 |
| 账号密码 | 账号列表、新建/改密、角色（管理员/普通）、启用禁用、删除、初始密码提示 |
| 数据库 / 文件 | 数据统计、立即备份、备份列表与恢复、校验修复、导出/导入 JSON、清空、打开数据目录 |
| 内置图标库 | 151 枚图标预览与搜索 |
| 运行日志 | 启动 / 监听 / 错误 / 崩溃日志尾部 |

**管理接口只走 Electron 本地 IPC，HTTP 端口上不存在 `/api/admin/*`**，公网无法改端口或账号。

### 开机自启与系统托盘（常驻后台）

- **开机自启**：控制台「服务与端口 → 开机自动启动服务」点一下即可开关，写入当前用户的启动项（Windows 注册表 `CurrentVersion\Run`），登录 Windows 后自动运行 Navio Server。
- **关窗不退出**：点桌面控制台窗口的「×」只是**隐藏到右下角系统托盘**，Web 服务继续在后台运行；手机 / 其他设备仍能访问。
- **托盘右键菜单**：打开服务端控制台 / **设置…**（直接跳到「服务与端口」页）/ 在浏览器中打开 / 重启服务 / 图形模式切换 / **退出（停止服务）**。
- **托盘双击 / 左键**：恢复显示控制台窗口。真正停止服务请用托盘「退出」。

---

## 首页界面（阶段 3）

> 本章记录阶段 3 的形态。下面的「常用 / 更多 两分区」「94 个站点」属于历史中间态，**当前最终形态见「阶段 12」章节**（51 站点 / 唯一「常用」/ 左侧统一分类栏 / 单书签图标背景色）。

Web 端是「起始页」，不是书签管理后台：

| 区域 | 内容 |
|---|---|
| 左侧竖列 | **只放「我的标签」**：自己新建的私有分组，带彩色图标、书签数与高亮条；没有自己的标签时显示空态 +「新建我的标签」。底部是组件 / 设置 / 主题 / 添加快捷入口与身份信息 |
| 顶部工具条 | 面包屑显示「通用书签」，右侧组件 / 添加 / 设置按钮 |
| 首页 Hero | 大时钟（含秒）、按时段变化的问候语、日期星期、660px 大搜索框（**内嵌搜索引擎下拉**） |
| 主区 | **「常用」「更多」两个公共分区** + 自己的私有分组**合并显示**，私有卡片带「我的」角标；深 / 浅两套主题、毛玻璃、悬浮光晕，窄屏自动折叠成顶部横排 |

**公共书签模板**：`renderer/presets.js` 内置 **94 个常用站点**。原来的 10 个细分类（AI 工具 / 开发 / 社区资讯 / 影音娱乐 / 购物生活 / 效率办公 / 设计素材 / 学习阅读 / 云与运维）与宿主机上历史积累的 11 个分组，现已**合并为「常用 / 更多」两个分区**：

- **常用**：按 host 白名单挑出的 30 个高频站点（百度、必应、Google、知乎、B 站、微博、淘宝、京东、GitHub、ChatGPT…），首屏即可点。
- **更多**：其余 64 个长尾站点，一个分区收完，不再层层分类。
- **只读模板**：Web 端任何增删改都只写 `spaces[身份ID]`，顶层公共书签永不被改写，别人看到的起始页始终是原样。
- **幂等投影**：服务端 `src/spaces.js` 的 `project()` 在**读取时**按 host 重新归组，因此旧版个人快照（扁平 `g_public`）无需改写盘上数据就能看到新分组；私有分组与用户移过去的书签一律不动。
- **图标是网站自己的**：94 个推荐站点的官方 favicon 随包内置（`renderer/site-icons/`），首屏零外网请求即可全部显示；未收录域名仍有在线抓取 → 品牌色 SVG → 渐变首字母兜底。详见「真实站点图标包（阶段 6）」。
- **无色块、大小一致**：真实 logo 直接浮在纯透明容器上，没有彩色渐变底、浅色底块或投影；94 枚图标统一为同一显示规格。详见「图标纯透明 + 统一规格（阶段 7）」。
- 全部数据仍落在同一个 `data.json`，**没有改存储引擎、没有引入数据库**。

顶层数据的一次性合并由 `tools/merge-groups.js`（纯函数）完成：只改 `groups` 与 `bookmarks[].groupId`，书签 id / url / 图标 / 排序 / 点击数、以及 `settings` / `spaces` / `widgets` 等全部原样保留，可反复执行。

**图标不叠字**：卡片图标只在图片加载失败（或没有图标）时才显示渐变首字母，图片正常显示时不叠加任何文字；首页所有卡片、快捷胶囊、侧栏项与工具按钮都不带原生 `title` 悬浮提示文字。CSS 用 `.ico:has(img:not([data-failed="1"])) .fallback` 控制（Electron 31 / Chromium 126 原生支持，缓存图片同样生效），`home.js` 的 `stripTitles()` 在每次重渲染后兜底清理。

**图标无色块（阶段 7）**：彩色渐变只挂在 `.fallback`（降级首字母）上，真实 logo 的 `.ico` 容器是纯透明的 `background:transparent` + `box-shadow:none`，不再出现「图标下面垫一块彩色底」；投影/内高光一并去掉，深浅主题都不会形成暗块。

实现文件：`renderer/presets.js`（目录）、`renderer/home.css`（视觉）、`renderer/home.js`（左侧栏 + Hero 联动，镜像 `#groupTabs` 并转发点击，不改主逻辑一行）、`renderer/index.html`（骨架）、`src/spaces.js` + `tools/merge-groups.js`（分组合并与投影）。

---

## 搜索栏与联网搜索（阶段 5，2026-11-24 改为纯网络搜索）

搜索栏**只做联网搜索，不再过滤本地书签**：输入内容时页面完全不变（书签栏照常显示、不筛选、不隐藏、不弹结果面板），只有回车才跳转。

| 能力 | 说明 |
|---|---|
| 联网搜索 | 输入关键词回车，直接用当前选中的搜索引擎打开结果；引擎名实时显示在搜索框左侧 |
| 引擎下拉 | 搜索框**左侧**点一下展开清单，共 7 个：百度、谷歌、必应、360、搜狗、DuckDuckGo、GitHub；当前引擎带品牌色标记与勾选 |
| 网址直达 | 输入 `github.com` 这类网址仍直接打开，不走搜索引擎 |
| 页面零干扰 | `runSearch()` 只记录 `UI.q`，完全不碰 DOM；书签栏、分类、组件在输入时都不受影响 |
| 持久化与同步 | 选择写入 `settings.searchEngine`（落到自己的个人快照，游客也独立）；搜索栏按钮、下拉勾选、设置抽屉「默认搜索引擎」三处实时同步 |

实现：`renderer/app.js` 里的 `ENGINES` 是唯一清单，搜索栏下拉、设置抽屉、回车跳转全部复用；`submitSearch()` 是唯一跳转入口（网址直达 → 引擎搜索），`renderer/index.html` 放下拉骨架，`renderer/home.css` 放深浅主题样式。外链统一走 `API.openExternal`（Web 端 `window.open` + `noopener`），不经过 CSP 的 `connect-src`。防回归：`_test_websearch.js` 21/21 覆盖"输入不碰 DOM、回车走引擎、网址直达、无书签残留"。

**下拉层叠修复**：`.search-wrap` 因 `transform` / `backdrop-filter` 会创建独立层叠上下文，导致下拉菜单虽然自身 `z-index:80`，却仍被后面按文档流绘制的快捷胶囊与书签卡片盖住（实测 7 项里只有第 1 项可点）。修法是给共同定位父级 `.hero-search` 提升 `z-index:60`，并把菜单背景从半透明玻璃改成实色 `--h-menu-bg`（深/浅各一），避免下层图标透出。线上以 `elementFromPoint` 逐项复验：修复前 1/5 命中，修复后 5/5 命中。

---

## 公共起始页与「我的标签」（阶段 4）

> 公共模板 / 个人快照 / 匿名身份 / 权限边界这些概念至今有效；但本章的「94 个书签、常用 / 更多 两分区」已被阶段 10 的「58 个站点 + 常用 + 9 分类单页切换」取代。

**去掉了原来的分组标签栏**：公共书签不再按分组切成一页页标签，而是合并平铺成「常用 / 更多」两个分区；侧栏始终只保留自己新建的标签。

| 概念 | 说明 |
|---|---|
| 公共书签 | 顶层 `data.json` 的 94 个书签，作为公共模板，展示为「常用 / 更多」两个分区；**不登录也能看、也能改** |
| 身份 | 登录账号用 `users.json` 里的账号 id；未登录用 `navio_anon=anon_xxx` 匿名 Cookie（HttpOnly，365 天） |
| 个人快照 | `spaces[身份ID]`，copy-on-write：第一次保存时才生成，内容 = 公共模板 + 自己的改动 |
| 改动只影响自己 | 删掉一个公共书签、加一个私有标签，都只写自己的快照；别人刷新看到的公共书签**仍然存在** |
| 登录后创建的标签 | 只对该账号可见，其他账号 / 游客都看不到；与主区两个公共分区**合并显示**，卡片和分组都带「我的」标识 |
| 游客 → 登录 | 登录时若带了匿名 Cookie 且已有快照，会自动继承到账号空间，改动不丢；换设备登录后保留 |
| 重置 | `POST /api/state/reset` 删掉当前身份的快照，回到干净的公共起始页 |

**权限边界**：游客可访问起始页、`/api/state`、天气、图标、书签 HTML 导入导出等白名单接口；备份 / 恢复 / 宿主机书签探测 / 账号管理等敏感接口游客一律 401。导出只导出当前身份视图，不会带出 `spaces` 里别人的数据；`/api/restore` 仅管理员可用。`server.json` 的 `publicMode.enabled=false` 可一键退回「必须登录」的旧行为，`anonymousEdit=false` 可让游客只读。

服务端实现：`src/spaces.js`（模板 / **两分组投影** / 视图 / 快照 / scope 标注）、`src/server.js`（`identityOf()`、白名单、快照继承）、`src/config.js`（`publicMode` 配置）；前端 `home.js` 的 `syncNav()` 过滤掉全部公共分组 id、只镜像私有标签，`app.js` 给卡片与分组加 `scope` 徽标，Web 模式下跳过前端播种以免把公共书签写进个人快照。

---

## 真实站点图标包（阶段 6）

用户反馈「图标都是生成的，不是网站自己的」，因此改为**全部使用各站点官方 favicon**：

- `tools/fetch-site-icons.js` 在构建期读取 `renderer/presets.js` 的 94 个站点，并发抓取官网真实图标。优先级：首页 `<link rel=icon>` 的 PNG/SVG/apple-touch-icon（最清晰）→ `/apple-touch-icon.png` → `/favicon.ico` → `/favicon.png` → 第三方 `favicon.im` 兜底。
- 产物落在 `renderer/site-icons/`：`<sha1(host)>.<png|ico|svg>` + `map.json`（host → 文件/类型/来源）+ `report.json`。**94/94 全部抓到**：61 PNG、23 ICO、10 SVG，总大小约 821 KB，文件头逐个校验合法，无文字占位图污染。
- 图标随 `app.asar` 一起打包，**离线可用、不依赖运行时外网、首屏不发几十个外网请求**。
- 服务端 `/api/icon` 命中内置包时返回真实图片，并带响应头 `X-Navio-Icon: site` 便于排查。

**降级链路（五级，服务端内部完成，前端零改动）**：

```
本地 favicons/ 缓存（用户点过「刷新图标」的最新结果）
   ↓ 没有
内置真实图标包 renderer/site-icons/std/  ← 94 枚统一 128x128 透明 PNG，离线秒出
   ↓ std/ 不存在（例如刚重新抓取、还没归一化）
原始文件 renderer/site-icons/<sha1>.<png|ico|svg>  ← 自动回退，向后兼容
   ↓ 未收录
在线抓取 /favicon.ico → /favicon.png → 首页 <link rel=icon> → apple-touch-icon
   ↓ 抓不到（内网 / 被墙 / 超时 / 站点没图标）
按域名精确匹配 → 域名后缀匹配 → 标题/URL 关键词匹配 → 用途分类匹配 → 内置自绘 SVG
   ↓ 仍无匹配
返回 404，前端降级为渐变色首字母
```

**历史数据兼容**：`tools/migrate-icons.js`（纯函数、幂等）只把 `bookmarks[].icon` / `spaces[*].bookmarks[].icon` 里写死的 `/api/preset-icon?...` 换成 `/api/icon?host=...&title=...`。线上一次性迁移 **164 处**（顶层 82 + 个人快照 82），书签数 94、分组「常用/更多」、`settings`、组件数据与 `users.json` / `sessions.json` 哈希全部未变。前端 `iconSrc()` 另有运行时兜底：即使导入旧备份、不做数据迁移，旧的自绘图标 URL 也会自动升级成真实 favicon；用户自己上传/填写的自定义图标原样保留。

想刷新某站点图标：控制台点「刷新图标」即可。整包重新抓取并按新规格归一化：

```bat
node tools/fetch-site-icons.js              :: 重新抓 94 个官网真实 favicon（可反复运行）
node tools/normalize-site-icons.js          :: 归一化成统一规格（需本机 Chromium，仅构建期）
node tools/normalize-site-icons.js --check :: 纯 Node 校验产物，全套回归会自动跑
```

---

## 图标纯透明 + 统一规格（阶段 7）

用户反馈「真实图标下面还有一块色块，而且各图标形状大小不一」。放大排查确认两个独立根因：

| 问题 | 根因 |
|---|---|
| 彩色色块 | `cardHTML()` 给每个 `.ico` 写了 `style="background: ${gradOf(b)}"` —— 按 host 哈希生成的**随机彩色渐变**；favicon 用 `object-fit:contain` 缩小后，四周就露出这层渐变。真机探针：94/94 卡片都带渐变。 |
| 大小参差 | 94 枚官网 favicon 原生尺寸有 **25 种**（16×16 ~ 180×180），且各自带的透明留白完全不同，`contain` 后视觉大小必然不齐。 |

按用户选定的「**纯透明，只统一大小**」方案落地（不加任何统一底板，保留各品牌圆形/方形原生形状）：

1. **前端**：彩色渐变从 `.ico` 容器移到 `.fallback` —— 只有「抓不到图标」的首字母降级才显示渐变；真实 logo 容器 `background:transparent`、`box-shadow:none`、`padding:0`。`.quick-chip` 快捷胶囊同规格。
2. **构建期归一化**：`tools/normalize-site-icons.js` 用 **Chromium Canvas** 解码 PNG / ICO / SVG（无需 sharp / Pillow），扫描 alpha 裁掉四周透明留白得到内容包围盒，再把内容等比缩放、居中绘制到 **128×128 全透明画布**的 84% 内切区。不改形状、不加底板、不改颜色，圆形仍是圆形、方形仍是方形。产物在 `renderer/site-icons/std/<sha1(host)>.png`，原始图标文件完全不动。
3. **服务端**：`src/site-icons.js` 的 `find()` 优先返回 `std/` 归一化文件；`std/` 不存在时自动回退原始文件。**`map.json` 结构没变、抓取脚本不用改**，删掉 `std/` 即可随时回滚。

结果：**94/94 归一化成功，25 种原始尺寸 → 1 种**；真机上容器统一 48×48、图片原生尺寸统一 `128x128`、padding 统一 `0px`、object-fit 统一 `contain`、`colored:0`（零色块）。归一化产物约 958 KB，随 `app.asar` 打包，依然离线可用。

防回归：`--check` 纯 Node 校验 94 枚 PNG 的 IHDR 尺寸与一一对应；`_test_site_icons.js` 新增 8 条、`_verify_home.js` 新增 3 条、`final-check.js` 逐枚读包内 IHDR，确保打包版也是统一规格。

---

## 单个图标独立尺寸（阶段 8）

同类书签工具允许每个图标单独设占格大小（1×2、2×2 之类），本项目也补齐了这一能力。

**四种占格**（列 × 行；格子 104×100 px，间距 8 px）：

| 值 | 实际卡片 | 图标 | 说明 |
|---|---|---|---|
| `1x1` | 104×100 | 48×48 | 默认，与阶段 7 视觉完全一致 |
| `2x1` | 216×100 | 68×68 | 横向加宽 |
| `1x2` | 104×208 | 76×76 | 纵向加高 |
| `2x2` | 216×208 | 104×104 | 大图标（名称字号同步放大） |

**怎么设**：右键任意书签 →「图标尺寸…」→ 在点阵里点选，即时生效并自动保存；编辑 / 新建书签弹窗里有同一个选择器；设置抽屉「单个图标尺寸 → 全部复位」可一次把当前身份的所有书签恢复成 1×1。

**布局**：首页书签区从 flex 改为 CSS Grid（`repeat(auto-fill, 104px)` + `grid-auto-flow: row dense`），大图标之后的普通卡片会自动补进空位；搜索结果区仍是普通 flex，不受影响。图标容器始终纯透明，`padding:0` / `object-fit:contain` / 128×128 归一化规格全部不变。

**数据**：书签对象新增可选字段 `size`，只允许 `1x1 / 2x1 / 1x2 / 2x2`。`src/store.js` 的 `normalize()` 白名单只在源数据带合法值时挂上该字段，**旧数据归一化结果逐字段不变**，非法值一律按 1×1 兜底；`src/spaces.js` 的 `template() / project() / annotate()` 逐层透传。尺寸随个人快照保存：你给百度设了 2×2，只有你自己看到，其他访客与账号仍是默认布局；顶层公共模板不会被 Web 端写入。想让全员默认带尺寸，在宿主机 `data.json` 顶层书签里加 `size` 即可。

防回归：`_test_card_sizes.js` 覆盖 4 种占格的 computed 跨行列与实测宽高、默认 1×1 视觉零变化、右键 / 编辑弹窗 / 复位、刷新持久化、个人快照隔离、dense 无重叠，共 **36/36 PASS**；`final-check.js` 校验 `app.asar` 内前端、CSS、服务端三处尺寸代码同步。

---

## 阶段 10：Navio 改名 · 58 个站点 · 分类单页切换（历史）

你在页面上把不需要的图标删掉后明确「留下的都是我要的」，同时要求分类不要堆在同一页、项目彻底改名。阶段 10 因此做了三件事；此形态已被阶段 11 / 12 取代，**当前最终形态见「阶段 12」章节**。

### 1. 全项目改名 Navio

- 目录：源码 `C:\AI使用\navio-win`、交付 `C:\AI使用\NavioServer`、回归资产 `C:\AI使用\navio-tmp`；可执行文件 `Navio.exe`、压缩包 `Navio-2.0.0-win-x64.zip`。
- 共 251 个文件 / 1704 处替换：项目名的三种大小写、`window.navio` 全局对象、`NAVIO_PRESETS` 预设常量、`renderer/navio-http.js` Web 兼容层文件名、`NAVIO_*` 环境变量前缀、`navio-boot.log / navio-crash.log` 日志文件名、`navio_sid / navio_anon` 会话 Cookie 名，全部统一为 Navio 系列。源码、文档与交付包内均不再出现旧项目名。
- **改名不掉线**：`src/auth.js` 的 `sessionToken()` 先按新键名取值，取不到就遍历 Cookie 里的所有值，只要命中任意未过期会话即认定登录。浏览器里仍带着旧键名 Cookie 的用户刷新后保持登录态，不用重新输密码。

### 2. 默认公共模板 = 你亲自留下的 58 个站点

以账号快照 `spaces.u_admin.bookmarks` 为**唯一权威来源**（不再用早期 94 站点全集，也不用中途挑的 40 个清单），由 `C:\AI使用\navio-tmp\build-catalog.js` 生成 `renderer/presets.js`（`version: 4`）：

| 分类 | 站点数 |
|---|---|
| 常用 | 24 |
| AI 工具 | 4 |
| 开发 | 3 |
| 社区资讯 | 3 |
| 影音娱乐 | 5 |
| 购物生活 | 2 |
| 效率办公 | 6 |
| 设计素材 | 2 |
| 学习阅读 | 3 |
| 云与运维 | 6 |
| **合计** | **58** |

- 你当前 `g_common` 里的 24 个原样进「常用」，其余按标题归入 9 个预设分类；10 个分类均非空、无重复 URL、总数守恒。
- 图标包仍保留 94 枚官网真实 favicon 与 94 枚 128×128 归一化 PNG——多出来的只是不展示，需要时可随时加回目录。
- `tools/migrate-catalog.js` 把顶层公共书签从 94 收敛到 58 并同步所有个人快照：保留自建书签、私有标签与 `size / clickCount / icon / title`，按 URL 继承旧字段，新书签直接写正确的分类 id，不留悬空 `groupId`。迁移前自动备份 `data.json / users.json / sessions.json / server.json`。

### 3. 分类单页切换

- 首页第一屏**只显示「常用」**（24 张卡片）；`#groupTabs` 从顶部工具条移到主区 Hero 下方，变成分类导航条。
- 点某个分类，主区**只渲染该分类**的卡片（例如「AI 工具」只出现 4 张），不再把所有分类纵向堆在一页；侧栏「我的标签」、面包屑与总数统计随当前分类联动。
- `renderer/app.js` 的 `UI.tab` 恒为某个有效分组 id（不再有 `all`），`render()` 会把非法 tab 自动纠正回首个公共分组。
- `src/spaces.js` 的 `project()` 通过 `presetCatalog()` 生成「常用 + `g_cat_*`」共 10 个公共分组，按 host 把公共书签投影过去；私有分组一律原样保留。

### 验证

`_test_groups.js` **39/39 PASS**（10 分类投影 / host 归类 / 旧快照兼容 / 私有分组保留 / 迁移幂等 / 无悬空 groupId）；`_verify_home.js` **48/48 PASS**（默认 1 个区块 24 张 / 10 个分类导航 / 点「AI 工具」只出 4 张 / 侧栏总数 58 / 私有标签需主动点击）；`_test_site_icons.js` **63/63 PASS**（58 站点全部收录）；全套 `run-all.js` `TOTAL_JOB_FAILURES=0`、产物 `final-check.js` `ARTIFACT_FAILS=0`、线上只读 `verify-live.js` `LIVE_FAILS=0`。


## 阶段 11：只留「常用」· 左侧分类栏 · 系统分类图标（历史，形态已被阶段 12 部分取代）

你在阶段 10 基础上又删掉一批图标，并要求：预设站点全部归入一个叫「常用」的分类；分类不要在搜索栏下方显示、改到左侧竖栏；分类要有自己的图标，系统预设一批分类图标。

> 注：本章描述的「左侧竖栏拆成『书签分类 / 我的标签』两区」已在阶段 12 被**统一连续列表**取代；51 站点单「常用」分类、顶栏隐藏、系统分类图标三点仍然有效。

### 1. 预设目录收敛为 51 站点 / 单分类

- 以你账号快照当前保留的 **51 个**站点为唯一权威（阶段 10 是 58），`renderer/presets.js` 升到 `version: 5`：只有一个 `p_common / 常用` 分组，51 个站点全部归入，分类自带 `iconKey: 'star'`。
- `src/spaces.js` 的 `project()` 把所有公共书签（含旧的 `g_cat_* / g_more / g_public`）统一投影到唯一 `g_common`；`presetCatalog()` 只输出「常用」一组，并带上系统预设分类图标（data URI）。
- `tools/migrate-catalog.js` 把顶层公共模板从 58/10 组收敛到 **51/1 组**，并同步所有个人快照；按 URL 继承 `size / clickCount / icon / title`，保留自建书签、私有标签（本次线上有 2 个「1111」），不留悬空 `groupId`。迁移前完整备份到 `C:\AI使用\navio-tmp\pre-stage11-backup`。
- 图标包仍保留 94 枚官网真实 favicon 与 94 枚归一化 PNG，只是不全部展示，需要时随时加回。

### 2. 分类移到左侧竖栏，删除搜索栏下方横条

- 搜索栏下方的 `#groupTabs` 分类横条**视觉彻底隐藏**（`display:none !important`），DOM 保留供点击委托与状态同步。
- 左侧竖栏拆成两区：「**书签分类**」（`#sideCatNav`，公共、人人可见）与「**我的标签**」（`#sideNav`，私有、仅自己可见）。「常用」分类显示在书签分类栏并带系统预设图标。
- `renderer/home.js` 的 `syncNav()` 按 `scope` 分流：公共分类进 `#sideCatNav`、私有标签进 `#sideNav`，两者都可点击切换，面包屑与统计同步联动。

### 3. 系统预设分类图标库

- `src/preset-icons.js` 内置图标库：约 80 枚品牌图标 + 19 枚分类图标（常用/开发/云/AI/文档/购物/影视/游戏/工具等），零外部依赖、离线可用。分类图标走 `categoryIcon(iconKey)` 解析成 SVG data URI，随分组数据下发。
- 服务端提供 `/api/preset-icons` 与 `/api/preset-icon`；前端兼容层 `window.navio.presetIcons()`。
- 新建 / 编辑分组弹窗增加「分类图标」点选网格：私有分组可选任意系统预设图标，选中随分组 `icon` 字段持久化（`store.js` 已支持 `group.icon`）；不选则按名称首字符显示。

### 验证

- `_test_groups.js` **40/40 PASS**（51 站点 / 唯一「常用」分类 / 分类图标 data URI / 迁移数据安全 / 幂等 / 私有分组保留 / 无悬空 groupId）；
- `_verify_home.js`（默认 1 区块 51 张 / 左侧分类栏带图标 / 顶栏隐藏 / 侧栏统计 51 / 私有隔离）、`_test_site_icons.js`（51 站点全部收录）、`_test_card_sizes.js`、`_test_public.js` 全部同步更新；
- 全套 `run-all.js`、产物 `final-check.js` / `verify-package-clean.js`、线上只读 `verify-live*.js` 均零失败。具体计数见文末「验证」章节。

---

## 阶段 12：单书签图标背景色 · 左侧分类栏弱化区分（当前最终形态）

你提出两点：书签图标要能自定义背景颜色、系统预设几种颜色供选择；左侧「我的标签」和公共分类不需要区分得那么明显。阶段 12 是**当前交付的最终形态**。

### 1. 系统预设色板 + 单书签背景色

- 新增 `src/preset-colors.js` 作为**唯一真源**：12 项色板 = 1 个「无背景」+ 11 个预设色（晴蓝 / 靛蓝 / 紫罗兰 / 玫粉 / 珊瑚红 / 暖橙 / 青柠 / 翠绿 / 蓝绿 / 天青 / 石板灰），色值一律 6 位小写 hex。前端 `renderer/presets.js` 同步导出 `NAVIO_PRESETS.bgColors`，`_test_icon_bg.js` 逐项断言两份完全一致，防止漂移。
- 书签新增可选字段 `bgColor`。`store.normalize()` 只接受**精确匹配预设色板**的值，其它（含 `url(...)`、`#fff;position:fixed`、大写 hex 等）一律丢弃 → 天然免疫 CSS 注入；旧数据不带该字段时归一化结果逐字段不变。
- `spaces.template() / project() / annotate()` 逐层透传，`tools/migrate-catalog.js` 按 URL 继承；改动随**个人快照**保存，顶层公共模板永不被 Web 端写入（与 `size` 同一套隔离语义）。
- 卡片渲染只给 `.ico` 加底色（`--ico-bg-soft` 柔和半透明 + 细描边），不污染卡片本身；**默认无背景时与阶段 7 视觉完全一致**（48×48 图标、纯透明、padding 0）。
- 三个入口：右键「图标背景色…」（点选即时生效）、编辑弹窗「图标背景色」（可回显 / 清除）、设置抽屉「恢复无背景」一键复位。右键 / 尺寸弹窗另有「全部恢复无背景」。
- 服务端新增只读接口 `/api/preset-colors`（游客可用），返回 `{ok, total, items}`。

### 2. 左侧分类栏改为统一连续列表

- 移除「书签分类 / 我的标签」两个分区标题，以及「公共 · 人人可见 / 仅自己可见」说明文字；改用一个轻标题「分类」。
- `#sideCatNav` 与 `#sideNav` 两个 DOM **保留**（app.js 点击委托、home.js 分流、既有 E2E 断言都依赖），但包进同一个 `.side-scroll` 滚动容器，一个滚动条、无分块感，视觉上就是一条连续列表。
- 自建标签不再用随机高饱和彩色方块，统一改为低调中性图标（`ico-plain`），与公共分类的系统预设图标并排不形成色块断层。
- 文案同步中性化：「新建我的标签」→「新建标签」、「个我的标签」→「个标签」、身份提示去掉「仅自己可见」，空态提示压到最轻。
- 主区卡片上的「我的」角标与分组徽标保持不动（用户明确指出的是左侧分类栏，且它们是现有隔离验证断言的依据）。

### 验证

- 新增 `_test_icon_bg.js`：**53/53 PASS**（前后端色板一致性 / 白名单与注入防护 / 逐层透传 / 迁移继承 / 文件往返 / 静态侧栏检查 + 真实 Chromium E2E：默认零变化、色板点选即时生效、多书签独立、编辑弹窗回显、刷新持久化、身份隔离、顶层模板不写入、一键复位、统一连续列表）。
- 新增线上只读验收 `verify-bg-live.js`：用现有有效会话 token，**只打开弹窗查看、不点选**，并在验收前后逐字节比对 `data.json` 与全部尺寸设置，确保不污染用户真实数据。断言不写死用户的具体尺寸值（历史踩坑：写死 `2x1` 会在用户自行改回 `1x1` 后误报）。
- `preflight.js` / `final-check.js` / `verify-package-clean.js` / `verify-pkg.js` 补入阶段 12 断言；`run-all.js` 加入新 job。截图 `shot-icon-bg-picker.png`、`shot-sidebar-unified.png`、`shot-live-stage12.png`。
- 最终全套回归 **35 个 job 全部 `exit=0`**，`TOTAL_JOB_FAILURES=0` / `ARTIFACT_FAILS=0` / `PACKAGE_FAILS=0` / `PREFLIGHT_FAILS=0`；`verify-pkg.js` **24/24**（含打包版色板接口）；线上六项只读验收 `LIVE_FAILS=0` / `LIVE_ICON_FAILS=0` / `LIVE_SIZE_FAILS=0` / `LIVE_TAB_FAILS=0` / `ICON_PICKER_FAILS=0` / `STAGE12_LIVE_FAILS=0`。

### 构建修复：`pack-asar.js` 挂起导致构建超时

首轮回归里 `build-portable.js` 卡在 `[2/5] 重建 app.asar` 直到 7 分钟超时，连带 `[3/5] 同步文档`、`[5/5] 打 zip` 未执行 → README 三处不一致、zip 未更新。根因：`asar.createPackage()` 写完后，`fs.rmSync(tmpRoot, {recursive:true})` 递归删除 188+ 个图标文件会被本机 `NODE_OPTIONS` 的 safe-delete shim 挂起，进程因此永不退出，而 `build-portable.js` 用 `spawnSync` 等待它。

修复：产物确认落盘后把临时目录清理改成 detached 子进程异步 `fire-and-forget`，主进程立即 `process.exit(0)`。清理本就是 best-effort，残留目录位于 `C:/AI使用/navio-tmp`，无关交付正确性。修复后 `pack-asar.js` 12.8 秒正常退出、完整构建 80 秒走完 5 步，全套回归耗时由 **11 分 14 秒降到 5 分 16 秒**。


---

## 内置自绘图标库（最后兜底）

`src/preset-icons.js` 自带 **151 枚**自绘 SVG 图标：约 133 个常见站点（GitHub、B站、知乎、微博、淘宝、京东、YouTube、Notion、ChatGPT、阿里云、腾讯云、Steam…）+ 18 个用途分类（开发、AI、云、文档、购物、影视、音乐、社交、资讯、金融、教育、游戏、邮箱、网盘、工具、设计、搜索、网址）。

- 现在**只在前四级都失败时才用到**，不再是推荐书签的默认图标。
- 图标都是「品牌色渐变圆角底 + 字形/几何符号」，自绘，不用第三方 logo 素材。
- Web 端也可通过 `navio.presetIcons('github')` 拿图标库列表、用 `/api/preset-icon?url=` 拿单枚 SVG，供「选图标」弹窗使用。
- 扩展：往 `src/preset-icons.js` 的 `BRANDS` / `CATEGORIES` 数组加一行即可，格式 `[id, 名称, 颜色, 字形, '域名 域名', '关键词 关键词']`。

---

## 与同类 PHP 书签导航的功能对照

| 层 | 同类 PHP 版 | Navio Server 当前 |
|---|---|---|
| 运行 | PHP + Nginx + MySQL | Electron 内嵌 Node HTTP + JSON 文件 |
| 远程访问 | Web 站点 | ✅ Web 端口（9200，可改） |
| 桌面端 | 无 | ✅ 服务端控制台 + 托盘 |
| 账号 | 多用户 / 用户组 / 管理员 / 冻结 / token / 登录 IP | ✅ 多用户（独立空间）、管理员、禁用、会话、登录失败锁定、登录 IP |
| 书签 | link + link_folder + history | ✅ 分组 / 卡片 / 拖拽 / 搜索 / 点击计数 / **每个图标独立占格 1×1 ~ 2×2** |
| 图标 | linkstore 官方图标库 | ✅ 94 枚官网真实 favicon（离线内置 / 纯透明 / 统一 128×128）+ 在线抓取 + 151 枚自绘 SVG + 字母兜底 |
| 外观 | wallpaper 壁纸库、config 全量配置 | ✅ 8 套预设、本地图片上传、主题/强调色/卡片尺寸 |
| 导入导出 | 浏览器书签 | ✅ Chrome/Edge/Brave 自动探测 + HTML/JSON 导入导出 |
| 数据安全 | MySQL 备份 | ✅ 原子写、滚动备份、损坏自愈、控制台校验修复 |
| 搜索引擎 | search_engine + 用户自定义 | ✅ 内置 7 个引擎，搜索栏可随时切换、联网搜索、持久化（自定义 URL 待补） |
| 卡片组件 | 天气、热搜、电子木鱼、记事本、每日诗词、日历、待办、倒计时、纪念日、今天吃什么 | ✅ 第一批 4 个（待办/日历/天气/记事本）已实现，可编辑、可开关、刷新保持；其余 6 个待补 |
| 笔记 / 待办 | note、plugins_todo(+分类+权重) | ✅ 多条笔记 + 待办勾选/日期关联已实现；分类与权重待补 |
| 页脚标签 / 访问历史 / 文件上传 | tabbar、history、file | ⏳ 阶段 2 |
| 浏览器扩展 / 邮件 / 在线升级 / 卡片商店 | 有 | ⏳ 阶段 2 评估 |

> 说明：v2 主干（远程 Web 访问 + 账号体系 + 数据管理 + 内置图标库）已交付；阶段 2 第一批组件已接上 UI，全程复用预留字段，没有改存储结构、没有引入数据库。

---

## 卡片组件（阶段 2 第一批）

顶部工具条的 **▦ 组件** 按钮打开管理弹窗，可单独开关每个组件，或整体隐藏/显示面板。默认启用 4 个：

| 组件 | 能做什么 | 数据去向 |
|---|---|---|
| 待办事项 | 回车快速添加、勾选完成、删除；在日历选好日期后，新待办自动带上该日期 | `data.json → todos[]` |
| 日历 | 当月月历、今天高亮、有待办的日子标圆点，可前后翻月 | 读 `todos[].due` |
| 天气 | 「联网获取」经服务端代理查 Open-Meteo（免费、无需 Key）；失败或离线时「手动填」照样可用 | `data.json → widgets[].data` |
| 记事本 | 多条笔记，标题 + 正文，点击编辑、可删除 | `data.json → notes[]` |

**天气为什么走服务端**：页面 CSP 是 `connect-src 'self'`，浏览器不能直接请求外部 API。`GET /api/weather?city=北京` 由 Node 主进程代查（地理编码 → 实时天气），单次超时 6 秒，失败返回 `{ ok:false, error }`，不会拖垮服务；手动填写的结果同样落盘。

所有组件数据与书签、分组、设置一起写在**同一个 `data.json`**，沿用原子写 / 滚动备份 / 多用户 `spaces[uid]` 隔离。刷新页面即可验证持久化。组件面板与书签网格互不干扰，浅色 / 深色主题均适配。

---

## 数据文件

默认位置：

- 打包态：`%APPDATA%\Navio\navio-data\`
- 便携版：exe 同级 `data\`（目录里放空的 `portable.flag` 即启用）

```
data.json           公共书签模板（顶层 groups/bookmarks）+ spaces[身份ID] 个人快照 + 设置/组件数据
data.json.bak       上一版快照
users.json          账号与 scrypt 密码哈希（绝无明文）
sessions.json       持久会话
server.json         端口/绑定/鉴权/白名单/HTTPS 配置
INITIAL_ADMIN.txt   首次生成的初始密码（改密后请删除）
backups/            滚动备份，保留 30 份
favicons/           抓取到的网站图标缓存
wallpapers/         上传的壁纸
```

仍是**纯文本 JSON**，记事本能打开，复制一个文件就是全量备份。账号数据在同一批文件里，不走数据库。

> 顶层 `groups / bookmarks` 是**公共模板**，不要手动往里加私有内容；Web 端的个人改动都在 `spaces` 里（上限 2000 个身份，逐份校验清洗）。交付 zip 已排除 `data/`，解压到新机器是干净安装，不会带上宿主机的账号密码与私有书签。

---

## 安全设计

| 项 | 实现 |
|---|---|
| 密码 | scrypt(N=16384, r=8, p=1) + 16 字节随机盐，`timingSafeEqual` 校验 |
| 会话 | 32 字节随机 token，`HttpOnly; SameSite=Lax; Path=/` Cookie，默认 7 天，持久化到 sessions.json |
| 登录限流 | 按 `IP|用户名` 计数，默认连续 5 次失败锁定 15 分钟 |
| IP 白名单 | 支持精确 IP 或网段前缀，入口层直接拒绝 |
| 请求限流 | 每 IP 每分钟 600 次 |
| 响应头 | `X-Content-Type-Options`、`X-Frame-Options: DENY`、`Referrer-Policy`、CSP（禁止 inline script / object / frame 嵌套） |
| 管理面隔离 | 账号/端口/重启/清空数据只走本地 IPC，HTTP 上返回 404 |
| 路径穿越 | 静态文件 `safeJoin` 校验，壁纸文件名 `path.basename` + 字符白名单 |
| HTTPS | 可填 cert/key 路径启用；自签证书或由反向代理终结 TLS |
| 多用户隔离 | 每个账号独立书签空间，互不可见；全量数据仍在一个 data.json |
| 公共起始页 | 游客只读白名单接口；公共模板不可被 Web 端改写；匿名身份用 HttpOnly Cookie，不暴露账号信息 |
| 导出边界 | `/api/export` 只导出当前身份视图，不含 `spaces`；`/api/restore` 仅管理员 |

---

## HTTP 接口（用户侧）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` / `logout` | 登录 / 登出 |
| GET | `/api/auth/session` | 当前会话 |
| POST | `/api/auth/password` | 修改自己的密码 |
| GET/POST | `/api/state` | 读取 / 保存**当前身份**的视图（游客白名单） |
| POST | `/api/state/flush` | 关页前同步落盘 |
| POST | `/api/state/reset` | 丢弃当前身份快照，回到公共起始页 |
| GET | `/api/stats` / `backups` / `preset-icons` | 统计 / 备份列表 / 图标库 |
| GET | `/api/icon?host=` | 图标五级降级（真实图标包优先，命中带 `X-Navio-Icon: site`） |
| GET | `/api/preset-icon?url=&title=` | 单枚内置 SVG |
| POST | `/api/icon/refresh` / `/api/wall/upload` | 重抓图标 / 上传壁纸 |
| POST | `/api/backup` / `restore` / `export` / `import` | 备份恢复 |
| GET | `/api/bookmarks/detect` | 探测宿主机 Chrome/Edge/Brave 书签 |
| POST | `/api/bookmarks/import-browser` / `import-html` / `export-html` | 书签导入导出 |
| POST | `/api/open-external` / `copy` | Web 端由前端直接实现 |

游客白名单：`/api/state`、`/api/state/flush`、`/api/state/reset`、`/api/weather`、`/api/icon`、`/api/preset-icon*`、`/api/preset-icons`、`/api/auth/session`、`/api/wall`、`/api/copy`、`/api/open-external`、书签 HTML 导入导出。`/api/stats`、`/api/backups`、`/api/restore`、`/api/bookmarks/detect`、`/api/bookmarks/import-browser` 等需要登录；`/api/restore` 还需管理员。

---

## 项目文件

```
main.js                  Electron 主进程：服务宿主、控制台窗口、托盘、管理 IPC、GPU 崩溃自愈
preload.js               contextBridge → window.navioAdmin（控制台专用）
src/server.js            零依赖 HTTP(S) 服务：静态托管、鉴权、API、图标降级、多用户空间
src/auth.js              账号/会话/密码哈希/限流/IP 白名单（users.json + sessions.json）
src/config.js            服务端配置（server.json）
src/preset-icons.js      151 枚内置图标 + 匹配算法 + SVG 生成
src/store.js             JSON 单文件存储（原子写、滚动备份、损坏自愈、扩展字段）
src/favicon.js           favicon 抓取与磁盘缓存
src/site-icons.js        内置真实站点图标包加载器（host → std/ 归一化 PNG，缺失回退原图）
tools/fetch-site-icons.js 构建期批量抓取 94 个官网真实 favicon（可反复运行）
tools/normalize-site-icons.js 构建期归一化：25 种尺寸 → 统一 128x128 透明 PNG（阶段 7）
tools/migrate-icons.js   历史数据 icon 字段迁移（纯函数、幂等）
tools/merge-groups.js    顶层分组 11 → 2 合并（阶段 5）
renderer/site-icons/     94 枚官网原始 favicon + map.json + report.json（随 asar 打包）
renderer/site-icons/std/ 94 枚归一化 128x128 透明 PNG + normalize-report.json（随 asar 打包）
src/importer.js          Netscape HTML / Chromium Bookmarks JSON 解析
renderer/index.html      Web 书签页（登录后才可下载）
renderer/navio-http.js    Web 端 window.navio 兼容层（复用整套书签 UI）
renderer/app.js          书签 UI 全部逻辑（1711 行，两端共用）
renderer/login.*         登录页
renderer/console.*       桌面端服务端控制台
tools/pack-asar.js       秒级重建 app.asar（不跑完整打包）
```

---

## 打包（一键重建，幂等）

```bat
打包EXE.bat
```

等价于 `node tools\build-portable.js C:\AI使用\NavioServer`，依次做五件事：

1. 探测本机 Electron 运行时（`node_modules\electron\dist` 或 `D:\electron-dist`）；目标目录缺 exe 才复制，已存在则跳过。
2. 调用 `tools/pack-asar.js` 从源码重建 `resources\app.asar`（逐文件复制，不用会崩的 `fs.cpSync`）。
3. 同步 `README.md` 到交付目录与 `win-unpacked`。
4. 收集预览截图到 `shots\`。
5. 用 `7zip-bin` 的 `7za.exe` 打 zip（失败自动回退 PowerShell `Compress-Archive`）。

全程**不跑 `electron-builder`、不写 `C:` 盘临时区** —— 本机 C 盘长期 0 字节空闲，NSIS 要在 C: 建 mmap，会直接报 `Internal compiler error #12345`。产物固定为：

```
C:\AI使用\NavioServer\win-unpacked\Navio.exe
C:\AI使用\NavioServer\Navio-2.0.0-win-x64.zip
C:\AI使用\NavioServer\README.md
```

只改了源码想秒级验证打包版，不必重新打 zip：

```bat
node tools\pack-asar.js C:\AI使用\NavioServer\win-unpacked\resources\app.asar
node _verify_v2.js C:\AI使用\NavioServer\win-unpacked\Navio.exe C:\AI使用\navio-tmp\pkg-e2e
```

> `打包EXE.bat` 已显式清空 `ELECTRON_RUN_AS_NODE`，避免从某些终端启动时 Electron 退化成纯 Node 静默 exit 0。

---

## 验证

```bat
node _test_core.js      :: 存储/解析单测
node _test_server.js    :: HTTP 服务集成测试（纯 Node，无需 Electron）
node _test_public.js    :: 公共模板 + 个人快照隔离语义（纯 Node）
node _test_groups.js    :: 常用 + 9 预设分类投影 / 58 站点迁移 / 旧快照兼容（纯 Node）
node _test_site_icons.js :: 真实图标包完整性 / 归一化规格 / 迁移纯函数 / 离线优先级（纯 Node）
node tools/normalize-site-icons.js --check :: 归一化产物 94 枚 128x128 PNG 校验（纯 Node）
node _verify_v2.js      :: 真实 Electron 控制台 + 真实 Chromium Web 登录
node _test_widgets.js   :: 组件数据层 + 天气代理（纯 Node）
node _verify_widgets.js :: 真实 Chromium 组件交互 + 刷新保持
node _verify_home.js    :: 真实 Chromium 公共起始页（游客/隔离/我的标签/主题/截图）
node _test_card_sizes.js :: 单书签独立占格（纯 Node 单元 + 真实 Chromium E2E）
node _test_icon_bg.js    :: 阶段 12 图标背景色 + 左侧分类栏弱化（纯 Node 单元 + 真实 Chromium E2E）
```

当前结果：

| 测试 | 结果 |
|---|---|
| `_test_core.js` | **29/29 PASS** |
| `_test_server.js` | **52/52 PASS**（公共模式断言 / 会话失效 / 快照落盘 / **真实图标包优先（归一化 PNG）+ 自绘 SVG 兜底仍在**） |
| `_test_public.js` | **47/47 PASS**（游客免登录 / 匿名 Cookie / 游客间与账号间隔离 / 公共模板不可改写 / 登录后继承 / 导出边界 / 关闭公共模式回退） |
| `_test_groups.js` | **40/40 PASS**（51 站点归入唯一「常用」/ 分类图标 data URI / 旧快照兼容 / 私有分组保留 / 身份隔离 / 迁移幂等且不动其它字段 / 无悬空 groupId） |
| `_test_site_icons.js` | **63/63 PASS**（94 枚图标文件头合法 / 无占位图污染 / www 双向 host 匹配 / **归一化 94 枚全部 128×128 / report 标记 / find 优先归一化 + 原图可回退** / 迁移纯函数与幂等 / 关闭在线抓取仍返回真实图标 / 包外域名仍走自绘兜底） |
| `_verify_v2.js` | **27/27 PASS**（控制台 7 页签 + Web 登录/搜索/主题/图标，JS 错误 0） |
| 打包版 exe HTTP 端到端 `C:\AI使用\navio-tmp\verify-pkg.js` | **24/24 PASS**（登录/会话/静态资源/管理面隔离/**系统预设色板接口随包发布**/**离线真实图标包 + 包外自绘兜底**/Web 写入落盘） |
| `_test_widgets.js` | **27/27 PASS**（组件数据往返、天气代理、多用户隔离） |
| `_verify_widgets.js` | **29/29 PASS**（真实浏览器：增删改/日历/天气/笔记/开关/刷新保持，JS 错误 0） |
| `_test_card_sizes.js` | **36/36 PASS**（4 种占格实测宽高与跨行列 / 默认 1×1 视觉零变化 / 右键与编辑弹窗 / 刷新持久化 / 个人快照隔离 / dense 无重叠 / 一键复位，JS 错误 0） |
| `_verify_home.js` | **48/48 PASS**（首页唯一「常用」51 张 / 左侧分类栏带系统图标 / 顶部横条隐藏 / 侧栏总数 51 / 游客改动只自己可见 / 账号间隔离 / 「我的」角标 / Hero / **搜索引擎下拉与切换 / 下拉层叠 7 项可点 / 联网按钮真的打开百度 / 设置抽屉同步 / 引擎持久化** / **卡片图标全部指向真实 favicon 且离线全部加载成功 / 容器纯透明零色块 / 统一 128×128** / 主题 / 深浅截图 / 图标不叠字，JS 错误 0） |
| `_test_icon_bg.js` | **53/53 PASS**（前后端 12 色板一致 / 白名单与注入防护 / 旧数据逐字段兼容 / spaces 逐层透传 / migrate 继承 / 文件往返 / 侧栏静态检查 + 真实 Chromium：默认零变化、色板即时生效、多书签独立、编辑回显、刷新持久化、身份隔离、顶层模板不写入、一键复位、统一连续列表） |
| 线上只读验收 `C:\AI使用\navio-tmp\verify-live*.js` | **LIVE_FAILS=0 / LIVE_ICON_FAILS=0 / LIVE_SIZE_FAILS=0 / LIVE_TAB_FAILS=0 / ICON_PICKER_FAILS=0 / STAGE12_LIVE_FAILS=0**（51 书签单「常用」/ 左侧分类栏带图标 / 顶栏隐藏 / 分类图标库 19 枚可加载 / 真实 favicon / 12 色板线上可用 / 统一连续列表 / **data.json 验收前后逐字节不变** / JS 错误 0） |
| 交付产物 `C:\AI使用\navio-tmp\final-check.js` | **ARTIFACT_FAILS=0**（app.asar / zip / README 三处一致 / 包内代码同步） |

---

## 故障排查

日志在 **exe 所在目录**的 `data\runtime\`：`navio-boot.log`（启动流水，64KB 滚动）、`navio-crash.log`（异常堆栈）。便携模式下所有运行文件都落 exe 同目录，不在 `%APPDATA%` 留痕。

| 现象 | 原因 / 处理 |
|---|---|
| 双击没反应 | 多为 GPU 进程 FATAL。已内置自愈：这次崩留下 `running.lock`，**下次启动自动切软件渲染**；托盘可一键切回硬件加速 |
| 从某些终端启动静默 exit 0 | 继承了 `ELECTRON_RUN_AS_NODE=1`，Electron 退化成纯 Node。命令行测试前先 `set ELECTRON_RUN_AS_NODE=` |
| 服务启动失败 / 端口被占用 | 控制台「服务与端口」改端口后「保存并重启」 |
| 局域网访问不到 | Windows 防火墙放行（控制台有现成命令），或确认绑定地址是 `0.0.0.0` |
| 忘记管理员密码 | 控制台「账号密码」页直接改密（本地 IPC，无需旧密码）；或删除 `users.json` 重新生成初始密码 |
| 公网访问但被 403 | 检查「访问安全」的 IP 白名单 |

---

## 已知限制 / 下一阶段

- 公共书签是**只读模板**：想让所有人永久看到改动，需在宿主机上改 `data.json` 顶层并重启，或由管理员在控制台维护；Web 端编辑一律落到个人快照。暂不做共享/协作与用户组可见性。
- 卡片组件还差 6 个（热搜 / 电子木鱼 / 每日诗词 / 倒计时 / 纪念日 / 今天吃什么），以及自定义搜索引擎 URL（内置 7 个已够用）、页脚标签、访问历史、文件上传 UI —— 数据层已预留，直接加 UI 即可。待办的分类与权重也待补。
- HTTPS 需要自备证书（或用反向代理），程序不内置证书签发。
- 无浏览器扩展、邮件通知、在线升级（Navio 的配套功能）。
- 仍是单实例单进程：托盘退出会停止 Web 服务。

---

## 近期更新（2026-11-19 ~ 11-24）

| 阶段 | 内容 | 验证 |
|---|---|---|
| iOS 长按冲突修复 | 粗指针设备禁用系统 `-webkit-touch-callout` / 文本选择，图标 `pointer-events:none`；长按成立清选择，并吞掉 iOS 补发的 `contextmenu`，避免菜单被错位重弹 | `_test_longpress.js` 34/34 |
| 多视图自动同步 | 服务端按身份维护 `rev`，`/api/state/rev` 轻量探测；前端 2.5s 轮询 + 同浏览器广播，变化才全量刷新；未保存 / 输入 / 弹窗 / 后台时门控不刷新；刷新保留分类、搜索词、滚动位置 | `_test_sync.js` 33/33 + `_test_sync_e2e.js` 12/12（双设备登录同一账号） |
| 搜索框纯网络搜索 | 输入时不筛选、不隐藏书签栏、不弹结果面板；回车走选中引擎，网址仍直达 | `_test_websearch.js` 21/21 |

以上改动均已重建 `app.asar` 部署到实际运行目录。交付包 `Navio-2.0.0-win-x64.zip` 由 `tools/build-portable.js` 一键生成（排除 `data/` 用户数据）。
