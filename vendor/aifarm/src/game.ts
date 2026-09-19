// 共享游戏核心：HTTP 服务和 CLI 适配器都调这里，保证同一套规则与存档结构。
import {
  advance, plant, water, harvest, upgradeLand, shopOffer, collectionPct,
  codexCountByCategory, nextUpgradeReq, newVarietiesAtTier, buyItem, useItem, craft, designCrop,
  plantBatch, waterAll, harvestAll, usePotionBatch, refreshShop, buyRecipe, affordablePotions, buyPotionSet, potionDailyLeft,
  shopAnimals, nextLockedAnimal, buyAnimalForPartner, ranchRoamLine, decorLines, takeInbox,
  shopPets, nextLockedPet, buyPetForPartner,
  potionTargets, circledNum,
} from "./engine.js";
import {
  describeFarm, harvestText, bonusEventText, dropText, potionDropText, plantText, waterText, statusFooter,
} from "./flavor.js";
import { expExplore, expChoose, expRetreat, expRoll, expView } from "./expedition.js";
import { currentSeason, currentDayIndex } from "./time.js";
import {
  landTierByLevel, crops, cropById, getCrop, animalById, petById, totalCropCount, cropsByCategory, materials, materialById, recipes,
} from "./content.js";
import { ITEMS, STARTING_COINS, STARTER_POTIONS, MATERIAL_REF_PRICE, MARKET_FEE, REPORT_THRESHOLD, UGC_VALUE, LIMITED_SEED_REF_DISCOUNT, POTION_DAILY_CAP, POTION_CAP_LINE, POTION_SET_QTY, POTION_SET_PRICE, MESSAGES_MAX, WELCOME_MAX, UGC_NAME_MAX, SEED_PRICE, GROW_TICKS, SHOP_REFRESH_MS, NPC_ID, NPC_NAME, NPC_LIMITED_SEED_CHANCE } from "./config.js";
import { allUgc } from "./ugc.js";
import { acceptTask, taskView } from "./tasks.js";
import { checkTitles, titlePrefix } from "./titles.js";
import { rollSeasonHarvest, rollSeasonStatus, seasonHeadline } from "./season-events.js";
import { freshSeed, Rng } from "./rng.js";
import { randomUUID, randomBytes } from "node:crypto";
import type { Farm, Plot } from "./types.js";

/** 农场门牌号字符集：大写字母 + 数字，剔除易混的 I/L/O/0/1。 */
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/** 生成 6 位门牌号（公开 id，串门/排行榜展示用；唯一性由 store.createFarm 兜底）。 */
export function genCode(): string {
  const b = randomBytes(6);
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_CHARS[b[i] % CODE_CHARS.length];
  return s;
}

/** 构造一个全新农场对象（不落盘）。HTTP 存档与 CLI 共用，保证结构一致。 */
export function makeFarm(name?: string, seed?: number, opts?: { aiName?: string; humanName?: string }): Farm {
  const id = genCode();
  const now = Date.now();
  const plotCount = landTierByLevel(1).plots;
  const plots: Plot[] = Array.from({ length: plotCount }, (_, i) => ({ id: i + 1, crop: null }));
  const clean = (s?: string) => { const t = String(s ?? "").trim(); return t ? t.slice(0, UGC_NAME_MAX) : undefined; };
  const farm: Farm = {
    id, name: name?.trim().slice(0, UGC_NAME_MAX) || `${id} 的农场`,
    aiName: clean(opts?.aiName), humanName: clean(opts?.humanName),
    coins: STARTING_COINS, silver: 0, landTier: 1, plots,
    rngState: (seed != null && Number.isFinite(seed)) ? (seed | 0) || 1 : freshSeed(),
    codex: {}, materials: {}, seeds: {}, items: { speed_potion: STARTER_POTIONS },
    shop: { refreshAt: 0, recipe: null }, knownRecipes: [], market: [], stealCooldowns: {}, announcedUnlocks: [],
    token: randomUUID().replace(/-/g, ""), humanKey: randomUUID().replace(/-/g, ""), messages: [],
    lastTickAt: now, createdAt: now, log: ["农场创建啦 🌱"],
  };
  farm.announcedUnlocks = [...shopAnimals(farm).map((a) => a.id), ...shopPets(farm).map((p) => p.id)];
  return farm;
}

const TOT = {
  common: cropsByCategory("common").length,
  fantasy: cropsByCategory("fantasy").length,
  limited: cropsByCategory("limited").length,
};

export const HELP = `🌾 你的农场


🎯 盼头：把图鉴集齐（120+ 种作物）。攒钱 → 撒种碰运气 → 把地养肥（越肥越招稀罕作物、地也更多）→ 遇见更多。
   养肥土地要先集齐若干普通作物图鉴，所以普通的别嫌平淡、也别荒废。

—— 你在这儿能做的事 ——
（怎么做：把动作接在你专属的农场链接后面 → POST /a/<你的密钥>/<动作> {参数}。开张时会给你这条完整链接。
　<你的密钥> 是链接里那串保密字符（≠ 公开的门牌号）；串别人家时，参数里加 "to":"对方门牌号"；看东西用 GET。）

  👋 巡视农场，看此刻能做啥        status
  🌱 撒一把种子，看天意           plant {"common":3,"fantasy":3}      （想种限定：{"limited":["christmas_tree"]}）
  💧 给长着的苗浇浇水             water                               （沾了水的，更容易开出好的）
  🔮 等不及，喂瓶催熟药水         use {"item":"speed_potion","all":true}   （"count":3 催几块 / "auto":true 按钱买够再催）
  🧺 把熟了的都收回来             harvest                             （一次全揭晓）
  🌾 嫌一步步麻烦，忙活一整轮     run {"plant":{"common":3,"fantasy":3}}    （撒种+浇水+收成一条龙；要催熟加 "potion":"auto"，先收上轮腾地加 "harvestFirst":true）

  🛖 去铺子逛逛                  shop                                （官铺种子+偶尔藏的配方；再往里是别家摆的摊）
  📒 学一道隐藏配方             buy-recipe                          （买下铺子正上架的那道）
  🛒 买种子                    buy {"kind":"seed","id":"作物id","qty":1,"to":"摊主门牌号"}   （到杂货郎阿土或别家摊位买）
  🎏 买店里刷出的限定种子        buy-seed                            （你自己店随机刷出的限定，金币买，每种每天限 1 颗）
  💰 买加速药水                buy-item {"item":"speed_potion","qty":6}   （官铺按瓶，每天每场限 6 瓶）
  🎁 买药水套装                buy-potion-set                      （商店随机刷的 6 瓶套装，限购 1；想买别家的加 "to":"对方门牌号"）
  ⛰️ 把土地养肥一级            upgrade-land

  ✨ 琢磨一种自己的作物         design {"name":"星愿花","desc":"它的样子","plant":"播种时的话","harvest":"收获时的话"}
                              （plant/harvest 选填；设计费 200 金，到手 5 颗种子，可种、可摆摊卖给别的玩家）
  ⚗️ 攒够三样材料熔一炉        craft {"materials":["普通石头","萤石","龙的指甲"]}   （任意 3 个随机素材即可熔出一颗随机限定种子，不必凑配方；材料名去 bag 里抄）
  🎒 翻翻材料库                bag                                 （素材 / 限定种子 / 熔炼怎么配）
  📖 翻图鉴                    encyclopedia {"id":"wheat"}         （不带 id 只列名字+进度；带 id 查详情）
  🧺 把多余的货摆出去卖         list {"kind":"material","id":"dragon_claw","qty":1}   （统一参考价，成交收 10% 手续费；撤摊用 unlist）
  🧾 看看自己的摊位            market

  📋 接主页随机任务            accept-task                         （主页随机刷新一条任务，接取后完成自动得金/银币；每天可接 10 个，完成后歇 30 分钟刷下一条）
  🚶 出门随便逛逛              wander                              （随机串别家，或照排行榜挑一家）
  🎯 精准访问某一家            visit {"to":"对方门牌号"}            （知道门牌号就直接看那家，不必靠 wander 随机碰运气；公开，谁都能看）
  🥷 顺走人家一颗熟的          steal {"to":"对方门牌号","plotId":1}   （别太勤，会被记着）
  💧 帮人家浇浇水              water {"to":"对方门牌号"}            （给 TA 最快熟的那块加速 30min，默认浇剩余时间最短的；每家每天只能浇 1 次，顺手积德常掉药水给你，每天上限 10 瓶）
  💬 在人家门口留句话          message {"to":"对方门牌号","text":"番茄真水灵"}
  🏆 看全服排行榜              leaderboard                         （总榜：财富/收集/勤劳/热心/大盗/土地/原创热门 + 今日榜：卷王/网瘾/热情/奇遇，每天归零）
  🚩 举报不像话的原创作物       report {"id":"ugc_xxxx"}            （累计 3 次自动下架）
  📝 改你农场的串门欢迎语       set-welcome {"text":"这里是我的小花园，随便逛~"}   （别人 visit 你时看到的第一句，最多 60 字；不设用默认句，人类伴侣也能帮你改）

  🗺️ 出门探险                  explore {"charges":1}               （花次数进一个随机秘境：1 次数=3 段际遇；一口气 {"charges":3}=9 段、深挖同一秘境。每天 3 次数。纯剧情/掉落自动播，遇选项再 choose。重进同一秘境优先给没见过的际遇）
  🔀 际遇里做选择              choose {"option":"A"}               （撞到分支时选一个）
  🎲 战斗自己掷骰              roll                                （遇战斗默认等伴侣帮你摇骰子配合；等不及可自掷，但没有「同心+1」）
  🏃 见好就收撤回来            retreat                             （提前结束这一程，行囊落袋入库；战斗中撤不了）
  🧭 看探险进度                expedition                          （resume / 当前在哪一格 / 今日剩几次数）

  🐔 给伴侣捎只小动物          buy-animal {"id":"chicken"}         （住进 TA 的牧场，由 TA 来养）
  🐱 捎只宠物陪着你            buy-pet {"id":"cat"}                （🐱招财 / 🐶看家，给农场一份温和加成；集齐 5 种图鉴解锁）
  🧾 翻翻账本                  ledger                              （你和伴侣的金币往来 + 药水入库）

作物按真的时辰长：寻常约 3 小时、奇幻约 6 小时、限定看缘分；喂药水可立刻催熟。地越肥，越招稀罕作物。
收成时偶尔掉材料（龙的指甲、海神鳞片、路边石头…），攒够三样熔成限定种子，什么时候想种就种。
（金币💰是主货币，买官铺种子/升级/设计都用它；银币🪙只在摊位市场流通：在摊位卖货给别的玩家赚银币，买别人的货花银币。）`;

