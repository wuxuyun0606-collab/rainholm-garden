// 内容加载层：读 content/*.json，建立类型与索引。加内容只改 JSON，不动引擎。
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { ExpMap, ExpEvent, ExpDecoration } from "./types.js";

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../content");
const load = <T>(name: string): T => JSON.parse(readFileSync(resolve(DIR, `${name}.json`), "utf8"));

export type Category = "common" | "fantasy" | "limited" | "ugc";
export type Rarity = "N" | "R" | "SR" | "SSR" | "SP" | "OR";

export interface Crop {
  id: string;
  name: string;
  latin: string;
  desc: string;
  category: Category;
  rarity: Rarity;
  growTicks: number;
  water: number | null;
  seedPrice: number;
  sellPrice: number;
  family: string | null;
  /** 解锁品阶：土地 ≥ 此值才进抽卡池（按品种解锁，不卡稀有度）。限定为 null。 */
  unlockTier?: number | null;
  mechanicText: string | null;
  mechanicStatus: "active" | "approx" | "dormant";
  mechanicSystem: string | null;
  // common
  availability?: "allyear" | "cross" | "single";
  seasons?: string | null;
  // fantasy
  fantasyType?: string;
  // limited
  unlockType?: "festival" | "timewindow" | "codex" | "action" | "craft";
  unlockCond?: string;
  /** 机器可判定的解锁规则（计数/土地/夜间商店类用；festival/craft 不需要）。
   *  kind: codexCount|codexPct|landMax|nightShop */
  unlockRule?: { kind: string; n?: number; chance?: number };
  /** 是否可被熔炼随机撞出（默认 true；带真实解锁条件的限定设 false，移出熔炼池）*/
  craftable?: boolean;
  produce?: string | null;
  /** UGC：设计者名（自创作物专用，展示用）*/
  designer?: string;
  /** UGC：设计者农场 id（稳定身份，用于"不能举报自己"等判定）*/
  designerId?: string;
  /** SSR/SP 作物的额外稀有叙事（收获仪式里展示，DS 填）*/
  lore?: string;
  /** 限定作物专属「下种台词」（种植时展示；没填则回落到通用限定句池）*/
  plantLine?: string;
  /** UGC：累计被买件数（参考；热门榜不再用它，改用 buyers 去重）*/
  sales?: number;
  /** UGC：买过的农场 id 列表（去重）——热门榜按「多少人买过」排，防跨农场对敲刷量 */
  buyers?: string[];
  /** UGC：举报者农场 id 列表（去重）*/
  reportedBy?: string[];
  /** UGC：被举报达阈值后下架 */
  banned?: boolean;
  /** UGC：是否曾经上架过（上架即置 true）。 */
  listed?: boolean;
}

export interface Quality {
  tier: number;
  name: string;
  sizeRange: string;
  priceFactor: number;
  lines: string[];
}
export interface LandTier {
  tier: number;
  name: string;
  plots: number;
  maxRarity: Rarity;
  upgradeCost: string | null;
  achieveText: string;
}
export interface Season {
  name: string;
  desc: string;
  ambience: string[];
  topCrops: string[];
  shopBias: string;
}
export interface Festival {
  name: string;
  dateWindow: string;
  cropId: string;
  enterText: string;
  harvestText: string;
  ambience: string;
}
export interface Animal {
  id: string;
  name: string;
  desc: string;
  category: string;
  produce: string;
  produceEveryTicks: number;
  producePrice: number;
  buyCost: number;
  /** 可选 emoji：能配上才填（如 🐔🐷🐮）；奇幻动物配不到就留空，展示处只显示名字、不强塞图标 */
  emoji?: string;
  /** AI 开场看到的动物现身描述（含 {acc} 占位，填入伴侣买的衣服/配饰）*/
  roam: string;
  /** 解锁门槛：AI 官方图鉴集齐这么多种，动物才在商店上架（0=开局即有；图鉴收集进度卡人的动物解锁）*/
  unlockCodex: number;
  /** 解锁条件人读文案（展示用）*/
  unlockCond: string | null;
}
/** 宠物（AI 买、归伴侣养，不产出、可改名，给农场一份温和 buff）。解锁同动物：官方图鉴集齐 unlockCodex 种。 */
export interface Pet {
  id: string;
  name: string;
  emoji: string;
  desc: string;
  /** 加成类型：luck=招财（稀有/掉落微涨）/ guard=看家（防偷）*/
  buff: "luck" | "guard";
  /** 加成数值（放 JSON 好调，不用 build）：luck=收获额外运气、dropMult=素材/药水掉落倍率、foil=偷菜被吓退概率 */
  params: { luck?: number; dropMult?: number; foil?: number };
  /** 商店一行用的短标签（如"招财·稀有/掉落微涨"）*/
  tag: string;
  /** 加成的人读说明（shop 展开/前端展示用）*/
  buffText: string;
  buyCost: number;
  unlockCodex: number;
  unlockCond: string | null;
  /** 随机现身氛围句池（含 {name}=宠物名、{acc}=穿戴前缀；DS 可继续扩写）*/
  roam: string[];
}
/** 牧场可买的衣服/配饰（伴侣花牧场金币给动物买，改写 AI 看到的现身描述）*/
export interface Accessory { id: string; name: string; desc: string; price: number; }
/** 牧场可买的农场装饰物（伴侣买，别人 visit 时展示）*/
export interface Decoration { id: string; name: string; price: number; visitLine: string; }
export interface FlavorPool {
  water: { owner: string[]; visitor: string[] };
  steal: { thiefByRarity: Record<string, string>; victim: string[] };
  ambient: Record<string, string[]>;
}

