# v1.3.0 发布检查

新增 Cloudflare 免费额度部署，保留本机、Docker 和 Render。部署模板需要用户自己的 Cloudflare 账号及两把独立随机 Secret，不含公共默认密码。

## 验证

- 本机 10 项回归通过，包括玩家 / AI 角色、存档、官方 MCP、Actions、浏览器来源与静态路径边界。
- Cloudflare 官方 workerd 集成测试通过：网页登录、共享钱包、并发操作去重、进程重启、Durable Object 驱逐恢复、官方 MCP 客户端与三个场景地图。
- OAuth 复用同一组断言；在授权确认前、授权码兑换前及访问令牌发出后驱逐对象，继续确认 PKCE、受众、一次性代码、刷新轮换、撤销和角色隔离。
- 验证 Secret 配置错误时拒绝启动、变更 OAuth epoch 后撤销注册、玩家可下载不含钥匙的游戏备份而 AI 不可下载。
- 大于 2 MiB 的 Unicode 存档按小行存储测试通过；中途注入写入失败后回滚，重复保存无变化内容不增加写入，缩小存档会清理旧分片。
- 上游 smoke / parity 通过，vendor 源文件没有变化。
- Wrangler 部署 dry-run 通过，识别 SQLite Durable Object 与静态资源，未实际部署。
- 依赖全量 npm audit 未报告已知漏洞（2026-09-19）。锁定官方 Wrangler 和其配套 Miniflare；后者当前版本号含 alpha，变更工具版本需重新回归。
- GitHub Actions 另检查 Node 20 / 22、Docker 和 Cloudflare，结果以发布提交的工作流为准。

## 免费运行相关处理

静态资源直接由平台提供。无常驻 SSE 监听；OAuth 限流不使用常驻清理计时器。云端最近消息、待显示指令和授权中间状态持久化，支持对象休眠。引擎回执与 AI 回执分别限制最近 200 条，避免存档无限增长。

方案依据：Extend — 现有花园 + Cloudflare 官方 Node HTTP adapter、SQLite Durable Objects 和 Wrangler。复用现有规则与协议；构建时转换文件内容加载，不修改上游规则。

## 边界

尚未在真实 Cloudflare 账号创建线上 Worker，也未逐一登录所有 AI 产品账号实测。官方本地运行时与 dry-run 不能代替各地区网络、线上配额或账号权限验证。免费额度有限，具体见 [部署说明](CLOUDFLARE.md)。

整包仍为公开源码非商业发行版，许可见 LICENSE / NOTICE。