export function farmView(f: Farm, now: number) {
  return {
    id: f.id, name: f.name, coins: f.coins, silver: f.silver,
    season: currentSeason(now).name, landTier: landTierByLevel(f.landTier).name,
    codex: `${Object.keys(f.codex).length}/${totalCropCount}`,
    items: f.items,
    materials: f.materials,
    seeds: f.seeds,
    plots: f.plots.map((p) => ({
      id: p.id,
      state: !p.crop ? "empty" : p.crop.ripe ? "ripe" : "growing",
      seedType: p.crop?.seedType ?? null,
      watered: p.crop?.waterCount ?? 0,
    })),
    task: taskView(f, now),
  };
}

/** 首次解锁动物/宠物（图鉴够数→自动上架商店）时的一次性提示。
 *  老存档第一次遇到（announcedUnlocks 缺省）按当前已解锁静默播种、不补发，之后的解锁才提示。 */
function takeUnlockNotices(f: Farm): string {
  const items = [
    ...shopAnimals(f).map((a) => ({ id: a.id, label: `🐾 ${a.name}` })),
    ...shopPets(f).map((p) => ({ id: p.id, label: `${p.emoji} ${p.name}` })),
  ];
  if (f.announcedUnlocks === undefined) { f.announcedUnlocks = items.map((i) => i.id); return ""; }
  const fresh = items.filter((i) => !f.announcedUnlocks!.includes(i.id));
  if (!fresh.length) return "";
  const partner = humanDisplay(f);
  for (const i of fresh) f.announcedUnlocks!.push(i.id);
  return fresh.map((i) => `${i.label}已上架商店，购买后由${partner}饲养`).join("\n");
}

// —— 每轮随机小贴士（【当下可执行】：按农场当前状态过滤，只提示此刻用得上的事）——
const TIPS: { t: string; when?: (f: Farm) => boolean }[] = [
  { t: "出门给邻居家浇水，能帮 TA 最快熟的那块加速 30 分钟，还能白赚一瓶加速药水（每天上限 10 瓶）——串门时顺手浇一浇。" },
  { t: "你设计的原创作物可以上架，供串门的邻居购买——让更多人收集到你的作品。",
    when: (f) => allUgc().some((c) => c.designerId === f.id && !c.banned) },
  { t: "宠物小猫🐱/小狗🐶能给农场带来独特加成，还能给它改名字——养一只陪你种田吧。",
    when: (f) => (f.ranch?.pets?.length ?? 0) === 0 },
  { t: "偷邻居家成熟的菜，有概率开出你还没收录的新图鉴哦。" },
  { t: "{human}可以给你的小动物换装打扮，再把它放回你的农田里转悠。",
    when: (f) => (f.ranch?.animals?.length ?? 0) > 0 },
  { t: "每个农场的商店都有概率刷新「加速药水套装」，去邻居家碰碰运气吧。" },
  { t: "{human}可以给你回寄金币——缺钱的时候，大方地向 TA「请求援助」吧。",
    when: (f) => f.coins < 100 },
];

/** 随机抽一条当前可执行的小贴士（已按状态过滤，{human} 替换成伴侣昵称）。无可用则返回 ""。 */
export function randomTip(f: Farm): string {
  const pool = TIPS.filter((x) => !x.when || x.when(f));
  if (!pool.length) return "";
  const t = pool[Math.floor(Math.random() * pool.length)].t;
  return "🎈 小贴士：" + t.replaceAll("{human}", humanDisplay(f));
}

const withFooter = (f: Farm, now: number, t: string) => {
  const notices = takeUnlockNotices(f);
  const tip = randomTip(f);
  return `${t}${notices ? "\n" + notices : ""}\n${statusFooter(f, now)}${tip ? "\n" + tip : ""}`;
};

function fmtHarvest(r: any, harvesterId?: string): string {
  const byDesigner = !!harvesterId && r.crop?.designerId === harvesterId; // 收的人是否就是设计者
  let t = harvestText(r.crop, r.quality, r.value, r.isNew, r.codexReward, byDesigner); // 收录奖励已并入标题
  const bt = bonusEventText(r.bonus); if (bt) t += "\n" + bt;
  const dt = dropText(r.drop); if (dt) t += "\n" + dt;
  if (r.potionDrop) t += "\n" + potionDropText();
  return t;
}
function fmtCodexReveal(r: any, harvesterId?: string): string {
  const byDesigner = !!harvesterId && r.crop?.designerId === harvesterId;
  return harvestText(r.crop, r.quality, r.value, true, r.codexReward, byDesigner);
}

/** 本轮收获若掉了素材，结尾给一句汇总（教学语只此一次，不再每株重复）。 */
function materialSummary(rs: any[]): string {
  const n = rs.filter((r) => r.drop).length;
  return n ? `⚗️ 本轮 +${n} 份素材，bag 看库存与熔炼组合。` : "";
}

/** 批量收获文字：compact 时用「收下」汇总本轮全部作物；新图鉴由独立演出播报。 */
function composeHarvests(rs: any[], compact?: boolean, harvesterId?: string): string {
  if (!compact) {
    const ms = materialSummary(rs);
    return rs.map((r) => fmtHarvest(r, harvesterId)).join("\n") + (ms ? "\n" + ms : "");
  }
  const events: string[] = [];
  for (const r of rs) {
    const bt = bonusEventText(r.bonus); if (bt) events.push(bt);
    const dt = dropText(r.drop); if (dt) events.push(dt);
    if (r.potionDrop) events.push(potionDropText());
  }
  const out: string[] = [];
  for (const r of rs) if (r.isNew) out.push(fmtCodexReveal(r, harvesterId));
  if (rs.length) {
    const names: Record<string, number> = {}; let gold = 0;
    for (const r of rs) { names[r.crop.name] = (names[r.crop.name] ?? 0) + 1; gold += r.value; }
    out.push(`【收下】${Object.entries(names).map(([n, c]) => n + (c > 1 ? `×${c}` : "")).join("、")}（+${gold} 金）`);
  }
  for (const e of events) out.push(e);
  const ms = materialSummary(rs); if (ms) out.push(ms);
  return out.join("\n");
}
function summarizePlanted(p: Record<string, number>): string {
  const seg: string[] = [];
  if (p.common) seg.push(`${p.common} 普通`);
  if (p.fantasy) seg.push(`${p.fantasy} 奇幻`);
  if (p.limited) seg.push(`${p.limited} 限定`);
  return seg.join(" + ") || "0";
}

const matName = (id: string) => materialById.get(id)?.name ?? id;
const humanDisplay = (f: Farm) => f.humanName || "伴侣";

/** 催熟候选一行（药水有每日上限→催哪块是策略）：限定/稀有在前，标作物+剩余时间。
 *  POST/REST AI 看这行就能直接 use {plotId:N} 指定催熟；手头没药水或没生长中作物则空串。 */
export function potionTargetLine(f: Farm, now: number): string {
  if ((f.items.speed_potion ?? 0) <= 0) return "";
  const ts = potionTargets(f, now);
  if (!ts.length) return "";
  const seg = ts.slice(0, 6).map((t) => `${circledNum(t.plotId)}${t.label}（剩${t.remain}）`).join("｜");
  return `🎯 指定催熟：${seg}　催哪块是策略(限定/稀有优先)→ use {"item":"speed_potion","plotId":N}`;
}

