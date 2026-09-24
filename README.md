# Serverless Analytics

一个跑在 Serverless 环境里的埋点分析服务。客户端把事件**攒成批次提交**，服务端校验、补全后写入数据库，在看板里分析。

- **Serverless**：部署到 Cloudflare Workers（D1 + KV）或 Vercel（Postgres / Supabase），没有需要维护的服务器，空闲时几乎零成本。
- **分批次提交**：Web、Android、iOS、桌面端通过一个 HTTP 接口 `POST /v1/batch` 一次提交多个事件；整批只用一条 SQL 写入，带幂等 id，失败重试不会重复计数。
- **可自部署**：数据库、缓存、队列都通过环境变量切换，数据留在你自己的账号里。

![Overview](docs/images/02-overview-light.png)

## 功能与路线图

| 分类 | 功能 | 状态 |
| --- | --- | --- |
| 部署 | Cloudflare Workers + D1 + KV，默认使用 Queues | ✅ 已完成（dev 环境已上线） |
| 部署 | Vercel + Postgres / Supabase（Build Output API） | ✅ 已完成（尚未在 Vercel 上实际部署验证） |
| 部署 | 自定义域名、GitHub Actions 部署 | ✅ 已完成 |
| 上报 | 批量提交、gzip、幂等去重、时钟偏差修正、`sendBeacon` | ✅ 已完成 |
| 上报 | 可配置队列：直接写库 / 后台写入 / Cloudflare Queues / QStash | ✅ 已完成 |
| 上报 | 按 App 采样：全量或采样，按用户或按事件，按事件名设置采样率，按权重估算全量 | ✅ 已完成 |
| 上报 | 上报限流（防刷量） | 🗓️ 计划中 |
| 事件 | 自定义事件与属性定义，Permissive / Strict 两种校验模式，一键定义已上报的事件 | ✅ 已完成 |
| 分析 | 按平台、渠道、国家、地区、系统、版本、设备或任意属性分组和筛选 | ✅ 已完成 |
| 分析 | 指标：事件数、去重用户、人均次数、数值属性的求和与平均值 | ✅ 已完成 |
| 分析 | DAU / WAU / MAU、粘性 | ✅ 已完成 |
| 分析 | 漏斗（有序、转化窗口、分组对比、步骤耗时） | ✅ 已完成 |
| 分析 | 留存（按周期的同期群） | 🗓️ 计划中 |
| 分析 | 用户路径、单个用户的事件时间线 | 🗓️ 计划中 |
| 分析 | 保存常用视图、看板组合 | 🗓️ 计划中 |
| 错误 | `$error` 自动归类、趋势、影响用户数、版本分布、堆栈 | ✅ 已完成 |
| 错误 | 错误告警（邮件 / Webhook） | 🗓️ 计划中 |
| 错误 | Source map 还原堆栈 | 🗓️ 计划中 |
| SDK | Web / Electron / Node SDK（渠道识别、错误捕获） | ✅ 已完成 |
| SDK | iOS（Swift）/ Android（Kotlin）原生 SDK | 🗓️ 计划中（目前可以直接调用 HTTP 接口） |
| 访问 | 单管理员登录、`ADMIN_API_TOKEN` 读取 API | ✅ 已完成 |
| 访问 | 多用户、角色权限、SSO | 🗓️ 计划中 |
| 规模 | 按小时 / 天的预聚合；Analytics Engine / ClickHouse 适配 | 🗓️ 计划中 |
| 工程 | CI（类型检查、双数据库测试、构建、打包） | ✅ 已完成 |

| Explore（暗色） | 事件定义 |
| --- | --- |
| ![Explore](docs/images/03-explore-dark.png) | ![Events](docs/images/05-events-light.png) |

## 快速开始（本地）

需要 Node 20+ 与 pnpm。

```sh
pnpm install
cp apps/cloudflare/.dev.vars.example apps/cloudflare/.dev.vars   # 设置 ADMIN_PASSWORD
pnpm build                                                        # 构建看板与 SDK
pnpm --filter @serverless-analytics/cloudflare dev                # http://localhost:8787
```

