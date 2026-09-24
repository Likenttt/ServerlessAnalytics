# 接入指南

## 需要哪些凭据

| 凭据 | 在哪里拿 | 放在哪里 | 能做什么 | 是否保密 |
| --- | --- | --- | --- | --- |
| **Endpoint** | 部署地址，例如 `https://analytics.example.com` | 客户端配置 | — | 否 |
| **Write key**（`wk_…`） | 看板 → App → Settings → Write key | 客户端（App / 网页 / 服务端） | **只能写入**该 App 的事件 | 否，可以打包进客户端；泄露后可在看板一键轮换 |
| **ADMIN_API_TOKEN**（可选） | 部署时自己生成（≥ 24 位随机串），设为环境变量 / Secret | 只放在你自己的服务端（BI、报表、脚本） | 通过 `/api/*` **读取和管理**所有数据 | **是**，等同管理员密码 |
| **个人访问令牌**（`sa_pat_…`） | `sa login` 在浏览器中批准后自动生成；也可以在看板 Settings → Access tokens 中手动创建 | CLI（本地配置文件）/ CI（`SA_TOKEN`） | 通过 `/api/*` 读取和管理所有数据 | **是**，可随时吊销 |
| ADMIN_PASSWORD | 部署时设置 | 只给看板使用者 | 登录看板 | **是** |

一个项目（一个客户端或一组相关客户端）对应看板里的一个 **App**。同一产品的 iOS、Android、Web 可以共用一个 App，用 `platform` 区分；也可以分开建多个 App。

## 1. 上报事件（写）

### Web / Electron / Node

```ts
import { createAnalytics } from '@serverless-analytics/sdk'

export const analytics = createAnalytics({
  endpoint: 'https://analytics.example.com',
  writeKey: 'wk_…',
  appVersion: '1.4.0',
  channel: 'website',      // 可选；浏览器里默认取首次访问的 utm_source 或来源域名
  captureErrors: true,     // 可选；自动上报未捕获异常
})

analytics.identify(user.id)                         // 登录后
analytics.track('purchase', { plan: 'pro', amount: 29, currency: 'USD' })
analytics.captureError(err, { screen: 'checkout' }) // 手动上报错误
analytics.reset()                                   // 退出登录
```

不用打包工具时，可以用 `<script src="…/analytics.global.js">` 引入，然后调用 `ServerlessAnalytics.createAnalytics(...)`。

### Android / iOS / 桌面端 / 服务端

直接调用 HTTP 接口 `POST /v1/batch`，协议见 [HTTP_API.md](./HTTP_API.md)。推荐做法：

1. 本地持久化队列（SQLite / 文件），攒够 20 条或每隔 5–10 秒提交一批；App 进入后台时立即提交一次。
2. 每个事件生成 UUID 作为 `id`，重试时保持不变（服务端会去重）。
3. 批次级 `context` 带上 `platform`、`appVersion`、`os`、`osVersion`、`device`、`locale`，以及 **`channel`**（应用商店或渠道包标识，如 `appstore`、`googleplay`、`huawei`、`xiaomi`）。
4. 只对网络错误、`429`、`5xx` 重试。

国家和地区由服务端根据请求自动识别（Cloudflare / Vercel 的地理信息），客户端不需要上报。

### 错误上报

发送名为 `$error` 的事件即可，属性为 `type`、`message`、`stack`，可选 `fatal`、`handled` 以及任意自定义字段。服务端会按「类型 + 规范化后的消息 + 首个堆栈帧」自动归类，结果在看板的 **Errors** 页查看。`$` 开头的内置事件在 strict 模式下也不需要事先定义。

## 2. 用 CLI 或 Agent 管理

推荐使用 [`serverless-analytics-cli`](../packages/cli/README.md)：执行 `sa login` 后在网页中授权，之后接入（`apps create`、`snippet`）、配置（`events define`、`sampling set`）、查询（`query …`）都可以在命令行完成。Agent 使用 [`SKILL.md`](../packages/cli/SKILL.md) 即可。

## 3. 读取数据（HTTP API）

在部署中设置 `ADMIN_API_TOKEN` 后，其他服务可以直接调用看板使用的同一套 API：

```sh
T="Authorization: Bearer $ADMIN_API_TOKEN"
B=https://analytics.example.com

curl -H "$T" "$B/api/apps"                                                     # App 列表（含 id）
curl -H "$T" "$B/api/apps/<appId>/overview?range=30d&tz=480"                   # 总量、用户数、趋势、环比
curl -H "$T" "$B/api/apps/<appId>/active-users"                                # DAU / WAU / MAU
curl -H "$T" "$B/api/apps/<appId>/insights?metric=users&groupBy=country&range=30d"                  # 分国家活跃用户趋势
curl -H "$T" "$B/api/apps/<appId>/insights?metric=users&groupBy=region&f=country=CN&range=30d"      # 某个国家内分地区
curl -H "$T" "$B/api/apps/<appId>/insights?event=purchase&metric=sum:amount&groupBy=channel"        # 分渠道收入
curl -H "$T" "$B/api/apps/<appId>/funnel?step=app_open&step=signup&step=purchase&window=168"        # 漏斗转化
curl -H "$T" "$B/api/apps/<appId>/errors?range=7d"                             # 错误分组
curl -H "$T" "$B/api/apps/<appId>/events?limit=100&name=purchase"              # 原始事件
```

常用参数：

| 参数 | 取值 |
| --- | --- |
| `range` | `24h` / `7d` / `30d` / `90d`，或者用 `from` 和 `to`（毫秒时间戳）指定 |
| `tz` | 时区偏移（分钟），例如北京时间为 `480` |
| `interval` | `hour` / `day` |
| `metric` | `events`、`users`、`per_user`、`sum:<属性>`、`avg:<属性>` |
| `groupBy` | `name`、`platform`、`channel`、`country`、`region`、`os`、`os_version`、`browser`、`app_version`、`device`、`locale`，或 `prop:<属性>` |
| `f` | 筛选条件，可以重复，例如 `f=platform=ios&f=prop:plan=pro` |

返回的类型定义见 [`packages/core/src/types.ts`](../packages/core/src/types.ts)。这是内部 API，目前还没有版本号承诺，升级前请查看变更记录。

## 4. 常见分析怎么做

| 需求 | 看板位置 | 做法 |
| --- | --- | --- |
| 分渠道的用户活跃走势 | Explore | 指标选 *Unique users*，分组选 *Channel* |
| 分国家 / 地区的活跃走势 | Explore | 指标选 *Unique users*，分组选 *Country*；看某国的地区时，先加筛选 *Country is CN*，再按 *Region* 分组 |
| DAU / WAU / MAU、粘性 | Overview | 活跃用户卡片（也支持筛选） |
| 某个事件的效果（转化） | Funnels | 例如 `view_paywall → start_trial → purchase`，可按渠道或平台拆分 |
| 收入、时长等数值 | Explore | 指标选 *Sum of amount* / *Average duration* |
| 属性分布 | Explore | 分组选任意属性，例如 *plan* |
| 错误 | Errors | 按问题归类，查看趋势、影响用户数、版本分布和堆栈 |