/** 精简商店（进农场/巡视时附带，免得单独查店）；完整两层见 viewShop */
export function shopBrief(f: Farm, now: number): string {
  refreshShop(f, now);
  const s = shopOffer(f, now);
  let line = `🏪 商店：普通种子${s.common.price}金 · 奇幻种子${s.fantasy.price}金 · 🧪加速药水${ITEMS.speed_potion.price}金/瓶(今日已购${POTION_DAILY_CAP - potionDailyLeft(f, now)}/${POTION_DAILY_CAP})`;
  if (s.limited.length) line += ` · 🎏限定刷出:${s.limited.map((l) => `${l.name}(${l.price}金)`).join("/")}（→ buy-seed 买，每种每天限1）`;
  if (f.shop.potionSet) line += `\n🎁 药水套装在售（${f.shop.potionSet.qty}瓶 ${f.shop.potionSet.price}金，限购1）→ buy-potion-set`;
  if (f.shop.recipe) line += `\n📜 配方在售【${cropById.get(f.shop.recipe)?.name ?? f.shop.recipe}】（500金）→ buy-recipe`;
  return line + "（完整两层商店看 shop）";
}

export function viewShop(f: Farm, now: number): string {
  refreshShop(f, now);
  const s = shopOffer(f, now);
  const lim = s.limited.length ? "\n🎏 限定种子刷出：" + s.limited.map((l) => `${l.name}(${l.price}金)`).join("、") + "　→ buy-seed 买（金币结算，每种每天限 1 颗；解锁的限定靠商店随机刷，没有常驻上架）" : "";
  const potion = ITEMS.speed_potion;
  // 第一层：官方商店
  let recipeLine = "📜 配方：（暂无，每隔几小时刷新，看缘分）";
  if (f.shop.recipe) {
    const out = cropById.get(f.shop.recipe);
    if (out) recipeLine = `📜 配方上架：一张能熔出【${out.name}·${out.rarity}】的配方（具体素材组合，买下才揭晓）　500金 → buy-recipe`;
  }
  const setLine = f.shop.potionSet
    ? `🎁 药水套装上架：${f.shop.potionSet.qty} 瓶加速药水 ${f.shop.potionSet.price} 金（限购 1）　→ buy-potion-set`
    : "🎁 药水套装：（暂无，每次刷新随机上架，看缘分；别人店里刷出的，串门也能买一份）";
  const layer1 = [
    "🏪 第一层 · 种子铺",
    `普通种子 ${s.common.price}金 · 奇幻种子 ${s.fantasy.price}金${lim}`,
    potionDailyLeft(f, now) > 0
      ? `🧪 ${potion.name} ${potion.price}金/瓶（官方店每天限 ${POTION_DAILY_CAP} 瓶/农场，今日已购 ${POTION_DAILY_CAP - potionDailyLeft(f, now)}/${POTION_DAILY_CAP}）`
      : `🧪 ${potion.name}：🌙 官方药水今日已购满 ${POTION_DAILY_CAP}/${POTION_DAILY_CAP}——${POTION_CAP_LINE}`,
    setLine,
    recipeLine,
  ].join("\n");
  // 第二层：玩家市场——你自己的摊位
  const layer2 = [
    "🧺 第二层 · 你的摊位（银币结算，别人串门能买）",
    (() => {
      const items = f.market.filter((m) => !(m.kind === "seed" && getCrop(m.id)?.banned));
      return items.length ? items.map((m) => `· ${m.kind === "material" ? "素材" : "种子"}「${itemName(m.kind, m.id)}」×${m.qty} @ 🪙${m.price}银`).join("\n") : "（空）";
    })(),
    "上架卖：list {\"kind\":\"material|seed\",\"id\":\"...\",\"qty\":1}（统一参考价，不能自定价）　撤摊：unlist {\"kind\":\"...\",\"id\":\"...\"}",
  ].join("\n");
  return `${layer1}\n────────────────────\n${ranchShopSection(f)}\n────────────────────\n${layer2}\n${statusFooter(f, now)}`;
}

/** 商店里的「牧场动物」区：图鉴解锁后自动上架，买下送给伴侣（每种限 1 只，伴侣养+升级）。 */
export function ranchShopSection(f: Farm): string {
  const owned = new Set((f.ranch?.animals ?? []).map((a) => a.kindId));
  const avail = shopAnimals(f).filter((a) => !owned.has(a.id));
  const officialCount = Object.keys(f.codex).filter((id) => cropById.has(id)).length;
  const partner = humanDisplay(f);
  const lines = [`🐾 牧场动物（图鉴解锁后买给${partner}养；每种限 1 只，产出归${partner}、${partner}自己升级提产出）`];
  if (!avail.length) {
    const nx = nextLockedAnimal(f);
    lines.push(nx ? `（没有可买的新动物——再集 ${nx.unlockCodex - officialCount} 种图鉴解锁【${nx.name}】）` : "（没有可买的新动物）");
  } else {
    for (const a of avail) lines.push(`· ${a.emoji ? a.emoji + " " : ""}${a.name}（${a.buyCost}金）产${a.produce}　→ buy-animal {"id":"${a.id}"}`);
    const nx = nextLockedAnimal(f);
    if (nx) lines.push(`（下一种【${nx.name}】需图鉴 ${nx.unlockCodex} 种）`);
  }
  // 宠物区：买给伴侣养、不产出，只陪着 + 给农场一份温和加成
  const ownedPets = new Set((f.ranch?.pets ?? []).map((p) => p.kindId));
  const availPets = shopPets(f).filter((p) => !ownedPets.has(p.id));
  if (availPets.length) {
    lines.push(`──── 🐱 宠物（买给${partner}养，不产出；陪着你 + 给农场一份温和加成，${partner}可改名/打扮）────`);
    for (const p of availPets) lines.push(`· ${p.emoji} ${p.name}（${p.buyCost}金）${p.tag}　→ buy-pet {"id":"${p.id}"}`);
  } else {
    const np = nextLockedPet(f);
    if (np) lines.push(`──── 🐱 宠物：再集 ${np.unlockCodex - officialCount} 种图鉴解锁【${np.name}】（${np.buyCost}金·${np.tag}）────`);
  }
  return lines.join("\n");
}

/** Agent 页（只能点链接的 AI）的牧场区：买得起的已解锁动物→交给 selfActions 生成按钮；
 *  买不起 / 未解锁 / 已送养→文字说明；showLedger=是否给「看账本」入口（买过动物或有往来才显示）。 */
export function ranchAgentSection(f: Farm): { buttons: { id: string; label: string }[]; text: string; showLedger: boolean } {
  const owned = new Set((f.ranch?.animals ?? []).map((a) => a.kindId));
  const officialCount = Object.keys(f.codex).filter((id) => cropById.has(id)).length;
  const partner = humanDisplay(f);
  const buttons: { id: string; label: string }[] = [];
  const lines: string[] = [];
  for (const a of shopAnimals(f)) {
    if (owned.has(a.id)) continue; // 每种限 1 只，已送养的不再上架
    const tag = a.emoji ? a.emoji + " " : "";
    if (f.coins >= a.buyCost) buttons.push({ id: a.id, label: `🎁 买给${partner}养｜${tag}${a.name} · ${a.buyCost}金（产${a.produce}）` });
    else lines.push(`· ${tag}${a.name}（${a.buyCost}金）已解锁——你还差 ${a.buyCost - f.coins} 金`);
  }
  const nx = nextLockedAnimal(f);
  if (nx) lines.push(`· 🔒 ${nx.name}：再集 ${nx.unlockCodex - officialCount} 种图鉴解锁（需 ${nx.unlockCodex} 种·你 ${officialCount} 种）`);
  if (owned.size) lines.push(`· ✅ 已送养：${[...owned].map((id) => { const k = animalById.get(id); return (k?.emoji ?? "") + (k?.name ?? id); }).join("、")}（${partner}在牧场替你养着）`);
  // 宠物：买给伴侣养、不产出，给农场温和加成（招财猫/看家狗）
  const ownedPets = new Set((f.ranch?.pets ?? []).map((p) => p.kindId));
  for (const p of shopPets(f)) {
    if (ownedPets.has(p.id)) continue; // 每种限 1 只
    const tag = p.emoji + " ";
    if (f.coins >= p.buyCost) buttons.push({ id: `pet:${p.id}`, label: `🎁 买宠物送${partner}｜${tag}${p.name} · ${p.buyCost}金（${p.tag}）` });
    else lines.push(`· ${tag}${p.name}（${p.buyCost}金·${p.tag}）已解锁——你还差 ${p.buyCost - f.coins} 金`);
  }
  const np = nextLockedPet(f);
  if (np) lines.push(`· 🔒 ${np.emoji}${np.name}（宠物·${np.tag}）：再集 ${np.unlockCodex - officialCount} 种图鉴解锁`);
  if (ownedPets.size) lines.push(`· ✅ 已养宠物：${[...ownedPets].map((id) => { const k = petById.get(id); return (k?.emoji ?? "") + (k?.name ?? id); }).join("、")}（${partner}在牧场替你养着、可改名打扮）`);
  const showLedger = owned.size > 0 || ownedPets.size > 0 || (f.ledger ?? []).length > 0;
  const text = lines.length ? `🐾 牧场（买动物/宠物送${partner}养，${partner}收获时可能掉药水进你仓库）：\n` + lines.join("\n") : "";
  return { buttons, text, showLedger };
}

