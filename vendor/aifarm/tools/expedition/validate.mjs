#!/usr/bin/env node
// 🔍 秘境机制校验器 —— 扫 content/expeditions.json，只查「结构/引用/机制」对不对，不碰内容含义。
//
// 用法：
//   node tools/expedition/validate.mjs            # 校验整份
//   node tools/expedition/validate.mjs <地图id>   # 只重点看某张图（装饰等跨图引用仍全局校验）
//
// 退出码：有 ❌ERROR 返回 1（publish 会据此中止发布），只有 ⚠️WARN/ℹ️INFO 返回 0。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const fileIx = argv.indexOf("--file");
const JSON_PATH = fileIx >= 0 ? path.resolve(argv[fileIx + 1]) : path.join(ROOT, "content", "expeditions.json");
const onlyMap = argv.find((a, i) => !a.startsWith("--") && (fileIx < 0 || i !== fileIx + 1));

const TYPES = new Set(["story", "drop", "choice", "encounter", "combat"]);
const LAYERS = new Set(["shallow", "deep", "finale"]);
const DIFFS = new Set(["easy", "mid", "hard"]);
const DROP_T = new Set(["coins", "silver", "potion", "decor"]);
const OUT_T = new Set(["coins", "silver", "potion", "decor", "status", "buff", "jump", "combat", "none"]);

const errors = [], warns = [], infos = [];
const E = (id, m) => errors.push(`❌ [${id}] ${m}`);
const W = (id, m) => warns.push(`⚠️  [${id}] ${m}`);
const I = (id, m) => infos.push(`ℹ️  [${id}] ${m}`);

let doc;
try { doc = JSON.parse(fs.readFileSync(JSON_PATH, "utf8")); }
catch (e) { console.error("❌ expeditions.json 不是合法 JSON：" + e.message); process.exit(1); }

const maps = doc.maps ?? [], events = doc.events ?? [], decorations = doc.decorations ?? [];
const eventById = new Map();
const decorIds = new Set(decorations.map((d) => d.id));
const usedDecor = new Set();

// —— 事件 id 唯一性 ——
for (const e of events) {
  if (!e.id) { E("?", "有事件缺 id"); continue; }
  if (eventById.has(e.id)) E(e.id, "事件 id 重复");
  eventById.set(e.id, e);
}

// —— 校验一份掉落 ExpDrop ——
function checkDrop(id, where, d) {
  if (!d || !DROP_T.has(d.t)) return E(id, `${where} 掉落类型非法：${JSON.stringify(d)}`);
  if (d.t === "decor") {
    if (!d.id) return E(id, `${where} 装饰掉落缺 id`);
    usedDecor.add(d.id);
    if (!decorIds.has(d.id)) E(id, `${where} 装饰掉落引用了不存在的装饰 id「${d.id}」——会显示成"装饰"两个字`);
  } else if (typeof d.n !== "number" || !(d.n > 0)) {
    W(id, `${where} 掉落 ${d.t} 的数量 n 不是正数（=${d.n}）`);
  }
}

// —— 校验一条后果 ExpOutcome ——
function checkOutcome(id, o) {
  if (!o || !OUT_T.has(o.t)) return E(id, `选项后果类型非法：${JSON.stringify(o)}`);
  switch (o.t) {
    case "coins": case "silver": case "potion":
      if (typeof o.n !== "number") E(id, `后果 ${o.t} 缺数量 n`); break;
    case "decor":
      if (!o.id) { E(id, "后果 decor 缺 id"); break; }
      usedDecor.add(o.id);
      if (!decorIds.has(o.id)) E(id, `后果引用了不存在的装饰 id「${o.id}」`); break;
    case "status": if (typeof o.n !== "number") E(id, "后果 status 缺 n"); break;
    case "buff": if (typeof o.mod !== "number") E(id, "后果 buff 缺 mod"); break;
    case "jump":
      if (!o.to) E(id, "后果 jump 缺 to");
      else if (!eventById.has(o.to)) W(id, `后果 jump 指向不存在的事件「${o.to}」——运行时会被忽略（跳转失效）`);
      break;
    case "combat":
      if (!o.foe) E(id, "后果 combat 缺 foe（敌人名）");
      if (o.difficulty && !DIFFS.has(o.difficulty)) E(id, `后果 combat 难度非法：${o.difficulty}`);
      break;
  }
}

