# 上报协议（HTTP API）

任何能发 HTTP 请求的客户端（Web、Android、iOS、桌面端、服务端）都可以直接上报。Web / Electron / Node 可以使用 [`@serverless-analytics/sdk`](../packages/sdk)。

## 鉴权

每个 App 有一个 **write key**（`wk_…`），只能写入事件，可以放心内置在客户端里。任选一种方式传递：

- `Authorization: Bearer <writeKey>`（推荐）
- `X-Write-Key: <writeKey>`
- 请求体字段 `"writeKey"`（用于 `navigator.sendBeacon`，它无法设置请求头）
- 查询参数 `?writeKey=`

`/v1/*` 开放 CORS（`*`）。

## `POST /v1/batch`

```http
POST /v1/batch
Authorization: Bearer wk_xxx
Content-Type: application/json
Content-Encoding: gzip        (可选)
```

```jsonc
{
  "sentAt": 1790000000000,            // 可选：发送时的客户端时间，用于修正设备时钟偏差
  "context": {                        // 可选：整批共享的上下文
    "platform": "android",            // web | ios | android | desktop | server | …
    "appVersion": "3.2.0",
    "os": "Android",
    "osVersion": "15",
    "device": "Pixel 9",
    "locale": "zh-CN",
    "channel": "huawei"             // 渠道：应用商店 / 渠道包 / utm_source
  },
  "events": [
    {
      "id": "3f0c…",                  // 强烈建议：客户端生成的唯一 id，重试时服务端据此去重
      "name": "purchase",
      "timestamp": 1789999990000,     // 毫秒时间戳或 ISO 字符串；缺省为服务端接收时间
      "anonymousId": "device-123",    // anonymousId / userId / distinctId 至少一个
      "userId": "user-42",            // 登录后设置；统计「用户数」时优先使用
      "sessionId": "s-1",
      "properties": { "plan": "pro", "amount": 29 },
      "context": { "appVersion": "3.2.1" } // 可选：覆盖批次上下文
    }
  ]
}
```

**响应**（请求体本身合法时始终为 200）：

```json
{ "ok": true, "accepted": 1, "sampled": 0, "rejected": [{ "index": 3, "id": "…", "reason": "missing required property \"plan\"" }] }
```

- `sampled` 是按 App 采样设置被丢弃的事件数量，这部分事件同样**不要重试**。
- `rejected` 中的事件**不要重试**，它们永远不会被接受（名称非法、strict 模式下未定义、属性类型不符等）。
- `401`：write key 缺失或无效；`400`：JSON 或请求体结构非法；`413`：批次或请求体过大。
- `5xx` / 网络错误：保留事件，指数退避后重试（带同样的 `id`，不会重复计数）。

## `POST /v1/track`

单事件的便捷接口：请求体就是一个事件，可附带 `writeKey`、`context`、`sentAt`。

```sh
curl -X POST https://analytics.example.com/v1/track \
  -H "Authorization: Bearer wk_xxx" -H "Content-Type: application/json" \
  -d '{"name":"signup","anonymousId":"device-123","properties":{"method":"email"}}'
```

## 字段规则

| 字段 | 规则 |
| --- | --- |
| 事件名 | 1–128 个字符；字母（任意语言）、数字、空格和 `_ $ . : -`，不能以空格或符号（`_`、`$` 除外）开头 |
| 属性名 | 1–64 个字符；同上但不允许空格 |
| 属性 | 最多 100 个，序列化后最多 16 KB；值可以是任意 JSON |
| 时间 | 超过服务端时间 1 分钟以上的未来时间会被修正为接收时间；超过 400 天的旧事件会被拒绝 |
| 批次 | 默认最多 100 个事件、1 MB（可通过 `MAX_BATCH_SIZE` / `MAX_BODY_BYTES` 调整） |

内置事件：`$error`（错误上报，属性为 `type`、`message`、`stack`、`fatal`、`handled`，服务端会自动归类）和 `$pageview`。`$` 开头的事件在 strict 模式下不需要事先定义。

服务端会自动补充：地区（Cloudflare 的 `regionCode` 或 Vercel 的 `x-vercel-ip-country-region`）、国家（来自 Cloudflare / Vercel 的地理请求头）、语言（`Accept-Language`），以及浏览器流量的操作系统 / 浏览器 / 设备类型。不保存 IP 地址。

## 原生客户端建议

- 本地持久化队列（SQLite / 文件），每 N 条或每隔几秒批量发送；应用进入后台时立刻发送一次。
- 每个事件生成 UUID 作为 `id`，重试时保持不变。
- 带上 `sentAt`，服务端会用它修正设备时钟偏差。
- 只对网络错误、`429` 和 `5xx` 重试；其他 `4xx` 直接丢弃该批次。

## 看板 API

`/api/*` 是看板使用的内部 API（Cookie 会话鉴权），不作为稳定的公开接口；类型定义见 [`packages/core/src/types.ts`](../packages/core/src/types.ts)。

MCP 端点 `/mcp` 和它的 OAuth 端点（`/oauth/*`、`/.well-known/oauth-*`）见 [MCP.md](./MCP.md)。