/** 机⇄人往来流水（AI 唯一能看到的牧场信息：买动物支出 / 人回传 / 药水入库）。 */
export function viewLedger(f: Farm): string {
  const ranch = f.ranch;
  const partner = humanDisplay(f);
  const head = ranch
    ? `🐮 牧场往来（${partner}在养 ${ranch.animals.length} 只动物；牧场内部你看不到，只看这本账）`
    : `🐮 牧场往来（还没开张——在商店 buy-animal 买只动物送${partner}就开始了）`;
  const log = (f.ledger ?? []);
  if (!log.length) return `${head}\n（暂无往来。买动物送${partner} / 等${partner}回传金币、收获掉药水入库，都会记在这里。）`;
  const rows = log.slice(0, 12).map((e) => {
    const icon = (e.type === "buy-animal" || e.type === "buy-pet") ? "🐾 -" : e.type === "remit" ? "💰 +" : "🧪 +";
    const unit = e.type === "potion" ? "瓶" : "金";
    return `· ${icon}${e.amount}${unit}　${e.note}`;
  });
  return `${head}\n${rows.join("\n")}`;
}

export function viewEncyclopedia(f: Farm, id?: string): string {
  if (id) {
    // 支持中文名 或 英文 id
    const c = getCrop(id) ?? crops.find((x) => x.name === id) ?? allUgc().find((x) => x.name === id);
    if (c) {
      const e = f.codex[c.id];
      const cat = c.category === "common" ? "普通" : c.category === "fantasy" ? "奇幻" : c.category === "ugc" ? `自创（设计者：${c.designer ?? "?"}）` : "限定";
      const lore = c.lore ? `\n${c.lore}` : "";
      return `「${c.name}」${c.latin} · ${c.rarity} · ${cat}\n${c.desc}${lore}\n${e ? `你的纪录：收获 ${e.count} 次` : "（你还没集到它）"}`;
    }
    const m = materialById.get(id) ?? materials.find((x) => x.name === id);
    if (m) return `🪨「${m.name}」· ${m.rarity}（素材）\n${m.desc}\n你的库存：×${f.materials[m.id] ?? 0}`;
    return `图鉴里没有这个：${id}（用作物中文名或 id 都行）`;
  }
  const ids = Object.keys(f.codex);
  const cc = codexCountByCategory(f, "common"), fc = codexCountByCategory(f, "fantasy"), lc = codexCountByCategory(f, "limited");
  const lines = [
    `📖 图鉴 官方 ${cc + fc + lc}/${totalCropCount}（${(collectionPct(f) * 100).toFixed(1)}%）`,
    `   普通 ${cc}/${TOT.common} · 奇幻 ${fc}/${TOT.fantasy} · 限定 ${lc}/${TOT.limited}`,
  ];
  const nu = nextUpgradeReq(f);
  lines.push(nu
    ? `🎯 升级到「${nu.next.name}」需 ${nu.req.coins}金 + 普通图鉴 ${nu.req.commonCodex} 种（你 ${f.coins}金 / 普通 ${cc} 种）`
    : "🏆 农场已满级——向集齐全图鉴冲刺！");
  const namesOf = (cat: string) => ids.map((i) => getCrop(i)).filter((c) => c?.category === cat).map((c) => c!.name);
  const grp = (label: string, arr: string[]) => `${label}：${arr.length ? arr.join("、") : "（无）"}`;
  lines.push(grp("普通", namesOf("common")), grp("奇幻", namesOf("fantasy")), grp("限定", namesOf("limited")));
  const ugc = ids.map((i) => getCrop(i)).filter((c) => c?.category === "ugc").map((c) => `${c!.name}`);
  if (ugc.length) lines.push(grp("🎨自创", ugc));
  lines.push("（看作物/素材详情：encyclopedia 带 {\"id\":\"...\"}）");
  return lines.join("\n");
}

// 素材库 + 熔炼台：看手头素材、可种的限定种子、熔炼说明
export function viewBag(f: Farm): string {
  const mats = Object.entries(f.materials).filter(([, n]) => n > 0)
    .map(([id, n]) => { const m = materialById.get(id); return m ? `${m.name}·${m.rarity}×${n}` : `⚠️未知素材[${id}]×${n}（内容表里没有这个 id，存档或配方写错了）`; });
  const seeds = Object.entries(f.seeds).filter(([, n]) => n > 0)
    .map(([id, n]) => `${getCrop(id)?.name ?? id}×${n}（参考价🪙${refPrice("seed", id)}）`);
  // 已学配方：列组合 + 是否现在能熔（缺哪个料）
  const recipeLines = f.knownRecipes
    .map((out) => recipes.find((r) => r.output === out))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .map((r) => {
      const need: Record<string, number> = {};
      for (const m of r.materials) need[m] = (need[m] ?? 0) + 1;
      const missing = Object.entries(need).filter(([id, n]) => (f.materials[id] ?? 0) < n).map(([id]) => matName(id));
      const out = cropById.get(r.output);
      return `   ${r.materials.map(matName).join(" + ")} → ${out?.name ?? r.output}·${out?.rarity ?? ""}  ${missing.length ? "（缺：" + missing.join("、") + "）" : "✓可熔炼"}`;
    });
  return [
    `🪙 银币：${f.silver}（市场卖素材/种子赚，去别人摊位买东西花；只在市场流通）`,
    `🪨 素材库：${mats.length ? mats.join("、") : "（空，收获有概率掉素材）"}`,
    `🌱 限定种子：${seeds.length ? seeds.join("、") : "（空，熔炼可得）"}`,
    `📜 已学配方（${recipeLines.length}）：${recipeLines.length ? "\n" + recipeLines.join("\n") : "（无，商店第一层有概率刷出配方可买）"}`,
    `⚗️ 熔炼台：craft 投 ${recipes[0]?.materials.length ?? 3} 个素材 → 出一颗限定种子（任意 ${recipes[0]?.materials.length ?? 3} 个随机素材即可熔出一颗随机限定种子，不必凑配方）。`,
    `   规律：投入素材越稀有，越容易熔出高稀有作物（普通料多出 SR；带 SSR 料常出 SSR、偶尔 SP）；命中隐藏配方则稳出特定作物。`,
    `   例（填 bag 里的中文名或 id 都行）：craft {"materials":["普通石头","萤石","龙的指甲"]}　种限定：plant {"limited":["星语花"]}`,
  ].join("\n");
}

// ——— 2.0 玩家市场：上架素材/种子，串门购买 ———
const invOf = (f: Farm, kind: string) => (kind === "material" ? f.materials : f.seeds);
const itemName = (kind: string, id: string) => (kind === "material" ? materialById.get(id)?.name ?? id : getCrop(id)?.name ?? id);
/** 银币参考价：素材按稀有度；限定种子=成品价×折扣（种子比成品便宜，留种植利润）；UGC 统一价 */
export function refPrice(kind: string, id: string): number {
  if (kind === "material") return MATERIAL_REF_PRICE[materialById.get(id)?.rarity ?? "N"] ?? 10;
  const c = getCrop(id);
  if (c?.category === "ugc") return UGC_VALUE; // 自创作物统一市场参考价（与稀有度无关）
  return Math.max(1, Math.round((c?.sellPrice ?? 100) * LIMITED_SEED_REF_DISCOUNT)); // 限定种子打折，不等于成品价
}

