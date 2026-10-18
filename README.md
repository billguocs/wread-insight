# 细读 · 微信读书个人数据看板

基于微信读书 Agent API 的个人阅读数据网站：书架、阅读分析、笔记管理与导出、搜索与推荐，数据可随时刷新。
支持**多账号接入**（多人共用一个实例互不覆盖）与**跟随系统的明暗主题**。

## 快速开始

```bash
cd app

# 1) 安装依赖
npm install --registry=https://registry.npmjs.org
npm --prefix web install --registry=https://registry.npmjs.org

# 2) 构建前端
npm run build

# 3) 启动
npm start
```

打开 <http://127.0.0.1:8787>，在引导页粘贴微信读书 API Key 即可完成接入 —— **不需要改 `.env`**。

启动后会：
1. 校验 Key 是否可用；
2. 创建独立「档案」，密钥以前缀 + 后四位脱敏展示（`wrk-a1b2…c3d4`）；
3. 后台自动跑一次全量同步，界面可以边同步边浏览。

> 若想用已有采集数据快速填充（跳过首次同步），可先执行 `npm run seed`（需要项目根目录 `data/` 下有 `scripts/collect.py` 的产物）。

开发模式（前端热更新）：

```bash
npm start                       # 终端 A：后端
npm --prefix web run dev        # 终端 B：Vite，访问 http://localhost:5173
```

## 功能

| 页面 | 能力 |
| --- | --- |
| 我的书架 | 991 本电子书 + 有声书全览；搜索、按在读/读完/有笔记筛选、排序；点击查看简介、进度、双平台评分；一键跳转微信读书阅读 |
| 阅读数据 | 累计与逐年/逐月/逐周趋势、24 小时时段钟、分类与作者偏好、阅读画像 |
| 笔记管理 | 254 本书的划线原文与想法点评，按章节归组、全局关键词搜索、单本或全量导出 MD/JSON/CSV |
| 发现好书 | 「为你推荐」（与 App 首页一致）、书城搜索（电子书/有声书/网文/作者/书单）、相似推荐 |

顶栏：`快速刷新`（约 10 秒，统计 + 书架）、`全量同步`（约 30–60 秒，含全部笔记全文）、主题切换、账号菜单。

### 多账号接入

- 右上角账号菜单 → **添加账号**，再填一个 API Key 即可新增一个档案。
- 每个档案拥有**独立的快照与豆瓣缓存**（`storage/profiles/<id>/`），互不覆盖。
- 档案可随时切换、移除；移除会连本地缓存一起删除。
- API Key 用 AES-256-GCM 加密后存于 `storage/profiles.json`，主密钥在 `storage/.secret`（首次运行自动生成，权限 0600）。
  **密钥永不出现在任何接口响应里**，前端只知道脱敏提示。

### 主题

- 默认 `auto`：跟随系统 `prefers-color-scheme`，系统切换时页面实时变化。
- 点右上角图标循环切换 `auto → 浅色 → 深色`，选择记在本地。
- 图表用 CSS 变量着色，换主题会自动重绘。

## 架构

```
app/
├── server/src/
│   ├── config.js              环境变量集中校验（API Key 已改为可选，支持网页内接入）
│   ├── index.js               Express 引导、CORS、静态托管、优雅停机
│   ├── routes/api.js          路由层（只做参数解析与响应格式化）
│   ├── services/              业务层（不依赖 req/res，按 profile 隔离）
│   │   ├── shelfService.js      书架、书籍详情、豆瓣批量补全
│   │   ├── statsService.js      统计结构转换
│   │   ├── notesService.js      笔记查询、搜索、导出
│   │   ├── discoverService.js   推荐与搜索
│   │   └── syncService.js       同步编排（quick / full，按档案隔离状态）
│   ├── integrations/
│   │   ├── wereadClient.js      网关客户端（重试、鉴权、并发限制、Key 探测）
│   │   └── doubanClient.js      豆瓣评分抓取（多候选匹配 + 分层缓存 + 限速）
│   ├── repositories/
│   │   ├── profileStore.js      档案索引 + 旧数据迁移 + 加解密
│   │   └── snapshotStore.js     按档案隔离的磁盘快照（原子写入 + 写队列）
│   ├── middleware/
│   │   ├── context.js           requestId、访问日志、全局错误处理
│   │   └── profileContext.js    档案解析、requireProfile / requireApiKey
│   └── lib/                     logger、errors、secretBox（AES-GCM）
├── web/src/
│   ├── App.jsx                 hash 路由、引导态、同步状态、主题
│   ├── theme.js                主题 hook（auto/light/dark）+ 图表配色
│   ├── pages/                  Shelf / Analytics / Notes / Discover
│   ├── components/             ui.jsx、charts.jsx、Setup.jsx、ProfileMenu.jsx、BookDetail.jsx
│   └── api.js, hooks.js        类型化请求封装（自动带 X-Profile-Id）、useApi、同步轮询
└── storage/                    profiles.json、profiles/<id>/、.secret（均已 gitignore）
```

### 数据流

