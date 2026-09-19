# 🗺️ 探险 · 加秘境工具

把 DS 按《通用秘境文案模板》(`docs/expedition-ds-template-generic.md`) 填好的 markdown，
一条命令转成数据并合并进 `content/expeditions.json`。机械活脚本干，数值平衡你过一遍。

## 用法

```bash
# 先 dry-run 看一眼解析对不对、有哪些要手配的（不写文件）
node tools/expedition/add-map.mjs <DS稿.md> --id <mapId> --dry-run

# 没问题了，真合并进 content/expeditions.json
node tools/expedition/add-map.mjs <DS稿.md> --id <mapId>

# map id 已存在、确定要覆盖
node tools/expedition/add-map.mjs <DS稿.md> --id <mapId> --force
```

- `--id` 必填：秘境的英文 id（中文名不能当 id），如 `rusty_clocktown`。
- 事件 id、标题用 DS 稿里 `### 事件 · 标题 · id` 那行的。

## 它自动做的

- 解析秘境设定（名字 / 是个什么地方+基调→theme / 引子→intro）。
- 解析每个事件：类型、触发层、出现频率→weight、故事、掉落、选项+后果、战斗。
- 中文→枚举：纯剧情/掉落/分支/奇遇/战斗、浅/深/终景、常见/偶见/稀有、易/中/难。
- 后果词：得到装饰品/药水/金币/银币、状态±、获得加成、纯剧情后果、进入战斗、跳转(按标题找 id)。
- 装饰：凡 `装饰品：名字` 自动登记一条 decoration（id=`exp_<mapId>_<n>`）。
- 终景的战斗事件自动设成 map.finale。

## 合并后必须你过一遍（脚本会在结尾列「⚠️ 待配清单」）

1. **金币/银币数量**：按层填了默认值（浅35/深55/终景200、银45），按事件轻重微调。
2. **装饰 visitLine**：占位符 `（待补…）`，给每件摆件写一句串门展示的氛围话。
3. **战斗 win.drops / critDrops**：战利品已尽量解析；critDrops 默认给「药水×2」当大胜犒赏，按需改/删。
4. **跳转目标**找不到会被降级成「无后果」并告警——改成稿里真实存在的事件标题。

过完清单 → `npm run build` → 本地/线上验证 → 部署。

## 文件

- `add-map.mjs` 主脚本（可调默认值在文件顶部常量区）。
- `_sample.md` 一份小样例（锈钟古镇，3 事件覆盖掉落/奇遇/战斗），可拿来试 dry-run。