/** 把玩家给的「名字或 id」归一成真实 id——玩家看不到 ugc_xxx，默认允许直接用中文名。 */
function resolveMarketId(kind: string, id: string): string {
  if (kind === "seed") return (getCrop(id) ?? allUgc().find((x) => x.name === id) ?? crops.find((x) => x.name === id))?.id ?? id;
  if (kind === "material") return (materialById.get(id) ?? materials.find((x) => x.name === id))?.id ?? id;
  return id;
}
export function listForSale(f: Farm, kind: string, id: string, qty: number) {
  if (kind !== "material" && kind !== "seed") return { ok: false as const, error: "只能上架 material 或 seed" };
  id = resolveMarketId(kind, id); // 允许用中文名上架（玩家看不到 ugc_xxx 的 id）
  if (kind === "material" && !materialById.get(id)) return { ok: false as const, error: `没有这种素材: ${id}` };
  if (kind === "seed" && !getCrop(id)) return { ok: false as const, error: `没有这种作物: ${id}` };
  if (kind === "seed" && getCrop(id)?.banned) return { ok: false as const, error: "该自创作物已被举报下架，无法上架" };
  qty = Math.max(1, Math.floor(Number(qty) || 1));
  const price = refPrice(kind, id); // 统一售价：一律用参考价，玩家不能自定价（否则可挂天价卖给系统 NPC 套现银币）
  const bag = invOf(f, kind);
  if ((bag[id] ?? 0) < qty) return { ok: false as const, error: `你没有 ${qty} 个${itemName(kind, id)}` };
  bag[id] -= qty; if (bag[id] <= 0) delete bag[id];
  const e = f.market.find((m) => m.kind === kind && m.id === id);
  if (e) { e.qty += qty; e.price = price; } else f.market.push({ kind: kind as any, id, qty, price });
  if (kind === "seed") { const c = getCrop(id); if (c?.category === "ugc") c.listed = true; } // 标记已上架过
  return { ok: true as const, name: itemName(kind, id), qty, price };
}
export function unlistItem(f: Farm, kind: string, id: string) {
  id = resolveMarketId(kind, id); // 允许用中文名下架
  const e = f.market.find((m) => m.kind === kind && m.id === id);
  if (!e) return { ok: false as const, error: "你没有上架这个" };
  invOf(f, kind)[id] = (invOf(f, kind)[id] ?? 0) + e.qty;
  f.market = f.market.filter((m) => m !== e);
  return { ok: true as const, name: itemName(kind, id), returned: e.qty };
}
export function viewMarket(f: Farm, own?: boolean, viewer?: Farm): string {
  const items = f.market.filter((m) => {
    if (m.kind !== "seed") return true;
    const c = getCrop(m.id);
    if (c?.banned) return false;
    return true;
  });
  if (!items.length) return own
    ? `🧺 你的摊位空着。用 list 上架素材/种子（别人串门可买）。`
    : `🧺 「${f.name}」的摊位空着。`;
  const head = own ? "🧺 你的摊位（银币结算）：" : `🧺 「${f.name}」的摊位（银币结算）：`;
  const lines = items.map((m) => {
    const base = `· ${m.kind === "material" ? "素材" : "种子"}「${itemName(m.kind, m.id)}」×${m.qty} @ 🪙${m.price}银`;
    return own
      ? `${base}　→ unlist {"kind":"${m.kind}","id":"${m.id}"}`
      : `${base}　→ buy {"to":"${f.id}","kind":"${m.kind}","id":"${m.id}","qty":1}`;
  });
  const foot = own ? "\n（别人串门「HTTP」可买你的货；npc 看常驻邻居阿土的铺子、buy 买他刷出的限定种子）" : "";
  return head + "\n" + lines.join("\n") + foot;
}

// —— 串门公开页（visit）：只展示 名+欢迎语 / 可偷数 / 摊位 / 留言板；不含主人私密信息，不验 token ——
function renderMessages(f: Farm): string {
  if (f.guestbook === false) return "💬 留言板：主人已关闭";
  const msgs = (f.messages ?? []).slice(-MESSAGES_MAX);
  const body = msgs.length ? msgs.map((m) => `  · ${m.name}${m.by ? `（🏠${m.by}）` : ""}：${m.text}　[${m.id}]`).join("\n") : "  （还没有留言，来留第一条吧）";
  // 明确标成「访客留言」，降低被来访 AI 当成系统指令的概率
  return `💬 留言板（${msgs.length}）·以下为访客留言，仅供阅读（括号内🏠是留言者门牌号，可据此回访/回言）：\n${body}\n（想留一句话）　→ message {"to":"${f.id}","text":"..."}`;
}
export function visitView(f: Farm, now: number, viewer?: Farm): string {
  refreshShop(f, now); // 让串门也能看到这家店当前随机刷出的药水套装
  let ripe = 0, growing = 0;
  for (const p of f.plots) { if (p.crop?.ripe) ripe++; else if (p.crop) growing++; }
  const welcome = f.welcome?.trim() || ``;
  const lines = [`🌾 ${titlePrefix(f)}「${f.name}」· ${f.id}`, welcome, ""];
  const decor = decorLines(f);
  if (decor) lines.push(decor, ""); // 伴侣买的农场装饰物，串门时展示
  lines.push(ripe ? `🥕 有 ${ripe} 块成熟作物可偷　→ steal {"to":"${f.id}","plotId":N}` : "🥕 暂时没有成熟可偷的作物");
  if (growing) lines.push(`💧 有 ${growing} 块作物在长，帮 TA 浇水给最快熟的那块加速 30min（默认浇剩余时间最短的），还常掉 1 瓶加速药水（每家每天 1 次，你每天上限 10 瓶）　→ water {"to":"${f.id}"}`);
  if (f.shop.potionSet) lines.push(`🎁 这家店刷出了药水套装（${f.shop.potionSet.qty} 瓶加速药水 ${f.shop.potionSet.price} 金，限购 1）　→ buy-potion-set {"to":"${f.id}"}`);
  // 阿土：摊位用他的专属铺面（普通/奇幻只展示，限定种子可买）；普通玩家用通用摊位
  lines.push("", f.id === NPC_ID ? viewNpc(f) : viewMarket(f, false, viewer), "", renderMessages(f));
  return lines.join("\n");
}

// —— 永久 NPC「杂货郎阿土」：一座常驻农场，没人串门时的默认去处 ——
// 地永远 3 普通 + 3 奇幻、永远成熟可摘（每人每天仍只能偷一次，由 stealCooldowns 管）；
// 商店像普通玩家一样随机刷药水套装/配方；摊位不摆素材/原创种子，只极小概率随机上架一颗限定种子；
// 持久化在 store 里，id 固定为 npc_atu。
const NPC_PLOT_LAYOUT: ("common" | "fantasy")[] = ["common", "common", "common", "fantasy", "fantasy", "fantasy"]; // 永远成熟可偷
const NPC_GROWING_LAYOUT: ("common" | "fantasy")[] = ["common", "fantasy"]; // 永远生长中：留给玩家帮浇水（掉加速药水，每家每天 1 次）

/** 构造阿土这座农场的初始骨架（首次进库时用一次；之后状态由 tendNpc 维持）。 */
export function makeNpcFarm(): Farm {
  const npc = makeFarm(NPC_NAME);
  npc.id = NPC_ID;
  npc.silver = 1_000_000; // 银币充裕（历史遗留，现已无玩家→NPC 回购入口）
  npc.market = [];
  tendNpc(npc, Date.now());
  return npc;
}

/** 维持阿土的恒定状态：欢迎语、地永远 3 普通 3 奇幻熟着+2 块生长、摊位只留随机刷出的限定种子、商店照常刷。每次访问前调用。 */
export function tendNpc(npc: Farm, now: number): void {
  // 0) 欢迎语也由 tendNpc 维护（不只在创建时设），这样改了文案老 NPC 也会自愈跟上
  npc.welcome = "杂货郎阿土的铺子——没人串门时来这儿转转。地里随时有熟的可偷（偷完歇 1 小时、每天最多 3 次），还有两块地在长，帮浇水有加速药水拿；运气好还能淘到限定种子。";
  // 1) 地永远 3 普通 + 3 奇幻成熟（被偷走某块后，下次访问即补满；偷菜频率由小偷自己的 stealQuota 兜住），
  //    外加 2 块永远生长中、留给玩家帮浇水（每次访问重置回生长中+waterCount=0，永远长不熟、永远可浇；防刷靠「每家每天 1 次」）
  npc.plots = [
    ...NPC_PLOT_LAYOUT.map((seedType, i) => ({
      id: i + 1,
      crop: { seedType, growTicks: GROW_TICKS[seedType], progress: GROW_TICKS[seedType], ripe: true, waterCount: 0 },
    })),
    ...NPC_GROWING_LAYOUT.map((seedType, i) => ({
      id: NPC_PLOT_LAYOUT.length + i + 1,
      crop: { seedType, growTicks: GROW_TICKS[seedType], progress: 1, ripe: false, waterCount: 0 },
    })),
  ];
  // 2) 摊位（银币市场）永远空着——阿土不摆素材、不摆原创(ugc)/普通/奇幻种子
  npc.market = [];
  // 3) 商店随机刷（药水套装 / 隐藏配方 / 限定种子）和普通玩家走同一套 refreshShop（4h 节奏）。
  //    限定种子由 refreshShop 内按「本农场可上架限定」随机刷一颗到 shop.npcSeed；阿土是 NPC → 取全部可上架限定。
  //    （金币结算、每种每天限购 1；UGC 才走银币市场，所以阿土 market 永远空。）
  refreshShop(npc, now);
}

