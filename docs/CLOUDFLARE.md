# Cloudflare 免费部署

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wuxuyun0606-collab/rainholm-garden)

本版使用 **Workers + Static Assets + SQLite Durable Objects**。不需要 Render、不需要常开电脑，也不依赖 R2、付费 Containers 或数据库服务器。保留免费 Workers 计划时，在各项额度以内可免费运行；模型客户端自己的费用另算。

## 一键部署

1. 注册 / 登录 Cloudflare，点击上方按钮，按平台步骤连接 GitHub 并创建自己的仓库副本与 Worker。保留 Workers Free，不必为了花园升级付费计划。
2. 准备两把不同的随机钥匙。在有 Node.js 的电脑上，下载源码后运行：

   ```bash
   node cloudflare/keys.mjs
   ```

   或使用密码管理器生成两条各 43 位的随机英文字母和数字。不要使用日常密码、模型 API Key、其他账号的 token，不能把两把钥匙设成同一个值。
3. 部署表单中填写 `GARDEN_USER_KEY` 和 `GARDEN_AI_KEY`。它们应存为 **Secrets**。如果平台未展示输入框，在 Worker 设置的 Variables and Secrets 中添加这两个 Secret，再重新部署。两个输入均需 32–256 字符 Base64 / Base64url，示例文件故意留空。
4. 等构建成功，打开平台给的 `https://rainholm-garden.你的子域.workers.dev/connect/`，用玩家钥匙登录。
5. 连接页选择 Operit / Kelivo、ChatGPT 或 Claude，复制相应地址 / AI 配置。Cloudflare 自带 HTTPS 和网址，不要求另买域名。DeepSeek 官方网页继续使用便笺方式。

**自己保管玩家钥匙。Cloudflare Secret 保存后通常不能再查看明文。**忘记时可在平台重新设置；本机的 `--show-access` 不会读出云端 Secret。

如果构建环境仍使用 Node 20，在构建设置指定 Node 22 或更高。普通本机玩法仍支持 Node 20；Cloudflare 构建工具要求 Node 22+。

## 命令行部署

需要 Node.js 22+。以下命令中的登录和部署会由你在自己的 Cloudflare 账号完成：

```bash
npm ci --ignore-scripts
npx wrangler login
node cloudflare/keys.mjs
npx wrangler secret put GARDEN_USER_KEY
npx wrangler secret put GARDEN_AI_KEY
npm run deploy
```

Secret 命令交互输入对应的钥匙本身。`npm run deploy` 会自动构建，发布静态资源并创建 SQLite Durable Object。不要把真实钥匙写进 `wrangler.jsonc` 或提交到仓库。

仅检查、不发布：`npx wrangler deploy --dry-run`。本地协议测试：`npm run test:cloudflare`，测试使用临时 SQLite 和随机测试钥匙，不访问 Cloudflare 账号。

若需要开发预览，复制 `.dev.vars.example` 为 `.dev.vars` 填测试钥匙，运行 `npm run dev:cloudflare`。使用本地 HTTPS；不要关闭浏览器安全检查。普通日常本机游玩用 `node start.mjs` 更简单。

## 免费额度怎样算

按 2026-09-19 官方文档核对，额度由整个账号共享，Cloudflare 后续可能调整：

| 项目 | 免费额度 |
|---|---|
| Worker 动态请求 | 100,000 次 / 日；每次 CPU 10 ms |
| Durable Object 请求 | 100,000 次 / 日 |
| Durable Object 运行时长 | 13,000 GB-s / 日 |
| SQLite 读取 / 写入 | 5,000,000 / 100,000 行 / 日 |
| SQLite 总存储 | 5 GB / 账号 |
| 静态图片、字体、JS 等 | 资源请求免费；最多 20,000 文件、单文件 25 MiB |

花园把运算放在 Durable Object，外层 Worker 只路由。图片、字体和脚本直接走静态资源，保护中的游戏 HTML 和接口才调用 Worker。没有常驻 SSE 监听、定时任务或付费模型调用。

