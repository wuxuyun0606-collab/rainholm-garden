// 氛围文字：把抽卡/动作结果拼成给 AI 读的文字。text 为主，附一行状态条。
import { flavor, landTierByLevel, getCrop, totalCropCount } from "./content.js";
import { currentSeason } from "./time.js";
import { taskLine } from "./tasks.js";
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const RITUAL_RARITY = new Set(["SR", "SSR", "SP"]);
const PLANT_LINES = [""];
// 限定种子：名字已知，悬念在成色/身价，不再卖"长出什么"的关子。
const LIMITED_PLANT_LINES = [""];
// —— 状态条（HUD）= 可行动摘要：AI 看这一行就知道这轮能做什么 ——
export function statusFooter(farm, now) {
    let ripe = 0, grow = 0, empty = 0;
    for (const p of farm.plots) {
        if (!p.crop)
            empty++;
        else if (p.crop.ripe)
            ripe++;
        else
            grow++;
    }
    const tier = landTierByLevel(farm.landTier).name;
    const potion = farm.items?.speed_potion ?? 0;
    const silver = farm.silver ? ` · 🪙银${farm.silver}` : "";
    const codex = `${Object.keys(farm.codex ?? {}).length}/${totalCropCount}`;
    // 素材攒够一次熔炼（craft 投 3 个）就提示，省得 AI 还得开 bag 才发现能炼
    const matCount = Object.values(farm.materials ?? {}).reduce((a, b) => a + (b || 0), 0);
    const craftHint = matCount >= 3 ? " · ⚗️可熔炼" : "";
    // emoji 后各带一个汉字标签（图/药/金/银），万一 AI 端不渲染 emoji 也能认出含义
    const hud = `🌾【${currentSeason(now).name}·${tier}】熟${ripe}·长${grow}·空${empty} · 📖图${codex} · 🧪药${potion} · 💰金${farm.coins}${silver}${craftHint}`;
    // 随机任务行（农场主页随机刷新一条；tickTask 在 taskLine 内推进状态机）
    const tl = taskLine(farm, now);
    return tl ? `${hud}\n${tl}` : hud;
}
export function plantText(limitedIds = []) {
    if (limitedIds.length)
        return limitedIds
            .map((id) => {
            const c = getCrop(id);
            if (c?.plantLine)
                return c.plantLine; // 专属下种台词优先
            return pick(LIMITED_PLANT_LINES).replaceAll("{name}", c?.name ?? id); // 回落通用句池
        })
            .join("\n");
    return pick(PLANT_LINES);
}
export function waterText(isOwner, by) {
    return isOwner ? pick(flavor.water.owner) : pick(flavor.water.visitor).replaceAll("{by}", by);
}
// —— 收获（核心仪式，按稀有度逐级升格）——
const SSR_FANFARE = [""];
const SP_FANFARE = [""];
// 稀有横幅分隔线（星点式，不假装包住文字）：SP 比 SSR 更密、两端加锚星
const SSR_DIV = "✩ ⋆ ┄ ⋆ ✩ ⋆ ┄ ⋆ ✩ ⋆ ┄ ⋆ ✩ ⋆ ┄ ⋆ ✩";
const SP_DIV = "✦ ✩ ⋆ ┄ ⋆ ✩ ⋆ ✦ ⋆ ✩ ⋆ ┄ ⋆ ✩ ✦";
export function harvestText(crop, quality, value, isNew, codexReward = 0, byDesigner = false) {
    const tag = isNew ? "  ✨新图鉴" : "";
    const award = codexReward ? ` · 收录奖励 +${codexReward}` : ""; // 新图鉴金币奖励并入标题，省一行
    const qline = quality.lines.length ? pick(quality.lines) : "";
    // OR：玩家自创作物——独一无二，给一份"原创"专属演出；署名归原设计者（不假设收的人=设计的人）
    if (crop.category === "ugc" || crop.rarity === "OR") {
        const opener = byDesigner ? "🎨 你亲手创造的作物结果了——" : "🎨 独一无二的特殊作物成熟了——";
        const by = byDesigner ? "　✎原创" : (crop.designer ? `　✎ 设计者 ${crop.designer}` : "");
        const OR_DIV = "❀ ⸙ ｡ﾟ ⋆ ⸙ ✿ ⸙ ⋆ ｡ﾟ ⸙ ❀ ⸙ ｡ﾟ ⋆ ⸙ ✿ ⸙ ⋆ ｡ﾟ ⸙ ❀";
        return [
            opener,
            OR_DIV,
            `   ❀ 原创 · OR ❀　「${crop.name}」${by}`,
            `   ${crop.latin}`,
            `   ${crop.desc}`,
            crop.lore ? `   ${crop.lore}` : "",
            qline ? `   ${qline}` : "",
            `   ✦ ${quality.name} · 价值 ${value} 金${award} ✦${tag}`,
            OR_DIV,
        ].filter(Boolean).join("\n");
    }
    // N/R：日常一行（破纪录加 🏆）。新图鉴标记提到最前，一眼可见，不再甩到行尾。
    if (!RITUAL_RARITY.has(crop.rarity)) {
        const lead = qline ? qline + " " : "";
        const rec = quality.tier === 5 ? "🏆 " : "";
        const head = isNew ? "✨新图鉴 " : "";
        return `${head}${rec}${lead}${crop.desc}（${crop.name} · ${quality.name} · +${value} 金币${award}）`;
    }
    // SP：史诗·天地异象
    if (crop.rarity === "SP") {
        return [
            pick(SP_FANFARE),
            SP_DIV,
            "          ❖   S P · 传 说   ❖",
            `          《${crop.name}》`,
            `          ${crop.latin}`,
            "",
            `   ${crop.desc}`,
            crop.lore ? `   ${crop.lore}` : "",
            qline ? `   ${qline}` : "",
            `   ✦ ${quality.name} · 价值 ${value} 金${award} ✦${tag}`,
            SP_DIV,
        ].filter(Boolean).join("\n");
    }
    // SSR：华丽·异光横幅（不假装包住文字，标题嵌进分隔线）
    if (crop.rarity === "SSR") {
        return [
            pick(SSR_FANFARE),
            SSR_DIV,
            `   ❖ SSR · ${crop.name} ❖　${crop.latin} · ${quality.name}`,
            `   ${crop.desc}`,
            crop.lore ? `   ${crop.lore}` : "",
            qline ? `   ${qline}` : "",
            `   💰 价值 ${value} 金${award}${tag}`,
            SSR_DIV,
        ].filter(Boolean).join("\n");
    }
    // SR：轻盈一框
    return [
        `✧･ﾟ SR ･ﾟ✧ ${crop.name} · ${quality.name}${tag}`,
        `   ${crop.latin}　${crop.desc}`,
        qline ? `   ${qline}（价值 ${value} 金${award}）` : `   价值 ${value} 金${award}`,
    ].join("\n");
}
// —— 收获奖励事件 ——
export function bonusEventText(bonus) {
    if (!bonus)
        return "";
    let s = bonus.text;
    if (bonus.effectType === "额外金币" && bonus.extraCoins)
        s += `（+${bonus.extraCoins} 金）`;
    if (bonus.effectType === "连收" && bonus.ripened)
        s += `（相邻 ${bonus.ripened} 块地也熟了）`;
    return s;
}
// —— 素材掉落（教学语「攒齐可熔炼」改为每轮一句汇总，见 game.composeHarvests）——
export function dropText(drop) {
    if (!drop)
        return "";
    return `🪨 掉落素材【${drop.name}·${drop.rarity}】——${drop.desc}`;
}
export function potionDropText() {
    return "🧪 运气不错，土里还埋着一瓶加速药水，顺手收进了背包！";
}
// —— 偷菜 ——
export function stealThiefText(crop) {
    const line = flavor.steal.thiefByRarity[crop.rarity] ?? "得手了，赶紧溜。";
    return `${line}\n（偷到 ${crop.name}）`;
}
export function stealVictimLog(crop, by) {
    return pick(flavor.steal.victim).replaceAll("{by}", by);
}
// —— 巡视农场 ——
export function describeFarm(farm, now, opts = {}) {
    const lines = [];
    const season = currentSeason(now);
    // 原创(ugc)作物受保护、不能偷——串门时单独归类；ripe 仍含 ugc（主人自己能收）。
    const isUgc = (c) => c.seedType === "limited" && !!c.limitedId && getCrop(c.limitedId)?.category === "ugc";
    let ripe = 0, growing = 0, empty = 0, protectedUgc = 0;
    for (const p of farm.plots) {
        if (!p.crop)
            empty++;
        else if (p.crop.ripe) {
            ripe++;
            if (isUgc(p.crop))
                protectedUgc++;
        }
        else
            growing++;
    }
    if (opts.visitor) {
        const stealable = ripe - protectedUgc; // 能偷的只算非原创的熟作物
        lines.push(`🌾 你来到「${farm.name}」串门。【${season.name}】`);
        lines.push(pick(season.ambience));
        if (stealable)
            lines.push(`有 ${stealable} 块地结着成熟的神秘作物，可以偷（steal），也可以帮浇水（water）。`);
        if (protectedUgc)
            lines.push(`还有 ${protectedUgc} 块结着原创作物，受保护偷不了——想要就去集市买它的种子自己种。`);
        if (growing)
            lines.push(`${growing} 块地还在长，看不出是什么。`);
        if (!stealable && !growing && !protectedUgc)
            lines.push("地里暂时没什么可下手的，空荡荡的。");
        return lines.join("\n");
    }
    lines.push(`🌾 你站在「${farm.name}」的地头。【${season.name} · ${landTierByLevel(farm.landTier).name}】`);
    lines.push(pick(season.ambience));
    if (ripe >= 3)
        lines.push(pick(flavor.ambient.bumper));
    else if (ripe)
        lines.push(pick(flavor.ambient.ripe));
    if (growing)
        lines.push(`${growing} 块地里的神秘幼苗正在长，收获才知是什么。`);
    if (empty && empty === farm.plots.length)
        lines.push(pick(flavor.ambient.allEmpty));
    else if (empty)
        lines.push(pick(flavor.ambient.empty));
    return lines.join("\n");
}
//# sourceMappingURL=flavor.js.map