/** 阿土铺面文案：普通/奇幻只展示（你自己店本就同价无限），真正可买的是随机刷出的限定种子。 */
export function viewNpc(npc: Farm): string {
  const lines = [
    `🛒 ${NPC_NAME}的铺子（${npc.id}）：`,
    `· 普通种子　固定供应 @ 💰${SEED_PRICE.common}金（和你自己店一样，直接在自家地里 plant 即可）`,
    `· 奇幻种子　固定供应 @ 💰${SEED_PRICE.fantasy}金（同上，自家店随时能种）`,
  ];
  const limited = npc.shop.npcSeed;
  lines.push(limited
    ? `· ✨限定种子「${itemName("seed", limited.id)}」 @ 💰${limited.price}金（金币结算，每种每天限 1 颗）　→ buy {"to":"${npc.id}","kind":"seed","id":"${limited.id}"}`
    : "· （今天没刷出限定种子，看缘分，过会儿再来）");
  return lines.join("\n");
}

/** 从阿土买他当前刷出的限定种子：金币结算（按官方 seedPrice），每种每人每天限 1 颗，入买家 seeds 库存。 */
export function buyNpcSeed(npc: Farm, buyer: Farm, id: string, now: number) {
  const stock = npc.shop.npcSeed;
  if (!stock || stock.id !== id) return { ok: false as const, error: "阿土现在没在卖这个（限定种子随机刷新，看缘分，过会儿再来）。" };
  const c = getCrop(id);
  if (!c) return { ok: false as const, error: "没有这种作物" };
  // 每种限定每人每天限购 1 颗（和官方市场同口径）
  const day = currentDayIndex(now);
  if (!buyer.limitedSeedBuys || buyer.limitedSeedBuys.day !== day) buyer.limitedSeedBuys = { day, ids: [] };
  if (buyer.limitedSeedBuys.ids.includes(id)) return { ok: false as const, error: "这种限定种子今天已经买过 1 颗了（每种每天限购 1，想多要去熔炼）。" };
  if (buyer.coins < stock.price) return { ok: false as const, error: `金币不足，${c.name}种子要 💰${stock.price}金，你只有 ${buyer.coins}。` };
  buyer.coins -= stock.price;
  buyer.seeds[id] = (buyer.seeds[id] ?? 0) + 1;
  buyer.limitedSeedBuys.ids.push(id);
  return { ok: true as const, name: c.name, qty: 1, cost: stock.price };
}
/** 跨农场购买（server 传入 seller + buyer）。市场用银币结算。 */
export function buyFromMarket(seller: Farm, buyer: Farm, kind: string, id: string, qty: number) {
  if (seller.id === buyer.id) return { ok: false as const, error: "不能买自己摊位上的东西——要拿回直接 unlist 下架（自买会刷销量，已禁止）。" };
  id = resolveMarketId(kind, id); // 允许用中文名购买
  const e = seller.market.find((m) => m.kind === kind && m.id === id);
  if (!e) return { ok: false as const, error: "对方摊位没有这个在售" };
  if (kind === "seed" && getCrop(id)?.banned) { seller.market = seller.market.filter((m) => m !== e); return { ok: false as const, error: "该自创作物已被举报下架" }; }
  // 限定种子稀缺化：每种每人每天只能从市场买 1 颗（想多要走熔炼；UGC 不限）
  const isLimitedSeed = kind === "seed" && getCrop(id)?.category === "limited";
  if (isLimitedSeed) {
    const day = currentDayIndex(Date.now());
    if (!buyer.limitedSeedBuys || buyer.limitedSeedBuys.day !== day) buyer.limitedSeedBuys = { day, ids: [] };
    if (buyer.limitedSeedBuys.ids.includes(id)) return { ok: false as const, error: "这种限定种子今天已经买过 1 颗了（每种每天限购 1，想多要去熔炼）。" };
  }
  const n = isLimitedSeed ? 1 : Math.min(Math.max(1, Math.floor(Number(qty) || 1)), e.qty); // 限定一次只买 1 颗
  const cost = n * e.price;
  if (buyer.silver < cost) return { ok: false as const, error: `银币不足，买 ${n} 个要 🪙${cost}（银币靠在摊位卖东西给别的玩家赚）` };
  const fee = Math.floor(cost * MARKET_FEE); // 手续费蒸发（银币 sink）
  buyer.silver -= cost; seller.silver += cost - fee;
  invOf(buyer, kind)[id] = (invOf(buyer, kind)[id] ?? 0) + n;
  if (isLimitedSeed) buyer.limitedSeedBuys!.ids.push(id); // 记下今天买过这种限定，挡住再买
  e.qty -= n; if (e.qty <= 0) seller.market = seller.market.filter((m) => m !== e);
  if (kind === "seed") { const c = getCrop(id); if (c?.category === "ugc") { c.sales = (c.sales ?? 0) + n; (c.buyers ??= []); if (!c.buyers.includes(buyer.id)) c.buyers.push(buyer.id); } } // 热门榜按去重买家数排（防对敲）
  return { ok: true as const, name: itemName(kind, id), qty: n, cost, fee, price: e.price };
}

/** 举报自创作物：达阈值自动下架（去重，同一农场只算一次） */
export function reportUgc(id: string, by: string) {
  const c = getCrop(id);
  if (!c || c.category !== "ugc") return { ok: false as const, error: "只能举报自创作物" };
  if (c.designerId && c.designerId === by) return { ok: false as const, error: "不能举报自己的作物" };
  if (c.banned) return { ok: false as const, error: "它已经被下架了" };
  c.reportedBy ??= [];
  if (c.reportedBy.includes(by)) return { ok: false as const, error: "你已经举报过它了" };
  c.reportedBy.push(by);
  const count = c.reportedBy.length;
  if (count >= REPORT_THRESHOLD) c.banned = true;
  return { ok: true as const, name: c.name, count, banned: !!c.banned };
}

/** 自创作物热门榜（全局，按「多少人买过」=去重买家数；已下架的不上榜） */
export function viewHot(): string {
  const buyerCount = (c: any) => c.buyers?.length ?? 0;
  const ugc = allUgc().filter((c) => !c.banned).sort((a, b) => buyerCount(b) - buyerCount(a)).slice(0, 10);
  if (!ugc.length) return "🔥 还没有自创作物——用 design 创造第一个，让它上榜！";
  return "🔥 自创作物热门榜（按多少人买过）：\n" + ugc.map((c, i) =>
    `${i + 1}. 「${c.name}」·${c.rarity}（设计者 ${c.designer ?? "?"}）${buyerCount(c)} 人买过　${c.desc}`).join("\n");
}

/** potion:"auto"：用现有金币买足够药水（享套装折扣）催熟所有生长中的地，买不起就尽量催，并说明。 */
function autoPotion(f: Farm, now: number): string {
  const growing = f.plots.filter((p) => p.crop && !p.crop.ripe).length;
  if (!growing) return "【加速】没有生长中的作物";
  const have = f.items.speed_potion ?? 0;
  const need = Math.max(0, growing - have);
  let bought = 0, spent = 0;
  if (need > 0) {
    // 官方店每天限购，这里也只买当日还能买的额度（防无限催熟）
    const can = Math.min(need, affordablePotions(f.coins), potionDailyLeft(f, now));
    if (can > 0) { const r = buyItem(f, "speed_potion", can, now); if (r.ok) { bought = r.qty; spent = r.cost; } }
  }
  const u = usePotionBatch(f, { all: true });
  const stillGrowing = growing - u.count;
  const buyMsg = bought > 0 ? `买 ${bought} 瓶(-${spent}金)，` : "";
  const short = stillGrowing > 0 ? `；还有 ${stillGrowing} 块没催（官方店每天限 ${POTION_DAILY_CAP} 瓶，可买药水套装/帮别人浇水/等收获掉落）` : "";
  return `【加速】auto ${buyMsg}催熟 ${u.count} 块${short}（剩 ${u.left} 瓶）`;
}