当前画面约每 3 秒询问一次黑猫指令，每 30 秒刷新状态。单个持续打开的页面约产生 32,000 次动态请求 / 天，再加你的 AI 调用；同时开多个页面会叠加。后台页面会暂停轮询。不要配置 AI 每秒不停查询。

免费额度耗尽会使对应操作报错，通常需等待日额度于 UTC 00:00 重置；不是无限运行。CPU、存储总量及其他非日额度限制需减少用量或清理数据。选择付费计划后则应按付费计价管理用量。

## 存档和授权

- 每个部署只有一座个人花园，使用固定名称的一个 SQLite Durable Object；玩家和所有 AI 共用钱包与存档。
- 游戏存档、最近 200 条 AI 回执、最近 200 条种植引擎回执持久保存。回执超出窗口后不要重放旧编号。
- Cloudflare 版最近 60 条消息与最新待显示的黑猫指令也持久保存，以免对象休眠后丢失。它与本机版“重启清空最近消息”的行为不同。
- OAuth 注册客户端、授权确认、一次性授权码、令牌哈希和限流记录保存在该对象。对象休眠或正常重部署后授权流程仍可继续；过期与撤销规则不变。
- 两把静态钥匙保存在 Cloudflare Secrets 中，不放进静态网页或源码。默认关闭 Workers observability；Cloudflare 仍按其服务政策处理运行数据。

连接页「下载存档备份」可导出种植存档和操作回执，**不包含玩家 / AI 钥匙或 OAuth 授权**。文件可能包含 AI 操作中的文字，请私人保存。它可作为本机版的 `data/garden-save.json` 恢复；当前未提供上传覆盖云端存档的界面。

不要删除 Worker / Durable Object 命名空间、修改 DO 类名或随意替换迁移标签。源码升级通常保留存档；删除云资源可能永久失去数据。先备份再操作。

## 域名、换钥匙与撤销连接

默认首次动态访问会记住平台路由的 HTTPS 地址。使用自定义域名时，设置变量 `GARDEN_PUBLIC_URL=https://garden.example.com`，重新部署；必须是根域址，不能有子路径。

公开地址变更会使旧 OAuth 授权失效；在客户端更新地址并重新连接。不要用临时预览网址作为正式入口，模板已关闭版本预览 URL。

换玩家 Secret 会使原网页会话失效；换 AI Secret 需更新 Operit / Kelivo / Actions 配置。**静态钥匙更换不会撤销已发出的 OAuth 授权。**需要一次撤销全部 OAuth 连接时，把普通变量 `GARDEN_OAUTH_EPOCH` 改为一个新的值（如日期加随机后缀）并重新部署，所有远程连接器需重新授权，花园存档不变。首次添加此变量同样会重置授权。

个人花园对所有访问者合计限制 OAuth 请求，避免休眠时丢失限流记录；达到上限后按返回时间等待。动态注册最多 200 个客户端，可通过上述方式清理失效授权。

## 运行结构与验证边界

同一套 `server/http.mjs`、种植引擎、MCP 和 Express OAuth 由 Cloudflare 官方 Node HTTP 适配层运行。构建时从已发布前端生成地图数据，并把上游 JSON 内容打包，避免在云端读写本地硬盘；不改上游 vendor 源文件。

SQLite 按小行保存大存档，事务失败会回滚，未变化的数据不重复写入。官方 SDK 原先用于清理限流记录的计时器改成持久化的按请求清理，允许对象闲置。工具链版本锁定；当前官方 Wrangler 配套 Miniflare 的版本号含 alpha，使用其实际 workerd 运行时做测试。

本版本验证了本地 workerd、官方 MCP 客户端、对象驱逐/重启、完整 OAuth 和部署 dry-run。**没有替你创建真实 Cloudflare 账号或线上 Worker，也没有验证各地区网络与所有客户端账号。**部署后先试登录、种一块地、刷新并让 AI 读状态，再长期使用。

## 官方参考

[Workers 定价](https://developers.cloudflare.com/workers/platform/pricing/) · [DO 定价](https://developers.cloudflare.com/durable-objects/platform/pricing/) · [静态资源](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) · [一键部署按钮](https://developers.cloudflare.com/workers/platform/deploy-buttons/) · [Node HTTP 兼容](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/)
