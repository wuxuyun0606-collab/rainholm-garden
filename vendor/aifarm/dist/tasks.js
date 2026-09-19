// 随机任务系统：农场主页随机刷新一条任务，接取后才计数，完成自动发奖，冷却 30 分钟刷下一条。
// 设计：生产/收集类奖「金币」（喂主线攒地升级），社交/对抗/市场类奖「银币」（喂玩家市场）。
// 数值（奖励/目标次数/权重/资格）都在下面的 TASK_POOL 调；节奏常量在 config.ts。
import { TASK_DAILY_CAP, TASK_COOLDOWN_MS, TASK_OFFER_TTL_MS, NPC_ID } from "./config.js";
import { currentDayIndex } from "./time.js";
import { bumpDaily } from "./daily.js";
// 社交类任务：只有「访问」开着（没闭门谢客）才会刷到
const social = (f) => f.social?.visit !== false;
// 有自创种子在背包（自创作物 id 以 "ugc_" 开头，见 engine.designCrop），才刷「种自创」
const hasUgcSeed = (f) => Object.entries(f.seeds ?? {}).some(([id, n]) => (n || 0) > 0 && id.startsWith("ugc_"));
const TASK_POOL = [
    // —— 生产 / 收集（奖金币）——
    { kind: "harvest_n", label: "收获 {n} 株普通(N)作物", target: 5, reward: 40, currency: "coin", weight: 20, event: "harvest", match: (d) => d.rarity === "N", eligible: () => true },
    { kind: "harvest_r", label: "收获 {n} 株 R 作物", target: 3, reward: 70, currency: "coin", weight: 14, event: "harvest", match: (d) => d.rarity === "R", eligible: () => true },
    { kind: "harvest_sr", label: "收获 {n} 株 SR 作物", target: 1, reward: 150, currency: "coin", weight: 7, event: "harvest", match: (d) => d.rarity === "SR", eligible: (f) => f.landTier >= 2 },
    { kind: "harvest_ssr", label: "收获 {n} 株 SSR/SP 作物", target: 1, reward: 300, currency: "coin", weight: 3, event: "harvest", match: (d) => d.rarity === "SSR" || d.rarity === "SP", eligible: (f) => f.landTier >= 3 },
    { kind: "craft", label: "熔炼 {n} 次", target: 1, reward: 60, currency: "coin", weight: 10, event: "craft", eligible: () => true },
    { kind: "new_codex", label: "收获到 {n} 个新图鉴", target: 1, reward: 50, currency: "coin", weight: 8, event: "harvest", match: (d) => d.isNew && !d.isUgc, eligible: () => true },
    { kind: "plant_ugc", label: "种下 {n} 株自创作物", target: 1, reward: 30, currency: "coin", weight: 8, event: "plant_ugc", eligible: hasUgcSeed },
    // —— 社交 / 对抗 / 市场（奖银币）——
    { kind: "help_water", label: "帮邻居浇 {n} 次水", target: 1, reward: 8, currency: "silver", weight: 14, event: "help_water", eligible: social },
    { kind: "message", label: "给邻居留 {n} 次言", target: 1, reward: 5, currency: "silver", weight: 12, event: "message", eligible: social },
    { kind: "visit", label: "串门 {n} 家农场", target: 2, reward: 6, currency: "silver", weight: 12, event: "visit", eligible: social },
    { kind: "steal", label: "偷 {n} 次菜", target: 1, reward: 5, currency: "silver", weight: 12, event: "steal", eligible: social },
    { kind: "buy_ugc", label: "买 {n} 次邻居的原创作物", target: 1, reward: 15, currency: "silver", weight: 6, event: "buy_ugc", eligible: social },
    { kind: "got_watered", label: "被人浇 {n} 次水", target: 1, reward: 5, currency: "silver", weight: 8, event: "got_watered", eligible: social },
    { kind: "got_stolen", label: "被偷 {n} 次菜", target: 1, reward: 10, currency: "silver", weight: 8, event: "got_stolen", eligible: social },
];
const defByKind = (kind) => TASK_POOL.find((t) => t.kind === kind);
/** 确定性 0..1（farmId+seq）：roll offer 用，不消耗 rngState（同 farm 同 seq 恒定）。 */
function hash01(id, seq) {
    let h = (2166136261 ^ seq) >>> 0;
    for (let i = 0; i < id.length; i++) {
        h ^= id.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 100000) / 100000;
}
const rewardText = (t) => t.currency === "coin" ? `+${t.reward} 金` : `+${t.reward} 银`;
function describe(slot) {
    return (defByKind(slot.kind)?.label ?? slot.kind).replace("{n}", String(slot.target));
}
/** 当天已接取数（顺带做每日重置）。 */
function dailyTaken(f, now) {
    const day = currentDayIndex(now);
    if (!f.taskDaily || f.taskDaily.day !== day)
        f.taskDaily = { day, taken: 0 };
    return f.taskDaily.taken;
}
/** 按权重 + 资格随机出一条新任务（确定性，靠 seq）。 */
function rollOffer(f, seq, now) {
    const pool = TASK_POOL.filter((t) => t.eligible(f));
    const total = pool.reduce((s, t) => s + t.weight, 0);
    let r = hash01(f.id, seq) * total;
    let chosen = pool[pool.length - 1];
    for (const t of pool) {
        if (r < t.weight) {
            chosen = t;
            break;
        }
        r -= t.weight;
    }
    return { seq, kind: chosen.kind, target: chosen.target, progress: 0, reward: chosen.reward, currency: chosen.currency, accepted: false, offeredAt: now };
}
/** 推进任务槽状态机（每次看农场主页/HUD 时调一次；确定性、可重复调用）。 */
export function tickTask(f, now) {
    if (f.id === NPC_ID)
        return;
    const taken = dailyTaken(f, now);
    if (taken >= TASK_DAILY_CAP) {
        if (f.task && !f.task.accepted)
            f.task = undefined;
        return;
    } // 今日已满：撤掉未接取的 offer
    const t = f.task;
    if (!t) {
        f.task = rollOffer(f, 1, now);
        return;
    }
    if (t.accepted && !t.completedAt)
        return; // 进行中：保留直到完成
    if (t.completedAt) { // 已完成：冷却到点刷下一条
        if (now - t.completedAt >= TASK_COOLDOWN_MS)
            f.task = rollOffer(f, t.seq + 1, now);
        return;
    }
    if (now - t.offeredAt >= TASK_OFFER_TTL_MS)
        f.task = rollOffer(f, t.seq + 1, now); // 未接取超时：换一条
}
/** 接取当前 offer（消耗一个每日额度）。 */
export function acceptTask(f, now) {
    if (f.id === NPC_ID)
        return { ok: false, text: "NPC 不接任务。" };
    tickTask(f, now);
    const t = f.task;
    if (!t || t.accepted || t.completedAt)
        return { ok: false, text: t?.accepted ? "任务已经接取了，完成它吧。" : "现在没有可接取的任务（冷却中或今日已满）。" };
    const taken = dailyTaken(f, now);
    if (taken >= TASK_DAILY_CAP)
        return { ok: false, text: `今天的任务额度已用完（${TASK_DAILY_CAP}/${TASK_DAILY_CAP}），明天再来。` };
    t.accepted = true;
    t.offeredAt = now;
    f.taskDaily.taken = taken + 1;
    return { ok: true, text: `📋 已接取任务：${describe(t)}（完成奖 ${rewardText(t)}）。去完成它吧！` };
}
/** 一次任务事件：匹配「进行中」任务则推进，完成则发奖。返回是否推进了进度（给调用方决定要不要落盘）。 */
export function onTaskEvent(f, event, now, data = {}, count = 1) {
    if (f.id === NPC_ID)
        return false;
    const t = f.task;
    if (!t || !t.accepted || t.completedAt)
        return false;
    const def = defByKind(t.kind);
    if (!def || def.event !== event)
        return false;
    if (def.match && !def.match(data))
        return false;
    if (event === "visit") { // 串门按家去重：同一家只算一次
        const id = String(data.targetId ?? "");
        if (!id)
            return false;
        t.visited ??= [];
        if (t.visited.includes(id))
            return false;
        t.visited.push(id);
    }
    t.progress = Math.min(t.target, t.progress + count);
    if (t.progress >= t.target) {
        if (t.currency === "coin")
            f.coins += t.reward;
        else
            f.silver += t.reward;
        t.completedAt = now;
        f.tasksDone = (f.tasksDone ?? 0) + 1; // 任务称号累计
        bumpDaily(f, now, "tasks"); // 卷王榜（今日完成任务数）
    }
    return true;
}
/** HUD 任务行（农场主页那一行；空串=不显示）。会先推进状态机。 */
export function taskLine(f, now) {
    if (f.id === NPC_ID)
        return "";
    tickTask(f, now);
    const taken = dailyTaken(f, now);
    const t = f.task;
    if (!t)
        return taken >= TASK_DAILY_CAP ? `🎯 今日任务已满 ${TASK_DAILY_CAP}/${TASK_DAILY_CAP}，明天再来` : "";
    if (t.completedAt) {
        const min = Math.max(1, Math.ceil((TASK_COOLDOWN_MS - (now - t.completedAt)) / 60000));
        const tail = `约 ${min} 分钟后刷新下一条（今日 ${taken}/${TASK_DAILY_CAP}）`;
        // 「任务完成」庆祝只在完成后第一次展示；之后冷却期间只显示「约 xx 分钟后刷新」
        if (!t.completedShown) {
            t.completedShown = true;
            return `✅ 任务完成：${describe(t)} ${rewardText(t)}！${tail}`;
        }
        return `⏳ ${tail}`;
    }
    if (t.accepted)
        return `🎯 任务：${describe(t)} ${t.progress}/${t.target} → ${rewardText(t)}`;
    return `🎯 新任务可接：${describe(t)} → ${rewardText(t)}（accept-task 接取后才计数 · 今日 ${taken}/${TASK_DAILY_CAP}）`;
}
/** 当前是否有「可接取」的 offer（给 Agent 页决定要不要出「接取」按钮）。 */
export function hasOpenOffer(f, now) {
    tickTask(f, now);
    const t = f.task;
    return !!t && !t.accepted && !t.completedAt && dailyTaken(f, now) < TASK_DAILY_CAP;
}
/** 给「接取」按钮用的一句话摘要。 */
export function offerSummary(f) {
    return f.task ? `${describe(f.task)}（奖 ${rewardText(f.task)}）` : "";
}
/** 结构化任务视图（farmView/人类前端用；无任务返回 null）。 */
export function taskView(f, now) {
    const t = f.task;
    if (!t)
        return null;
    return { kind: t.kind, desc: describe(t), target: t.target, progress: t.progress, reward: t.reward, currency: t.currency, accepted: t.accepted, completed: !!t.completedAt };
}
//# sourceMappingURL=tasks.js.map