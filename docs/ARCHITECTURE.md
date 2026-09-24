# 架构设计

## 目标与边界

- **单用户、多 App**：一个部署服务一个管理员，管理多个 App（每个 App 一个 write key）。不做团队 / 多租户。
- **Web 优先**：看板是 Web 应用，与 API 部署在同一个 Serverless 服务上；任何客户端通过 HTTP 上报。
- **可移植**：同一份代码运行在 Cloudflare Workers 与 Vercel；数据库、KV、队列都可以通过配置切换（见 [CONFIGURATION.md](./CONFIGURATION.md)）。
- **默认简单**：零配置默认值（D1 + KV + 同步写入）即可跑起来，复杂组件都是可选项。

## 技术选型

| 层 | 选择 | 理由 |
| --- | --- | --- |
| 运行时 / 框架 | TypeScript + **Hono** | 基于 Web 标准（`Request`/`Response`），同一个 app 可直接跑在 Workers、Vercel（Node）、Deno、Bun |
| 数据访问 | **Kysely** + 薄方言层 | 一套类型安全的查询同时编译到 SQLite（D1）和 Postgres；方言差异集中在一个文件里 |
| 校验 | **Zod** | 上报数据与管理 API 的输入校验 |
| 看板 | **React 19 + Vite + Tailwind v4**，Geist 字体 | 纯静态 SPA，由平台 CDN 直接分发；无服务端渲染依赖，部署到哪里都一样 |
| 数据请求 | TanStack Query + wouter | 缓存、轮询（Live）、切换筛选时保留上一帧；路由和筛选状态都放在 URL 里 |
| 图表 | 自绘 SVG | 不引入重型图表库；按统一的数据可视化规范绘制（细线、发丝网格、十字准线、键盘可操作） |

## 请求流

```
客户端 SDK / 任意 HTTP 客户端
   │  POST /v1/batch（write key，批量、gzip、幂等 id）
   ▼
┌──────────────── Hono app（packages/core）────────────────┐
│ 1. 读取请求体（限制大小，支持 gzip）                        │
│ 2. write key → App        （L1 内存 30s → KV 5min → DB）   │
│ 3. 校验每个事件；strict 模式按事件定义校验（同样走缓存）      │
│ 4. 补全：时钟偏差修正、国家、语言、UA 解析                    │
│ 5. queue.enqueue(rows)                                      │
│      direct      → 同步写库                                  │
│      background  → waitUntil 写库                           │
│      cloudflare  → Cloudflare Queues → 消费者批量写库         │
│      qstash      → QStash → /api/queue/qstash → 写库          │
└─────────────────────────────────────────────────────────────┘
   写库：一条语句写入整批（INSERT … SELECT FROM json_each / jsonb_to_recordset），
        按 (app_id, id) 冲突忽略 → 天然幂等
```

看板 `/*` 是静态资源；`/api/*` 是 Cookie 会话保护的管理与查询 API；`/api/cron/retention` 与 Cloudflare Cron 执行数据保留清理。

## 代码结构

```
packages/core        平台无关的全部逻辑
  src/config.ts        环境变量 → 配置（配置约定）
  src/db/              schema、迁移、方言层、Repository、D1 与 Postgres 连接
  src/kv.ts            KV 驱动 + 两级缓存
  src/queue.ts         队列驱动 + QStash 签名校验
  src/ingest/          上报校验、补全、UA 解析
  src/routes/          /v1（上报）、/api（看板）、内部回调
packages/sdk         Web / Electron / Node SDK
apps/cloudflare      Worker 入口（fetch / queue / scheduled）+ wrangler.jsonc
apps/vercel          Vercel Function 入口 + Build Output API 构建脚本
apps/dashboard       看板 SPA
```

平台入口只做一件事：告诉 core **如何打开数据库**、**如何 waitUntil**，其余都在 core 里。

## 存储设计

### 表

- `apps`：id、name、write_key、schema_mode（permissive / strict）、retention_days、软删除字段 `deleted_at`
- `event_definitions`：(app_id, name) 主键；描述、状态（active / archived）、属性定义（名称、类型、是否必填、描述）
- `events`：(app_id, id) 主键；`ts`（修正后的事件时间，毫秒）、`received_at`、`distinct_id`（userId ?? anonymousId）、user_id、session_id、platform、os、os_version、browser、app_version、device、country、locale、`properties`（SQLite 为 TEXT JSON，Postgres 为 JSONB）
- 索引：`(app_id, ts)`、`(app_id, name, ts)`

