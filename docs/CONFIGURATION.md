# 配置参考（Configuration）

本文件是**自部署配置的唯一约定**。部署行为完全由「环境变量 + 平台绑定（binding）」决定，切换数据库 / KV / 队列不需要改代码。
后续的配置 Skill 只需要根据用户回答生成本文描述的变量和绑定即可。

解析逻辑见 [`packages/core/src/config.ts`](../packages/core/src/config.ts)：配置无效时，所有问题会一次性列出，并在看板登录页展示。

---

## 1. 兼容矩阵

| 平台 | 数据库 `DB_DRIVER` | KV `KV_DRIVER` | 队列 `QUEUE_DRIVER` | 定时清理 |
| --- | --- | --- | --- | --- |
| **Cloudflare Workers** | `d1`（默认）· `postgres`（建议走 Hyperdrive） | `cloudflare`（默认）· `upstash` · `memory` | `direct` · `background` · `cloudflare` · `qstash` | Cron Trigger（`wrangler.jsonc`） |
| **Vercel** | `postgres`（Supabase / Neon / 任意 Postgres） | `upstash` · `memory` | `direct` · `background` · `qstash` | Vercel Cron → `/api/cron/retention` |

> D1 只能在 Cloudflare Workers 内通过 binding 访问，所以 Vercel 上只能用 Postgres。

---

## 2. 环境变量

### 通用

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `ADMIN_PASSWORD` | ✅ | — | 看板登录密码，至少 8 位。**以 Secret 方式设置**。修改后所有会话失效。 |
| `ADMIN_API_TOKEN` | | — | 可选，≥ 24 位。其他服务通过 `Authorization: Bearer <token>` 调用 `/api/*` 读取数据（等同管理员权限，只放在服务端）。 |
| `SESSION_SECRET` | | 等于 `ADMIN_PASSWORD` | 会话 Cookie 的签名密钥。单独设置后，修改密码不会让会话失效。 |
| `MAX_BATCH_SIZE` | | `100` | 单次上报最多事件数（1–1000）。 |
| `MAX_BODY_BYTES` | | `1000000` | 上报请求体上限（解压后）。 |
| `CRON_SECRET` | Vercel 必填 | — | 保护 `/api/cron/retention`。Vercel Cron 会自动携带 `Authorization: Bearer $CRON_SECRET`。 |
| `PUBLIC_URL` | | 请求的 origin | 对外访问地址。仅 `qstash` 队列用它拼回调地址（有自定义域名 / 反代时设置）。 |

### 数据库

| 变量 / 绑定 | 取值 | 说明 |
| --- | --- | --- |
| `DB_DRIVER` | `d1` \| `postgres` | 不设置时：存在 `DB` 绑定则 `d1`，否则有连接串则 `postgres`。 |
| 绑定 `DB` | D1 数据库 | `DB_DRIVER=d1` 时需要。 |
| `DATABASE_URL`（或 `POSTGRES_URL`） | Postgres 连接串 | `DB_DRIVER=postgres` 时需要。Supabase 请用 **Pooler / Transaction 模式（端口 6543）** 的连接串。 |
| 绑定 `HYPERDRIVE` | Hyperdrive | Cloudflare 上连 Postgres 时推荐；存在时优先于 `DATABASE_URL`。 |

### KV（缓存）

KV 只做缓存（write key → App、事件定义）和登录限流计数，数据库始终是唯一数据源；关闭 KV 不影响正确性。

| 变量 / 绑定 | 取值 | 说明 |
| --- | --- | --- |
| `KV_DRIVER` | `cloudflare` \| `upstash` \| `memory` | 不设置时：有 `KV` 绑定则 `cloudflare`，有 Upstash 变量则 `upstash`，否则 `memory`。 |
| 绑定 `KV` | KV Namespace | `KV_DRIVER=cloudflare` 时需要。 |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | | `KV_DRIVER=upstash` 时需要。也兼容 Vercel 集成注入的 `KV_REST_API_URL` / `KV_REST_API_TOKEN`。 |

### 队列

