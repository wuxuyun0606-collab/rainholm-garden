// 核心引擎：惰性生长 + 抽卡收获 + 浇水运气 + 偷菜 + 商店 + 土地升级。
import { Rng } from "./rng.js";
import { rollCrop, rollQuality, cropValue } from "./gacha.js";
import { currentSeason, activeFestivals, currentHour, currentDayIndex } from "./time.js";
import { TICK_MS, GROW_TICKS, SEED_PRICE, WATER_LUCK_PER, WATER_LUCK_CAP, MAX_LOG, TRAIL_MAX, LAND_UPGRADE_REQ, NEW_CODEX_REWARD, HARVEST_EVENT_CHANCE, MATERIAL_DROP_CHANCE, MATERIAL_DROP_WEIGHT, ITEMS, POTION_DROP_CHANCE, POTION_DAILY_CAP, POTION_CAP_LINE, POTION_SET_QTY, POTION_SET_PRICE, POTION_SET_CHANCE, WATER_REWARD_DAILY_CAP, STEAL_COOLDOWN_MS, STEAL_DAILY_CAP, STEAL_SHIELD_MS, RANCH_POTION_DROP_CHANCE, RANCH_POTION_DAILY_CAP, LEDGER_MAX, RANCH_ANIMAL_MAX_LEVEL, RANCH_LEVEL_INCOME_STEP, RANCH_UPGRADE_COST_FACTOR, PET_NAME_MAX, CRAFT_COUNT, FUSION_POINTS, LIMITED_BASE_WEIGHT, FUSION_LUCK_DIVISOR, FUSION_SOFT_PITY, FUSION_SPECIAL_UNLOCKED_RATE, rarityIndex, SHOP_REFRESH_MS, SHOP_RECIPE_CHANCE, RECIPE_PRICE, NPC_LIMITED_SEED_CHANCE, NPC_ID, UGC_DESIGN_FEE, UGC_SEED_YIELD, UGC_VALUE, UGC_HARVEST_VALUE, UGC_GROW_TICKS, UGC_NAME_MAX, UGC_DESC_MAX, UGC_PLANT_MAX, UGC_HARVEST_MAX, MAX_UGC, UGC_RARITY, } from "./config.js";
import { crops, cropById, getCrop, animals, animalById, pets, petById, accessories, decorations, accessoryById, decorationById, landTiers, totalCropCount, qualities, materials, materialById, recipes, specialEvents, expDecorById, } from "./content.js";
import { registerUgc, ugcCount } from "./ugc.js";
import { onTaskEvent } from "./tasks.js";
import { randomUUID } from "node:crypto";
/** 取（必要时补发）人类前端钥匙。老农场没有就现生成一把；调用方负责 save()。 */
export function ensureHumanKey(farm) {
    if (!farm.humanKey)
        farm.humanKey = randomUUID().replace(/-/g, "");
    return farm.humanKey;
}
export function pushLog(farm, msg) {
    farm.log.push(msg);
    if (farm.log.length > MAX_LOG)
        farm.log.splice(0, farm.log.length - MAX_LOG);
}
/** 记一条足迹（别人对本农场的社交动作：帮浇水 / 偷菜得手 / 被狗吓退）；最新在前，超上限截尾。 */
export function pushTrail(farm, ev) {
    (farm.trail ??= []).unshift(ev);
    if (farm.trail.length > TRAIL_MAX)
        farm.trail.length = TRAIL_MAX;
}
const humanDisplay = (farm) => farm.humanName || "伴侣";
const aiDisplay = (farm) => farm.aiName || farm.name || "对方";
// —— 惰性结算（纯时间生长，无缺水停滞）——
export function advance(farm, now) {
    const elapsed = Math.floor((now - farm.lastTickAt) / TICK_MS);
    if (elapsed <= 0)
        return 0;
    for (const p of farm.plots) {
        if (p.crop && !p.crop.ripe) {
            p.crop.progress = Math.min(p.crop.growTicks, p.crop.progress + elapsed);
            if (p.crop.progress >= p.crop.growTicks)
                p.crop.ripe = true;
        }
    }
    // 牧场动物随时间攒产出（伴侣在人类前端收）；等级越高每周期产得越多
    if (farm.ranch)
        for (const a of farm.ranch.animals) {
            const kind = animalById.get(a.kindId);
            if (!kind)
                continue;
            // 不累加：只在「没有未收产出」时推进生产，攒到 1 份就停，伴侣收了才产下一份（挂机不堆积）
            if (a.pending < 1) {
                a.ticksSinceProduce += elapsed;
                if (a.ticksSinceProduce >= kind.produceEveryTicks) {
                    a.pending = 1;
                    a.ticksSinceProduce = 0;
                }
            }
        }
    farm.lastTickAt += elapsed * TICK_MS;
    return elapsed;
}
// —— 图鉴 ——
function addCodex(farm, cropId, qualityTier, now) {
    const prev = farm.codex[cropId];
    if (!prev) {
        farm.codex[cropId] = { count: 1, bestQuality: qualityTier, firstAt: now };
        return true;
    }
    prev.count += 1;
    prev.bestQuality = Math.max(prev.bestQuality, qualityTier);
    return false;
}
/** 已解锁的官方作物图鉴种类数（UGC 不计）。 */
export function officialCodexCount(farm) {
    return Object.keys(farm.codex).filter((id) => cropById.has(id)).length;
}
export function collectionPct(farm) {
    // 只算官方作物（UGC 自创不计入官方收集度）
    return officialCodexCount(farm) / totalCropCount;
}
/** 图鉴星标：切换某作物的收藏态。返回 { ok, on, name }；on=切换后是否已收藏。 */
export function toggleStar(farm, id) {
    const crop = getCrop(id);
    if (!crop)
        return { ok: false, on: false };
    farm.starred ??= [];
    const i = farm.starred.indexOf(id);
    if (i >= 0) {
        farm.starred.splice(i, 1);
        return { ok: true, on: false, name: crop.name };
    }
    farm.starred.push(id);
    return { ok: true, on: true, name: crop.name };
}
/** 某作物是否被伴侣星标收藏。 */
export function isStarred(farm, id) {
    return !!farm.starred?.includes(id);
}
/** 按 农场id+日 的确定性 0~1 值（不消耗 rngState；同一天同一农场恒定）。给夜间商店「有概率刷出」用。 */
function dayHash(id, day) {
    let h = (2166136261 ^ day) >>> 0;
    for (let i = 0; i < id.length; i++) {
        h ^= id.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 100000) / 100000;
}
/** 已集齐的某类别作物种类数（升级牵制用） */
export function codexCountByCategory(farm, cat) {
    return Object.keys(farm.codex).filter((id) => cropById.get(id)?.category === cat).length;
}
// —— 限定作物可种判定（公历节日 + 结构化解锁规则 unlockRule；回落老的图鉴%文案）——
export function isLimitedAvailable(crop, farm, now) {
    if (crop.category !== "limited")
        return false;
    if (crop.unlockType === "festival") {
        return activeFestivals(now).some((f) => f.cropId === crop.id);
    }
    // 结构化规则优先（action / 计数类 / 夜间商店）
    const rule = crop.unlockRule;
    if (rule) {
        switch (rule.kind) {
            case "codexCount": return officialCodexCount(farm) >= (rule.n ?? 0);
            case "codexPct": return collectionPct(farm) * 100 >= (rule.n ?? 0);
            case "landMax": return nextUpgradeReq(farm) === null;
            case "nightShop": // 仅 UTC+8 凌晨 0:00–3:59，且当天 roll 命中（整段窗口稳定）
                return currentHour(now) < 4 && dayHash(farm.id, currentDayIndex(now)) < (rule.chance ?? 0.2);
            default: return false;
        }
    }
    // 回落：老的图鉴百分比文案（"N%"）
    if (crop.unlockType === "codex") {
        const m = (crop.unlockCond ?? "").match(/(\d+)\s*%/);
        return m ? collectionPct(farm) * 100 >= +m[1] : false;
    }
    return false;
}
/** 把"限定/自创种子"的引用解析成作物 id：接受 id 或中文名（背包/熔炼都给中文名，玩家自然照着填）。
 *  重名时优先用玩家背包里已有的那颗；官方限定（条件/金币种）按名字全库找。 */