### 方言层（唯一需要区分 SQLite / Postgres 的地方）

| 能力 | SQLite / D1 | Postgres |
| --- | --- | --- |
| 时间分桶 | 整数运算 `(ts + 时区偏移) / 间隔`（两边一致，不依赖日期函数） | 同左 |
| 读属性 | `json_extract` + `json_type`（布尔统一为 `'true'/'false'`） | `properties ->> key` |
| 批量写入 | `INSERT OR IGNORE … SELECT … FROM json_each(?)`：**整批 1 条语句、1 个参数**，绕开 D1「每条语句最多 100 个参数」与「每次调用的查询数」限制 | `INSERT … SELECT … FROM jsonb_to_recordset($1) ON CONFLICT DO NOTHING` |

迁移由内置的极简迁移器执行（所有 DDL 都是 `IF NOT EXISTS`，可重复运行）；首次部署后在看板上点击「Initialize database」即可，不需要命令行。

### 查询

- Overview：本期 / 上期总量与去重用户数、按时间分桶的序列、各维度 Top N。
- Explore：事件 × 指标（事件数 / 用户数）× 分组（内置维度或任意属性）× 筛选，取 Top 8 分组后再查序列。
- 所有时间序列按浏览器时区对齐。

规模说明：当前直接在原始事件表上聚合，适合每天几十万事件量级。D1 单库上限 10 GB，可以通过保留期控制容量。更大规模时的扩展方向见文末。

## 队列与一致性

- 所有写入都按 `(app_id, id)` 幂等，队列重投递、客户端重试都不会重复计数。
- `cloudflare` 驱动：单条消息 ≤ 128 KB、`sendBatch` ≤ 256 KB，按体积切分；消费者失败时整批重试，超过次数进入死信队列。
- `qstash` 驱动：校验 `Upstash-Signature`（HS256，支持当前 / 下一个签名密钥轮换，并校验请求体哈希）。
- 数据库连接在请求结束后、所有后台任务完成后才关闭。

## 缓存

- L1：每个实例内存缓存 30 秒；L2：配置的 KV（5 分钟）；最后是数据库。不存在的 write key 也会被缓存，防止随机 key 打穿数据库。
- 修改 App / 定义 / 轮换 key 时会清除 L2 与本实例 L1；其他实例最多延迟 30 秒生效（界面上有提示）。
- Cloudflare KV 是最终一致、单 key 写入约 1 次/秒，因此只用作缓存，不用作计数器。

## 安全

- write key 只能写事件；看板使用 `ADMIN_PASSWORD` 登录，换取 HMAC 签名的无状态会话 Cookie（HttpOnly、SameSite=Lax、HTTPS 下 Secure）。
- 修改类请求额外校验 `Origin`；登录失败按 IP 限流（基于 KV，尽力而为）；密码比较为常量时间。
- 不存储 IP 地址。

## 看板设计原则

- 参考 Vercel / Geist：中性色、发丝边框、无装饰阴影、单一字体；颜色只留给数据和状态。
- 明暗两套独立调校的色阶（不是简单反色），跟随系统或手动切换。
- 所有筛选、时间范围、分组都写在 URL 里，可以分享、刷新后保留；导航用真实链接。
- 键盘可达：焦点环、原生 `<dialog>`、图表可用方向键移动十字准线、`/` 聚焦搜索。
- 图表分类色使用经过色觉障碍校验的 8 色顺序；颜色跟随实体（筛选不会改变已有系列的颜色）；多系列图表始终有图例和数据表；未完成的时间桶用虚线表示。

## 后续演进

- 预聚合（按小时 / 天的 rollup 表），降低大时间范围查询成本。
- 列式存储适配器（ClickHouse / Tinybird / Cloudflare Analytics Engine），实现同一个 Repository 接口即可接入。
- 漏斗、留存、用户路径；看板 API token（供脚本调用）。
- Android（Kotlin）/ iOS（Swift）原生 SDK。
