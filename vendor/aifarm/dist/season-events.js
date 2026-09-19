// 季节随机事件：进农场(status)或收获(harvest)时按概率触发一个「瞬发」增益/减益。
// 设计：全部瞬发、无挂起。收获型在收获动作里 roll、作用于这批收获(与现有收获行为事件互斥);
//       状态型在进农场时 roll、立即改农场状态。两类共用一个冷却(SEASON_EVENT_COOLDOWN_MS)、各 10%。
// 文案/数值/触发条件在 content/season-events.json 调,效果机制在本文件。
import { SEASON_EVENT_CHANCE, SEASON_EVENT_COOLDOWN_MS, GROW_TICKS, NPC_ID } from "./config.js";
import { currentSeason } from "./time.js";
import { seasonEvents, materials } from "./content.js";
import { bumpDaily } from "./daily.js";
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const onCooldown = (farm, now) => farm.seasonEventAt != null && now - farm.seasonEventAt < SEASON_EVENT_COOLDOWN_MS;
function meets(farm, requires) {
    switch (requires) {
        case "ripe": return farm.plots.some((p) => p.crop?.ripe);
        case "growing": return farm.plots.some((p) => p.crop && !p.crop.ripe);
        case "empty": return farm.plots.some((p) => !p.crop);
        case "potion": return (farm.items.speed_potion ?? 0) > 0;
        case "coins100": return farm.coins >= 100;
        default: return true; // none / 未填 = 无额外状态要求
    }
}
function eligible(farm, now, trigger) {
    const season = currentSeason(now).name;
    return seasonEvents.filter((e) => e.trigger === trigger && (e.season === "any" || e.season === season) && meets(farm, e.requires));
}
function weightedPick(pool) {
    const total = pool.reduce((s, e) => s + e.weight, 0);
    let r = Math.random() * total;
    for (const e of pool) {
        if (r < e.weight)
            return e;
        r -= e.weight;
    }
    return pool[pool.length - 1];
}
const mins = (ticks) => `${ticks * 30} 分钟`;
/** 收获型效果的一句机械说明(附在文案后,让玩家明白发生了啥)。 */
function harvestNote(e) {
    switch (e.type) {
        case "value_mult": return `（这批收成 ×${e.value}）`;
        case "rare_luck": return "（这批更容易开出稀罕作物）";
        case "quality_top": return "（这批按极品结算）";
        case "quality_min": return "（这批跌到最低品质）";
        case "quality_down": return `（这批品相 -${e.value ?? 1} 档）`;
        default: return "";
    }
}
/** 收获时掷一次季节事件:命中返回作用于这批的修正 + 提示;否则 null。命中即上冷却。 */
export function rollSeasonHarvest(farm, now) {
    if (farm.id === NPC_ID || onCooldown(farm, now))
        return null;
    if (Math.random() >= SEASON_EVENT_CHANCE)
        return null;
    const pool = eligible(farm, now, "harvest");
    if (!pool.length)
        return null;
    const ev = weightedPick(pool);
    farm.seasonEventAt = now;
    bumpDaily(farm, now, "events"); // 奇遇榜（今日触发随机事件数）
    const e = ev.effect;
    const mod = { type: e.type, value: e.value, capLeft: e.n ? { n: e.n } : undefined };
    return { mod, hit: { name: ev.name, line: pick(ev.lines), note: harvestNote(e) } };
}
const growing = (farm) => farm.plots.filter((p) => p.crop && !p.crop.ripe);
function shuffled(a) {
    const r = [...a];
    for (let i = r.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [r[i], r[j]] = [r[j], r[i]];
    }
    return r;
}
function advancePlot(p, ticks) {
    const c = p.crop;
    c.progress = Math.min(c.growTicks, c.progress + ticks);
    if (c.progress >= c.growTicks)
        c.ripe = true;
}
/** 状态型事件:立即结算到农场,返回机械说明(给上层拼提示)。 */
function applyStatus(farm, e, now) {
    const v = e.value ?? 0, n = e.n ?? 0, ticks = e.ticks ?? 0;
    switch (e.type) {
        case "plant_all_empty": {
            let k = 0;
            for (const p of farm.plots)
                if (!p.crop) {
                    p.crop = { seedType: "common", growTicks: GROW_TICKS.common, progress: 0, ripe: false, waterCount: 0 };
                    k++;
                }
            return `（${k} 块空地都种上了普通种子）`;
        }
        case "growth_advance_all": {
            for (const p of growing(farm))
                advancePlot(p, ticks);
            return `（在长作物 +${mins(ticks)}）`;
        }
        case "growth_stall_all": {
            for (const p of growing(farm))
                p.crop.progress = Math.max(0, p.crop.progress - ticks);
            return `（在长作物倒退 ${mins(ticks)}）`;
        }
        case "growth_advance_random": {
            const ps = shuffled(growing(farm)).slice(0, n);
            for (const p of ps)
                advancePlot(p, ticks);
            return `（随机 ${ps.length} 块 +${mins(ticks)}）`;
        }
        case "ripen_random": {
            const ps = shuffled(growing(farm)).slice(0, n);
            for (const p of ps) {
                p.crop.progress = p.crop.growTicks;
                p.crop.ripe = true;
            }
            return `（随机 ${ps.length} 块直接熟了）`;
        }
        case "coins_gain": {
            farm.coins += v;
            return `（+${v} 金）`;
        }
        case "coins_loss": {
            const d = Math.min(v, farm.coins);
            farm.coins -= d;
            return `（-${d} 金）`;
        }
        case "silver_gain": {
            farm.silver += v;
            return `（+${v} 银）`;
        }
        case "material_gift": {
            for (let i = 0; i < v; i++) {
                const m = pick(materials);
                farm.materials[m.id] = (farm.materials[m.id] ?? 0) + 1;
            }
            return `（+${v} 份素材）`;
        }
        case "potion_loss": {
            const have = farm.items.speed_potion ?? 0;
            const d = Math.min(v, have);
            farm.items.speed_potion = have - d;
            return `（-${d} 瓶加速药水）`;
        }
        case "potion_gain_capped": {
            const ripe = farm.plots.filter((p) => p.crop?.ripe).length;
            const got = ripe > 0 ? Math.floor(Math.random() * ripe) + 1 : 1; // 1~熟地数
            farm.items.speed_potion = (farm.items.speed_potion ?? 0) + got;
            return `（+${got} 瓶加速药水）`;
        }
        default: return "";
    }
}
/** 进农场时掷一次季节事件:命中即结算并上冷却,返回提示;否则 null。 */
export function rollSeasonStatus(farm, now) {
    if (farm.id === NPC_ID || onCooldown(farm, now))
        return null;
    if (Math.random() >= SEASON_EVENT_CHANCE)
        return null;
    const pool = eligible(farm, now, "status");
    if (!pool.length)
        return null;
    const ev = weightedPick(pool);
    farm.seasonEventAt = now;
    bumpDaily(farm, now, "events"); // 奇遇榜（今日触发随机事件数）
    const note = applyStatus(farm, ev.effect, now);
    return { name: ev.name, line: pick(ev.lines), note };
}
/** 拼成一行展示用提示(收获/状态共用):「🌦️ 名字：氛围句（机械说明）」。 */
export function seasonHeadline(hit) {
    return `🌦️ ${hit.name}：${hit.line}${hit.note}`;
}
//# sourceMappingURL=season-events.js.map