// 解析 DS 的「特殊事件 & 特殊图鉴」稿 → content/special-drops.json + special-events.json
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const D = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(D, "../docs/# AI 农场 · 特殊事件 & 特殊图鉴（DS 填写）.txt");
const OUT = resolve(D, "../content");
const lines = readFileSync(SRC, "utf8").split(/\r?\n/);

let section = ""; // events / drops
let header = null;
const eventRows = [], dropRows = [];
const cells = (l) => l.trim().slice(1, -1).split("|").map((c) => c.trim());
const isSep = (c) => c.every((x) => /^:?-{2,}:?$/.test(x));

for (const raw of lines) {
  const l = raw.trim();
  if (l.startsWith("## A")) { section = "events"; header = null; continue; }
  if (l.startsWith("## B")) { section = "drops"; header = null; continue; }
  if (l.startsWith("###")) { header = null; continue; }
  if (l.startsWith("|") && l.endsWith("|")) {
    const c = cells(l);
    if (isSep(c)) continue;
    if (!header) { header = c; continue; }
    const o = {}; header.forEach((h, i) => (o[h] = c[i] ?? ""));
    if (section === "events") eventRows.push(o);
    else if (section === "drops") dropRows.push(o);
  } else header = null;
}

// drops
const drops = dropRows
  .filter((o) => o["id"])
  .map((o) => ({ id: o["id"], name: o["名称"], desc: o["故事"], rarity: o["品级"], value: Number(o["价值"]) }));

// events：掉落类抽出来当掉落开场白，其余为奖励事件
const bonus = [], dropIntros = [];
for (const o of eventRows) {
  if (!o["id"]) continue;
  if (o["效果类型"] === "掉落") { dropIntros.push(o["文案"]); continue; }
  bonus.push({ id: o["id"], name: o["名称"], effectType: o["效果类型"], param: o["参数"], weight: Number(o["权重"]) || 1, text: o["文案"] });
}

writeFileSync(resolve(OUT, "special-drops.json"), JSON.stringify(drops, null, 2), "utf8");
writeFileSync(resolve(OUT, "special-events.json"), JSON.stringify({ bonus, dropIntros }, null, 2), "utf8");
console.log(`特殊掉落物 ${drops.length} 件 | 奖励事件 ${bonus.length} 个 | 掉落开场白 ${dropIntros.length} 条`);
const byR = {}; for (const d of drops) byR[d.rarity] = (byR[d.rarity] || 0) + 1;
console.log("掉落物按品级:", JSON.stringify(byR));
console.log("奖励事件:", bonus.map((b) => `${b.name}(${b.effectType}${b.param})`).join(" "));
