# 部署、升级与备份

这是单实例、单玩家的个人花园。多个 AI 可以共享这一份存档，但不是多租户平台。不要运行多个进程共写一个数据目录，不要配置水平扩容。

## Cloudflare 免费额度方案

推荐希望低成本长期保留个人花园的用户使用 [Cloudflare 部署说明](CLOUDFLARE.md)。该版使用 SQLite Durable Objects，存储、备份和撤销方式与以下文件存档部署不同。

## Render 一键模板

[部署到 Render](https://render.com/deploy?repo=https://github.com/wuxuyun0606-collab/rainholm-garden)

模板使用付费 Starter 计算实例和 1 GB 持久磁盘。**点击后在 Render 确认当前价格，决定是否付费。**免费临时文件系统不适合保存这座花园。

1. 登录 Render，打开部署按钮，检查服务名、区域、费用后创建服务。
2. 平台从 Dockerfile 构建，自动生成独立 `GARDEN_USER_KEY` 与 `GARDEN_AI_KEY`。
3. 等健康检查通过，打开服务网址的 `/connect/`，使用环境变量里的玩家钥匙登录。
4. 连接页复制 MCP / Actions 配置；Claude 走 OAuth 授权。

服务自动读取 `RENDER_EXTERNAL_URL`。使用自定义域名时，设置 `GARDEN_PUBLIC_URL=https://你的域名` 并重启；客户端也需要更新地址并重新授权。

模板关闭上游提交自动部署。升级时先备份，再在 Render 手动部署最新提交。仓库提供模板与协议测试，未替任何人创建实际付费 Render 实例。

## Docker Compose

```bash
docker compose up -d --build
docker compose exec garden node start.mjs --show-access
```

默认仅本机 `127.0.0.1:5173`，命名卷 `garden-data` 保存数据。容器以非 root 用户运行。

局域网访问可设置 `GARDEN_BIND_IP=0.0.0.0` 后启动，手机使用宿主机 IP。若 Host 被拒绝，请通过公网 HTTPS 反代并设置公开域名；容器网络不一定拥有宿主机局域网地址。局域网最简单的方式是直接 `node start.mjs --lan`。

公网反代时，设置 `GARDEN_PUBLIC_URL=https://garden.example.com`；只让反代连接本机 5173。反代必须保留原 `Host`，转发完整 `/mcp`、OAuth 根路径、`/.well-known/` 和游戏路径，支持 JSON POST，不能给 OAuth discovery 加另一层登录页。TLS 在反代终止。不要把应用放在 `/some/subpath`。

例：已配置域名和 TLS 的 Nginx location 中使用 `proxy_pass http://127.0.0.1:5173;`、`proxy_set_header Host $host;`。应用不信任任意 `X-Forwarded-Host`。

## 环境变量

| 名称 | 默认 / 说明 |
|---|---|
| `HOST` | 本地 127.0.0.1，容器 0.0.0.0 |
| `PORT` | 5173；Render 可自动提供 |
| `GARDEN_DATA` | 本地 `data`；模板中为 `/var/lib/rainholm` |
| `GARDEN_PUBLIC_URL` | HTTPS 根地址，无路径、查询或账号信息 |
| `RENDER_EXTERNAL_URL` | Render 自动提供，优先级低于 GARDEN_PUBLIC_URL |
| `GARDEN_USER_KEY` | 玩家钥匙；须与 AI 钥匙一起设置 |
| `GARDEN_AI_KEY` | 独立 AI 钥匙；与玩家钥匙不同 |

不配置环境钥匙时首次生成并保存 `.garden-keys.json`。手动设置时使用密码学随机的 32–256 字符 Base64/Base64url，不能填写示例口令或复用其他服务凭据。启动器默认不打印钥匙；`--show-access` 是显式查看命令。

`node start.mjs --help` 查看启动参数。`--public-base-url` 只配置公开地址，不创建域名、证书或隧道。首次 `npm ci` 联网；之后游戏资源自托管，不含统计代码。

## 私人数据与备份

数据目录包含：

- `garden-save.json`：存档及最近 200 条 AI 操作回执。
- `.garden-keys.json`：自动生成的两把钥匙；使用环境钥匙时不会生成此文件。
- `.garden-oauth.json`：注册客户端和 OAuth 令牌哈希，仅公网 OAuth 使用。

备份前停止服务，将整个数据目录复制到私人位置，并单独安全保存环境变量钥匙。Docker 命名卷不是源码文件夹；不要执行 `docker compose down -v`，除非明确要删除存档。Render 重部署保留持久磁盘，删除服务/磁盘仍可能丢失数据。

备份包含私人信息，不能上传 GitHub。运行文件被 `.gitignore` 与容器上下文排除。最近 60 条聊天、移动/气泡显示指令只在内存中，重启清空；客户端可能自行保存工具返回和聊天。部署平台的访问日志与保留时间由平台/部署者管理。

## 更换钥匙 / 撤销连接

停止服务后，生成新的两把独立钥匙并更新原配置来源；使用文件存储时可先安全备份旧文件，再删除 `.garden-keys.json`，下次启动自动重建。不要删除存档。玩家钥匙更换会使原网页会话失效，AI 钥匙更换需要更新 MCP / Actions 配置。

OAuth 授权独立于静态 AI 钥匙。要撤销全部 OAuth 连接，停止服务，删除数据目录中的 `.garden-oauth.json` 后重启，所有客户端都需重新注册授权。只更换玩家或 AI 钥匙不会撤销已发出的 OAuth 令牌。客户端也可调用标准 `/revoke` 撤销其授权。访问令牌 1 小时，刷新令牌 30 天并在刷新时轮换。

公开动态注册限制为 200 个客户端；若被滥用导致无法注册，可停止服务重置 OAuth 状态，并在反代增加适当速率限制。

## 从 v1.1 升级

先备份原存档，将新版源码放到独立目录，再将旧 `garden-save.json` 复制到新数据目录。运行 `node start.mjs` 生成钥匙并检查存档。

v1.2 的网页/API 都增加认证。原来无认证的黑猫脚本必须添加 AI Bearer Header；网页需玩家登录。存档格式兼容，新增重试回执不改变上游种植规则。失败时停止新版，恢复备份到旧版目录；不要并行运行新旧进程共写存档。

## 参考

[Render Blueprint](https://render.com/docs/blueprint-spec) · [环境变量](https://render.com/docs/environment-variables) · [持久磁盘](https://render.com/docs/disks) · [健康检查](https://render.com/docs/health-checks)
