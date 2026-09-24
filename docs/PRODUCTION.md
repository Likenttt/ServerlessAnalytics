# 生产就绪评估

结论：**适合中小规模生产使用**（单个管理员；每天几十万事件量级；数据保留期控制在 D1 的 10 GB 以内）。更大规模或多人协作场景，需要先补齐下面「上线前建议」中的几项。

## 已具备

- **数据可靠性**：Cloudflare 上默认走队列（请求只负责入队，由消费者批量写库，失败会重试，最终进入死信队列）；事件 id 幂等去重、客户端时钟偏差修正；可选 Cloudflare Queues（重试 + 死信队列）或 QStash。
- **安全**：
  - write key 只能写入，泄露后可以一键轮换；
  - 看板使用 HMAC 签名的会话 Cookie（HttpOnly、Secure、SameSite），修改类请求校验 Origin 防 CSRF，登录失败有限流；
  - 可选 `ADMIN_API_TOKEN` 供服务端读取；
  - 不存储 IP 地址。
- **运维**：配置错误会在登录页直接列出；迁移可重复执行；每日自动清理超过保留期的数据；Cloudflare observability 已开启。
- **质量**：60 个核心测试同时在 SQLite（D1）和 Postgres（PGlite）上运行，另有 SDK 测试；CI 覆盖类型检查、测试、构建、Worker 打包和 Vercel 产物；dev 环境已实际部署并验证。

## 上线前建议

| 优先级 | 事项 | 说明 / 做法 |
| --- | --- | --- |
| 高 | **上报限流** | write key 是公开的，可能被刷量。可以在 Cloudflare WAF 为 `/v1/*` 配置 Rate Limiting 规则（按 IP 或 write key），或在 Worker 中接入 Rate Limiting binding。 |
| 高 | **正式环境使用独立资源** | 正式环境使用单独的 Worker 名和 D1 数据库名（在 `wrangler.jsonc` 中修改 `name` 与 `database_name`），不要和 dev 共用。 |
| 高 | **强密码与 API token** | `ADMIN_PASSWORD` 使用随机生成的长密码；`ADMIN_API_TOKEN` 只放在服务端。 |
| 中 | **容量与查询成本** | 流量很大时，可以在 App 设置中开启**采样**（推荐按用户采样）。目前直接在原始事件表上聚合。事件量大（例如每月数千万）时，需要预聚合表或列式存储（Analytics Engine / ClickHouse）。同时设置合理的保留期。 |
| 中 | **备份** | D1 自带 30 天 Time Travel，可恢复到任意时间点；Postgres 依赖服务商的备份。建议定期导出重要数据。 |
| 中 | **监控告警** | 在 Cloudflare 中为 Worker 错误率配置告警；关注 D1 的读写用量。 |
| 低 | **多用户 / 权限** | 目前只有一个管理员，没有审计日志和 2FA。团队协作需要接入 SSO 或 Cloudflare Access（可以直接用 Access 保护看板路径）。 |
| 低 | **Vercel 路径** | 构建产物已在本地用真实 Postgres 连接验证，但还没有在 Vercel 上实际部署过。 |

## 已知限制

- 漏斗基于每个用户在每一步的首次和末次发生时间，属于近似计算；在同一步骤反复出现的场景下，转化时间可能偏短。
- 时区按请求时的偏移量对齐，跨越夏令时切换的时间段会有一小时误差。
- 缓存最多有 30 秒延迟：修改 schema 模式、事件定义或轮换 key 后，其他实例最多 30 秒后才生效。
- `region` 是国家内的行政区划代码（例如 `CA`、`GD`），不同国家之间可能重名，建议配合国家筛选使用。