| `QUEUE_DRIVER` | 语义 | 需要 | 适用场景 |
| --- | --- | --- | --- |
| `direct`（默认） | 请求内同步写库，写成功才返回 200 | — | 大多数场景；最简单、不丢数据 |
| `background` | 先返回，再用 `waitUntil` 写库 | — | 追求最低延迟，可接受极少量丢失 |
| `cloudflare` | Cloudflare Queues，消费者按批写库（带重试 + 死信队列） | 生产者绑定 `EVENTS_QUEUE` + 消费者配置 | Cloudflare 上的高吞吐；把大量小写入合并成少量大批次，显著降低 D1 写压力 |
| `qstash` | Upstash QStash，QStash 回调 `/api/queue/qstash`（签名校验、自动重试） | `QSTASH_TOKEN`、`QSTASH_CURRENT_SIGNING_KEY`、`QSTASH_NEXT_SIGNING_KEY`；可选 `QSTASH_URL`（区域地址，默认 `https://qstash.upstash.io`） | Vercel 等没有原生队列的平台 |

所有队列路径都是幂等的：事件按 `(app_id, id)` 去重，重投递不会重复计数。

---

## 3. 平台配置方法

### Cloudflare（`apps/cloudflare/wrangler.jsonc`）

- 普通变量写在 `vars`；密码用 `wrangler secret put ADMIN_PASSWORD`。
- `d1_databases` / `kv_namespaces` 不写 id 时，首次 `wrangler deploy` 会自动创建资源。
- 启用 Cloudflare Queues：取消注释 `queues` 段（生产者 binding 必须叫 `EVENTS_QUEUE`），并设置 `"QUEUE_DRIVER": "cloudflare"`。先创建队列：
  ```sh
  wrangler queues create serverless-analytics-events
  wrangler queues create serverless-analytics-events-dlq
  ```
- 使用 Postgres：`wrangler hyperdrive create serverless-analytics --connection-string="postgres://..."`，取消注释 `hyperdrive` 段，并设置 `"DB_DRIVER": "postgres"`。
- 本地开发：复制 `.dev.vars.example` 为 `.dev.vars`。

### Vercel（`apps/vercel`）

- 项目 Root Directory 设为 `apps/vercel`（`vercel.json` 已配置安装与构建命令）。
- 在 Project → Settings → Environment Variables 中设置：`ADMIN_PASSWORD`、`DATABASE_URL`、`CRON_SECRET`，以及可选的 KV / 队列变量（参考 `apps/vercel/.env.example`）。
- 构建产物遵循 Build Output API：一个 Node.js Function 处理 `/api/*` 与 `/v1/*`，其余路径是静态看板；每日清理任务已写入 `config.json`（`crons`）。

---

## 4. 配置 Skill 的问题树（建议）

1. **部署到哪里？** Cloudflare / Vercel
2. **数据库？**
   - Cloudflare：D1（推荐，零配置）/ 已有 Postgres（→ 询问连接串，创建 Hyperdrive）
   - Vercel：Supabase / Neon / 其他 Postgres（→ 询问连接串；Supabase 提示使用 6543 端口的 Pooler 连接串）
3. **缓存？**
   - Cloudflare：Cloudflare KV（推荐）/ Upstash / 不使用
   - Vercel：Upstash（推荐）/ 不使用
4. **预计流量与可靠性要求？**
   - 低 / 中流量、要求简单可靠 → `direct`
   - 追求最低延迟 → `background`
   - Cloudflare 上高流量 → `cloudflare`（同时创建主队列与死信队列）
   - Vercel 上需要缓冲与重试 → `qstash`（询问 QStash token 与签名密钥）
5. **看板密码**：生成强随机密码并以 Secret 写入；Vercel 同时生成 `CRON_SECRET`。
6. **是否有自定义域名？** 使用 `qstash` 时设置 `PUBLIC_URL`。
7. 部署完成后打开看板 → 输入密码 → 点击「Initialize database」完成建表。

---

## 5. 最小示例

**Cloudflare + D1 + KV（默认）**

```jsonc
"vars": { "DB_DRIVER": "d1", "KV_DRIVER": "cloudflare", "QUEUE_DRIVER": "direct" }
```
```sh
wrangler secret put ADMIN_PASSWORD
```

**Vercel + Supabase + Upstash + QStash**

```sh
ADMIN_PASSWORD=...
DATABASE_URL=postgres://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
KV_DRIVER=upstash
UPSTASH_REDIS_REST_URL=https://<id>.upstash.io
UPSTASH_REDIS_REST_TOKEN=...
QUEUE_DRIVER=qstash
QSTASH_TOKEN=...
QSTASH_CURRENT_SIGNING_KEY=...
QSTASH_NEXT_SIGNING_KEY=...
CRON_SECRET=...
```
