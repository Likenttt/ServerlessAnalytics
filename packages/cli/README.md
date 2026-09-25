# serverless-analytics-cli

用命令行管理和查询 Serverless Analytics。它是为人和 AI agent 共同设计的：

- 在网页上登录授权（和 `gh auth login` 一样，CLI 本身不经手密码）；
- 输出不是终端时，自动输出 JSON，方便 agent 解析；
- 退出码固定：`0` 成功 · `1` API 或网络错误 · `2` 用法错误 · `3` 未登录。

## 安装

```sh
npm install -g serverless-analytics-cli      # 提供 sa 和 serverless-analytics 两个命令
# 或在本仓库中运行：pnpm build && pnpm sa --help
```

需要 Node.js 18 或更高版本，没有运行时依赖。

## 登录

```sh
sa login --endpoint https://analytics.example.com
```

1. CLI 打开 `…/cli/authorize?code=ABCD-EFGH`，并在终端显示同样的代码；
2. 在已登录的看板中确认代码一致，然后点击 **Authorize**；
3. CLI 拿到一个访问令牌（`sa_pat_…`），保存在 `~/.config/serverless-analytics/config.json`（权限 0600）。

令牌可以在看板的 **Settings → Access tokens** 中随时吊销；`sa logout` 会同时吊销并删除本地保存的令牌。

**Agent 或无法打开浏览器的环境**，可以分两步完成：

```sh
sa login --endpoint https://analytics.example.com --no-wait   # 输出 {url, code}，交给用户打开
sa login --resume                                             # 用户批准后执行，等待并保存令牌
```

**CI 环境**：在看板中创建令牌，然后设置环境变量 `SA_ENDPOINT` 和 `SA_TOKEN`（环境变量优先于本地保存的登录信息）。

## 命令

`<app>` 可以是 App 的 id，也可以是名称（不区分大小写）。

```sh
# 状态
sa whoami                          # 部署地址、令牌、运行时、存储和队列驱动、待执行的迁移
sa migrate                         # 执行待执行的数据库迁移
sa tokens list | create <name> | revoke <id> --yes

# 接入
sa apps create "iOS App" [--strict] [--retention-days 180]
sa snippet "iOS App" --lang swift  # 可选 js | html | curl | kotlin | swift，代码中已填入地址和 write key
sa track "iOS App" signup --prop method=email --user u1   # 发送一条测试事件（k:=<json> 表示原样传入 JSON）

# 配置
sa apps list | get <app> [--reveal]
sa apps update <app> [--name N] [--schema-mode permissive|strict] [--retention-days N]
sa apps rotate-key <app> --yes | sa apps delete <app> --yes
sa events list <app>
sa events define <app> purchase --description "Paid" --prop plan:string:required --prop amount:number
sa events update <app> purchase [--status archived] [--prop …]   # 传 --prop 时会替换全部属性定义
sa events delete <app> purchase --yes
sa sampling get <app>
sa sampling set <app> --rate 10% [--strategy user|event] [--override purchase=1 --override noise=0]
sa sampling set <app> --mode full

# 查询（--range 24h|7d|30d|90d 或 --from/--to · --filter 字段=值 · --interval hour|day · --tz 分钟偏移）
sa query overview <app> --range 30d
sa query active <app>                                   # DAU / WAU / MAU
sa query top <app> --by country --filter platform=ios
sa query trend <app> --metric users --by channel --range 30d
sa query trend <app> --event purchase --metric sum:amount --by country
sa query funnel <app> --step app_open --step signup --step purchase --window 168 --by channel
sa query errors <app> [<fingerprint>]
sa query events <app> --name purchase --limit 20
```

可分组、筛选的字段：`name`、`platform`、`channel`、`country`、`region`、`os`、`os_version`、`browser`、`app_version`、`device`、`locale`，以及 `prop:<属性名>`。

## 输出格式

- 在终端中运行时输出表格；加 `--json`，或者输出被管道、agent 读取时，输出 JSON。需要强制输出表格时加 `--human`。
- 进度提示总是写到 stderr，stdout 只包含结果。
- 出错时，stderr 的最后一行是 `{"error":{"code","message","status"}}`。

## MCP

```sh
sa mcp        # 本地 stdio MCP server，复用当前登录状态
```

支持远程 MCP 的客户端，可以直接连接部署的 `/mcp` 端点（支持 OAuth，只填 URL 即可）。配置方法见 [docs/MCP.md](../../docs/MCP.md)。

## 配合 agent 使用

把 [`SKILL.md`](./SKILL.md) 复制到 agent 的 skills 目录，例如 Claude Code 的 `~/.claude/skills/serverless-analytics/SKILL.md`。之后就可以直接对 agent 说「帮我把这个 iOS 项目接入埋点」「定义 purchase 事件」「看看最近 30 天各渠道的活跃用户」，agent 会调用 `sa` 完成。
