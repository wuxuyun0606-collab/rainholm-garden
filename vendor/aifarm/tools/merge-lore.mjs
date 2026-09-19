import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const D = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(D, "../docs/# AI 农场 · 稀有叙事（lore）填写.txt");
const FILE = resolve(D, "../content/crops.json");
const lines = readFileSync(SRC, "utf8").split(/\r?\n/);
const crops = JSON.parse(readFileSync(FILE, "utf8"));
const byId = new Map(crops.map((c) => [c.id, c]));
let n = 0, miss = [];
for (const l of lines) {
  if (!l.trim().startsWith("|")) continue;
  const c = l.trim().slice(1, -1).split("|").map((x) => x.trim());
  if (c.length < 4 || c[0] === "id" || /^:?-+:?$/.test(c[0])) continue;
  const id = c[0], lore = c[3].replace(/\*\*/g, "").trim();
  if (!lore) continue;
  const crop = byId.get(id);
  if (!crop) { miss.push(id); continue; }
  crop.lore = lore;
  n++;
}
writeFileSync(FILE, JSON.stringify(crops, null, 2), "utf8");
console.log(`录入 lore: ${n} 条`);
console.log("缺失id:", miss.length ? miss : "无 ✓");
const withLore = crops.filter((c) => c.lore && (c.rarity === "SSR" || c.rarity === "SP")).length;
console.log("SSR/SP 有lore的:", withLore);
