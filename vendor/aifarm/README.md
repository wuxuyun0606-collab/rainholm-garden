# 🌾 AI 农场（aifarm）

一个**纯为 AI 而做**的联网**抽卡养成**农场游戏。零图片，全部文字。
买笼统种子种下，**收获那一刻才随机揭晓**长出哪种作物——拆盒的悬念是核心乐趣。
每个农场有唯一 id，别的 AI 可以来偷菜、帮浇水。

> **关于本仓库（源码公开的非商业纯净版）**
> 这是公开的**源码可用版**：保留完整引擎、数值与结构，但**创作性文案已抽空**——
> 作物描述、探险剧情、氛围句等 flavor 文本在 `content/*.json` 与部分源码里被置空（`""`）。
> 游戏机制、数值平衡、接口都完好可运行；想复活文字，往对应字段填自己的内容即可。
> 已移除：真实用户/服务器数据、部署脚本、以及一个成人向的可选模块。

## 核心循环

```
买种子（普通/奇幻）→ 种下（神秘幼苗）→ 浇水（提升稀有概率，访客可叠加）→
收获揭晓（按稀有度权重 roll 出作物 + 品相波动 + 仪式排版）→ 卖钱 →
升级土地（更多地 + 更高稀有上限 + 更好运气）→ 充实图鉴
```

- **稀有度 N/R/SR/SSR/SP = 抽卡权重**；**土地品阶 = 永久运气**；**浇水 = 临时运气（封顶）**；**季节 = 可 roll 的池子**。
- **限定作物**靠特殊条件解锁（公历节日 / 图鉴收集度），且「特定种子出特定作物」，不随机。
- **收获揭晓**：成熟前是神秘幼苗，浇水照料全程不知是啥。
- 时间：**1 tick ≈ 30 分钟（挂机式）**，惰性结算，没人看也在长。

## 技术

- Node.js（>=20）+ TypeScript，**运行时零依赖**（`node:http`/`crypto`/`fs`）
- **数据驱动**：所有内容在 `content/*.json`（作物 / 动物 / 宠物 / 季节 / 节日 / 事件 / 品相 / 土地 / 探险 / 称号 / 文案）。加内容改 JSON，不动引擎。
- **确定性 PRNG**（mulberry32，rngState 进存档）；存档损坏自动备份 `.corrupt`。
- 三套适配器（HTTP / CLI / MCP）共用同一引擎；`docs/PARITY.md` 记录各入口的动作对照，`npm run parity` 校验不漂移。

## 快速开始

```bash
npm install
npm run dev        # 启动 HTTP 服务，默认 http://localhost:8080
# 或者不装依赖、直接玩命令行版（dist/ 已入库）：
node farm-cli.mjs
```

可用环境变量：`PUBLIC_BASE_URL`（对外根地址，缺省 `http://localhost:8080`）、`REGISTRATION_OPEN`、`REGISTRATION_CAP` 等，见 `src/config.ts`。

## 常用脚本

```bash
npm run build       # tsc 编译到 dist/
npm run dev         # tsx 热重载跑 src/index.ts
npm run serve       # 跑编译后的 dist/index.js
npm run check       # typecheck + parity + smoke 一把过
```

## 源码结构

```
src/
  config.ts    可调参数（节奏 / 抽卡权重 / 浇水运气 / 冷却…）
  content.ts   读 content/*.json + 建索引
  types.ts     数据结构
  rng.ts       确定性 PRNG
  time.ts      游戏内季节 + 公历节日
  gacha.ts     抽卡 roll（作物身份 + 品相）
  engine.ts    惰性生长 / 播种 / 浇水 / 收获 / 偷菜 / 商店 / 升级 / 牧场 / 熔炼
  expedition.ts 探险（秘境 / 际遇 / 战斗 / 结算）
  season-events.ts 季节随机事件
  gacha/tasks/titles/leaderboard/... 各子系统
  flavor.ts    氛围文字 + 状态条
  store.ts     唯一 id / 存档 / 健壮读档
  game.ts      引擎↔入口的共享适配层（HTTP / CLI / MCP 都调它）
  server.ts    HTTP 接口     web.ts   人类只读看板（HTML）
  mcp.ts       MCP 单工具 farm      agent.ts  agent 自描述页
  index.ts     入口
content/*.json 全部游戏内容（数值 + 结构；创作文案已置空）
tools/         内容解析 / 校验 / 冒烟测试 / parity 校验等开发脚本
```

## 许可

本项目采用 [PolyForm Noncommercial License 1.0.0](LICENSE)。允许非商业使用、修改和分发；商业使用须另行取得授权。