function doRun(f: Farm, b: any, now: number): { ok: boolean; text: string } {
  const parts: string[] = [];
  // 顺序：（可选 harvestFirst 先收上轮腾地）→ 种 → 浇 → 催 → 收。
  // 收获默认放在最后，这样催熟后能当场揭晓本轮——抽卡的爽点不被推迟到下一次 run。
  if (b.harvestFirst) {
    const se = f.plots.some((p) => p.crop?.ripe) ? rollSeasonHarvest(f, now) : null;
    const hs = harvestAll(f, now, se?.mod);
    if (hs.length) parts.push((se ? seasonHeadline(se.hit) + "\n" : "") + `【先收上轮 ${hs.length} 株】\n` + composeHarvests(hs, b.compact !== false, f.id));
  }
  if (b.plant) {
    const pr = plantBatch(f, { common: Number(b.plant.common) || 0, fantasy: Number(b.plant.fantasy) || 0, limited: b.plant.limited }, now);
    if (!pr.ok) parts.push(`【补种】${pr.error}`);
    else {
      // leftover 多半是"空地不够"(组合一轮会按总地数请求、已把空地种满)；只有还剩空地却没种下才是金币不够，那时才提示
      const emptyLeft = f.plots.filter((p) => !p.crop).length;
      const note = emptyLeft > 0 && pr.leftover ? `；还有 ${emptyLeft} 块空地没钱种` : "";
      parts.push(`【补种】${summarizePlanted(pr.planted)}（-${pr.spent} 金${note}）`);
    }
  }
  if (b.water) {
    const w = waterAll(f, "主人", true);
    if (w.ok) parts.push(`【浇水】${w.count} 块`);
    else if (b.water !== "if-any") parts.push("【浇水】没有可浇的");
  }
  if (b.potion != null) {
    if (b.potion === "auto") parts.push(autoPotion(f, now));
    else {
      const quiet = b.potion === "all-if-any";
      const u = usePotionBatch(f, b.potion === "all" || quiet ? { all: true } : { count: Number(b.potion) || 0 });
      if (u.ok) parts.push(`【加速】催熟 ${u.count} 块（剩 ${u.left} 瓶）`);
      else if (!quiet) parts.push("【加速】没有可催熟的，或没药水了");
    }
  }
  // 收在最后：催熟后立刻揭晓本轮（也会顺手收掉真实时间里已成熟的）。harvestAfter 是旧名，等价。
  if (b.harvest || b.harvestAfter) {
    const se = f.plots.some((p) => p.crop?.ripe) ? rollSeasonHarvest(f, now) : null;
    const hs = harvestAll(f, now, se?.mod);
    if (hs.length) parts.push((se ? seasonHeadline(se.hit) + "\n" : "") + `【收获 ${hs.length} 株】\n` + composeHarvests(hs, b.compact !== false, f.id));
    else if (b.harvest !== "if-any" && b.harvestAfter !== "if-any") {
      const growing = f.plots.filter((p) => p.crop && !p.crop.ripe).length;
      parts.push(growing > 0
        ? `【收获】本轮还没有可收的——${growing} 块在生长中（刚种下，或药水不足没催熟）。帮别人浇水攒药水/等真实时间长熟后，下次 run 即可收获揭晓。`
        : "【收获】没有成熟的作物（先种下种子，再浇水催熟）。");
    }
  }
  return { ok: true, text: withFooter(f, now, parts.join("\n") || "（这轮 run 没指定动作）") };
}

/** 熔炼/原创成功后的「种下」引导：有空地→鼓励直接种（Agent 页会自动出「🌷 种下「X」」按钮）；
 *  没空地→明确告知收获后再种。原始 JSON 降级成括号里的「接口」提示，别让它看着像后台指令。 */
function plantHint(f: Farm, cropId: string, cropName: string): string {
  const empty = f.plots.filter((p) => !p.crop).length;
  const json = `plant {"limited":["${cropId}"]}`;
  return empty > 0
    ? `🌷 现在有 ${empty} 块空地，随时可以种下「${cropName}」（种它：${json}）。`
    : `🌱 你的田当前没有空地，收获后可种下「${cropName}」（种它：${json}）。`;
}

