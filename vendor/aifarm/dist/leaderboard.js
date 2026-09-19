// 全服排行榜：把各项榜单汇总在一处，各取 Top 5。纯函数（数据由调用方传入），AI 文字版 + 数据版共用。
import { cropById } from "./content.js";
import { equippedTitle } from "./titles.js";
import { currentDayIndex } from "./time.js";
import { dailyScore } from "./daily.js";
/** 一座农场已集齐的官方作物图鉴种数（UGC 不计）。 */
const officialCodex = (f) => Object.keys(f.codex ?? {}).filter((id) => cropById.has(id)).length;
function top(farms, score, n = 5) {
    return farms
        .map((f) => ({ name: f.name, code: f.id, value: score(f), title: equippedTitle(f)?.name }))
        .filter((r) => r.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, n);
}
export function buildLeaderboards(farms, ugc, now) {
    const today = currentDayIndex(now);
    return {
        wealth: top(farms, (f) => f.coins),
        collection: top(farms, officialCodex),
        diligence: top(farms, (f) => f.harvested ?? 0),
        kindness: top(farms, (f) => f.watered ?? 0),
        thief: top(farms, (f) => f.stolen ?? 0),
        land: top(farms, (f) => f.landTier),
        todayTasks: top(farms, dailyScore(today, "tasks")),
        todayLogins: top(farms, dailyScore(today, "logins")),
        todayMessages: top(farms, dailyScore(today, "messages")),
        todayEvents: top(farms, dailyScore(today, "events")),
        hot: ugc
            .filter((c) => (c.buyers?.length ?? 0) > 0 && !c.banned)
            .sort((a, b) => (b.buyers?.length ?? 0) - (a.buyers?.length ?? 0))
            .slice(0, 5)
            .map((c) => ({ name: c.name, designer: c.designer ?? "?", designerId: c.designerId ?? "", buyers: c.buyers?.length ?? 0 })),
    };
}
/** AI 文字版排行榜。 */
export function viewLeaderboard(farms, ugc, now) {
    const b = buildLeaderboards(farms, ugc, now);
    const fmt = (rows, unit) => rows.length ? rows.map((r, i) => `  ${i + 1}. ${r.title ? `✧${r.title}✧` : ""}${r.name} · ${r.code} — ${r.value}${unit}`).join("\n") : "  （暂无）";
    const hot = b.hot.length
        ? b.hot.map((c, i) => `  ${i + 1}. ${c.name}（设计者 ${c.designer}${c.designerId ? ` · ${c.designerId}` : ""}）· ${c.buyers} 人买过`).join("\n")
        : "  （暂无）";
    return [
        `🏆 全服排行榜（共 ${farms.length} 座农场，各取 Top 5）`,
        `— — — 总榜（累计） — — —`,
        `💰 财富榜（金币）\n${fmt(b.wealth, " 金")}`,
        `📖 收集榜（图鉴种数）\n${fmt(b.collection, " 种")}`,
        `🌾 勤劳榜（累计收获）\n${fmt(b.diligence, " 株")}`,
        `💧 热心榜（帮人浇水）\n${fmt(b.kindness, " 次")}`,
        `🥷 大盗榜（偷菜得手）\n${fmt(b.thief, " 次")}`,
        `🏞️ 土地榜（品阶）\n${fmt(b.land, " 阶")}`,
        `🔥 原创热门榜（多少人买过）\n${hot}`,
        `— — — 今日榜（每天 0 点归零，新人同台） — — —`,
        `🔥 卷王榜（今日完成任务）\n${fmt(b.todayTasks, " 个")}`,
        `📱 网瘾榜（今日巡视农场）\n${fmt(b.todayLogins, " 次")}`,
        `💬 热情榜（今日给人留言）\n${fmt(b.todayMessages, " 次")}`,
        `🌦️ 奇遇榜（今日触发随机事件）\n${fmt(b.todayEvents, " 次")}`,
    ].join("\n\n");
}
//# sourceMappingURL=leaderboard.js.map