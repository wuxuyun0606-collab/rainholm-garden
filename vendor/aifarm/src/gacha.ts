// 抽卡核心：收获时 roll 出作物身份 + 品相。
import { Rng } from "./rng.js";
import {
  RARITY_WEIGHT, LAND_LUCK, WATER_LUCK_PER, WATER_LUCK_CAP, rarityIndex, RECORD_CHANCE,
} from "./config.js";
import {
  cropsByCategory, qualities, type Crop, type Quality, type Category,
} from "./content.js";

const SEASON_ORDER = ["春", "夏", "秋", "冬"];

/** 跨季作物的可种判定：当前季节是否落在 "春-秋" 这类区间内 */
function seasonInRange(current: string, range: string): boolean {
  const parts = range.split(/[-—~]/).map((s) => s.trim());
  if (parts.length === 1) return parts[0] === current;
  const a = SEASON_ORDER.indexOf(parts[0]);
  const b = SEASON_ORDER.indexOf(parts[1]);
  const c = SEASON_ORDER.indexOf(current);
  if (a < 0 || b < 0 || c < 0) return false;
  return a <= b ? c >= a && c <= b : c >= a || c <= b;
}

// 池子由「解锁品阶 unlockTier ≤ 土地品阶」决定（按品种解锁，不卡稀有度）。
// 稀有度只当权重——荒地也能抽到高稀有，只是概率低。
function eligibleCommon(season: string, landTier: number): Crop[] {
  return cropsByCategory("common").filter((c) => {
    if ((c.unlockTier ?? 1) > landTier) return false;
    if (c.availability === "allyear") return true;
    if (!c.seasons) return true;
    return seasonInRange(season, c.seasons);
  });
}

function eligibleFantasy(landTier: number): Crop[] {
  return cropsByCategory("fantasy").filter((c) => (c.unlockTier ?? 1) <= landTier);
}

/** roll 出一种作物身份 */
export function rollCrop(
  rng: Rng,
  seedType: Exclude<Category, "limited">,
  landTier: number,
  waterCount: number,
  season: string,
  extraLuck = 0, // 额外运气（如招财猫宠物 buff），叠在土地/浇水运气之上
): Crop {
  const pool = seedType === "common" ? eligibleCommon(season, landTier) : eligibleFantasy(landTier);
  if (pool.length === 0) {
    // 兜底：至少返回一个该类别最低稀有度作物
    return cropsByCategory(seedType)[0];
  }
  const luck = (LAND_LUCK[landTier] ?? 0) + Math.min(waterCount * WATER_LUCK_PER, WATER_LUCK_CAP) + extraLuck;
  const weights = pool.map((c) => {
    const base = RARITY_WEIGHT[c.rarity] ?? 1;
    return base * Math.pow(1 + luck, rarityIndex(c.rarity));
  });
  return pool[rng.weighted(weights)];
}

function parseRange(s: string): [number, number] {
  const m = s.match(/(\d+)\s*-\s*(\d+)/);
  if (!m) return [0, 1];
  return [+m[1] / 100, +m[2] / 100];
}

/** roll 品相：钟形分布 + 小概率破纪录 */
export function rollQuality(rng: Rng): { quality: Quality; sizePct: number } {
  let size = (rng.next() + rng.next()) / 2; // 钟形，集中在 0.5
  if (rng.next() < RECORD_CHANCE) size = 0.99 + rng.next() * 0.01; // 破纪录
  for (const q of qualities) {
    const [lo, hi] = parseRange(q.sizeRange);
    if (size >= lo && size < hi) return { quality: q, sizePct: Math.round(size * 100) };
  }
  const top = qualities[qualities.length - 1];
  return { quality: top, sizePct: Math.round(size * 100) };
}

/** 最终售价 */
export function cropValue(crop: Crop, quality: Quality): number {
  return Math.max(1, Math.round(crop.sellPrice * quality.priceFactor));
}
