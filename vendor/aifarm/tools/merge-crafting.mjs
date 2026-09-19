// 把 DS 的熔炼填充稿合并进 content/{materials,recipes,crops}.json（按 id 去重）。
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const D = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(D, "../docs/### A. 素材（新增 15 种，补齐至 30 种）.txt");
const C = resolve(D, "../content");
const lines = readFileSync(SRC, "utf8").split(/\r?\n/);
const cells = (l) => l.trim().slice(1, -1).split("|").map((c) => c.trim());
const isSep = (c) => c.every((x) => /^:?-{2,}:?$/.test(x));

let section = "", header = null;
const A = [], B = [], CC = [];
for (const raw of lines) {
  const l = raw.trim();
  if (l.startsWith("### A")) { section = "A"; header = null; continue; }
  if (l.startsWith("### B")) { section = "B"; header = null; continue; }
  if (l.startsWith("### C")) { section = "C"; header = null; continue; }
  if (l.startsWith("|") && l.endsWith("|")) {
    const c = cells(l);
    if (isSep(c)) continue;
    if (!header) { header = c; continue; }
    const o = {}; header.forEach((h, i) => (o[h] = c[i] ?? ""));
    if (section === "A") A.push(o);
    else if (section === "B") B.push(o);
    else if (section === "C") CC.push(o);
  } else header = null;
}

const SEED_DEF = { SR: 30, SSR: 60, SP: 120 };
const load = (n) => JSON.parse(readFileSync(resolve(C, `${n}.json`), "utf8"));
const save = (n, v) => writeFileSync(resolve(C, `${n}.json`), JSON.stringify(v, null, 2), "utf8");
const mergeById = (arr, add) => {
  const seen = new Set(arr.map((x) => x.id));
  for (const x of add) if (!seen.has(x.id)) { arr.push(x); seen.add(x.id); }
  return arr;
};

// A 素材
const materials = mergeById(load("materials"), A.filter((o) => o.id).map((o) => ({
  id: o.id, name: o["名称"], rarity: o["稀有度"], desc: o["描述"],
})));
save("materials", materials);

// B 配方（去重：按排序后的素材组合）
const recipes = load("recipes");
const keyOf = (m) => [...m].sort().join("+");
const seenR = new Set(recipes.map((r) => keyOf(r.materials)));
for (const o of B) {
  if (!o.materials) continue;
  const mats = o.materials.split("+").map((s) => s.trim()).filter(Boolean);
  if (mats.length !== 3 || seenR.has(keyOf(mats))) continue;
  recipes.push({ materials: mats, output: o.output, hint: o.hint });
  seenR.add(keyOf(mats));
}
save("recipes", recipes);

// C 追加 craftable 限定作物
const crops = load("crops");
const seenC = new Set(crops.map((c) => c.id));
const num = (v) => { const n = parseInt(String(v).replace(/[^\d]/g, ""), 10); return Number.isFinite(n) ? n : null; };
for (const o of CC) {
  if (!o.id || seenC.has(o.id)) continue;
  const rarity = o["稀有度"];
  crops.push({
    id: o.id, name: o["名称"], latin: o["学名"], desc: o["描述"],
    category: "limited", rarity,
    growTicks: num(o["生长tick"]) ?? 18, water: null,
    seedPrice: SEED_DEF[rarity] ?? 60, sellPrice: num(o["售价"]) ?? 500,
    family: null, unlockTier: null,
    mechanicText: o["特殊机制"] || null, mechanicStatus: "active", mechanicSystem: null,
    unlockType: "craft", unlockCond: "熔炼获得", produce: null,
  });
  seenC.add(o.id);
}
save("crops", crops);

console.log(`素材 → ${materials.length}（+${A.length}）`);
console.log(`配方 → ${recipes.length}`);
console.log(`作物 → ${crops.length}（新增 craft 限定 ${CC.filter((o) => o.id).length}）`);
// 校验配方 output 都存在
const ids = new Set(crops.map((c) => c.id));
const bad = recipes.filter((r) => !ids.has(r.output));
console.log("配方 output 缺失:", bad.length ? bad.map((r) => r.output) : "无 ✓");
const craftLimited = crops.filter((c) => c.category === "limited" && c.unlockType !== "festival").length;
console.log("可熔炼限定作物总数:", craftLimited);