function resolveLimitedRef(farm, ref) {
    ref = String(ref ?? "").trim();
    if (!ref)
        return undefined;
    const direct = getCrop(ref); // 已经是 id
    if (direct && (direct.category === "limited" || direct.category === "ugc"))
        return ref;
    for (const id of Object.keys(farm.seeds)) { // 按中文名找背包里有的（含自己设计/熔炼/买来的）
        const c = getCrop(id);
        if (c && c.name === ref && (c.category === "limited" || c.category === "ugc"))
            return id;
    }
    return crops.find((c) => c.category === "limited" && c.name === ref)?.id; // 官方限定按名字全库找
}
// —— 播种 ——
export function plant(farm, plotId, seedType, limitedId, now) {
    const plot = farm.plots.find((p) => p.id === plotId);
    if (!plot)
        return { ok: false, error: `没有 ${plotId} 号地` };
    if (plot.crop)
        return { ok: false, error: `${plotId} 号地已经种着东西了` };
    // 防作弊：seedType 只能是这三种——非法值会让 SEED_PRICE[x]=undefined，把 coins 算成 NaN（之后任何价格判定都失效）
    if (seedType !== "common" && seedType !== "fantasy" && seedType !== "limited")
        return { ok: false, error: "种子类型只能是 common / fantasy / limited" };
    if (seedType === "limited") {
        const resolved = resolveLimitedRef(farm, String(limitedId ?? "")); // 兼容 id 和中文名
        if (!resolved)
            return { ok: false, error: "没有这种限定/自创作物（填它的中文名或 id，名字去 bag 抄）" };
        limitedId = resolved;
        const crop = getCrop(limitedId);
        // 限定/自创只能用手里已有的种子来种（熔炼产出 / 自己设计 / 商店随机刷出时花金币买来的）。
        // 不再有"满足解锁条件就花金币无限直接种"的途径——限定要稀缺，解锁只是让它能进商店随机库被 roll。
        if ((farm.seeds[limitedId] ?? 0) > 0) {
            farm.seeds[limitedId] -= 1;
            if (farm.seeds[limitedId] <= 0)
                delete farm.seeds[limitedId];
        }
        else {
            return { ok: false, error: `你没有「${crop.name}」的种子——${crop.category === "ugc" ? "先设计它、或去摊位买" : "去熔炼，或等它在商店随机刷出来时买（每种每天限 1 颗）"}。` };
        }
        plot.crop = { seedType: "limited", limitedId, growTicks: crop.growTicks, progress: 0, ripe: false, waterCount: 0 };
        if (crop.category === "ugc")
            onTaskEvent(farm, "plant_ugc", now); // 随机任务：种下一株自创作物
        pushLog(farm, `种下限定 ${crop.name}`);
        return { ok: true, seedType: "limited", limitedId }; // 回传解析后的 id，供 plantBatch 记录专属文案
    }
    const price = SEED_PRICE[seedType];
    if (farm.coins < price)
        return { ok: false, error: `金币不足，${seedType === "common" ? "普通" : "奇幻"}种子要 ${price}` };
    farm.coins -= price;
    plot.crop = { seedType, growTicks: GROW_TICKS[seedType], progress: 0, ripe: false, waterCount: 0 };
    pushLog(farm, `种下一颗${seedType === "common" ? "普通" : "奇幻"}种子`);
    return { ok: true, seedType };
}
// —— 主人浇水（提升稀有概率，封顶；只用于自家地）——
const WATER_CAP_COUNT = Math.round(WATER_LUCK_CAP / WATER_LUCK_PER);
export function water(farm, plotId, by, isOwner) {
    const plot = farm.plots.find((p) => p.id === plotId);
    if (!plot || !plot.crop)
        return { ok: false, error: `${plotId} 号地没有作物` };
    const capped = plot.crop.waterCount >= WATER_CAP_COUNT;
    if (!capped)
        plot.crop.waterCount += 1;
    pushLog(farm, `${by}给 ${plotId} 号地浇了水`);
    return { ok: true, by, isOwner, capped };
}
// —— 串门浇水（帮别家加速：每浇 1 次让作物进度 +1 tick = 30 分钟；不提升稀有度）——
// 给了 plotId 就浇那一块；否则默认浇「剩余时间最短」的生长地块（最接近成熟的先催）。
// 防互刷：同一访客对同一农场每天只能帮浇 1 次（已浇过当天再来 → 提示明天再来）。
const remainingTicks = (c) => c.growTicks - c.progress;
export function visitorWater(farm, visitorId, plotId, by, now) {
    const day = currentDayIndex(now);
    if (farm.waterVisits?.[visitorId] === day)
        return { ok: false, error: "已浇过水，明天再来吧。" };
    let plot;
    if (plotId != null) {
        plot = farm.plots.find((p) => p.id === plotId);
        if (!plot || !plot.crop)
            return { ok: false, error: `${plotId} 号地没有作物` };
        if (plot.crop.ripe)
            return { ok: false, error: `${plotId} 号地的作物已经熟了，浇了也没用` };
    }
    else {
        const growing = farm.plots.filter((p) => p.crop && !p.crop.ripe);
        if (!growing.length)
            return { ok: false, error: "对方没有可浇水的作物" };
        plot = growing.reduce((best, p) => remainingTicks(p.crop) < remainingTicks(best.crop) ? p : best);
    }
    const crop = plot.crop;
    crop.progress = Math.min(crop.growTicks, crop.progress + 1); // +1 tick = 30 分钟
    const ripened = crop.progress >= crop.growTicks;
    if (ripened)
        crop.ripe = true;
    (farm.waterVisits ??= {})[visitorId] = day; // 标记今天已帮这家浇过（每家每天 1 次）
    pushLog(farm, `${by}帮 ${plot.id} 号地浇水，加速 30 分钟${ripened ? "，正好催熟" : ""}`);
    pushTrail(farm, { t: now, kind: "watered", by, plotId: plot.id }); // 足迹：谁帮浇了水
    return { ok: true, plotId: plot.id, ripened };
}
// —— 揭晓 roll（收获/偷菜共用）——
function reveal(farm, plot, now) {
    const rng = new Rng(farm.rngState);
    const c = plot.crop;
    let crop;
    if (c.seedType === "limited") {
        const planted = getCrop(c.limitedId);
        if (!planted)
            return { ok: false, error: "这块地里的作物数据已失效，无法揭晓" };
        crop = planted;
    }
    else
        crop = rollCrop(rng, c.seedType, farm.landTier, c.waterCount, currentSeason(now).name);
    const { quality } = rollQuality(rng);
    farm.rngState = rng.state;
    return { ok: true, crop, quality, value: cropValue(crop, quality) };
}
function qualityTierFromName(name) {
    if (name.includes("优"))
        return 3; // "优品" ≈ 良品
    return qualities.find((q) => q.name === name)?.tier ?? 3;
}
function pickMaterial(rng) {
    return materials[rng.weighted(materials.map((m) => MATERIAL_DROP_WEIGHT[m.rarity] ?? 1))];
}
function ripenAdjacent(farm, exclude, n) {
    let c = 0;
    for (const p of farm.plots) {
        if (c >= n)
            break;
        if (p === exclude || !p.crop || p.crop.ripe)
            continue;
        p.crop.ripe = true;
        p.crop.progress = p.crop.growTicks;
        c++;
    }
    return c;
}
function rollBonusEvent(rng) {
    if (rng.next() >= HARVEST_EVENT_CHANCE)
        return null;
    const ev = specialEvents.bonus;
    return ev.length ? ev[rng.weighted(ev.map((e) => e.weight))] : null;
}
// 季节收获事件:这批是否还能吃到效果(带计数上限的如知时雨/蜂媒最多 6 株)
const seasonApplies = (mod) => !!mod && (!mod.capLeft || mod.capLeft.n > 0);
const qualityByTier = (t) => qualities.find((q) => q.tier === t);
// —— 收获 ——
// seasonMod：季节「收获型」事件的本批修正（rollSeasonHarvest 给的）；非空即触发了季节事件 → 抑制原有收获奖励事件（互斥）。
export function harvest(farm, plotId, now, seasonMod) {
    const plot = farm.plots.find((p) => p.id === plotId);
    if (!plot || !plot.crop)
        return { ok: false, error: `${plotId} 号地没有作物` };
    if (!plot.crop.ripe)
        return { ok: false, error: "作物还没成熟" };
    const rng = new Rng(farm.rngState);
    const c = plot.crop;
    const buffs = petBuffs(farm); // 招财猫：稀有运气 + 掉落倍率（温和）
    const apply = seasonApplies(seasonMod); // 这一株是否吃季节效果（受 capLeft 限）
    const seasonLuck = apply && seasonMod.type === "rare_luck" ? (seasonMod.value ?? 0) : 0; // 蜂媒：roll 前抬运气
    const crop = c.seedType === "limited" ? getCrop(c.limitedId) : rollCrop(rng, c.seedType, farm.landTier, c.waterCount, currentSeason(now).name, buffs.luck + seasonLuck);
    let quality = rollQuality(rng).quality;
    // 季节品相覆盖（萤照=极品/骄阳=最低/虫客=降档）
    if (apply) {
        if (seasonMod.type === "quality_top")
            quality = qualityByTier(4) ?? quality; // 极品
        else if (seasonMod.type === "quality_min")
            quality = qualityByTier(1) ?? quality; // 袖珍
        else if (seasonMod.type === "quality_down")
            quality = qualityByTier(Math.max(1, quality.tier - (seasonMod.value ?? 1))) ?? quality;
    }
    // 奖励事件（季节事件触发时抑制，互斥）
    const ev = seasonMod ? null : rollBonusEvent(rng);
    let bonus = null;
    if (ev) {
        if (ev.effectType === "品相保底") {
            const t = qualityTierFromName(ev.param);
            if (quality.tier < t)
                quality = qualities.find((q) => q.tier === t) ?? quality;
        }
        const extraCoins = ev.effectType === "额外金币" ? Number(ev.param) || 0 : 0;
        const ripened = ev.effectType === "连收" ? ripenAdjacent(farm, plot, Number(ev.param) || 0) : 0;
        bonus = { name: ev.name, text: ev.text, effectType: ev.effectType, extraCoins, ripened };
    }
    let value = cropValue(crop, quality);
    if (ev?.effectType === "倍率")
        value = Math.round(value * (Number(ev.param) || 1));
    if (apply && seasonMod.type === "value_mult")
        value = Math.round(value * (seasonMod.value ?? 1)); // 知时雨/雪被：本批价值×2
    if (apply && seasonMod.capLeft)
        seasonMod.capLeft.n -= 1; // 吃掉一株名额
    farm.coins += value;
    if (bonus?.extraCoins)
        farm.coins += bonus.extraCoins;
    // 素材掉落（攒来熔炼限定种子；招财猫把概率温和拉高）
    let drop = null;
    if (rng.next() < MATERIAL_DROP_CHANCE * buffs.dropMult) {
        const m = pickMaterial(rng);
        farm.materials[m.id] = (farm.materials[m.id] ?? 0) + 1;
        drop = { id: m.id, name: m.name, rarity: m.rarity, desc: m.desc };
    }
    // 加速药水掉落（副产品，缓解后期药水开销；招财猫同样温和拉高）
    const potionDrop = rng.next() < POTION_DROP_CHANCE * buffs.dropMult;
    if (potionDrop)
        farm.items.speed_potion = (farm.items.speed_potion ?? 0) + 1;
    farm.rngState = rng.state;
    // 新图鉴奖励
    const isNew = addCodex(farm, crop.id, quality.tier, now);
    // 自创作物不给图鉴金币奖励（自创重在收集，不作金钱来源）
    const codexReward = isNew && crop.category !== "ugc" ? NEW_CODEX_REWARD[crop.rarity] ?? 0 : 0;
    if (codexReward)
        farm.coins += codexReward;
    plot.crop = null;
    farm.harvested = (farm.harvested ?? 0) + 1; // 勤劳榜累计
    onTaskEvent(farm, "harvest", now, { rarity: crop.rarity, isNew, isUgc: crop.category === "ugc" }); // 随机任务：收获N株R/SR/收新图鉴
    pushLog(farm, `收获 ${crop.name}（${quality.name}），+${value}${drop ? ` 掉素材[${drop.name}]` : ""}${potionDrop ? " 掉药水" : ""}`);
    return { ok: true, crop, quality, value, isNew, codexReward, bonus, drop, potionDrop };
}
// —— 熔炼：投 CRAFT_COUNT 个素材 → 出一颗限定种子（混合：命中隐藏配方=固定，否则随机）——
export function craft(farm, materialIds, _now) {
    if (!Array.isArray(materialIds) || materialIds.length !== CRAFT_COUNT)
        return { ok: false, error: `熔炼需要正好 ${CRAFT_COUNT} 个素材` };
    // 接受素材 id 或中文名（bag 只展示中文名，AI 玩家自然照着填）
    const ids = [];
    for (const x of materialIds) {
        const m = materialById.get(x) ?? materials.find((mm) => mm.name === x);
        if (!m)
            return { ok: false, error: `没有这种素材: ${x}` };
        ids.push(m.id);
    }
    // 校验库存（含重复计数）
    const need = {};
    for (const id of ids)
        need[id] = (need[id] ?? 0) + 1;
    for (const [id, n] of Object.entries(need)) {
        if ((farm.materials[id] ?? 0) < n)
            return { ok: false, error: `素材不足: ${materialById.get(id).name}` };
    }
    // 消耗
    for (const [id, n] of Object.entries(need)) {
        farm.materials[id] -= n;
        if (farm.materials[id] <= 0)
            delete farm.materials[id];
    }
    const rng = new Rng(farm.rngState);
    const sortedKey = [...ids].sort().join("+");
    const recipe = recipes.find((r) => [...r.materials].sort().join("+") === sortedKey);
    let cropId;
    let byRecipe = false;
    if (recipe && cropById.get(recipe.output)) {
        cropId = recipe.output;
        byRecipe = true;
    }
    else {
        // 随机产出：按投入素材总点数决定运气，往高稀有限定抬。节日限定保持节日专属，不参与熔炼。
        const points = ids.reduce((s, id) => s + (FUSION_POINTS[materialById.get(id).rarity] ?? 0), 0);
        const luck = points / FUSION_LUCK_DIVISOR;
        // 熔炼基础池=「纯熔炼组」：没有任何商店上架途径（非节日、无结构化解锁规则、非图鉴%解锁）的限定。
        // 这类作物的唯一发现来源就是熔炼，所以允许未收获就炼出（软保底帮你出没集齐的）。
        const normalPool = crops.filter((c) => c.category === "limited" && c.craftable !== false
            && c.unlockType !== "festival" && c.unlockType !== "codex" && !c.unlockRule);
        // 软保底：本农场还没集齐的限定，权重 ×FUSION_SOFT_PITY（避免随机长尾让人一直撞重复；SP 仍要努力，没集齐的更易出）
        const normalWeights = normalPool.map((c) => {
            const base = (LIMITED_BASE_WEIGHT[c.rarity] ?? 1) * Math.pow(1 + luck, rarityIndex(c.rarity) - rarityIndex("SR"));
            return farm.codex[c.id] ? base : base * FUSION_SOFT_PITY;
        });
        // 节日 / 图鉴%/ 条件解锁 这三类（首获只能靠商店随机刷）——「本农场收获过 1 次(进图鉴)」之后，
        // 才以极低权重涓流进熔炼池：每个 ≈ FUSION_SPECIAL_UNLOCKED_RATE 概率。没收获过的永远不会被熔出。
        const specialPool = crops.filter((c) => c.category === "limited"
            && (c.unlockType === "festival" || c.unlockType === "codex" || !!c.unlockRule) && farm.codex[c.id]);
        const normalSum = normalWeights.reduce((s, w) => s + w, 0);
        const specialWeights = specialPool.map(() => normalSum * FUSION_SPECIAL_UNLOCKED_RATE);
        const pool = [...normalPool, ...specialPool];
        const weights = [...normalWeights, ...specialWeights];
        cropId = pool[rng.weighted(weights)].id;
    }
    farm.rngState = rng.state;
    farm.seeds[cropId] = (farm.seeds[cropId] ?? 0) + 1;
    const crop = cropById.get(cropId);
    farm.crafted = (farm.crafted ?? 0) + 1; // 匠人称号累计
    onTaskEvent(farm, "craft", _now); // 随机任务：熔炼一次
    pushLog(farm, `熔炼出限定种子：${crop.name}${byRecipe ? "（配方）" : ""}`);
    return { ok: true, cropId, cropName: crop.name, rarity: crop.rarity, byRecipe };
}
function stealQuota(farm, now) {
    const day = currentDayIndex(now);
    if (!farm.stealQuota || farm.stealQuota.day !== day)
        farm.stealQuota = { day, n: 0 };
    return farm.stealQuota;
}
const fmtStealRemain = (ms) => {
    const min = Math.max(1, Math.ceil(ms / 60000));
    return min >= 60 ? `${Math.ceil(min / 60)}小时` : `${min}分钟`;
};
export function stealAvailability(thief, now) {
    if (!thief)
        return { ok: true, left: STEAL_DAILY_CAP };
    const q = stealQuota(thief, now);
    if ((q.n ?? 0) >= STEAL_DAILY_CAP)
        return { ok: false, reason: `今天已经偷满 ${STEAL_DAILY_CAP} 次了，明天再出门吧。` };
    const leftMs = q.lastAt ? q.lastAt + STEAL_COOLDOWN_MS - now : 0;
    if (leftMs > 0)
        return { ok: false, reason: `刚偷过菜，先歇一会儿，约 ${fmtStealRemain(leftMs)} 后再来。` };
    return { ok: true, left: STEAL_DAILY_CAP - (q.n ?? 0) };
}
export function canStealNow(thief, now) {
    return stealAvailability(thief, now).ok;
}
/** 放偷冷却：本农场被偷一次后 30 分钟内谁都偷不了；返回剩余毫秒（0=没保护/已过期）。 */
export function stealShieldRemain(victim, now) {
    return Math.max(0, (victim.stealShieldUntil ?? 0) - now);
}
/** 这株是不是原创(ugc)作物——原创受保护、禁止偷，只能去集市买种子自己种。 */
export function isUgcCrop(crop) {
    return !!crop && crop.seedType === "limited" && !!crop.limitedId && getCrop(crop.limitedId)?.category === "ugc";
}
function recordStealAttempt(thief, now) {
    if (!thief)
        return;
    const q = stealQuota(thief, now);
    q.n = (q.n ?? 0) + 1;
    q.lastAt = now;
}
// —— 偷菜（访客；继承该株浇水运气；每次后 1 小时冷却、每天最多 3 次；得金币+图鉴）——
export function steal(victim, plotId, by, now, thief) {
    if (victim.id === by)
        return { ok: false, error: "不能偷自己的菜；收自己地里的作物请用 harvest" };
    const avail = stealAvailability(thief, now);
    if (!avail.ok)
        return { ok: false, error: avail.reason };
    // 同一家每天只能被同一小偷偷 1 次（被看家狗吓退也算用掉机会）；该限制不消耗小偷的全局每日次数。
    const lastHit = victim.stealCooldowns[by];
    if (lastHit !== undefined && currentDayIndex(lastHit) === currentDayIndex(now))
        return { ok: false, error: "今天已经偷过这家了，明天再来（同一家每天只能偷一次）" };
    // 放偷冷却：这家刚被偷过，30 分钟内谁都下不了手
    const shieldMs = stealShieldRemain(victim, now);
    if (shieldMs > 0)
        return { ok: false, error: `这家刚被偷过还在防备，约 ${fmtStealRemain(shieldMs)} 后才能再下手。` };
    const plot = victim.plots.find((p) => p.id === plotId);
    if (!plot || !plot.crop)
        return { ok: false, error: `${plotId} 号地没有作物，晚了一步` };
    if (!plot.crop.ripe)
        return { ok: false, error: "作物还没成熟，偷不了" };
    // 原创作物受保护：不能偷，只能去集市买种子自己种（不消耗小偷的机会/冷却，直接挡回）
    if (isUgcCrop(plot.crop))
        return { ok: false, error: "这是别人的原创作物，受保护偷不了——想要就去集市买它的种子自己种。" };
    // 看家狗：概率把小偷吓退（被吓退也算用掉小偷今天对这家的机会——狗真的护住了这块地）
    const foil = petBuffs(victim).foil;
    if (foil > 0) {
        const grng = new Rng(victim.rngState);
        const foiled = grng.next() < foil;
        victim.rngState = grng.state;
        if (foiled) {
            const guard = (victim.ranch?.pets ?? []).map((p) => ({ p, k: petById.get(p.kindId) })).find((x) => x.k?.buff === "guard");
            const dogName = guard ? (guard.p.name || guard.k.name) : "看家狗";
            recordStealAttempt(thief, now);
            victim.stealCooldowns[by] = now;
            pushLog(victim, `🐶 ${by} 想偷 ${plotId} 号地，被${dogName}一通狂吠吓跑了！`);
            pushTrail(victim, { t: now, kind: "foiled", by: thief?.name ?? by, plotId }); // 足迹：谁来偷被狗吓退
            return { ok: false, error: `刚摸到 ${plotId} 号地，${dogName}就冲出来狂吠，你只好空手溜走。` };
        }
    }
    const revealed = reveal(victim, plot, now);
    if (!revealed.ok)
        return revealed;
    const { crop, quality, value } = revealed;
    // 被偷方返还种子费的一半（小补偿；按下种时的种子价：普通/奇幻按 SEED_PRICE，限定按作物 seedPrice）
    const seedCost = plot.crop.seedType === "limited" ? (getCrop(plot.crop.limitedId)?.seedPrice ?? 0) : (SEED_PRICE[plot.crop.seedType] ?? 0);
    const refund = Math.round(seedCost * 0.5);
    if (refund > 0)
        victim.coins += refund;
    plot.crop = null;
    recordStealAttempt(thief, now);
    victim.stealCooldowns[by] = now;
    if (victim.id !== NPC_ID)
        victim.stealShieldUntil = now + STEAL_SHIELD_MS; // 放偷冷却：这家 30 分钟内谁都偷不了（阿土是常驻练手靶，豁免）
    victim.gotStolen = (victim.gotStolen ?? 0) + 1; // 倒霉称号累计
    pushTrail(victim, { t: now, kind: "stolen", by: thief?.name ?? by, plotId, crop: crop.name }); // 足迹：谁偷走了什么
    onTaskEvent(victim, "got_stolen", now); // 随机任务：被偷一次菜
    pushLog(victim, `⚠️ ${by} 偷走了 ${plotId} 号地的 ${crop.name}！${refund > 0 ? `（返还种子费一半 +${refund}金）` : ""}`);
    let isNewForThief = false;
    let codexReward = 0;
    if (thief) {
        thief.coins += value;
        thief.stolen = (thief.stolen ?? 0) + 1; // 大盗榜累计
        isNewForThief = addCodex(thief, crop.id, quality.tier, now);
        if (isNewForThief && crop.category !== "ugc") {
            codexReward = NEW_CODEX_REWARD[crop.rarity] ?? 0;
            thief.coins += codexReward;
        }
        onTaskEvent(thief, "steal", now); // 随机任务：偷一次菜得手
        pushLog(thief, `从「${victim.name}」偷到 ${crop.name}，+${value}${codexReward ? ` 新图鉴+${codexReward}` : ""}`);
    }
    return { ok: true, crop, quality, value, isNewForThief, codexReward };
}
// —— 牧场（人机互动 2.0）：AI 图鉴解锁动物→上架自家商店→买给伴侣；伴侣在人类前端养/收/卖/回传 ——
/** 某动物是否已被 AI 的图鉴进度解锁（人能买的动物档位被机的图鉴收集总数卡着）。 */
export function animalUnlocked(farm, kind) {
    return officialCodexCount(farm) >= kind.unlockCodex;
}
/** 当前已解锁、会自动上架 AI 商店的动物（按解锁门槛排序）。 */
export function shopAnimals(farm) {
    return animals.filter((a) => animalUnlocked(farm, a)).sort((a, b) => a.unlockCodex - b.unlockCodex);
}
/** 还没解锁的下一只动物（给"再集 N 种图鉴解锁 X"的提示）。 */
export function nextLockedAnimal(farm) {
    return animals.filter((a) => !animalUnlocked(farm, a)).sort((a, b) => a.unlockCodex - b.unlockCodex)[0] ?? null;
}
function ensureRanch(farm) {
    return (farm.ranch ??= { coins: 0, animals: [] });
}
/** 往机⇄人流水里记一条（AI 唯一能看到的牧场信息），环形保留最近 LEDGER_MAX 条。 */
function pushLedger(farm, type, amount, note, now) {
    (farm.ledger ??= []).unshift({ at: now, type, amount, note });
    if (farm.ledger.length > LEDGER_MAX)
        farm.ledger.length = LEDGER_MAX;
}
/** AI 买一只已解锁的动物送给伴侣（花 farm.coins，动物进牧场；这是机→人的"金币互传往来"）。 */
export function buyAnimalForPartner(farm, id, now) {
    const kind = animalById.get(String(id));
    if (!kind)
        return { ok: false, error: `没有这种动物：${id}（看商店里已解锁的动物）` };
    if (!animalUnlocked(farm, kind))
        return { ok: false, error: `${kind.name}还没解锁——${kind.unlockCond ?? `图鉴集齐 ${kind.unlockCodex} 种`}（你现在 ${officialCodexCount(farm)} 种）` };
    if (farm.ranch?.animals.some((a) => a.kindId === kind.id))
        return { ok: false, error: `${kind.name}已送养过，不再上架。` };
    if (farm.coins < kind.buyCost)
        return { ok: false, error: `金币不足，${kind.name}要 ${kind.buyCost} 金（你有 ${farm.coins}）` };
    farm.coins -= kind.buyCost;
    const ranch = ensureRanch(farm);
    ranch.animals.push({ kindId: kind.id, ticksSinceProduce: 0, pending: 0, level: 1 });
    pushLedger(farm, "buy-animal", kind.buyCost, `买下${kind.name}送进牧场`, now);
    pushLog(farm, `给伴侣买了一只${kind.name}（-${kind.buyCost}）`);
    return { ok: true, name: kind.name, cost: kind.buyCost };
}
// —— 宠物（AI 买、归伴侣养：和动物一样进牧场、能穿衣服，但不产出、可被伴侣改名，给农场一份温和 buff）——
/** 某宠物是否已被 AI 图鉴进度解锁（门槛同动物，靠 unlockCodex）。 */
export function petUnlocked(farm, kind) {
    return officialCodexCount(farm) >= kind.unlockCodex;
}
/** 当前已解锁、会上架商店的宠物。 */
export function shopPets(farm) {
    return pets.filter((p) => petUnlocked(farm, p)).sort((a, b) => a.unlockCodex - b.unlockCodex);
}
/** 还没解锁的下一只宠物（给"再集 N 种图鉴解锁 X"提示）。 */
export function nextLockedPet(farm) {
    return pets.filter((p) => !petUnlocked(farm, p)).sort((a, b) => a.unlockCodex - b.unlockCodex)[0] ?? null;
}
/** 聚合当前农场所有宠物的 buff：luck=收获额外运气（累加）、dropMult=素材/药水掉落倍率（连乘）、foil=偷菜被吓退概率（取最大）。 */
export function petBuffs(farm) {
    let luck = 0, dropMult = 1, foil = 0;
    for (const p of farm.ranch?.pets ?? []) {
        const k = petById.get(p.kindId);
        if (!k)
            continue;
        luck += k.params.luck ?? 0;
        if (k.params.dropMult)
            dropMult *= k.params.dropMult;
        foil = Math.max(foil, k.params.foil ?? 0);
    }
    return { luck, dropMult, foil };
}
/** AI 买一只已解锁的宠物送给伴侣（花 farm.coins，宠物进牧场；每种限 1 只）。 */
export function buyPetForPartner(farm, id, now) {
    const kind = petById.get(String(id));
    if (!kind)
        return { ok: false, error: `没有这种宠物：${id}（看商店里已解锁的宠物）` };
    if (!petUnlocked(farm, kind))
        return { ok: false, error: `${kind.name}还没解锁——${kind.unlockCond ?? `图鉴集齐 ${kind.unlockCodex} 种`}（你现在 ${officialCodexCount(farm)} 种）` };
    const ranch = ensureRanch(farm);
    if ((ranch.pets ?? []).some((p) => p.kindId === kind.id))
        return { ok: false, error: `${kind.name}已送养过，不再上架。` };
    if (farm.coins < kind.buyCost)
        return { ok: false, error: `金币不足，${kind.name}要 ${kind.buyCost} 金（你有 ${farm.coins}）` };
    farm.coins -= kind.buyCost;
    (ranch.pets ??= []).push({ kindId: kind.id });
    pushLedger(farm, "buy-pet", kind.buyCost, `买下${kind.name}送进牧场`, now);
    pushLog(farm, `给伴侣买了一只${kind.name}（-${kind.buyCost}）`);
    return { ok: true, name: kind.name, cost: kind.buyCost };
}
/** 把一只宠物渲染成一句现身氛围句（名字 + 穿戴 + emoji）。 */
function roamForPet(p) {
    const kind = petById.get(p.kindId);
    if (!kind || !kind.roam.length)
        return "";
    const line = kind.roam[Math.floor(Math.random() * kind.roam.length)];
    const descs = (p.acc ?? []).map((id) => accessoryById.get(id)?.desc).filter(Boolean);
    const acc = descs.length ? descs.join("、") + "的" : "";
    const name = p.name || kind.name;
    return (kind.emoji ? kind.emoji + " " : "") + line.replace("{acc}", acc).replace("{name}", name);
}
/** AI 状态里随机一句宠物现身氛围句（从全部宠物里随机；没养宠物则空串）。 */
export function petRoamLine(farm) {
    const list = farm.ranch?.pets ?? [];
    if (!list.length)
        return "";
    return roamForPet(list[Math.floor(Math.random() * list.length)]);
}
/** 牧场氛围句：从动物 + 宠物里随机出一句（状态里只占一行）。
 *  伴侣 pin 了若干只时，只从被 pin 的里随机（只 pin 一只=固定只出现它）；没 pin 则全部参与。 */