export interface Material {
  id: string;
  name: string;
  rarity: string;
  desc: string;
}
export interface Recipe {
  materials: string[]; // 隐藏配方：这组素材熔出 output
  output: string; // 限定作物 id
  hint: string;
}
export interface BonusEvent {
  id: string;
  name: string;
  effectType: string; // 倍率 / 额外金币 / 品相保底 / 连收
  param: string;
  weight: number;
  text: string;
}

/** 季节随机事件：进农场(status)或收获(harvest)时按概率触发，配一个瞬发增益/减益。文案 DS 填、机制见 season-events.ts。 */
export interface SeasonEvent {
  id: string;
  /** 触发季节：春/夏/秋/冬，或 "any"=四季通用 */
  season: string;
  name: string;
  /** 触发时机：harvest=随收获结算(作用于这批) / status=随进农场即时改农场状态 */
  trigger: "harvest" | "status";
  /** 仅分类展示：buff/debuff */
  polarity: string;
  /** 同触发池内相对权重 */
  weight: number;
  /** 触发前置条件：ripe(有熟)/growing(有在长)/empty(有空地)/potion(有药水)/coins100(金币≥100)/none */
  requires?: string;
  /** 机器执行的效果（type 见 season-events.ts）*/
  effect: { type: string; value?: number; n?: number; ticks?: number };
  /** 触发时随机抽一条的氛围句 */
  lines: string[];
}

export const crops = load<Crop[]>("crops");
export const materials = load<Material[]>("materials");
export const materialById = new Map(materials.map((m) => [m.id, m]));
export const recipes = load<Recipe[]>("recipes");
export const specialEvents = load<{ bonus: BonusEvent[]; dropIntros: string[] }>("special-events");
export const qualities = load<Quality[]>("qualities").sort((a, b) => a.tier - b.tier);
export const landTiers = load<LandTier[]>("land-tiers").sort((a, b) => a.tier - b.tier);
export const seasons = load<Season[]>("seasons");
export const seasonEvents = load<SeasonEvent[]>("season-events");
export const festivals = load<Festival[]>("festivals");
export const animals = load<Animal[]>("animals");
export const pets = load<Pet[]>("pets");

/** 称号定义（content/titles.json）：达到某指标 field≥min 即解锁；name/flavor 是展示文案。 */
export interface TitleDef { id: string; cat: string; tier: number; field: string; min: number; name: string; flavor: string }
export const titles = load<TitleDef[]>("titles");
const ranchItems = load<{ accessories: Accessory[]; decorations: Decoration[] }>("ranch-items");
export const accessories = ranchItems.accessories;
export const decorations = ranchItems.decorations;
export const accessoryById = new Map(accessories.map((a) => [a.id, a]));
export const decorationById = new Map(decorations.map((d) => [d.id, d]));
export const flavor = load<FlavorPool>("flavor");

// 🗺️ 探险内容：秘境 / 际遇事件 / 专属装饰（独立于熔炼与可买装饰）
const expeditionData = load<{ maps: ExpMap[]; events: ExpEvent[]; decorations: ExpDecoration[] }>("expeditions");
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
export const getCrop = (id: string): Crop | undefined => cropById.get(id) ?? ugcById.get(id);
export const animalById = new Map(animals.map((a) => [a.id, a]));
export const petById = new Map(pets.map((p) => [p.id, p]));
export const cropsByCategory = (cat: Category) => crops.filter((c) => c.category === cat);
export const totalCropCount = crops.length;

export function seasonByName(name: string): Season | undefined {
  return seasons.find((s) => s.name === name);
}
export function landTierByLevel(level: number): LandTier {
  return landTiers.find((t) => t.tier === level) ?? landTiers[0];
}
