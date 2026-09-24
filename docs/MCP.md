# MCP：让 agent 直接调用

Serverless Analytics 自带 MCP（Model Context Protocol）server。连接之后，agent 可以直接调用工具来接入项目、修改配置、查询数据，不需要经过 shell 或 CLI。

提供两种连接方式，工具完全相同：

| 方式 | 地址 | 认证 | 适用于 |
| --- | --- | --- | --- |
| **远程**（推荐） | `https://<你的部署>/mcp` | `Authorization: Bearer <访问令牌>` | Claude Code、Cursor 等支持 HTTP MCP 的客户端；无需在本地安装任何东西 |
| **本地 stdio** | `sa mcp` | 复用 `sa login` 的登录状态，或环境变量 `SA_ENDPOINT` / `SA_TOKEN` | 只支持本地进程的客户端，例如 Claude Desktop |

## 获取访问令牌

两种方式任选其一：

- 在看板 **Settings → Access tokens → Create token** 中创建，令牌只显示一次；创建后对话框里会直接给出 `claude mcp add` 命令。
- 执行 `sa login`，在浏览器中授权后，令牌会保存在 `~/.config/serverless-analytics/config.json`。

令牌拥有完整的管理权限，随时可以在看板中吊销。只把它放在你自己的机器或 CI 的 secret 里。

## 连接

### Claude Code

```sh
claude mcp add --transport http serverless-analytics https://analytics.example.com/mcp \
  --header "Authorization: Bearer sa_pat_…"
```

### Cursor（`.cursor/mcp.json` 或全局 `~/.cursor/mcp.json`）

```json
{
  "mcpServers": {
    "serverless-analytics": {
      "url": "https://analytics.example.com/mcp",
      "headers": { "Authorization": "Bearer sa_pat_…" }
    }
  }
}
```

### Claude Desktop 等只支持本地进程的客户端（`claude_desktop_config.json`）

```json
{
  "mcpServers": {
    "serverless-analytics": {
      "command": "npx",
      "args": ["-y", "serverless-analytics-cli", "mcp"],
      "env": { "SA_ENDPOINT": "https://analytics.example.com", "SA_TOKEN": "sa_pat_…" }
    }
  }
}
```

如果本机已经执行过 `sa login`，可以省略 `env`。CLI 尚未发布到 npm 时，把 `command` / `args` 换成 `"node"` 和 `["/path/to/ServerlessAnalytics/packages/cli/dist/cli.js", "mcp"]`。

### 手动测试

```sh
curl -s https://analytics.example.com/mcp \
  -H "Authorization: Bearer $SA_TOKEN" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## 工具

| 类别 | 工具 |
| --- | --- |
| 状态 | `get_status` |
| App | `list_apps`、`get_app`（含 write key）、`create_app`、`update_app`（名称、schema 模式、保留期）、`rotate_write_key`\*、`delete_app`\* |
| 接入 | `get_integration_snippet`（js / html / curl / kotlin / swift）、`send_test_event` |
| 事件定义 | `list_event_definitions`、`define_event`、`update_event_definition`、`delete_event_definition`\* |
| 采样 | `set_sampling`（全量 / 按用户 / 按事件、采样率、按事件单独设置） |
| 查询 | `query_overview`、`query_active_users`、`query_top`、`query_trend`、`query_funnel`、`query_errors`、`query_events` |

标 \* 的工具具有破坏性，必须传入 `confirm: true` 才会执行；agent 应当先征得用户同意。每个工具都带有 MCP annotations（`readOnlyHint` / `destructiveHint` / `idempotentHint`），客户端可以据此决定是否需要逐次确认。

查询类工具的参数与 CLI 一致：
- `range`：`24h` / `7d` / `30d` / `90d`，或用 `from` / `to` 指定；
- `filters`：例如 `{"country":"CN","prop:plan":"pro"}`；
- `by`：分组字段，例如 `channel`、`region`、`prop:plan`；
- `metric`：`events` / `users` / `per_user` / `sum:<属性>` / `avg:<属性>`；
- `tz`：时区偏移（分钟），远程 MCP 默认 UTC，本地默认使用本机时区。

示例提问：
- 「把这个 Android 项目接入埋点，渠道按 productFlavor 区分」
- 「定义 purchase 事件，plan 必填、amount 为数字」
- 「最近 30 天各渠道的日活走势」
- 「广东和北京的用户，付费转化漏斗有什么差别」
- 「这周新出现的崩溃有哪些，集中在哪个版本」

## 实现说明

- 协议：MCP 2025-06-18（兼容 2025-03-26 和 2024-11-05）。远程端点使用 Streamable HTTP 的无状态模式：`POST` 发送 JSON-RPC，返回 JSON；`GET` / `DELETE` 返回 405；通知返回 202。
- 工具通过同一套 `/api` 执行，所有校验、权限和缓存失效逻辑都与看板一致。
- 未携带凭据的请求返回 401，并带有 `WWW-Authenticate: Bearer` 头。暂不支持 OAuth 动态授权；需要 OAuth 的客户端（例如 Claude.ai 的远程 connector）请先使用本地 stdio 方式。