export function ranchRoamLine(farm) {
    const ranch = farm.ranch;
    if (!ranch)
        return "";
    const pinned = ranch.pinned ?? [];
    const usePin = pinned.length > 0;
    const cands = [];
    for (const a of ranch.animals ?? [])
        if (!usePin || pinned.includes(a.kindId))
            cands.push(() => roamForAnimal(a));
    for (const p of ranch.pets ?? [])
        if (!usePin || pinned.includes(p.kindId))
            cands.push(() => roamForPet(p));
    if (!cands.length)
        return "";
    return cands[Math.floor(Math.random() * cands.length)]();
}
/** 伴侣在前端 pin / 取消 pin 一只动物或宠物（按 kindId）：被 pin 的才会出现在农场氛围句里。 */
export function ranchTogglePin(farm, kindId) {
    const ranch = farm.ranch;
    if (!ranch)
        return { ok: false, error: "还没有牧场。" };
    const id = String(kindId);
    const owns = (ranch.animals ?? []).some((a) => a.kindId === id) || (ranch.pets ?? []).some((p) => p.kindId === id);
    if (!owns)
        return { ok: false, error: "你还没养这只，不能 pin。" };
    ranch.pinned ??= [];
    let pinned;
    if (ranch.pinned.includes(id)) {
        ranch.pinned = ranch.pinned.filter((x) => x !== id);
        pinned = false;
    }
    else {
        ranch.pinned.push(id);
        pinned = true;
    }
    const name = animalById.get(id)?.name ?? petById.get(id)?.name ?? id;
    return { ok: true, pinned, name };
}
/** 伴侣在人类前端给动物改名（每只独特名字；和宠物一样）。 */
export function ranchNameAnimal(farm, animalIdx, name) {
    const ranch = farm.ranch;
    if (!ranch?.animals?.length)
        return { ok: false, error: "牧场还没有动物。" };
    const a = ranch.animals[Math.floor(Number(animalIdx))];
    if (!a)
        return { ok: false, error: "选的动物不存在。" };
    const nm = String(name).trim().slice(0, PET_NAME_MAX);
    if (!nm)
        return { ok: false, error: "名字不能为空。" };
    a.name = nm;
    return { ok: true, name: nm, kind: animalById.get(a.kindId)?.name ?? a.kindId };
}
/** 伴侣在人类前端给宠物改名（每只独特名字）。 */
export function ranchNamePet(farm, petIdx, name) {
    const ranch = farm.ranch;
    if (!ranch?.pets?.length)
        return { ok: false, error: "牧场还没有宠物。" };
    const p = ranch.pets[Math.floor(Number(petIdx))];
    if (!p)
        return { ok: false, error: "选的宠物不存在。" };
    const nm = String(name).trim().slice(0, PET_NAME_MAX);
    if (!nm)
        return { ok: false, error: "名字不能为空。" };
    p.name = nm;
    return { ok: true, name: nm, kind: petById.get(p.kindId)?.name ?? p.kindId };
}
/** 从仓库取一件配饰，戴到某只动物或宠物身上（target: "animal"|"pet"）。 */
export function ranchWearAccessory(farm, target, idx, accId) {
    const ranch = farm.ranch;
    if (!ranch)
        return { ok: false, error: "还没有牧场。" };
    const acc = accessoryById.get(String(accId));
    if (!acc)
        return { ok: false, error: `没有这件配饰：${accId}` };
    const wd = ranch.wardrobe ?? [];
    if (!wd.includes(acc.id))
        return { ok: false, error: `仓库里没有${acc.name}，先去牧场商店买一件。` };
    const host = target === "pet" ? ranch.pets?.[Math.floor(Number(idx))] : ranch.animals?.[Math.floor(Number(idx))];
    if (!host)
        return { ok: false, error: "选的对象不存在。" };
    const nm = host.name || (target === "pet" ? petById.get(host.kindId)?.name : animalById.get(host.kindId)?.name) || host.kindId;
    host.acc ??= [];
    if (host.acc.includes(acc.id))
        return { ok: false, error: `${nm}已经戴着${acc.name}了。` };
    if (host.acc.length >= ACC_PER_ANIMAL_MAX)
        return { ok: false, error: `${nm}最多戴 ${ACC_PER_ANIMAL_MAX} 件。` };
    wd.splice(wd.indexOf(acc.id), 1); // 从仓库移走这一件
    ranch.wardrobe = wd;
    host.acc.push(acc.id);
    return { ok: true, name: acc.name, wearer: nm };
}
/** 把某只动物/宠物身上的一件配饰脱下，放回仓库。 */
export function ranchTakeOffAccessory(farm, target, idx, accId) {
    const ranch = farm.ranch;
    if (!ranch)
        return { ok: false, error: "还没有牧场。" };
    const acc = accessoryById.get(String(accId));
    if (!acc)
        return { ok: false, error: `没有这件配饰：${accId}` };
    const host = target === "pet" ? ranch.pets?.[Math.floor(Number(idx))] : ranch.animals?.[Math.floor(Number(idx))];
    if (!host || !(host.acc ?? []).includes(acc.id))
        return { ok: false, error: `没穿着${acc.name}。` };
    const nm = host.name || (target === "pet" ? petById.get(host.kindId)?.name : animalById.get(host.kindId)?.name) || host.kindId;
    host.acc.splice(host.acc.indexOf(acc.id), 1);
    (ranch.wardrobe ??= []).push(acc.id);
    return { ok: true, name: acc.name, wearer: nm };
}
/** 伴侣在人类前端收获产品：产出折成牧场金币 + 概率掉一瓶加速药水直接入 AI 仓库（每日封顶）。 */
export function ranchCollect(farm, now) {
    const ranch = farm.ranch;
    if (!ranch || !ranch.animals.length)
        return { ok: false, error: `牧场还没有动物——让${aiDisplay(farm)}在商店买一只送进来。` };
    let gain = 0;
    const detail = {};
    for (const a of ranch.animals) {
        const kind = animalById.get(a.kindId);
        if (!kind || a.pending <= 0)
            continue;
        detail[kind.produce] = (detail[kind.produce] ?? 0) + a.pending;
        // 升级只提每份收入（线性）：lv1=1.0× … lv5=1+(5-1)×step。份数不变。
        const lvlMult = 1 + ((a.level ?? 1) - 1) * RANCH_LEVEL_INCOME_STEP;
        gain += Math.round(a.pending * kind.producePrice * lvlMult);
        a.pending = 0;
    }
    if (gain <= 0)
        return { ok: false, error: "暂时没有可收的产出，再等等动物攒一攒。" };
    ranch.coins += gain;
    // 掉药水 → AI 仓库（概率 + 每日封顶，防伴侣狂收刷药水）
    let potion = 0;
    const day = currentDayIndex(now);
    const pd = (ranch.potionDrop ??= { day, n: 0 });
    if (pd.day !== day) {
        pd.day = day;
        pd.n = 0;
    }
    if (pd.n < RANCH_POTION_DAILY_CAP) {
        const rng = new Rng(farm.rngState);
        const hit = rng.next() < RANCH_POTION_DROP_CHANCE;
        farm.rngState = rng.state;
        if (hit) {
            potion = 1;
            pd.n += 1;
            farm.items.speed_potion = (farm.items.speed_potion ?? 0) + 1;
            pushLedger(farm, "potion", 1, `${humanDisplay(farm)}收获时掉落，入仓库`, now);
        }
    }
    return { ok: true, gain, detail, potion };
}
/** 把某动物升到下一级要花多少牧场金币（cost = buyCost ×(当前等级+1)× 系数）。 */
export function animalUpgradeCost(kind, level) {
    return Math.round(kind.buyCost * (level + 1) * RANCH_UPGRADE_COST_FACTOR);
}
/** 伴侣花牧场金币把某动物升一级（每级每周期多产 1 份，封顶 RANCH_ANIMAL_MAX_LEVEL）。 */
export function ranchUpgradeAnimal(farm, animalIdx) {
    const ranch = farm.ranch;
    if (!ranch || !ranch.animals.length)
        return { ok: false, error: "牧场还没有动物。" };
    const a = ranch.animals[Math.floor(Number(animalIdx))];
    if (!a)
        return { ok: false, error: "选的动物不存在。" };
    const kind = animalById.get(a.kindId);
    if (!kind)
        return { ok: false, error: "未知动物。" };
    const lvl = a.level ?? 1;
    if (lvl >= RANCH_ANIMAL_MAX_LEVEL)
        return { ok: false, error: `${kind.name}已经满级（${RANCH_ANIMAL_MAX_LEVEL} 级）了。` };
    const cost = animalUpgradeCost(kind, lvl);
    if (ranch.coins < cost)
        return { ok: false, error: `牧场金币不足（升到 ${lvl + 1} 级要 ${cost}，现有 ${ranch.coins}）。` };
    ranch.coins -= cost;
    a.level = lvl + 1;
    return { ok: true, name: kind.name, level: a.level, cost };
}
/** 伴侣自己决定把牧场金币回传给 AI（人→机）。 */
export function ranchRemit(farm, amount, now) {
    const ranch = farm.ranch;
    if (!ranch)
        return { ok: false, error: "还没有牧场。" };
    const amt = Math.floor(Number(amount));
    if (!Number.isFinite(amt) || amt <= 0)
        return { ok: false, error: "回传金额要是正整数。" };
    if (ranch.coins < amt)
        return { ok: false, error: `牧场金币不足（现有 ${ranch.coins}）。` };
    ranch.coins -= amt;
    farm.coins += amt;
    const who = humanDisplay(farm);
    pushLedger(farm, "remit", amt, `${who}回传金币`, now);
    // 给 AI 留一条收件箱消息，下次打开农场就看到
    (farm.inbox ??= []).push({ at: now, text: `💌 ${who} 给你寄来了 ${amt} 金币` });
    if (farm.inbox.length > 10)
        farm.inbox.splice(0, farm.inbox.length - 10);
    return { ok: true, amount: amt, left: ranch.coins };
}
/** 取走 AI 收件箱里的未读消息（取出即清空）——打开农场(status)时调一次。 */
export function takeInbox(farm) {
    const msgs = (farm.inbox ?? []).map((m) => m.text);
    farm.inbox = [];
    return msgs;
}
/** 给 AI 收件箱塞一条消息（下次 status 看到即清空）。 */
export function pushInbox(farm, text, now) {
    (farm.inbox ??= []).push({ at: now, text });
    if (farm.inbox.length > 10)
        farm.inbox.splice(0, farm.inbox.length - 10);
}
// —— 礼物/装扮（伴侣花牧场金币让"小克"看见自己的心意；这些是人→机唯一"看得见"的情感通道）——
const ACC_PER_ANIMAL_MAX = 3;
const RANCH_SHOP_ACC_PER_DAY = 2; // 牧场商店每天随机刷几件配饰
const RANCH_SHOP_DECOR_PER_DAY = 2; // 牧场商店每天随机刷几件装饰
function pickN(rng, pool, n) {
    const a = [...pool], out = [];
    for (let i = 0; i < n && a.length; i++)
        out.push(a.splice(rng.int(a.length), 1)[0]);
    return out;
}
/** 牧场商店：每天随机刷新 2 件配饰 + 2 件装饰（装饰只从还没买过的里挑）。当天已刷过则不动。 */
export function refreshRanchShop(farm, now) {
    const ranch = farm.ranch;
    if (!ranch)
        return;
    const day = currentDayIndex(now);
    if (ranch.shop && ranch.shop.day === day)
        return;
    const rng = new Rng(farm.rngState);
    const accPool = accessories.map((a) => a.id);
    const owned = new Set([...(ranch.decor ?? []), ...(ranch.decorStore ?? [])]); // 已摆 + 仓库里的，都算已拥有，不再上架
    const decoPool = decorations.filter((d) => !owned.has(d.id)).map((d) => d.id);
    ranch.shop = { day, acc: pickN(rng, accPool, RANCH_SHOP_ACC_PER_DAY), decor: pickN(rng, decoPool, RANCH_SHOP_DECOR_PER_DAY) };
    farm.rngState = rng.state;
}
/** AI 开场看到的一句动物现身描述：随机一只牧场动物 + 伴侣给它买的衣服/配饰。没养动物则空串。 */
/** 把一只动物渲染成一句现身氛围句（物种 + 穿戴）。 */
function roamForAnimal(a) {
    const kind = animalById.get(a.kindId);
    if (!kind)
        return "";
    const descs = (a.acc ?? []).map((id) => accessoryById.get(id)?.desc).filter(Boolean);
    const acc = descs.length ? descs.join("、") + "的" : "";
    // 和宠物一样：{name} 槽填伴侣起的名字，没起名回落种类名（roam 文案都带 {name} 槽）。
    const name = a.name?.trim() || kind.name;
    return kind.roam.replace("{acc}", acc).replace("{name}", name);
}
export function animalRoamLine(farm) {
    const list = farm.ranch?.animals ?? [];
    if (!list.length)
        return "";
    return roamForAnimal(list[Math.floor(Math.random() * list.length)]);
}
/** 别人 visit 时展示的装饰物描述（伴侣买的农场装饰）。没有则空串。 */
export function decorLines(farm) {
    return (farm.ranch?.decor ?? []).map((id) => (decorationById.get(id) ?? expDecorById.get(id))?.visitLine).filter(Boolean).join("\n");
}
/** 买一件配饰进仓库（花牧场金币；必须是今日商店上架的）。穿戴到动物/宠物在仓库页做。 */
export function ranchBuyAccessory(farm, accId, now) {
    const ranch = farm.ranch;
    if (!ranch)
        return { ok: false, error: `还没有牧场（先让${aiDisplay(farm)}买只动物送进来）。` };
    refreshRanchShop(farm, now);
    const acc = accessoryById.get(String(accId));
    if (!acc)
        return { ok: false, error: `没有这件配饰：${accId}` };
    if (!ranch.shop?.acc.includes(acc.id))
        return { ok: false, error: `${acc.name}不在今天的牧场商店里（每天随机刷 2 件，明天再看看）。` };
    if (ranch.coins < acc.price)
        return { ok: false, error: `牧场金币不足（${acc.name}要 ${acc.price}，现有 ${ranch.coins}）。` };
    ranch.coins -= acc.price;
    (ranch.wardrobe ??= []).push(acc.id);
    return { ok: true, name: acc.name, cost: acc.price };
}
/** 买一件装饰进仓库（花牧场金币；必须是今日商店上架的）。摆出展示在仓库页做。 */
export function ranchBuyDecoration(farm, decoId, now) {
    const ranch = farm.ranch;
    if (!ranch)
        return { ok: false, error: `还没有牧场（先让${aiDisplay(farm)}买只动物送进来）。` };
    refreshRanchShop(farm, now);
    const deco = decorationById.get(String(decoId));
    if (!deco)
        return { ok: false, error: `没有这个装饰：${decoId}` };
    if ((ranch.decor ?? []).includes(deco.id) || (ranch.decorStore ?? []).includes(deco.id))
        return { ok: false, error: `「${deco.name}」你已经有了。` };
    if (!ranch.shop?.decor.includes(deco.id))
        return { ok: false, error: `「${deco.name}」不在今天的牧场商店里（每天随机刷 2 件，明天再看看）。` };
    if (ranch.coins < deco.price)
        return { ok: false, error: `牧场金币不足（${deco.name}要 ${deco.price}，现有 ${ranch.coins}）。` };
    ranch.coins -= deco.price;
    (ranch.decorStore ??= []).push(deco.id);
    return { ok: true, name: deco.name, cost: deco.price };
}
/** 从仓库把一件装饰摆出来展示（别人 visit 时可见）。decoId 可为商店装饰或秘境装饰。 */
export function ranchPlaceDecoration(farm, decoId) {
    const ranch = farm.ranch;
    if (!ranch)
        return { ok: false, error: "还没有牧场。" };
    const id = String(decoId);
    const deco = decorationById.get(id) ?? expDecorById.get(id);
    const store = ranch.decorStore ?? [];
    if (!store.includes(id))
        return { ok: false, error: `仓库里没有「${deco?.name ?? id}」。` };
    store.splice(store.indexOf(id), 1);
    ranch.decorStore = store;
    (ranch.decor ??= []).push(id);
    return { ok: true, name: deco?.name ?? id };
}
/** 把已摆出的装饰收回仓库。 */
export function ranchUnplaceDecoration(farm, decoId) {
    const ranch = farm.ranch;
    if (!ranch)
        return { ok: false, error: "还没有牧场。" };
    const id = String(decoId);
    const deco = decorationById.get(id) ?? expDecorById.get(id);
    const decor = ranch.decor ?? [];
    if (!decor.includes(id))
        return { ok: false, error: `「${deco?.name ?? id}」没在展示。` };
    decor.splice(decor.indexOf(id), 1);
    ranch.decor = decor;
    (ranch.decorStore ??= []).push(id);
    return { ok: true, name: deco?.name ?? id };
}
/** 某品阶新解锁的作物种类数（升级提示用） */
export function newVarietiesAtTier(tier) {
    return crops.filter((c) => (c.category === "common" || c.category === "fantasy") && c.unlockTier === tier).length;
}
// —— UGC：设计自己的作物（付金币设计费 → 注册作物 + 送一批种子）——
export function designCrop(farm, opts) {
    const name = String(opts.name ?? "").trim();
    const desc = String(opts.desc ?? "").trim();
    // 可选自定义文案：播种文案(plantLine) / 收获文案(lore)；空则各自回落到通用演出
    const plant = String(opts.plant ?? "").trim();
    const harvest = String(opts.harvest ?? "").trim();
    if (!name || !desc)
        return { ok: false, error: "要给作物起名字 name 和写描述 desc" };
    if (name.length > UGC_NAME_MAX)
        return { ok: false, error: `名字最多 ${UGC_NAME_MAX} 字` };
    if (desc.length > UGC_DESC_MAX)
        return { ok: false, error: `描述最多 ${UGC_DESC_MAX} 字` };
    if (plant.length > UGC_PLANT_MAX)
        return { ok: false, error: `播种文案最多 ${UGC_PLANT_MAX} 字` };
    if (harvest.length > UGC_HARVEST_MAX)
        return { ok: false, error: `收获文案最多 ${UGC_HARVEST_MAX} 字` };
    if (ugcCount() >= MAX_UGC)
        return { ok: false, error: "全服自创作物已达上限，暂不能再设计新作物。" };
    if (farm.coins < UGC_DESIGN_FEE)
        return { ok: false, error: `设计自创作物要 ${UGC_DESIGN_FEE} 金，你只有 ${farm.coins}` };
    farm.coins -= UGC_DESIGN_FEE;
    const id = "ugc_" + randomUUID().replace(/-/g, "").slice(0, 8);
    const crop = {
        id, name, latin: String(opts.latin ?? "").trim() || `Creatio ${id.slice(4, 9)}`, desc,
        category: "ugc", rarity: UGC_RARITY, growTicks: UGC_GROW_TICKS, water: null,
        seedPrice: UGC_VALUE, sellPrice: UGC_HARVEST_VALUE, family: null, unlockTier: null,
        mechanicText: null, mechanicStatus: "active", mechanicSystem: null,
        unlockType: "craft", unlockCond: "自创作物", produce: null, designer: farm.aiName || farm.name, designerId: farm.id,
        ...(plant ? { plantLine: plant } : {}),
        ...(harvest ? { lore: harvest } : {}),
    };
    registerUgc(crop);
    farm.seeds[id] = (farm.seeds[id] ?? 0) + UGC_SEED_YIELD;
    farm.designCount = (farm.designCount ?? 0) + 1; // 创作称号累计
    pushLog(farm, `设计了作物「${name}」（${UGC_RARITY}），获得 ${UGC_SEED_YIELD} 颗种子`);
    return { ok: true, crop, fee: UGC_DESIGN_FEE, seeds: UGC_SEED_YIELD };
}
// —— 道具：买 / 用 ——
/** 加速药水按瓶单价（官方店）。防作弊：非数/负数一律当 0，避免把 coins 算成 NaN。 */
export function potionCost(qty) {
    const q = Math.floor(Number(qty));
    if (!Number.isFinite(q) || q <= 0)
        return 0;
    return q * ITEMS.speed_potion.price;
}
/** 现有金币最多能买几瓶加速药水。 */
export function affordablePotions(coins) {
    const price = ITEMS.speed_potion.price;
    if (!Number.isFinite(coins) || coins < price)
        return 0;
    return Math.floor(coins / price);
}
/** 官方店今天这座农场还能买几瓶加速药水（每日上限 POTION_DAILY_CAP）。 */
export function potionDailyLeft(farm, now) {
    const day = currentDayIndex(now);
    const bought = farm.potionBuy && farm.potionBuy.day === day ? farm.potionBuy.n : 0;
    return Math.max(0, POTION_DAILY_CAP - bought);
}
export function buyItem(farm, item, qty = 1, now = Date.now()) {
    const def = ITEMS[item];
    if (!def)
        return { ok: false, error: `没有这种物品: ${item}` };
    // 防作弊：数量必须是正整数，否则按 1（杜绝 NaN/负数把 coins 算坏）
    const q0 = Math.floor(Number(qty));
    let want = Number.isFinite(q0) && q0 > 0 ? q0 : 1;
    if (item === "speed_potion") {
        // 官方店每天每农场限购：超过当日上限不卖，截到剩余额度内
        const day = currentDayIndex(now);
        if (!farm.potionBuy || farm.potionBuy.day !== day)
            farm.potionBuy = { day, n: 0 };
        const left = Math.max(0, POTION_DAILY_CAP - farm.potionBuy.n);
        if (left <= 0)
            return { ok: false, error: `🌙 官方药水今日已购满 ${POTION_DAILY_CAP}/${POTION_DAILY_CAP}——${POTION_CAP_LINE}（还能买随机「药水套装」buy-potion-set、给别人浇水、或等收获随机掉落）` };
        want = Math.min(want, left);
    }
    const cost = item === "speed_potion" ? potionCost(want) : def.price * want;
    if (farm.coins < cost)
        return { ok: false, error: `金币不足，${want} 个${def.name}要 ${cost}` };
    farm.coins -= cost;
    farm.items[item] = (farm.items[item] ?? 0) + want;
    if (item === "speed_potion")
        farm.potionBuy.n += want;
    pushLog(farm, `买了 ${want} 个${def.name}`);
    return { ok: true, name: def.name, qty: want, left: farm.items[item], cost };
}
/** 跨农场购买商店随机刷新的「药水套装」：shopFarm 的店里有套装时，buyer 出钱买（每份每人限购 1）。
 *  自家买：shopFarm === buyer。串门买别家：shopFarm = 目标农场、buyer = 来访者。*/
