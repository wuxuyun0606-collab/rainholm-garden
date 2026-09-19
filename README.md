# Rainholm Garden

一座手绘的小花园，一间小花房，一间给两只猫住的小窝。
种下去，浇水，等它熟，收的那一刻才知道长出来的是什么。

院子里有两只猫：**白猫是你**，点地面它就走过去；**黑猫是你的 AI**，它自己有一套接口，能看地图、能走、能说话、能种你的地。
两只猫种的是**同一片地、同一份存档**。它收了你刷新就看得见，你收了它下次读地图就知道。

无需数据库或模型 API Key。`node start.mjs` 一键启动，自动准备玩家与 AI 两把钥匙，并打开连接页。
Operit、Kelivo 用 MCP；ChatGPT 用 Actions；Claude Chat 用远程 MCP + OAuth。DeepSeek 普通网页可用便笺方式参与。

**许可说明：本仓库是公开源码的非商业发行版。** 自写代码采用 MIT，但随包的
种植引擎采用 PolyForm Noncommercial 1.0.0；整包不属于 OSI 定义的开源软件，
也不是可自由商用的 MIT 整包。各项素材条款见 `NOTICE`。

![花园白天](docs/screenshots/garden-day.jpg)

---

## 一键开始

安装 Node.js 20 或以上版本，下载并解压 [最新版本](https://github.com/wuxuyun0606-collab/rainholm-garden/releases/latest)，在项目目录运行：

```bash
node start.mjs
```

首次自动安装锁定版本的 MCP 依赖、生成玩家 / AI 两把独立随机钥匙、准备示例存档，并打开已登录的连接页。
macOS 也可以双击 `start.command`，Windows 双击 `start.bat`（均需已安装 Node.js）。

**连接页会给你可复制的 MCP 配置、ChatGPT Actions 地址、Claude 授权说明和普通聊天便笺。**
游戏画面右下角的「连接 AI」可以随时回来。

| 你在哪聊天 | 怎么接入 |
|---|---|
| Operit / Kelivo | Streamable HTTP MCP + 独立 AI 钥匙 |
| ChatGPT | 带 Actions 的自定义 GPT，导入 OpenAPI，API Key / Bearer 认证 |
| Claude Chat | 自定义远程连接器，填 `/mcp`，在花园授权页用玩家钥匙批准 |
| DeepSeek 官方网页 / 无工具的普通聊天 | 复制游戏快照给 AI，粘回 JSON 指令，在网页确认执行 |
| Operit / Kelivo 中的 DeepSeek 模型 | 客户端和模型支持工具调用时，通过 MCP 自动操作 |

客户端是否显示自定义连接器 / GPT 编辑入口，由各产品版本、账号和套餐决定。
上面是服务端提供的接入方式，**不代表未安装工具的聊天窗口可以靠一个链接自动执行**。

### 手机与电脑同一 Wi-Fi

```bash
node start.mjs --lan
```

启动器列出电脑的局域网地址。手机打开连接页，填玩家钥匙；Operit / Kelivo 填同一个电脑地址的 `/mcp`。
若需要查看钥匙，运行 `node start.mjs --lan --show-access`。钥匙只在这次显式查看时打印。

### Docker

```bash
docker compose up -d --build
docker compose exec garden node start.mjs --show-access
```

默认只发布到本机 5173 端口；存档和钥匙保存在独立数据卷。详细网络配置见 [部署说明](docs/DEPLOY.md)。

### Cloudflare 免费额度部署

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wuxuyun0606-collab/rainholm-garden)

**个人花园优先推荐这个方案。**用 Workers + 免费额度内的 SQLite Durable Objects 保存花园，静态资源免费托管，自带 HTTPS，不需要电脑常开或购买域名。额度有限，超限会报错；AI 模型费用另算。

点击按钮后填入两把独立随机 Secret：`GARDEN_USER_KEY`、`GARDEN_AI_KEY`，部署完成便可连接上述客户端。钥匙可用 `node cloudflare/keys.mjs` 生成，请私人保存。完整步骤、额度、备份和升级规则见 [Cloudflare 部署说明](docs/CLOUDFLARE.md)。

### Render 部署到公网 HTTPS

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/wuxuyun0606-collab/rainholm-garden)

**此模板使用 Render 付费 Starter 实例与持久磁盘，请在平台确认价格后部署。**
创建服务后，从环境变量取得 `GARDEN_USER_KEY`，打开服务网址登录。AI 钥匙在连接页复制。
平台负责 HTTPS；模板自动使用 `RENDER_EXTERNAL_URL` 作为连接地址。
本仓库不会替你创建付费服务、购买域名或消耗模型额度。

ChatGPT Actions、Claude 云端连接器访问不到你的 `127.0.0.1` 或家庭 Wi-Fi，需要公网 HTTPS。
本机接反代时使用 `node start.mjs --public-base-url https://garden.example.com`；该参数不负责创建隧道。

