import { RARITY_WEIGHT, LAND_LUCK, WATER_LUCK_PER, WATER_LUCK_CAP, rarityIndex, RECORD_CHANCE, } from "./config.js";
import { cropsByCategory, qualities, } from "./content.js";
const SEASON_ORDER = ["春", "夏", "秋", "冬"];
/** 跨季作物的可种判定：当前季节是否落在 "春-秋" 这类区间内 */
function seasonInRange(current, range) {
    const parts = range.split(/[-—~]/).map((s) => s.trim());
    if (parts.length === 1)
        return parts[0] === current;
    const a = SEASON_ORDER.indexOf(parts[0]);
    const b = SEASON_ORDER.indexOf(parts[1]);
    const c = SEASON_ORDER.indexOf(current);
    if (a < 0 || b < 0 || c < 0)
        return false;
    return a <= b ? c >= a && c <= b : c >= a || c <= b;
}
// 池子由「解锁品阶 unlockTier ≤ 土地品阶」决定（按品种解锁，不卡稀有度）。
// 稀有度只当权重——荒地也能抽到高稀有，只是概率低。
function eligibleCommon(season, landTier) {
    return cropsByCategory("common").filter((c) => {
        if ((c.unlockTier ?? 1) > landTier)
            return false;
        if (c.availability === "allyear")
            return true;
        if (!c.seasons)
            return true;
        return seasonInRange(season, c.seasons);
    });
}
function eligibleFantasy(landTier) {
    return cropsByCategory("fantasy").filter((c) => (c.unlockTier ?? 1) <= landTier);
}
/** roll 出一种作物身份 */
export function rollCrop(rng, seedType, landTier, waterCount, season, extraLuck = 0) {
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
function parseRange(s) {
    const m = s.match(/(\d+)\s*-\s*(\d+)/);
    if (!m)
        return [0, 1];
    return [+m[1] / 100, +m[2] / 100];
}
/** roll 品相：钟形分布 + 小概率破纪录 */
export function rollQuality(rng) {
    let size = (rng.next() + rng.next()) / 2; // 钟形，集中在 0.5
    if (rng.next() < RECORD_CHANCE)
        size = 0.99 + rng.next() * 0.01; // 破纪录
    for (const q of qualities) {
        const [lo, hi] = parseRange(q.sizeRange);
        if (size >= lo && size < hi)
            return { quality: q, sizePct: Math.round(size * 100) };
    }
    const top = qualities[qualities.length - 1];
    return { quality: top, sizePct: Math.round(size * 100) };
}
/** 最终售价 */
export function cropValue(crop, quality) {
    return Math.max(1, Math.round(crop.sellPrice * quality.priceFactor));
}
//# sourceMappingURL=gacha.js.map