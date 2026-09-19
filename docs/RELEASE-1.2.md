# v1.2.0 发布检查

## 本次变化

- 本机启动器、macOS / Windows 启动文件、Docker Compose 和 Render 部署模板。
- 玩家与 AI 独立随机钥匙、签名网页登录会话、连接设置页。
- 官方 SDK Streamable HTTP MCP、ChatGPT Actions schema、Claude 远程 MCP 所需 OAuth。
- 普通聊天便笺：复制状态、预览单条指令、用户确认执行。
- 最近 200 条 AI 操作回执持久化，相同编号重试不重复执行。

## 发布前验证

- 10 项 Node 测试全部通过：角色隔离、会话、官方 MCP 客户端调用、共享存档、重试/重启、Actions、便笺、OAuth consent / PKCE / refresh / revoke、来源与静态路径边界、Render Base64 钥匙。
- 上游引擎 smoke 和 adapter parity 检查通过。
- 所有第一方 JS 语法、文档相对链接和 diff 空白检查通过。
- 锁定运行时依赖 `npm audit --omit=dev` 未报告已知漏洞（2026-09-19）。
- 桌面与 375px 手机视口检查：登录、各客户端说明、便笺预览/执行、进入花园与返回连接页；控制台无警告或错误，连接页无横向溢出。
- 对 717 个候选发布文件复查：未发现未处理的凭据、私人连接串或本机路径；二进制素材沿用 v1.1 已审核版本。模式扫描不能保证发现所有可能的秘密。
- GitHub 工作流另验证 Node 20/22 和 Docker 构建、持久卷、健康检查、未认证拒绝与重启保留钥匙；实际结果见对应提交的 Actions。

## 验证边界

未逐一登录 Operit、Kelivo、ChatGPT、Claude、DeepSeek 账号进行实机兼容性测试；客户端功能入口可能受版本和套餐限制。未创建付费 Render 实例。协议测试通过不等同于每个产品账号都可使用。

DeepSeek 官方网页采用手动便笺；自动工具调用通过支持 MCP 的客户端与模型组合。ChatGPT Actions、Claude 远程连接器需要公网 HTTPS。

本仓库为公开源码非商业发行版，保留上游引擎及素材许可，详见 LICENSE 与 NOTICE。