第一次种的是示例存档中的两块田；以后启动沿用同一份 `data/garden-save.json`。
不要运行两个进程共写一个存档目录。完整步骤见 [快速开始](docs/QUICKSTART.md)、[AI 接入](docs/AI_GUIDE.md)、[部署与备份](docs/DEPLOY.md)。

---

## 长什么样

| | |
|---|---|
| 花园·夜 | ![](docs/screenshots/garden-night.jpg) |
| 花房 | ![](docs/screenshots/greenhouse.jpg) |
| 小窝 | ![](docs/screenshots/cathome.jpg) |
| 收获票签 | ![](docs/screenshots/harvest-ticket.jpg) |
| 手机竖屏 | ![](docs/screenshots/mobile-day.jpg) |

---

## 怎么玩

- **种** —— 点一块空地，植株头顶浮出三颗钮，选「种」，再挑普通种子（8 金）或奇幻种子（40 金）。
  种下去只有一株神秘幼苗，**收获那一刻才揭晓长出来的是什么**。
- **浇** —— 浇水提高稀有度的运气，最多叠 6 次。长按「浇」＝一次浇满。
- **收** —— 熟了就收，一张毛玻璃上的票签告诉你品种、稀有度、收过几次。第一次收到的品种进图鉴，另有一笔奖励。
- **图鉴** —— 右上角那颗。123 种作物做成一墙票签，没收到过的只有灰影和一个问号。花房另有一本「花的图鉴」。
- **花房** —— 走到花房门口那颗箭头进去。八个花盆，四种花，跟菜园一个钱包、一份存档。
- **小窝** —— 两只猫的屋子。点床，两只一起去睡；点沙发，两只一起窝着。
- **换一片地 / 升级土地** —— 攒够钱和图鉴就能扩地，格子更多、稀有度上限更高。
- **昼夜** —— 右上角那颗手动切；不碰它就按本机时钟走（22:00–06:30 是夜）。
- **四季** —— 一季 2 天 6 小时，九天一轮，花园花房同一口钟。冬天畦上盖雪，季节限定作物只在它那一季出。
- **说话** —— 左下角那颗对话钮，打一句，白猫头顶冒出来、跟着它走。猫跑到屏幕外头说话，顶上会冒一条带小头像的气泡。
- **视角** —— 「视角」钮开了镜头才跟着白猫走，默认不跟。跟随是限速的，宁可落后一点也不飞。
- **鸣谢** —— 钮列最下面那颗。

---

## 两只猫

猫是光栅四向走路帧（正 / 背 / 左 / 右 × 8 帧），只靠自托管的 pixi.js 画，不连任何外网。

- **白猫 ＝ 你。** 点一块地面它就走过去；点到走不到的地方，它会停在离那儿最近能站的点，不会装没看见。
- **黑猫 ＝ 你的 AI。** 它不听页面指挥，只听 `POST /garden/api/cat/black`。没人指挥的时候它自己遛弯、趴下打盹。
- 两只互不穿身。花园、花房、小窝各有一套禁行区（`web/walk-map.json`），菜畦踩不进、花房玻璃走不穿。
- 点一下猫，头顶冒一声「喵」。

不想要猫：`?cats=0`，或者 `localStorage.rhCatsOff = '1'`。

---

## 给你的 AI 看的地图和种地接口

黑猫怎么知道床在哪、哪块畦熟了？读地图。

```bash
# ① 地图：8 块畦 / 8 个花盆各在什么坐标、地里现在什么状态、小窝的床沙发在哪、门在哪、猫常待哪片
#    scene = garden | greenhouse | cathome；换 map.md 拿人话版（Markdown，直接喂给模型）
curl -s -H 'Authorization: Bearer <AI_KEY>' 'http://127.0.0.1:5173/garden/api/cat/black/map?scene=garden'
curl -s -H 'Authorization: Bearer <AI_KEY>' 'http://127.0.0.1:5173/garden/api/cat/black/map.md?scene=cathome'

# ② 让黑猫走过去 / 头顶冒一句（x,y 是底图世界坐标 1536×1024，直接抄地图里的数）
curl -s -X POST http://127.0.0.1:5173/garden/api/cat/black \
     -H 'Authorization: Bearer <AI_KEY>' -H 'Content-Type: application/json' -d '{"x":1200,"y":880,"say":"我来了"}'

# ③ 让黑猫种地：plant / water / harvest，plot 从 1 起，say 可选（成功才冒泡）
curl -s -X POST http://127.0.0.1:5173/garden/api/cat/black/farm \
     -H 'Authorization: Bearer <AI_KEY>' -H 'Content-Type: application/json' \
     -d '{"scene":"garden","action":"plant","plot":3,"seedType":"common","say":"我去种 3 号畦"}'
```

