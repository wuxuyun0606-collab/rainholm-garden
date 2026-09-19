import assert from "node:assert/strict";
import { buyFromMarket, listForSale, makeFarm } from "../dist/game.js";
import { designCrop, plant, plantBatch, steal, tryWaterReward, usePotionBatch, waterAll } from "../dist/engine.js";

// 锚到「今天北京正午」：保持当天（不影响季节/图鉴等按天逻辑），但避免 Date.now() 临近北京午夜时
// now+1h 跨天，导致偷菜「同一家每天 1 次」等按天断言 flake。currentDayIndex 用 UTC+8 切天。
const now = Math.floor((Date.now() + 8 * 3600 * 1000) / 86400000) * 86400000 + 4 * 3600 * 1000;

{
  const victim = makeFarm("原创农场", 101, { aiName: "Designer" });
  const thief = makeFarm("访客农场", 202, { aiName: "Visitor" });
  const designed = designCrop(victim, { name: "月光萝卜", desc: "会在夜里发亮的萝卜" });
  assert.equal(designed.ok, true);

  const planted = plant(victim, 1, "limited", designed.crop.id, now);
  assert.equal(planted.ok, true);
  const ripened = usePotionBatch(victim, { all: true });
  assert.equal(ripened.ok, true);

  // 原创(ugc)作物受保护：禁止偷，只能去集市买种子自己种。
  const stolen = steal(victim, 1, thief.id, now + 1, thief);
  assert.equal(stolen.ok, false);
  assert.match(stolen.error, /原创作物/);
  assert.ok(victim.plots[0].crop, "原创作物应仍留在地里（没被偷走）");
  assert.equal(thief.stealQuota?.n ?? 0, 0, "偷原创被挡回，不消耗小偷的每日次数");
}

{
  const farm = makeFarm("自家农场", 303);
  const planted = plant(farm, 1, "common", undefined, now);
  assert.equal(planted.ok, true);
  const ripened = usePotionBatch(farm, { all: true });
  assert.equal(ripened.ok, true);

  const selfSteal = steal(farm, 1, farm.id, now + 2, farm);
  assert.equal(selfSteal.ok, false);
  assert.match(selfSteal.error, /不能偷自己的菜/);
}

{
  const farm = makeFarm("浇水农场", 404);
  const planted = plant(farm, 1, "common", undefined, now);
  assert.equal(planted.ok, true);
  const before = farm.items.speed_potion ?? 0;

  const watered = waterAll(farm, farm.name, false);
  assert.equal(watered.ok, true);
  assert.equal(watered.helped > 0, true);
  assert.equal(tryWaterReward(farm, farm, watered.helped, now + 3), false);
  assert.equal(farm.items.speed_potion ?? 0, before);
}

{
  const farm = makeFarm("self-buy farm", 505, { aiName: "Seller" });
  const designed = designCrop(farm, { name: "selfbuycrop", desc: "market self-buy regression" });
  assert.equal(designed.ok, true);
  farm.seeds[designed.crop.id] = 1;
  const listed = listForSale(farm, "seed", designed.crop.id, 1);
  assert.equal(listed.ok, true);
  farm.silver = listed.price;

  const selfBuy = buyFromMarket(farm, farm, "seed", designed.crop.id, 1);
  assert.equal(selfBuy.ok, false);
  assert.equal(designed.crop.sales ?? 0, 0);
}

{
  // 偷菜叠加规则：小偷全局每天 3 次 + 1h 冷却，且同一家每天只能偷 1 次
  const HOUR = 60 * 60 * 1000;
  const va = makeFarm("受害甲", 606, { aiName: "Va" });
  plant(va, 1, "common", undefined, now);
  plant(va, 2, "common", undefined, now);
  usePotionBatch(va, { all: true });
  const thief = makeFarm("小偷", 707, { aiName: "Thief" });

  const s1 = steal(va, 1, thief.id, now, thief);
  assert.equal(s1.ok, true);
  // 全局 1h 冷却（codex 规则）：紧接着第二刀被冷却挡
  const s1b = steal(va, 2, thief.id, now + 1, thief);
  assert.equal(s1b.ok, false);
  assert.match(s1b.error, /先歇一会儿|冷却|歇/);
  // 过了冷却、同一家同一天再来：被 per-victim 规则挡（我的规则，不消耗全局次数）
  const s2 = steal(va, 2, thief.id, now + HOUR + 1, thief);
  assert.equal(s2.ok, false);
  assert.match(s2.error, /今天已经偷过这家/);

  // 换一家、过了 1h 冷却：全局第 2 次成功（证明 s2 没消耗全局次数）
  const vb = makeFarm("受害乙", 808, { aiName: "Vb" });
  plant(vb, 1, "common", undefined, now);
  usePotionBatch(vb, { all: true });
  const s3 = steal(vb, 1, thief.id, now + HOUR + 1, thief);
  assert.equal(s3.ok, true);
}

{
  // 限定/自创种子能种下：agent 页「种限定种子」按钮走的 run→plantBatch({limited}) 路径，消耗 1 颗库存并占地
  const farm = makeFarm("限定种植农场", 909, { aiName: "U" });
  const d = designCrop(farm, { name: "限定测试花", desc: "limited-plant regression" });
  assert.equal(d.ok, true);
  assert.equal((farm.seeds[d.crop.id] ?? 0) > 0, true); // designCrop 到手数颗种子入库
  const before = farm.seeds[d.crop.id];

  const pr = plantBatch(farm, { limited: [d.crop.id] }, now);
  assert.equal(pr.ok, true);
  assert.equal(pr.limitedIds.includes(d.crop.id), true);
  assert.equal(farm.seeds[d.crop.id] ?? 0, before - 1);          // 消耗 1 颗
  assert.equal(farm.plots.some((p) => p.crop?.limitedId === d.crop.id), true); // 确实种下
}

{
  // 限定/自创种子可按「中文名」种（不只 id）：bag 给的是中文名，玩家照着填要能种
  const farm = makeFarm("按名种植", 1111, { aiName: "N" });
  const d = designCrop(farm, { name: "星语花测试", desc: "plant-by-name" });
  assert.equal(d.ok, true);
  const r = plantBatch(farm, { limited: [d.crop.name] }, now); // 用中文名，不是 id
  assert.equal(r.ok, true);
  assert.equal(r.limitedIds.includes(d.crop.id), true);        // 解析回正确的 id
  assert.equal(farm.plots.some((p) => p.crop?.limitedId === d.crop.id), true);
}

console.log("smoke tests passed");