// —— 逐事件校验 ——
for (const e of events) {
  if (onlyMap && e.map !== onlyMap) continue;
  const id = e.id ?? "?";
  if (!e.map) E(id, "事件缺 map");
  if (!TYPES.has(e.type)) E(id, `type 非法：${e.type}`);
  if (!LAYERS.has(e.layer)) E(id, `layer 非法：${e.layer}`);
  if (typeof e.weight !== "number" || !(e.weight > 0)) W(id, `weight 不是正数（=${e.weight}）——抽取权重可能不对`);
  if (!e.story || !String(e.story).trim()) W(id, "story 为空");

  if (e.type === "drop") {
    if (!e.drops?.length) W(id, "掉落类事件没有 drops");
    else e.drops.forEach((d) => checkDrop(id, "drops", d));
  }
  if (e.type === "choice" || e.type === "encounter") {
    if (!e.options?.length) {
      if (e.type === "choice") E(id, "choice(分支) 没有 options——没得选，是坏的");
      else I(id, "encounter(奇遇) 没有 options，引擎会当纯剧情播放（可能是有意的）");
    }
    const keys = new Set();
    for (const o of e.options ?? []) {
      if (!o.key) E(id, "有选项缺 key");
      else if (keys.has(o.key.toUpperCase())) E(id, `选项 key 重复：${o.key}`);
      else keys.add(o.key.toUpperCase());
      if (!o.label || !String(o.label).trim()) W(id, `选项 ${o.key} 的 label 为空`);
      if (!o.outcomes?.length) E(id, `选项 ${o.key} 没有 outcomes`);
      const hasJump = o.outcomes?.some((x) => x.t === "combat") && o.outcomes?.some((x) => x.t === "jump");
      if (hasJump) W(id, `选项 ${o.key} 同时有 combat 和 jump——combat 优先，jump 会被忽略`);
      (o.outcomes ?? []).forEach((oc) => checkOutcome(id, oc));
    }
  }
  if (e.type === "combat") {
    if (!e.foe) E(id, "战斗缺 foe（敌人名）");
    if (!e.difficulty || !DIFFS.has(e.difficulty)) E(id, `战斗难度非法/缺失：${e.difficulty}`);
    if (!e.win?.text) W(id, "战斗缺 win.text（赢了的叙事）");
    if (!e.win?.drops?.length) I(id, "战斗赢了没有 win.drops（无战利品，可能是有意的）");
    (e.win?.drops ?? []).forEach((d) => checkDrop(id, "win.drops", d));
    (e.win?.critDrops ?? []).forEach((d) => checkDrop(id, "win.critDrops", d));
    if (!e.lose?.text) W(id, "战斗缺 lose.text（没打过的叙事）");
    if (!e.record) I(id, "战斗没写 record（不进见闻录/图鉴）");
  }
  // 非分支/奇遇却带了 options，或分支带了 drops 之类的错配
  if (e.options?.length && !(e.type === "choice" || e.type === "encounter")) W(id, `${e.type} 事件带了 options，引擎不会用`);
}

// —— 逐地图校验 ——
for (const m of maps) {
  if (onlyMap && m.id !== onlyMap) continue;
  const id = "map:" + (m.id ?? "?");
  if (!m.id) E(id, "地图缺 id");
  if (!m.name) W(id, "地图缺 name");
  if (!m.intro) W(id, "地图缺 intro（进入时念的引子）");
  if (!m.events?.length) { E(id, "地图没有 events"); continue; }
  const seen = new Set();
  for (const eid of m.events) {
    if (seen.has(eid)) W(id, `events 里重复列了「${eid}」`); seen.add(eid);
    const ev = eventById.get(eid);
    if (!ev) E(id, `events 列了不存在的事件「${eid}」——运行时会被跳过，白占际遇额度`);
    else if (ev.map !== m.id) E(id, `事件「${eid}」的 map 是「${ev.map}」，却被列进了本图`);
  }
  // 反向：属于本图但没进 events 列表的事件（永远抽不到）
  for (const ev of events) if (ev.map === m.id && !seen.has(ev.id)) W(id, `事件「${ev.id}」属于本图但没列进 map.events，永远抽不到`);
  if (m.finale) {
    const fev = eventById.get(m.finale);
    if (!fev) E(id, `finale 指向不存在的事件「${m.finale}」`);
    else if (fev.map !== m.id) E(id, `finale「${m.finale}」不属于本图`);
    else if (fev.type !== "combat") I(id, `finale「${m.finale}」不是战斗事件（压轴通常是 boss 战）`);
  }
  const layers = new Set(m.events.map((eid) => eventById.get(eid)?.layer).filter(Boolean));
  if (!layers.has("shallow")) W(id, "本图没有 shallow（浅层）事件——开场可能直接跳深层");
  const combats = m.events.map((eid) => eventById.get(eid)).filter((ev) => ev?.type === "combat").length;
  if (combats > 3) W(id, `本图有 ${combats} 场战斗——偏多（战斗要伴侣摇骰，建议 1~2 场）`);
  if (combats === 0) I(id, "本图没有战斗（也行，纯探索流）");
}

// —— 装饰：定义了但从没被引用 ——
for (const d of decorations) {
  if (onlyMap && d.from && d.from !== onlyMap) continue;
  if (!usedDecor.has(d.id)) I("decor:" + d.id, `装饰「${d.name ?? d.id}」定义了但没有任何事件掉落它`);
  if (!d.visitLine) W("decor:" + d.id, "装饰缺 visitLine（摆到农场里访客看到的那句）");
}

// —— 汇总 ——
const line = (arr) => arr.length ? "\n  " + arr.join("\n  ") : " 无";
console.log(`\n🔍 校验 ${onlyMap ? `地图「${onlyMap}」` : "整份 expeditions.json"}：${maps.length} 图 / ${events.length} 事件 / ${decorations.length} 装饰`);
console.log(`\n❌ 错误 ${errors.length} 个（会出 bug，务必修）：${line(errors)}`);
console.log(`\n⚠️  警告 ${warns.length} 个（可能不对，建议核对）：${line(warns)}`);
console.log(`\nℹ️  提示 ${infos.length} 个（多半没事，知会一声）：${line(infos)}`);
console.log(errors.length ? `\n结论：❌ 有 ${errors.length} 个错误，建议修完再发。` : `\n结论：✅ 无致命错误，可以发。`);
process.exit(errors.length ? 1 : 0);
