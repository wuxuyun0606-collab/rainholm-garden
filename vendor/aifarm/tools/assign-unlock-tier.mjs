// 给普通/奇幻作物分配 unlockTier(1-5)：按品种解锁、混合稀有度、前期富集。
// 不和稀有度严格挂钩——每个稀有度组都铺到各品阶，且多数在低阶。限定不参与(null)。
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const FILE = resolve(dirname(fileURLToPath(import.meta.url)), "../content/crops.json");
const crops = JSON.parse(readFileSync(FILE, "utf8"));

// 前期富集：~45% 在荒地(1)，往后递减
const tierOf = (f) => (f < 0.45 ? 1 : f < 0.65 ? 2 : f < 0.82 ? 3 : f < 0.93 ? 4 : 5);

for (const cat of ["common", "fantasy"]) {
  const byR = {};
  for (const c of crops) if (c.category === cat) (byR[c.rarity] ??= []).push(c);
  for (const r of Object.keys(byR)) {
    const arr = byR[r].sort((a, b) => (a.id < b.id ? -1 : 1));
    arr.forEach((c, i) => (c.unlockTier = tierOf((i + 0.5) / arr.length)));
  }
}
for (const c of crops) if (c.category === "limited") c.unlockTier = null;

writeFileSync(FILE, JSON.stringify(crops, null, 2), "utf8");

// 报告分布
const dist = {};
for (const c of crops) {
  if (c.category === "limited") continue;
  const k = `T${c.unlockTier}`;
  (dist[k] ??= { common: 0, fantasy: 0, byRarity: {} });
  dist[k][c.category]++;
  dist[k].byRarity[c.rarity] = (dist[k].byRarity[c.rarity] || 0) + 1;
}
for (const t of Object.keys(dist).sort()) console.log(t, JSON.stringify(dist[t]));