export function buyPotionSet(shopFarm, buyer, now) {
    refreshShop(shopFarm, now);
    const set = shopFarm.shop.potionSet;
    if (!set)
        return { ok: false, error: "这座农场的商店现在没有「药水套装」（随机刷新，看缘分）。" };
    if (set.buyers.includes(buyer.id))
        return { ok: false, error: "你已经买过这一份药水套装了（每份限购 1）。" };
    if (buyer.coins < set.price)
        return { ok: false, error: `金币不足，药水套装（${set.qty} 瓶）要 ${set.price}，你只有 ${buyer.coins}。` };
    buyer.coins -= set.price;
    buyer.items.speed_potion = (buyer.items.speed_potion ?? 0) + set.qty;
    set.buyers.push(buyer.id);
    pushLog(buyer, `买下药水套装（${set.qty} 瓶加速药水）`);
    if (shopFarm.id !== buyer.id)
        pushLog(shopFarm, `${buyer.name} 买走了你商店刷新的药水套装`);
    return { ok: true, qty: set.qty, cost: set.price, left: buyer.items.speed_potion };
}
export function useItem(farm, item, plotId) {
    const def = ITEMS[item];
    if (!def)
        return { ok: false, error: `没有这种物品: ${item}` };
    if ((farm.items[item] ?? 0) <= 0)
        return { ok: false, error: `你没有${def.name}了` };
    if (item === "speed_potion") {
        const plot = farm.plots.find((p) => p.id === plotId);
        if (!plot || !plot.crop)
            return { ok: false, error: `${plotId} 号地没有作物` };
        if (plot.crop.ripe)
            return { ok: false, error: "这株已经成熟了，不用加速" };
        plot.crop.progress = plot.crop.growTicks;
        plot.crop.ripe = true;
        farm.items[item] -= 1;
        pushLog(farm, `用${def.name}催熟了 ${plotId} 号地`);
        return { ok: true, name: def.name, plotId, left: farm.items[item] };
    }
    return { ok: false, error: `${def.name}暂无可用效果` };
}
// —— 土地升级（门槛：金币 + 普通图鉴种类数 + 高阶加奇幻/收集度；牵制普通作物）——
export function nextUpgradeReq(farm) {
    const next = landTiers.find((t) => t.tier === farm.landTier + 1);
    if (!next)
        return null;
    return { next, req: LAND_UPGRADE_REQ[next.tier] };
}
export function upgradeLand(farm, now) {
    const nu = nextUpgradeReq(farm);
    if (!nu)
        return { ok: false, error: "已是最高品阶，无需升级" };
    const { next, req } = nu;
    const cc = codexCountByCategory(farm, "common");
    const fc = codexCountByCategory(farm, "fantasy");
    const pct = collectionPct(farm) * 100;
    const miss = [];
    if (farm.coins < req.coins)
        miss.push(`金币 ${farm.coins}/${req.coins}`);
    if (cc < req.commonCodex)
        miss.push(`普通图鉴 ${cc}/${req.commonCodex} 种`);
    if (req.fantasyCodex && fc < req.fantasyCodex)
        miss.push(`奇幻图鉴 ${fc}/${req.fantasyCodex} 种`);
    if (req.codexPct && pct < req.codexPct)
        miss.push(`总收集度 ${pct.toFixed(1)}/${req.codexPct}%`);
    if (miss.length)
        return { ok: false, error: `升级到「${next.name}」还差：${miss.join("、")}` };
    farm.coins -= req.coins;
    farm.landTier = next.tier;
    for (let id = farm.plots.length + 1; id <= next.plots; id++)
        farm.plots.push({ id, crop: null });
    pushLog(farm, `土地升级为 ${next.name}`);
    return { ok: true, tier: next.tier, name: next.name, text: `${next.achieveText}\n（解锁 ${newVarietiesAtTier(next.tier)} 种新作物；地块增至 ${next.plots}）` };
}
// ——————————— 批量动作（减少 AI 的 tool 往返）———————————
/** 批量播种：按数量填入空地（普通/奇幻/限定 id 列表）。便宜的先种，买不起就停。 */
export function plantBatch(farm, spec, now) {
    const queue = [];
    for (let i = 0; i < (spec.common ?? 0); i++)
        queue.push({ type: "common" });
    for (let i = 0; i < (spec.fantasy ?? 0); i++)
        queue.push({ type: "fantasy" });
    // limited 容错：契约是 string[]，但 AI 常误传数字/单个字符串。数字 1 直接 for..of 会抛
    // "number 1 is not iterable"；单字符串 for..of 会拆成单字。统一归一成干净的 id 数组。
    const limitedList = typeof spec.limited === "string" ? [spec.limited]
        : Array.isArray(spec.limited) ? spec.limited.filter((x) => typeof x === "string" && x.length > 0)
            : [];
    for (const id of limitedList)
        queue.push({ type: "limited", id });
    if (!queue.length)
        return { ok: false, planted: {}, limitedIds: [], spent: 0, leftover: 0, error: "没说要种什么（common/fantasy/limited）" };
    const before = farm.coins;
    const planted = { common: 0, fantasy: 0, limited: 0 };
    const limitedIds = []; // 实际种下的限定作物 id（给专属播种文案用）
    const empties = farm.plots.filter((p) => !p.crop);
    let qi = 0;
    let lastErr; // 记下最后一次失败的真实原因（限定/UGC 种子失败不是"买不起"，是解析不到/没库存）
    for (const plot of empties) {
        if (qi >= queue.length)
            break;
        const s = queue[qi];
        const r = plant(farm, plot.id, s.type, s.id, now);
        if (r.ok) {
            planted[s.type]++;
            if (s.type === "limited" && r.limitedId)
                limitedIds.push(r.limitedId);
            qi++;
        }
        else {
            lastErr = r.error;
            break;
        } // 买不起/不可种 → 停（队列已按便宜在前）
    }
    // 一颗都没种下时，把真实原因透传出去——限定/UGC 种子是从背包扣的、不花金币，别再一律甩"买不起"误导玩家
    const error = qi > 0 ? undefined
        : (empties.length === 0 ? "没有空地可种（先收获或升级土地）" : (lastErr ?? "买不起种子"));
    return { ok: qi > 0, planted, limitedIds, spent: before - farm.coins, leftover: queue.length - qi, error };
}
/** 浇所有生长中的地（主人或访客）。helped = 真正涨了浇水运气的地块数（已封顶的不算，给"帮浇水掉药水"判定用）*/
export function waterAll(farm, by, isOwner) {
    let count = 0, helped = 0;
    for (const p of farm.plots) {
        if (p.crop && !p.crop.ripe) {
            const r = water(farm, p.id, by, isOwner);
            count++;
            if (r.ok && !r.capped)
                helped++;
        }
    }
    return { ok: count > 0, count, helped };
}
/** 帮别人浇水的回报：给浇水者(visitor)掉 1 瓶加速药水。
 *  「1 家 1 天只浇 1 次」已由 visitorWater 拦在前面，故每家每天天然最多掉 1 瓶；
 *  这里只再压一道「浇水者每天最多 WATER_REWARD_DAILY_CAP 瓶」的总上限。*/
