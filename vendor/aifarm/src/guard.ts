// 公网防滥用：按 IP 的滑动窗口限流（零依赖、内存态）。开放无鉴权服务的第一道闸。
import {
  RATE_WINDOW_MS, RATE_MAX_PER_WINDOW, RATE_CREATE_WINDOW_MS, RATE_CREATE_PER_WINDOW,
} from "./config.js";

const hits = new Map<string, number[]>();    // ip → 窗口内的请求时间戳
const creates = new Map<string, number[]>(); // ip → 1 小时内的建农场时间戳

/** 丢弃窗口外的旧时间戳（数组按时间升序） */
function prune(arr: number[], now: number, win: number): number[] {
  let i = 0;
  while (i < arr.length && now - arr[i] >= win) i++;
  return i ? arr.slice(i) : arr;
}

/** 通用请求限流：每 IP 每窗口 RATE_MAX_PER_WINDOW 次。true=放行。超限不再入队，数组长度天然封顶。 */
export function allowRequest(ip: string, now: number): boolean {
  const arr = prune(hits.get(ip) ?? [], now, RATE_WINDOW_MS);
  hits.set(ip, arr);
  if (arr.length >= RATE_MAX_PER_WINDOW) return false;
  arr.push(now);
  return true;
}

/** 建农场限流：每 IP 每小时 RATE_CREATE_PER_WINDOW 座。true=放行。 */
export function allowCreate(ip: string, now: number): boolean {
  const arr = prune(creates.get(ip) ?? [], now, RATE_CREATE_WINDOW_MS);
  creates.set(ip, arr);
  if (arr.length >= RATE_CREATE_PER_WINDOW) return false;
  arr.push(now);
  return true;
}

/** 周期清理空闲 IP，防两个 Map 随陌生 IP 无限增长。 */
export function sweepGuard(now: number): void {
  for (const [ip, arr] of hits) {
    const p = prune(arr, now, RATE_WINDOW_MS);
    if (p.length) hits.set(ip, p); else hits.delete(ip);
  }
  for (const [ip, arr] of creates) {
    const p = prune(arr, now, RATE_CREATE_WINDOW_MS);
    if (p.length) creates.set(ip, p); else creates.delete(ip);
  }
}