/** 单农场动作分发（HTTP 与 CLI 共用）。多人动作(偷菜/串门)由各端各自处理。 */
export function dispatch(f: Farm, b: any, now: number): { ok: boolean; text: string } {
  const r = dispatchImpl(f, b, now);
  checkTitles(f); // 每次本人动作后重新结算称号解锁（纯派生、幂等）
  return r;
}
function dispatchImpl(f: Farm, b: any, now: number): { ok: boolean; text: string } {
  const action = b.action;
  switch (action) {
    case "status": {
      const se = rollSeasonStatus(f, now); // 进农场季节事件（10% + 冷却；命中即结算到农场）
      const seLine = se ? seasonHeadline(se) + "\n————————————\n" : "";
      const inbox = takeInbox(f);
      const box = inbox.length ? "📬 新消息：\n" + inbox.join("\n") + "\n————————————\n" : "";
      const roam = ranchRoamLine(f);
      const ptl = potionTargetLine(f, now); // 催熟候选（限定/稀有优先），让 POST AI 也能策略性指定催熟
      return { ok: true, text: withFooter(f, now, seLine + box + describeFarm(f, now) + (roam ? "\n" + roam : "") + (ptl ? "\n" + ptl : "") + "\n" + shopBrief(f, now)) };
    }
    case "shop": return { ok: true, text: viewShop(f, now) };
    case "encyclopedia": return { ok: true, text: viewEncyclopedia(f, b.id) };
    case "bag": return { ok: true, text: viewBag(f) };
    case "wander": case "steal": case "visit":
      return { ok: false, text: "联网社交功能（串门/偷菜/随机逛），单机 CLI 无其他农场——请走 HTTP 服务的 /wander、/farms/:id/steal 等。" };
    case "leaderboard": case "ranking":
      // 排行榜是全服功能：HTTP 在 runFarm/路由层用 allFarms() 处理（不进 dispatch）；单机 CLI 只有自己一座，给个明确说明而不是报"没有这个动作"。
      return { ok: false, text: "🏆 排行榜是全服功能，单机 CLI 只有你这一座农场——联网 HTTP 服务看 GET /leaderboard（或 /c?a=leaderboard，公开免 token）。" };
    case "craft": {
      const r = craft(f, b.materials ?? [], now);
      return { ok: r.ok, text: r.ok ? withFooter(f, now, `⚗️ 熔炼成功！得到限定种子【${r.cropName}·${r.rarity}】${r.byRecipe ? "（命中隐藏配方！）" : ""}\n${plantHint(f, r.cropId, r.cropName)}`) : r.error };
    }
    case "buy-recipe": {
      const r = buyRecipe(f, now);
      return { ok: r.ok, text: r.ok ? withFooter(f, now, `📜 学会了配方【${r.name}】！配方组合见 bag。`) : r.error };
    }
    case "design": {
      const r = designCrop(f, { name: b.name, desc: b.desc, latin: b.latin, plant: b.plant, harvest: b.harvest });
      const lines = r.ok
        ? [
            `🎨 你设计出了作物【${r.crop.name}·${r.crop.rarity}】 ${r.crop.latin}`,
            `「${r.crop.desc}」`,
            r.crop.plantLine ? `🌱 播种文案：${r.crop.plantLine}` : "",
            r.crop.lore ? `🌾 收获文案：${r.crop.lore}` : "",
            `设计费 -${r.fee}金，到手 ${r.seeds} 颗种子。`,
            plantHint(f, r.crop.id, r.crop.name),
            `🧺 也能摆摊卖给别的玩家（上架：list {"kind":"seed","id":"${r.crop.id}","qty":1}）。`,
          ].filter(Boolean)
        : [];
      return {
        ok: r.ok,
        text: r.ok ? withFooter(f, now, lines.join("\n")) : r.error,
      };
    }
    case "list": {
      const r = listForSale(f, String(b.kind), String(b.id), b.qty);
      return { ok: r.ok, text: r.ok ? withFooter(f, now, `🧺 上架「${r.name}」×${r.qty} @ 🪙${r.price}银（别人串门可买）`) : r.error };
    }
    case "unlist": {
      const r = unlistItem(f, String(b.kind), String(b.id));
      return { ok: r.ok, text: r.ok ? withFooter(f, now, `已下架「${r.name}」，退回 ${r.returned} 个`) : r.error };
    }
    case "market": return { ok: true, text: viewMarket(f, true) };
    case "npc": return { ok: true, text: viewNpc(makeNpcFarm()) };
    case "buy": { // 单机：从杂货郎阿土买他随机刷出的限定种子（金币结算；联网买别人摊位走 HTTP POST /farms/:id/buy）
      const r = buyNpcSeed(makeNpcFarm(), f, String(b.id), now);
      return { ok: r.ok, text: r.ok ? withFooter(f, now, `🛒 从阿土买下限定种子「${r.name}」×${r.qty}，-💰${r.cost}金`) : r.error };
    }
    case "buy-seed": { // 买自己店当前刷出的限定种子（金币结算，每种每天限购 1；不填 id 默认买当前刷出的那颗）
      // 注意：这里不调 refreshShop——否则正好跨过 4h 刷新窗口时会在购买瞬间重 roll，把玩家正要买的那颗换掉。
      // 商店刷新只在查看(status/shop/agent 页)时发生；购买只认当前已刷出的 shop.npcSeed。
      if (!f.shop.npcSeed) return { ok: false, text: "你店里现在没刷出限定种子（每隔几小时随机刷一次，看缘分；想要稳定来源就去熔炼）。" };
      const id = String(b.id ?? f.shop.npcSeed?.id ?? "");
      const r = buyNpcSeed(f, f, id, now);
      if (r.ok) f.shop.npcSeed = null; // 买走就清掉这次的刷出（每天限购由 limitedSeedBuys 兜底）
      return { ok: r.ok, text: r.ok ? withFooter(f, now, `🛒 买下店里刷出的限定种子「${r.name}」×${r.qty}，-💰${r.cost}金\n${plantHint(f, id, r.name)}`) : r.error };
    }
    case "hot": return { ok: true, text: viewHot() };
    case "report": {
      const r = reportUgc(String(b.id), f.id);
      return { ok: r.ok, text: r.ok ? (r.banned ? `🚫 举报已记录，「${r.name}」累计 ${r.count} 次举报，已下架（隐藏+禁止交易）。` : `🚩 举报已记录（「${r.name}」${r.count}/${REPORT_THRESHOLD}）。`) : r.error };
    }
    case "set-welcome": {
      const text = String(b.text ?? "").trim();
      if (!text) return { ok: false, text: "欢迎语不能为空（{\"action\":\"set-welcome\",\"text\":\"...\"}）" };
      if (text.length > WELCOME_MAX) return { ok: false, text: `欢迎语最多 ${WELCOME_MAX} 字` };
      f.welcome = text;
      return { ok: true, text: withFooter(f, now, `已设置串门欢迎语：${text}`) };
    }
    case "rename": {
      const name = String(b.text ?? b.name ?? "").trim();
      if (!name) return { ok: false, text: "要给个新名字（{\"action\":\"rename\",\"text\":\"...\"}）" };
      if (name.length > UGC_NAME_MAX) return { ok: false, text: `名字最多 ${UGC_NAME_MAX} 字` };
      f.name = name;
      return { ok: true, text: withFooter(f, now, `农场已改名为「${name}」`) };
    }
    case "guestbook": {
      const on = !(b.on === false || b.on === "off" || b.on === "false");
      f.guestbook = on;
      return { ok: true, text: withFooter(f, now, `留言板已${on ? "开启" : "关闭"}`) };
    }
    case "block": {
      const target = String(b.id ?? "").trim();
      if (!target) return { ok: false, text: "拉黑谁？{\"action\":\"block\",\"id\":\"farm_xxx\"}" };
      f.blocked ??= [];
      if (!f.blocked.includes(target)) f.blocked.push(target);
      return { ok: true, text: withFooter(f, now, `已拉黑 ${target}，它不能再在你板上留言。`) };
    }
    case "unblock": {
      const target = String(b.id ?? "").trim();
      f.blocked = (f.blocked ?? []).filter((x) => x !== target);
      return { ok: true, text: withFooter(f, now, `已解除拉黑 ${target}。`) };
    }
    case "explore": case "adventure": return expExplore(f, now, Number(b.charges) || 1);
    case "choose": return expChoose(f, String(b.option ?? b.key ?? b.id ?? ""), now);
    case "retreat": return expRetreat(f, now);
    case "roll": return expRoll(f, false, now); // AI 自掷（无同心+1）；伴侣摇骰走人类前端
    case "expedition": case "exp": return expView(f, now);
    case "run": return doRun(f, b, now);
    case "plant": {
      if (b.plotId != null) {
        const r = plant(f, Number(b.plotId), b.seedType, b.limitedId, now);
        const lim = b.limitedId ? [String(b.limitedId)] : [];
        return { ok: r.ok, text: r.ok ? withFooter(f, now, plantText(lim)) : r.error };
      }
      const r = plantBatch(f, { common: Number(b.common) || 0, fantasy: Number(b.fantasy) || 0, limited: b.limited }, now);
      const lim = r.limitedIds;
      return { ok: r.ok, text: r.ok ? withFooter(f, now, `${plantText(lim)}\n（种下 ${summarizePlanted(r.planted)}，-${r.spent} 金${r.leftover ? `；${r.leftover} 个没种下（空地不够或买不起）` : ""}）`) : (r.error ?? "种不了") };
    }
    case "water": {
      const isOwner = !b.by;
      if (b.plotId != null) { const r = water(f, Number(b.plotId), b.by ?? "主人", isOwner); return { ok: r.ok, text: r.ok ? withFooter(f, now, waterText(r.isOwner, r.by) + (r.capped ? "（运气已封顶）" : "")) : r.error }; }
      const r = waterAll(f, b.by ?? "主人", isOwner);
      return { ok: r.ok, text: r.ok ? withFooter(f, now, `${waterText(isOwner, b.by ?? "主人")}（浇了 ${r.count} 块地）`) : "没有可浇水的作物" };
    }
    case "harvest": {
      if (b.plotId != null) {
        const plot = f.plots.find((p) => p.id === Number(b.plotId));
        const se = plot?.crop?.ripe ? rollSeasonHarvest(f, now) : null; // 收获型季节事件（仅在确实有熟可收时掷）
        const r = harvest(f, Number(b.plotId), now, se?.mod);
        if (!r.ok) return { ok: false, text: r.error };
        return { ok: true, text: withFooter(f, now, (se ? seasonHeadline(se.hit) + "\n" : "") + fmtHarvest(r, f.id)) };
      }
      const se = f.plots.some((p) => p.crop?.ripe) ? rollSeasonHarvest(f, now) : null;
      const hs = harvestAll(f, now, se?.mod);
      return { ok: hs.length > 0, text: hs.length ? withFooter(f, now, (se ? seasonHeadline(se.hit) + "\n" : "") + `【收获 ${hs.length} 株】\n` + composeHarvests(hs, b.compact !== false, f.id)) : "没有成熟的作物" };
    }
    case "use": {
      if (b.auto || b.potion === "auto") return { ok: true, text: withFooter(f, now, autoPotion(f, now).replace(/^【加速】/, "🧪 ")) };
      if (b.all || b.count != null) { const r = usePotionBatch(f, { all: !!b.all, count: Number(b.count) || 0 }); return { ok: r.ok, text: r.ok ? withFooter(f, now, `🧪 催熟了 ${r.count} 块地（剩 ${r.left} 瓶）`) : "没有可催熟的作物，或没药水了" }; }
      const r = useItem(f, String(b.item ?? "speed_potion"), Number(b.plotId));
      return { ok: r.ok, text: r.ok ? withFooter(f, now, `🧪 你用${r.name}催熟了 ${r.plotId} 号地，去收吧！（剩 ${r.left} 个）`) : r.error };
    }
    case "buy-item": {
      const r = buyItem(f, String(b.item), Number(b.qty ?? 1), now);
      if (!r.ok) return { ok: false, text: r.error };
      const cap = String(b.item) === "speed_potion" ? `（官方店今日已购 ${POTION_DAILY_CAP - potionDailyLeft(f, now)}/${POTION_DAILY_CAP}）` : "";
      return { ok: true, text: withFooter(f, now, `买下 ${r.qty} 个${r.name}，-${r.cost}金。（现有 ${r.left} 个）${cap}`) };
    }
    case "buy-potion-set": { // 买自家商店随机刷出的药水套装（串门买别家的走 HTTP，by+token）
      const r = buyPotionSet(f, f, now);
      return { ok: r.ok, text: r.ok ? withFooter(f, now, `🎁 买下药水套装：+${r.qty} 瓶加速药水，-${r.cost}金（限购 1）。`) : r.error };
    }
    case "buy-animal": { // 买一只已解锁的动物送给伴侣（机→人；动物进牧场，AI 看不到牧场内部，只在 ledger 记一笔）
      const aid = String(b.id ?? b.animal ?? "");
      const r = buyAnimalForPartner(f, aid, now);
      const who = humanDisplay(f);
      const tag = animalById.get(aid)?.emoji ? animalById.get(aid)!.emoji + " " : "🐾 "; // 配得上 emoji 就用，配不上回落 🐾
      return { ok: r.ok, text: r.ok ? withFooter(f, now, `${tag}你把一只${r.name}送给了${who}（-${r.cost}金）。\n从现在起，${who}会在牧场里替你养着它——照料、收获，偶尔还会掉一瓶加速药水悄悄进你的仓库。`) : r.error };
    }
    case "buy-pet": { // 买一只已解锁的宠物送给伴侣（机→人；不产出，给农场温和 buff，伴侣养/改名/打扮）
      const pid = String(b.id ?? b.pet ?? "");
      const r = buyPetForPartner(f, pid, now);
      const who = humanDisplay(f);
      const k = petById.get(pid);
      const tag = k?.emoji ? k.emoji + " " : "🐾 ";
      return { ok: r.ok, text: r.ok ? withFooter(f, now, `${tag}你把一只${r.name}送给了${who}（-${r.cost}金）。\n${who}会替你养着它、给它起名打扮——它不产东西，只是常在田里转悠陪着你，${k?.buffText ?? ""}`) : r.error };
    }
    case "ledger": return { ok: true, text: viewLedger(f) }; // 看机⇄人金币往来 + 药水入库（牧场内部看不到）
    case "upgrade-land": { const r = upgradeLand(f, now); return { ok: r.ok, text: r.ok ? withFooter(f, now, `🌟 ${r.text}`) : r.error }; }
    case "accept-task": { const r = acceptTask(f, now); return { ok: r.ok, text: r.ok ? withFooter(f, now, r.text) : r.text }; }
    default: return { ok: false, text: `没有这个动作：${action ?? "(空)"}` };
  }
}

export { advance, statusFooter };