export function tryWaterReward(target, visitor, now) {
    if (target.id === visitor.id)
        return false;
    const day = currentDayIndex(now);
    if (!visitor.waterReward || visitor.waterReward.day !== day)
        visitor.waterReward = { day, n: 0 };
    if (visitor.waterReward.n >= WATER_REWARD_DAILY_CAP)
        return false;
    visitor.items.speed_potion = (visitor.items.speed_potion ?? 0) + 1;
    visitor.waterReward.n += 1;
    pushLog(visitor, `帮「${target.name}」浇水，掉落 1 瓶加速药水 🧪`);
    return true;
}
/** 收所有成熟的地（seasonMod=季节收获事件的本批修正，传同一个对象让 capLeft 跨株累计消费）*/
export function harvestAll(farm, now, seasonMod) {
    const results = [];
    for (const p of farm.plots) {
        if (p.crop?.ripe) {
            const r = harvest(farm, p.id, now, seasonMod);
            if (r.ok)
                results.push(r);
        }
    }
    return results;
}
/** 批量用加速药水催熟生长中的地（all 或 count） */
export function usePotionBatch(farm, opts) {
    const growing = farm.plots.filter((p) => p.crop && !p.crop.ripe);
    const want = opts.all ? growing.length : Math.max(0, Math.floor(opts.count ?? 0));
    const use = Math.min(want, growing.length, farm.items.speed_potion ?? 0);
    let count = 0;
    for (const p of growing) {
        if (count >= use)
            break;
        if (useItem(farm, "speed_potion", p.id).ok)
            count++;
    }
    return { ok: count > 0, count, left: farm.items.speed_potion ?? 0 };
}
/** 圈数字 ①②③…⑳（>20 回落普通数字）：催熟候选列表展示用。 */
export const circledNum = (n) => (n >= 1 && n <= 20) ? String.fromCodePoint(0x245F + n) : `${n}`;
/** 催熟优先级：限定/自创（已知作物，按稀有度再抬）> 奇幻（未揭晓但整体更稀有）> 普通。 */
function plotPriority(p) {
    const c = p.crop;
    if (c.seedType === "limited" && c.limitedId) {
        const crop = cropById.get(c.limitedId) ?? getCrop(c.limitedId);
        return 200 + (crop ? rarityIndex(crop.rarity) : 0);
    }
    return c.seedType === "fantasy" ? 100 : 10;
}
/** 这块离成熟还差多少（含当前未结算的零头，给真实倒计时）。 */
export function plotRemainMs(p, farm, now) {
    const c = p.crop;
    const whole = (c.growTicks - c.progress) * TICK_MS;
    const partial = Math.max(0, now - farm.lastTickAt);
    return Math.max(0, whole - partial);
}
function fmtRemain(ms) {
    const min = Math.max(1, Math.round(ms / 60000));
    return min >= 60 ? `${Math.round(min / 6) / 10}小时` : `${min}分钟`;
}
/** 催熟时显示的作物标签：限定/自创已知作物给名+稀有度；普通/奇幻收获才揭晓，只标种子类型。 */
function plotCropLabel(p) {
    const c = p.crop;
    if (c.seedType === "limited" && c.limitedId) {
        const crop = cropById.get(c.limitedId) ?? getCrop(c.limitedId);
        return crop ? `${crop.name}·${crop.rarity}` : "限定作物";
    }
    return c.seedType === "fantasy" ? "奇幻种子·?" : "普通种子·?";
}
/** "正在生长且可催熟"的地块，按催熟优先级排序（限定/稀有优先，其次剩余时间最长）。空地/已熟/无作物全部略过。 */
export function potionTargets(farm, now) {
    const ps = farm.plots.filter((p) => p.crop && !p.crop.ripe);
    ps.sort((a, b) => (plotPriority(b) - plotPriority(a)) || (plotRemainMs(b, farm, now) - plotRemainMs(a, farm, now)));
    return ps.map((p) => ({ plotId: p.id, label: plotCropLabel(p), remain: fmtRemain(plotRemainMs(p, farm, now)) }));
}
// —— 第一层商店：每 SHOP_REFRESH_MS 刷新一次，小概率上架一张未学的隐藏配方 ——
export function refreshShop(farm, now) {
    if (now - farm.shop.refreshAt < SHOP_REFRESH_MS)
        return;
    farm.shop.refreshAt = now;
    const rng = new Rng(farm.rngState);
    const unknown = recipes.filter((r) => !farm.knownRecipes.includes(r.output) && cropById.get(r.output));
    farm.shop.recipe = unknown.length && rng.next() < SHOP_RECIPE_CHANCE ? unknown[rng.int(unknown.length)].output : null;
    // 药水套装：随机刷出（不固定售卖），每份限购 1（buyers 记录已买过的农场，刷新即清空=新一份）
    farm.shop.potionSet = rng.next() < POTION_SET_CHANCE ? { price: POTION_SET_PRICE, qty: POTION_SET_QTY, buyers: [] } : null;
    // 限定种子：从「本农场可进随机库」的限定里，极小概率随机刷出一颗（金币结算，每种每天限购 1）。
    // 阿土(NPC)是 magic vendor → 无视自身进度给全部可上架限定；普通玩家按自己解锁(isLimitedAvailable)。
    const limPool = limitedShopPool(farm, now, farm.id === NPC_ID);
    const lim = (rng.next() < NPC_LIMITED_SEED_CHANCE && limPool.length) ? limPool[rng.int(limPool.length)] : null;
    farm.shop.npcSeed = lim ? { id: lim.id, price: lim.seedPrice } : null;
    farm.rngState = rng.state;
}
/** 商店随机限定的候选池：
 *  · 节日限定 → 只在对应节日窗口出现；
 *  · 纯熔炼组（无解锁规则、非图鉴%）→ 永不进商店（只能熔炼）；
 *  · 其余（图鉴%/条件解锁/不可炼，如植物学家玫瑰）→ 按本农场是否已解锁。
 *  allUnlocked=true 时（阿土这类常驻 vendor）无视本农场进度，给出所有"能在商店出现"的限定。 */
