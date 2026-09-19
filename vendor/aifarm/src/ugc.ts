// UGC 自创作物的全局注册表（玩家设计的作物存这里，与官方 content 分开）。
// 仅 type-only 依赖 content，避免运行时循环。
import type { Crop } from "./content.js";

export const ugcById = new Map<string, Crop>();

export function registerUgc(crop: Crop): void {
  ugcById.set(crop.id, crop);
}
export function allUgc(): Crop[] {
  return [...ugcById.values()];
}
/** 当前自创作物总数（全服上限判定用）*/
export function ugcCount(): number {
  return ugcById.size;
}

/** 序列化 / 反序列化（存档用）*/
export function dumpUgc(): Crop[] {
  return allUgc();
}
export function loadUgc(arr: Crop[] | undefined): void {
  ugcById.clear();
  for (const c of arr ?? []) ugcById.set(c.id, c);
}