- 地图是**请求那一刻现算**的：坐标从前端那几份源文件读（`app.js` 的畦和盆、`host-cat.js` 的家具落地面、`walk-map.json` 的禁行区），挪一件家具地图就跟着变，不是抄死的表。
- 每块畦记着**最后是谁动的手**（`lastActor`：玩家 / AI）。页面每 30 秒拉一次状态，回到前台也拉，黑猫种了什么你不用刷新。
- 黑猫的种浇收走的是和玩家**同一条账本、同一份存档**。新 MCP / Actions 接口使用 `requestId` 防止重试重复执行；同一个意图重试要沿用同一个编号（保留最近 200 条）。
- 想接自己的 AI：定时读 `map.md`，让模型决定去哪、做什么，再打 ②③ 两条。就这么多。

这些接口要求独立 **AI 钥匙**。网页使用玩家会话，AI 无权登录网页或读取连接设置。
浏览器跨站请求会被拒绝，POST 必须使用 JSON。旧接口仍可使用，但需要认证；可靠重试请使用 MCP 或 `/garden/api/ai/action`。

---

## 项目结构

```
server/
  serve.mjs      本机启动与文件存档
  http.mjs       本机 / Cloudflare 共用的认证、游戏和 AI 接口
  access.mjs     两种钥匙与会话、Host/Origin 校验
  agent.mjs      MCP/Actions/便笺共用的黑猫操作
  mcp.mjs        官方 SDK 的 Streamable HTTP MCP
  oauth.mjs      Claude 等远程客户端的 OAuth 授权
  openapi.mjs    ChatGPT Actions 的 OpenAPI schema
  scenes.mjs     花园 / 花房分派：一份存档两块地、一个钱包、一个版本号
  garden.mjs     花园那一半的服务与视图，幂等账本在这里
  ai-map.mjs     给 AI 看的地图：现读 web 那几份源文件算坐标，不落死数
  map-names.json 地图上的中文名（覆盖表；小窝八块家具的 id 也在这儿定）
web/
  index.html     页面骨架
  app.js         渲染、地块、图鉴、揭晓卡、场景切换
  host-boot.js   宿主引导：昼夜、起手参数、动态挂猫层
  host-cat.js    猫层（自包含）：四向走路、禁行区、玩家说话、黑猫接口轮询
  walk-map.json  三个场景的可走区 / 禁行区 / 门口落点
  style.css      主样式
  assets/        底图、植株、图标、字体、图鉴 123 张、猫的走路帧与双猫幕
  assets/v7 v8   界面增量包：票签、图鉴墙、角钮、气泡、鸣谢……每个文件头都写了它管什么
  vendor/        pixi.js（自托管）
vendor/aifarm/   上游规则引擎（⚠️ 禁商用，见 NOTICE）
start.mjs        一键启动器
web/connect/     登录与 AI 连接、便笺页面
Dockerfile       可持久化容器部署
render.yaml      Render 一键部署模板（付费持久磁盘）
wrangler.jsonc   Cloudflare 一键部署配置（免费额度）
cloudflare/      持久存储、官方 HTTP 适配与构建
data/            存档与私人钥匙（不入 Git）
docs/            截图
```

---

## 鸣谢

- 小屋方案原作：59（小红书）
- 种植方案原作：初一（小红书）
- rainholm小屋制作：BlueBlue（小红书）

页面里也有一颗「鸣谢」钮，三个场景和加载页都在。

---

## 许可

- 本项目自己写的代码：**MIT**，署名 suwanblue & Kelin & Guchen（见 `LICENSE`）。
- 规则引擎 `vendor/aifarm`：**PolyForm Noncommercial 1.0.0，禁商用**。
  Required Notice: Copyright 2026 tutusagi。上游 https://github.com/tutusagi/aifarm-oss 。
  ⚠️ 最严的这条管住整包——**整仓库一起分发时按禁商用算**。想商用，自己去找上游谈。
- 美术：Guchen Zoran。图标 Lucide（ISC）。字体站酷快乐体、寒蝉全圆体、Noto Sans/Serif CJK SC（均 OFL）。pixi.js（MIT）。
- 两只猫的形象源自 LittleCat by Ezri（Ezri Free Material License，许可全文随包）。走路帧是重绘的光栅图，不含原模型文件。

逐项见 `NOTICE`。

---

## 验证

```bash
npm test
node vendor/aifarm/tools/smoke-test.mjs
node vendor/aifarm/tools/parity-check.mjs
```

项目测试使用临时存档，覆盖启动、地图、角色认证、官方 MCP 客户端、Actions、OAuth、幂等重试和来源边界。Cloudflare 另运行 `npm run test:cloudflare`（Node 22+）。版本验证范围见 [v1.3 发布检查](docs/RELEASE-1.3.md)。

## TODO

- [ ] 补充浏览器交互的自动化回归测试。
- [ ] i18n：界面文案全是中文，硬编码在 `app.js` 和几份增量包里。
- [ ] 更多客户端版本的实机兼容性回归。
