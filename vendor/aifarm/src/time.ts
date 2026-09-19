// 时间：游戏内加速季节 + 真实公历节日判定。
import { TICK_MS, TZ, SEASON_LENGTH_TICKS } from "./config.js";
import { seasons, festivals, type Season, type Festival } from "./content.js";

/** 游戏内加速季节（随真实时间推进，与真实季节无关） */
export function currentSeason(now: number): Season {
  const totalTicks = Math.floor(now / TICK_MS);
  const idx = Math.floor(totalTicks / SEASON_LENGTH_TICKS) % seasons.length;
  return seasons[idx];
}

/** 取当前时区的 月/日/时 */
function nowParts(now: number): { month: number; day: number; hour: number } {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date(now));
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return { month: get("month"), day: get("day"), hour: get("hour") % 24 };
}

/** 解析 "M/D-M/D" 公历窗口；非公历（农历/计算式）返回 null（v1 不支持） */
function gregorianWindow(s: string): { sm: number; sd: number; em: number; ed: number } | null {
  const m = s.match(/(\d+)\/(\d+)\s*-\s*(\d+)\/(\d+)/);
  if (!m) return null;
  return { sm: +m[1], sd: +m[2], em: +m[3], ed: +m[4] };
}

function inWindow(month: number, day: number, w: NonNullable<ReturnType<typeof gregorianWindow>>): boolean {
  const cur = month * 100 + day;
  const start = w.sm * 100 + w.sd;
  const end = w.em * 100 + w.ed;
  return start <= end ? cur >= start && cur <= end : cur >= start || cur <= end; // 跨年
}

/** 当前进行中的公历节日（v1 只认 M/D-M/D 窗口的；农历的暂不触发） */
export function activeFestivals(now: number): Festival[] {
  const { month, day } = nowParts(now);
  return festivals.filter((f) => {
    const w = gregorianWindow(f.dateWindow);
    return w ? inWindow(month, day, w) : false;
  });
}

/** 当前小时（时区），给时辰类机制用 */
export function currentHour(now: number): number {
  return nowParts(now).hour;
}

/** UTC+8 日序号（Asia/Shanghai 无夏令时，直接偏移 8h 取整即可）。给「连续天数」「每日确定性 roll」用。 */
export function currentDayIndex(now: number): number {
  return Math.floor((now + 8 * 3600 * 1000) / 86400000);
}