打开 http://localhost:8787 → 输入密码 → **Initialize database** → **New app** → 按页面上的示例发送第一个事件。

开发看板时可以另开一个终端运行 `pnpm --filter @serverless-analytics/dashboard dev`（http://localhost:5173，API 会代理到 8787）。

## 部署

### Cloudflare（D1 + KV，推荐）

```sh
pnpm install
cd apps/cloudflare
npx wrangler login
npx wrangler secret put ADMIN_PASSWORD
cd ../.. && pnpm deploy:cloudflare
```

首次部署时会自动创建 D1 数据库和 KV 命名空间。默认使用 Cloudflare Queues，部署前先创建队列：`wrangler queues create serverless-analytics-events`，以及对应的 `-dlq` 死信队列。使用自定义域名时加上 `--domain analytics.example.com`。部署后打开站点，初始化数据库即可。改为直接写库或使用 Postgres（Hyperdrive）请参考 [配置文档](docs/CONFIGURATION.md)。

### Vercel（Postgres / Supabase）

1. 导入仓库，把 **Root Directory** 设为 `apps/vercel`（`vercel.json` 已包含安装与构建命令）。
2. 设置环境变量：`ADMIN_PASSWORD`、`DATABASE_URL`（Supabase 请使用 6543 端口的 Pooler 连接串）、`CRON_SECRET`；可选 `UPSTASH_REDIS_REST_*`、`QUEUE_DRIVER=qstash` 等。
3. 部署后打开站点并初始化数据库。

## 上报事件（批量）

客户端在本地排队，按「攒够 N 条」或「每隔几秒」打包成一批提交；页面关闭或 App 退到后台时立刻提交剩余事件。

```
客户端队列 ──(每批 ≤ 100 条，可 gzip)──▶ POST /v1/batch ──▶ 校验 / 补全 ──▶ 队列驱动 ──▶ 一条 SQL 写入整批
```

- 每个事件带客户端生成的 `id`，服务端按 `(app, id)` 去重，重试安全。
- 批次里的坏事件单独返回在 `rejected` 里，不影响同批其他事件。
- 带上 `sentAt`，服务端会修正设备时钟偏差。
- 写库方式由 `QUEUE_DRIVER` 决定：同步写入、后台写入，或经 Cloudflare Queues / Upstash QStash 再合并成更大的批次。


```sh
curl -X POST https://<your-deployment>/v1/batch \
  -H "Authorization: Bearer <write key>" -H "Content-Type: application/json" \
  -d '{"events":[{"id":"<uuid>","name":"purchase","anonymousId":"device-123","properties":{"plan":"pro","amount":29}}]}'
```

```ts
import { createAnalytics } from '@serverless-analytics/sdk'

const analytics = createAnalytics({
  endpoint: 'https://<your-deployment>',
  writeKey: '<write key>',
  flushAt: 20, // 攒够 20 条提交一批
  flushInterval: 5000, // 或每 5 秒提交一次
})
analytics.identify('user-42')
analytics.track('purchase', { plan: 'pro', amount: 29 })
```

完整协议（Android / iOS 等原生客户端对接）见 [HTTP API](docs/HTTP_API.md)。

## 文档

- [接入指南](docs/INTEGRATION.md)：凭据说明、各端上报方式、用 API 读取数据、常见分析场景
- [生产就绪评估](docs/PRODUCTION.md)
- [架构设计](docs/ARCHITECTURE.md)：技术选型、请求流、存储与方言层、队列语义、缓存、安全
- [配置参考](docs/CONFIGURATION.md)：全部环境变量、兼容矩阵、平台配置方法、配置向导问题树
- [上报协议](docs/HTTP_API.md)

## 开发

```sh
pnpm typecheck   # 所有包的类型检查
pnpm test        # core：同时在 SQLite（D1）与 Postgres（PGlite）上测试；sdk 单元测试
pnpm build
```

```
packages/core      平台无关的核心（Hono app、存储、KV、队列、上报）
packages/sdk       Web / Electron / Node SDK
apps/cloudflare    Cloudflare Worker 入口
apps/vercel        Vercel 入口（Build Output API）
apps/dashboard     看板（React + Vite + Tailwind）
```