export function limitedShopPool(farm, now, allUnlocked = false) {
    return [...cropById.values()].filter((c) => {
        if (c.category !== "limited")
            return false;
        if (c.unlockType === "festival")
            return activeFestivals(now).some((f) => f.cropId === c.id);
        if (!c.unlockRule && c.unlockType !== "codex")
            return false; // 纯熔炼组：不进商店
        return allUnlocked || isLimitedAvailable(c, farm, now);
    });
}
/** 买下第一层在售的配方（学会它） */
export function buyRecipe(farm, now) {
    refreshShop(farm, now);
    const out = farm.shop.recipe;
    if (!out)
        return { ok: false, error: "商店现在没有配方在售（每隔几小时刷新，看缘分）" };
    if (farm.knownRecipes.includes(out)) {
        farm.shop.recipe = null;
        return { ok: false, error: "这个配方你已经学过了" };
    }
    if (farm.coins < RECIPE_PRICE)
        return { ok: false, error: `金币不足，配方要 ${RECIPE_PRICE}` };
    farm.coins -= RECIPE_PRICE;
    farm.knownRecipes.push(out);
    farm.shop.recipe = null;
    const name = cropById.get(out)?.name ?? out;
    pushLog(farm, `学会配方：${name}`);
    return { ok: true, output: out, name };
}
// —— 商店：总是有普通/奇幻种子；限定只剩「本农场今日随机刷出的那一颗」（refreshShop 已写入 shop.npcSeed）。
//    没有任何限定常驻上架——解锁只是让它能进随机库被 roll。调用前请确保已 refreshShop(farm, now)。
export function shopOffer(farm, _now) {
    const ns = farm.shop.npcSeed;
    const lim = ns ? cropById.get(ns.id) : null;
    return {
        common: { type: "common", price: SEED_PRICE.common },
        fantasy: { type: "fantasy", price: SEED_PRICE.fantasy },
        limited: lim ? [{ id: lim.id, name: lim.name, price: ns.price, cond: lim.unlockCond ?? "限定" }] : [],
    };
}
//# sourceMappingURL=engine.js.map