1. 请求带上 `X-Profile-Id` 头，服务端解析出该档案的 `{profileId, apiKey}`。
2. 读 `storage/profiles/<id>/snapshot.json` 到内存，首屏零等待。
3. 快照过期（快速 10 分钟 / 全量 12 小时）时**先返回旧数据**，后台自动触发同步。
4. 同步写盘用「临时文件（唯一名）+ 原子重命名」，每档案独立写队列，避免并发覆盖。

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/bootstrap` | 引导态：是否已接入、档案列表、当前档案 |
| POST | `/api/profiles/probe` | 校验 Key（不落库），返回阅读天数/时长 |
| POST | `/api/profiles` | 创建档案并触发首次全量同步 |
| PATCH/DELETE | `/api/profiles/:id` | 改名/换 Key、移除档案 |
| GET | `/api/health` `/api/ready` | 健康检查 |
| GET | `/api/meta` | 同步时间、数据量、豆瓣缓存统计 |
| POST | `/api/sync?mode=quick\|full` | 触发同步（202 已启动 / 409 正在运行） |
| GET | `/api/sync/status` | 同步进度（前端 1.5s 轮询） |
| GET | `/api/shelf` | 书架：`q` `filter` `sort` `limit` `offset` |
| GET | `/api/books/:bookId` | 书籍详情 + 进度 + 豆瓣/微读评分 + 我的笔记数 |
| POST | `/api/douban/batch` | 批量豆瓣评分（按需、带缓存，最多 30 条） |
| GET | `/api/stats/overview` `/trend` `/profile` | 统计、趋势、画像 |
| GET | `/api/notes/books` | 有笔记的书列表 |
| GET | `/api/notes/:bookId` | 单本笔记（按章节排序） |
| GET | `/api/notes/search` | 划线/想法全局搜索 |
| GET | `/api/notes/export?format=md\|json\|csv` | 导出（可选 `bookId` 导单本） |
| GET | `/api/discover/recommend` `/search` `/similar` | 推荐、搜索、相似 |

错误统一返回：

```json
{ "error": { "code": "invalid_request", "message": "…", "requestId": "3f35a1b2" } }
```

`428` 表示尚未接入账号或该档案未绑定 Key，前端据此跳转引导页。

## 微信读书接口与数据口径

| 接口 | 用途 |
| --- | --- |
| `/readdata/detail` | 统计（`overall` / `annually` / `monthly` / `weekly`） |
| `/shelf/sync` | 书架 |
| `/user/notebooks` | 笔记本概览（`count` + `lastSort` 游标分页） |
| `/book/bookmarklist` | 划线原文 |
| `/review/list/mine` | 想法与点评 |
| `/book/info` `/book/getprogress` | 详情与进度 |
| `/book/recommend` `/store/search` `/book/similar` | 推荐、搜索、相似 |

- **时长**：接口返回秒，前端统一换算。
- **笔记总数** = 划线 + 想法点评 + 书签；书签只有数量，无正文。
- **书架总数** = 电子书 + 专辑/有声书 + 文章收藏入口。
- **评分量纲**：`/store/search` 返回 93，`/book/info` 返回 910，服务端统一归一化到 10 分制。
- **进度** `progress` 是 0–100 整数，1 表示 1%。
- **相似推荐** `/book/similar` 的 `maxIdx` 必须显式传（哪怕 0），否则上游报 `errcode -2003`。

## 关于豆瓣评分

豆瓣无公开 API，采用「搜索建议接口 + 详情页解析」：

1. 书名依次尝试多个候选（原标题 → 去括号 → 去「套装/全集/修订版」等修饰），
   因为豆瓣对含括号的标题常返回 0 结果。
2. 按标题相似度 + 作者匹配打分，低于阈值判定为不匹配。
3. **分层缓存**（按档案隔离）：命中长缓存（30 天）；确认无匹配短缓存（6 小时）；抓取失败**不缓存**，下次重试。
4. 全局限速（并发 2、间隔 350ms），失败静默降级为「暂无评分」，不影响主流程。

## 安全

- API Key 仅存服务端，AES-256-GCM 加密落盘，接口只返回脱敏提示。
- `X-Profile-Id` 只是选择器、不是凭证；无有效档案时接口返回 428，不泄露任何数据。
- 日志脱敏：`apiKey` / `authorization` / `token` / `password` 等字段输出为 `[redacted]`。
- CORS 仅放行同源与本地开发端口，生产不使用通配符。
- 5xx 只返回「服务器内部错误」，堆栈只进日志。

## 已知限制

- 无登录鉴权，默认按本机私有部署设计。若要发布公网，**必须先加访问口令**，否则同网络内任何人都能接入/查看。
- 书架 991 本的豆瓣评分是**按需渐进加载**（首屏补前 12 本），详情页即时查询。
- 阅读日历热力按「月」粒度，因上游未提供每日明细（`dailyReadTimes` 为空）。
- 全量同步受上游限流影响，偶发单个年份/单本书抓取失败，失败会自动跳过并保留上次数据。
