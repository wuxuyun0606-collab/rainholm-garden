// 内容加载层：读 content/*.json，建立类型与索引。加内容只改 JSON，不动引擎。
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../content");
const load = (name) => JSON.parse(readFileSync(resolve(DIR, `${name}.json`), "utf8"));
export const crops = load("crops");
export const materials = load("materials");
export const materialById = new Map(materials.map((m) => [m.id, m]));
export const recipes = load("recipes");
export const specialEvents = load("special-events");
export const qualities = load("qualities").sort((a, b) => a.tier - b.tier);
export const landTiers = load("land-tiers").sort((a, b) => a.tier - b.tier);
export const seasons = load("seasons");
export const seasonEvents = load("season-events");
export const festivals = load("festivals");
export const animals = load("animals");
export const pets = load("pets");
export const titles = load("titles");
const ranchItems = load("ranch-items");
export const accessories = ranchItems.accessories;
export const decorations = ranchItems.decorations;
export const accessoryById = new Map(accessories.map((a) => [a.id, a]));
export const decorationById = new Map(decorations.map((d) => [d.id, d]));
export const flavor = load("flavor");
// 🗺️ 探险内容：秘境 / 际遇事件 / 专属装饰（独立于熔炼与可买装饰）
const expeditionData = load("expeditions");
export const expMaps = expeditionData.maps;
export const expEvents = expeditionData.events;
export const expDecorations = expeditionData.decorations;
export const expMapById = new Map(expMaps.map((m) => [m.id, m]));
export const expEventById = new Map(expEvents.map((e) => [e.id, e]));
export const expDecorById = new Map(expDecorations.map((d) => [d.id, d]));
// —— 索引 ——
import { ugcById } from "./ugc.js";
export const cropById = new Map(crops.map((c) => [c.id, c]));
/** 统一查作物：先官方，再 UGC 自创 */
export const getCrop = (id) => cropById.get(id) ?? ugcById.get(id);
export const animalById = new Map(animals.map((a) => [a.id, a]));
export const petById = new Map(pets.map((p) => [p.id, p]));
export const cropsByCategory = (cat) => crops.filter((c) => c.category === cat);
export const totalCropCount = crops.length;
export function seasonByName(name) {
    return seasons.find((s) => s.name === name);
}
export function landTierByLevel(level) {
    return landTiers.find((t) => t.tier === level) ?? landTiers[0];
}
//# sourceMappingURL=content.js.map