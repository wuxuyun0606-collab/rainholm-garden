// 每日榜单计数：按 UTC+8 日序号在农场上累加当日事件数，跨日自动归零。
// 存档字段 farm.daily（见 types.ts）；bumpDaily 只改内存，落盘由调用方 save() 负责。
import { currentDayIndex } from "./time.js";
/** 取（必要时重建）当日计数器：跨日或首次调用则整体归零。 */
function ensureDaily(f, day) {
    if (!f.daily || f.daily.day !== day)
        f.daily = { day, logins: 0, tasks: 0, messages: 0, events: 0 };
    return f.daily;
}
/** 当日某项 +n（默认 1）；跨日先归零。调用方负责 save()。 */
export function bumpDaily(f, now, key, n = 1) {
    ensureDaily(f, currentDayIndex(now))[key] += n;
}
/** 生成「按某日打分」的取值函数（不写存档；非当日=0）。给排行榜 top()/rankOf 用。 */
export function dailyScore(today, key) {
    return (f) => (f.daily && f.daily.day === today ? f.daily[key] : 0);
}
//# sourceMappingURL=daily.js.map