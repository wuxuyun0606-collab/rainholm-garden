


import { makeFarm } from '../vendor/aifarm/dist/game.js';
import { advance, plant, water, harvest, upgradeLand } from '../vendor/aifarm/dist/engine.js';
import { rollSeasonHarvest } from '../vendor/aifarm/dist/season-events.js';
import { checkTitles } from '../vendor/aifarm/dist/titles.js';
import { currentSeason } from '../vendor/aifarm/dist/time.js';
import { TICK_MS, GROW_TICKS, SEED_PRICE, WATER_LUCK_PER, WATER_LUCK_CAP } from '../vendor/aifarm/dist/config.js';
import { publicView } from './garden.mjs';

export const SCENES = ['garden', 'greenhouse'];
export const GREENHOUSE_PLOTS = 8;
export const GREENHOUSE_NAME = '小花房';

/* ── 花房经济数值：显式写死在这里，不从上游隐式继承 ──────────────────────────
   数值本身沿用上游当前的普通/奇幻种子，写明白是为了以后上游动了数字，
   这边能当场看出来对不上（下面 checkRuleDrift 会在启动时喊一嗓子）。 */
export const FLOWER_RULES = {
  tickMs: 30 * 60 * 1000,                    // 1 tick = 30 分钟（同菜园）
  seedPrice: { common: 8, fantasy: 40 },     // 普通花种 8 金 / 奇幻花种 40 金
  growTicks: { common: 6, fantasy: 12 },     // 3 小时 / 6 小时
  waterCap: 6,                               // 浇水加运气的封顶次数
};

/* 新花头一回进图鉴的奖励：**本项目自己钱包出的钱，不走上游**。
   只在这朵花第一次被揭晓时发一次，之后再收同一朵是 0。
   揭晓卡上「新图鉴奖励 N 金」那行显示的就是这个数，钱包也真的多这么多 —— 对得上账，
   不是装饰文字。配套动作见 action() 里那段：花房收获会把上游那笔「看不见的蔬菜图鉴奖励」
   原样退回去，再发这一笔。不然卡面写 30、钱包多 110，账就对不上了。 */
export const FLOWER_CODEX_REWARD = { common: 30, fantasy: 80 };

/* 花池映射：普通池 = 奶油星瓣 / 粉铃，奇幻池 = 月露 / 琥珀灯。
   when = 上游 roll 出来的作物稀有度落在哪一档，就揭晓这一朵。
   （常见档给池子里"常见"的那朵，稀有档给"稀罕"的那朵，四朵都够得着。）
   pool = 这朵花属于哪个池，新花奖励按池发。 */
export const FLOWER_POOL = {
  common: [
    { id: 'rainholm_flower_cream_star', name: '奶油星瓣', rarity: 'N', pool: 'common', when: ['N'] },
    { id: 'rainholm_flower_blush_chime', name: '粉铃', rarity: 'R', pool: 'common', when: ['R', 'SR', 'SSR', 'SP'] },
  ],
  fantasy: [
    { id: 'rainholm_flower_moon_dew', name: '月露', rarity: 'R', pool: 'fantasy', when: ['N', 'R'] },
    { id: 'rainholm_flower_amber_lantern', name: '琥珀灯', rarity: 'SR', pool: 'fantasy', when: ['SR', 'SSR', 'SP'] },
  ],
};
const FLOWER_BY_ID = new Map(Object.values(FLOWER_POOL).flat().map(f => [f.id, f]));

/** 启动时对一次账：花房配置和上游数值对不上就喊出来（不静默漂移） */
export function checkRuleDrift(warn = console.warn) {
  const drift = [];
  if (FLOWER_RULES.tickMs !== TICK_MS) drift.push(`tickMs 配置 ${FLOWER_RULES.tickMs} ≠ 上游 ${TICK_MS}`);
  for (const k of ['common', 'fantasy']) {
    if (FLOWER_RULES.seedPrice[k] !== SEED_PRICE[k]) drift.push(`${k} 种子价 配置 ${FLOWER_RULES.seedPrice[k]} ≠ 上游 ${SEED_PRICE[k]}`);
    if (FLOWER_RULES.growTicks[k] !== GROW_TICKS[k]) drift.push(`${k} 生长 tick 配置 ${FLOWER_RULES.growTicks[k]} ≠ 上游 ${GROW_TICKS[k]}`);
  }
  const upstreamCap = Math.round(WATER_LUCK_CAP / WATER_LUCK_PER);
  if (FLOWER_RULES.waterCap !== upstreamCap) drift.push(`waterCap 配置 ${FLOWER_RULES.waterCap} ≠ 上游 ${upstreamCap}`);
  if (drift.length) warn('[greenhouse] 花房配置和上游数值对不上：' + drift.join('；') + '。引擎扣的是上游值，接口报的是配置值，去 server/scenes.mjs 对齐。');
  return drift;
}

/* ── 存档迁移 ────────────────────────────────────────────────────────────────
   一期的记录是 {farm, revision, receipts, history}。二期在旁边加兄弟键，
   不动 farm，不迁移菜畦数据；老账本按场景分家，未决的一条都不丢。 */
function migrateReceipts(raw) {
  const out = { garden: {}, greenhouse: {} };
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw)) {
    const isNamespace = SCENES.includes(key) && value && typeof value === 'object' && !('canonical' in value);
    if (isNamespace) { Object.assign(out[key], value); continue; }
    if (value && typeof value === 'object' && typeof value.canonical === 'string') {
      /* 一期的 canonical 是 [action,plotId,seedType,revision]，没有 scene。
         补成 garden 开头，这样老前端拿着同一个编号重放，算出来的 canonical 仍然对得上，
         不会被判成「编号已用于另一项操作」。 */
      let canonical = value.canonical;
      try {
        const parsed = JSON.parse(canonical);
        if (Array.isArray(parsed) && parsed.length === 4) canonical = JSON.stringify(['garden', ...parsed]);
      } catch { /* 认不出来就原样留着，宁可 409 也不丢账 */ }
      out.garden[key] = { ...value, canonical };
      continue;
    }
    out.garden[key] = value;   // 完全认不出来的也留着，不丢
  }
  return out;
}

export function ensureScenes(record, now = Date.now()) {
  if (!record.greenhouse || typeof record.greenhouse !== 'object') record.greenhouse = {};
  const gh = record.greenhouse;
  if (!gh.farm) {
    gh.farm = makeFarm(GREENHOUSE_NAME);
    gh.farm.coins = 0;          // 开局那 200 金只算一份，在菜园那边；钱包马上会把它同步过来
    /* 花房的 tick 跟菜畦对齐：两边同一个节拍，nextTickAt 才不会各报各的。
       makeFarm 里那个 Date.now() 是它自己现取的，不认服务的时钟，这里改回来。 */
    gh.farm.lastTickAt = Number.isFinite(record.farm?.lastTickAt) ? record.farm.lastTickAt : now;
    gh.farm.createdAt = Number.isFinite(record.farm?.createdAt) ? record.farm.createdAt : now;
  }
  gh.codex ??= {};              // 花图鉴：{花id: {count,bestQuality,firstAt}}，跟蔬菜图鉴分开
  gh.history ??= [];
  /* aifarm-20260918：谁最后动的这块地。**不进上游 Farm**（vendor 是第三方包，
     非商用许可，一个字不碰），单开一张兄弟表放在 record 旁边，取 state 时并进 plots[]。
     形状：{ garden: { "3": {by:"black", at:1758..., action:"harvest"} }, greenhouse: {…} }。
     老存档没有这张表 ＝ 这局开始前的操作查不到人，报 null，不猜是谁干的。 */
  if (!record.actors || typeof record.actors !== 'object') record.actors = {};
  for (const s of SCENES) if (!record.actors[s] || typeof record.actors[s] !== 'object') record.actors[s] = {};
  /* 花房固定八盆。上游 1 阶土地只有 6 格，这里补两格 —— 只是往 Farm 的数据里加两个
     {id,crop:null}，引擎的 plant/water/harvest 全是按 plots.find(id) 找的，不需要改 vendor。 */
  for (let id = gh.farm.plots.length + 1; id <= GREENHOUSE_PLOTS; id++) gh.farm.plots.push({ id, crop: null });

  if (!Number.isFinite(record.wallet)) record.wallet = Number.isFinite(record.farm?.coins) ? record.farm.coins : 0;
  record.receipts = migrateReceipts(record.receipts);
  record.history ??= [];
  record.schema = 2;
  return record;
}

/* aifarm-20260918：把「谁最后动的」并进视图里的地块数组。
   老存档没记过的地块一律 null —— 查不到就说查不到，不填「user」凑数。 */
export function mergeActors(record, scene, rows) {
  const table = record.actors?.[scene] ?? {};
  for (const row of rows) {
    const hit = table[String(row.id)];
    row.lastActor = hit?.by ?? null;
    row.lastActionAt = hit?.at ?? null;
    row.lastAction = hit?.action ?? null;
  }
  return rows;
}

/** 唯一钱包：两个 Farm 的 coins 一律等于 record.wallet，谁也别想各留一份 */
function syncWallet(record) {
  const w = record.wallet;
  if (record.farm) record.farm.coins = w;
  if (record.greenhouse?.farm) record.greenhouse.farm.coins = w;
}

function advanceAll(record, now) {
  const a = advance(record.farm, now);
  const b = advance(record.greenhouse.farm, now);
  return (a > 0) || (b > 0);
}

/* ── 浇水提醒 ────────────────────────────────────────────────────────────────
   不是缺水生命条，不影响生长、更不会枯死。规则：生长中、没浇满、且「已经过了
   一个 tick 还没跟上浇水次数」才冒那个 !。浇完当场就不提醒了，
   也不会每次刷新把所有生长中的地都标上。 */
function needsWater(plot, cap) {
  const c = plot?.crop;
  if (!c || c.ripe) return false;
  const watered = c.waterCount ?? 0;
  if (watered >= cap) return false;
  return watered < Math.min(cap, c.progress ?? 0);
}

/* ── 视图 ───────────────────────────────────────────────────────────────────── */
export function gardenView(record, now) {
  const view = publicView(record, now);          // garden.mjs 那份，形状不动
  view.scene = 'garden';
  view.coins = record.wallet;                    // 钱包才是唯一余额
  view.nextTickAt = record.farm.lastTickAt + TICK_MS;
  const cap = view.rules?.waterCap ?? FLOWER_RULES.waterCap;
  const raw = new Map(record.farm.plots.map(p => [p.id, p]));
  for (const p of view.plots) {
    const src = raw.get(p.id);
    p.canWater = !!src?.crop && !src.crop.ripe && (src.crop.waterCount ?? 0) < cap;
    p.needsWater = needsWater(src, cap);
  }
  mergeActors(record, 'garden', view.plots);
  return view;
}

function flowerCodexList(gh) {
  return Object.entries(gh.codex ?? {}).flatMap(([id, entry]) => {
    const flower = FLOWER_BY_ID.get(id);
    if (!flower) return [];
    return [{ id, name: flower.name, rarity: flower.rarity, count: entry.count, bestQuality: entry.bestQuality, firstAt: entry.firstAt }];
  });
}

export function greenhouseView(record, now) {
  const gh = record.greenhouse, f = gh.farm, cap = FLOWER_RULES.waterCap;
  const view = {
    scene: 'greenhouse',
    revision: record.revision,
    now,
    name: GREENHOUSE_NAME,
    coins: record.wallet,
    season: currentSeason(now).name,
    nextTickAt: f.lastTickAt + FLOWER_RULES.tickMs,
    rules: {
      tickMs: FLOWER_RULES.tickMs,
      seedPrice: { ...FLOWER_RULES.seedPrice },
      growTicks: { ...FLOWER_RULES.growTicks },
      waterCap: cap,
    },
    land: { name: GREENHOUSE_NAME, count: f.plots.length, next: null },
    /* 种植中的盆只报「种的是普通还是奇幻花种」，绝不报最终是哪一朵 —— 揭晓前不泄题 */
    flowerPlots: f.plots.map(p => ({
      id: p.id,
      state: !p.crop ? 'empty' : p.crop.ripe ? 'ripe' : 'growing',
      seedType: p.crop?.seedType ?? null,
      progress: p.crop?.progress ?? 0,
      growTicks: p.crop?.growTicks ?? 0,
      watered: p.crop?.waterCount ?? 0,
      readyAt: (!p.crop || p.crop.ripe) ? null : f.lastTickAt + (p.crop.growTicks - p.crop.progress) * FLOWER_RULES.tickMs,
      canWater: !!p.crop && !p.crop.ripe && (p.crop.waterCount ?? 0) < cap,
      needsWater: needsWater(p, cap),
    })),
    flowerCodex: flowerCodexList(gh),
    flowerHistory: gh.history ?? [],
    harvested: f.harvested ?? 0,
  };
  mergeActors(record, 'greenhouse', view.flowerPlots);
  return view;
}

/** 上游 roll 出来的作物稀有度 → 这一池里的哪一朵花 */
export function pickFlower(seedType, rolledRarity) {
  const pool = FLOWER_POOL[seedType] ?? FLOWER_POOL.common;
  return pool.find(f => f.when.includes(rolledRarity)) ?? pool[pool.length - 1];
}

/* value 一律按「这一笔收获实际进钱包的钱，减去图鉴奖励」倒推，不直接抄 result.value。
   上游除了售价还有别的加钱路（收获奖励事件的额外金币、季节事件倍率…），
   抄 result.value 会让卡面上「收成 N 金 · 新图鉴奖励 M 金」跟钱包实涨对不上账。
   倒推是按结果说话：以后上游再加一条加钱路，这里也不会说谎。 */
function gardenReveal(result, now, earned) {
  return {
    id: result.crop.id, name: result.crop.name, rarity: result.crop.rarity,
    quality: result.quality.name, value: earned - (result.codexReward ?? 0),
    codexReward: result.codexReward, isNew: result.isNew, at: now,
    bonus: result.bonus ? { name: result.bonus.name, text: result.bonus.text } : null,
  };
}

function flowerReveal(record, seedType, result, now) {
  const gh = record.greenhouse;
  const flower = pickFlower(seedType === 'fantasy' ? 'fantasy' : 'common', result.crop?.rarity);
  const tier = result.quality?.tier ?? 1;
  const prev = gh.codex[flower.id];
  const isNew = !prev;
  if (isNew) gh.codex[flower.id] = { count: 1, bestQuality: tier, firstAt: now };
  else { prev.count += 1; prev.bestQuality = Math.max(prev.bestQuality ?? 0, tier); }
  /* 头一回见这朵花 → 发我们自己的新花奖励；再见到同一朵是 0。
     这个数会原样写进揭晓卡，也会原样加进唯一钱包（结算在 action() 里，同一笔事务）。 */
  const codexReward = isNew ? (FLOWER_CODEX_REWARD[flower.pool] ?? 0) : 0;
  return {
    id: flower.id, name: flower.name, rarity: flower.rarity,
    quality: result.quality?.name ?? '', value: 0,   // 由 action() 按钱包真实增量回填
    codexReward, isNew, at: now,
    bonus: result.bonus ? { name: result.bonus.name, text: result.bonus.text } : null,
  };
}

/* ── 服务 ─────────────────────────────────────────────────────────────────────
   transact(accountId, callback) 必须跟所有写农场的人共用同一把锁，
   原子提交 farm + greenhouse + wallet + revision + receipts，回调抛异常就整笔回滚。 */
export class SceneService {
  constructor({ transact, clock = Date.now }) { this.transact = transact; this.clock = clock; }

  view(record, scene, now) {
    return scene === 'greenhouse' ? greenhouseView(record, now) : gardenView(record, now);
  }

  async state(accountId, scene) {
    if (!SCENES.includes(scene)) return { ok: false, status: 400, error: '没有这个场景' };
    return this.transact(accountId, record => {
      const now = this.clock();
      ensureScenes(record, now);
      if (advanceAll(record, now)) record.revision++;   // 惰性结算写了状态 → 版本也得往前走
      syncWallet(record);
      return { ok: true, state: this.view(record, scene, now) };
    });
  }

  /** 图鉴只报已揭晓的品种；成熟未收的盆一个字都不带 */
  async codex(accountId) {
    return this.transact(accountId, record => {
      ensureScenes(record, this.clock());
      return { ok: true, scene: 'greenhouse', revision: record.revision, codex: flowerCodexList(record.greenhouse) };
    });
  }

  /* actor ＝ 这一笔是谁按下的：'user'（玩家在页面上点）或 'black'（AI 走 cat/black/farm）。
     只用来记账，不参与幂等 canonical —— 同一个编号换个人重放还是同一件事，不许执行两遍。 */
  async action(accountId, scene, input, key, actor = 'user') {
    if (!SCENES.includes(scene)) return { ok: false, status: 400, error: '没有这个场景' };
    if (!input || !['plant', 'water', 'harvest', 'upgrade'].includes(input.action)) return { ok: false, status: 400, error: '不支持的花园操作' };
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(key ?? '')) return { ok: false, status: 400, error: '缺少操作编号，请刷新后重试' };
    if (!Number.isSafeInteger(input.revision) || input.revision < 0) return { ok: false, status: 400, error: '缺少有效版本号' };
    if (input.action !== 'upgrade' && (!Number.isSafeInteger(input.plotId) || input.plotId < 1)) return { ok: false, status: 400, error: `请选择一${scene === 'greenhouse' ? '个花盆' : '块田'}` };
    if (input.action === 'plant' && !['common', 'fantasy'].includes(input.seedType)) return { ok: false, status: 400, error: '请选择普通或奇幻种子' };

    const canonical = JSON.stringify([scene, input.action, input.plotId ?? null, input.seedType ?? null, input.revision]);

    return this.transact(accountId, record => {
      const clockNow = this.clock();
      ensureScenes(record, clockNow);

      /* 幂等：一个编号只对应一件事。换场景拿同一个编号重放 = 409，不许重新执行。 */
      for (const s of SCENES) {
        if (!Object.hasOwn(record.receipts[s], key)) continue;
        const receipt = record.receipts[s][key];
        if (s !== scene || receipt.canonical !== canonical) {
          return { ok: false, status: 409, error: '操作编号已用于另一项操作', state: this.view(record, scene, clockNow) };
        }
        return { ...receipt.response, replayed: true };
      }

      /* 版本先对，再推时间 —— 时间自己往前走不该把请求带来的版本号作废（同一期） */
      if (input.revision !== record.revision) {
        return { ok: false, status: 409, error: scene === 'greenhouse' ? '花房刚刚有变化，已为你刷新' : '菜地刚刚有变化，已为你刷新', state: this.view(record, scene, clockNow) };
      }

      const now = clockNow;
      advanceAll(record, now);

      const target = scene === 'greenhouse' ? record.greenhouse.farm : record.farm;
      target.coins = record.wallet;             // 装入唯一钱包
      let result, reveal = null;

      if (input.action === 'plant') result = plant(target, input.plotId, input.seedType, undefined, now);
      else if (input.action === 'water') result = water(target, input.plotId, '主人', true);
      else if (input.action === 'upgrade') {
        result = scene === 'greenhouse'
          ? { ok: false, error: '小花房就这八个花盆，暂时扩不了' }
          : upgradeLand(target, now);
      } else {
        const plot = target.plots.find(p => p.id === input.plotId);
        const seedType = plot?.crop?.seedType ?? null;
        const season = plot?.crop?.ripe ? rollSeasonHarvest(target, now) : null;
        const coinsBefore = target.coins;              // 对账基准：这一笔收获前钱包多少
        result = harvest(target, input.plotId, now, season?.mod);
        if (result.ok && scene === 'greenhouse') {
          /* 上游按「它那本看不见的蔬菜图鉴」发的奖励，先原样退回去 ——
             那本图鉴任何接口都不返回，为一份玩家看不见的收集付钱，卡面也对不上账。 */
          if (result.codexReward) target.coins -= result.codexReward;
          reveal = flowerReveal(record, seedType, result, now);
          /* 再发我们自己的新花奖励：卡面写多少，钱包就多多少 */
          if (reveal.codexReward) target.coins += reveal.codexReward;
          reveal.value = (target.coins - coinsBefore) - reveal.codexReward;
        } else if (result.ok) {
          reveal = gardenReveal(result, now, target.coins - coinsBefore);
        }
      }

      checkTitles(target);
      /* aifarm-20260918：记一笔谁干的。只记真的落了地的（result.ok）、且落在某一块地上的
         （upgrade 是整片地的事，没有 plotId，不记）。写在 record.actors 这张兄弟表里，
         上游 Farm 结构一个字没动。 */
      if (result.ok && Number.isSafeInteger(input.plotId)) {
        record.actors[scene][String(input.plotId)] = {
          by: actor === 'black' ? 'black' : 'user',
          at: now,
          action: input.action,
        };
      }
      /* 引擎结果写回唯一钱包（失败的操作引擎没动 coins，这里等于原样写回） */
      if (Number.isFinite(target.coins)) record.wallet = target.coins;
      syncWallet(record);
      record.revision++;

      if (reveal) {
        const book = scene === 'greenhouse' ? record.greenhouse : record;
        book.history.unshift(reveal);
        book.history = book.history.slice(0, 100);
      }

      const response = {
        ok: result.ok, status: result.ok ? 200 : 422, error: result.error ?? null,
        reveal, capped: result.capped ?? false, state: this.view(record, scene, now),
      };
      record.receipts[scene][key] = { canonical, response: structuredClone(response) };
      // Retain a bounded retry window instead of growing the save forever.
      const allReceipts = SCENES.flatMap(s => Object.keys(record.receipts[s]).map(k => ({ scene: s, key: k, at: record.receipts[s][k]?.response?.state?.now || 0 })));
      allReceipts.sort((a, b) => a.at - b.at);
      for (const old of allReceipts.slice(0, Math.max(0, allReceipts.length - 200))) delete record.receipts[old.scene][old.key];
      return response;
    });
  }
}

/* ── HTTP 口 ─────────────────────────────────────────────────────────────────
   跟一期同一套门规：宿主先认自己的会话，永远不信浏览器自报的账号；
   同源 JSON + 自定义头 + Origin 校验 + 体积上限，一条不减。 */
function parseScene(value) {
  if (value === undefined || value === null || value === '') return 'garden';   // 老前端不带 scene = 菜园
  return SCENES.includes(value) ? value : null;
}

export function createSceneApiHandler({ service, resolveAccount }) {
  return async (req, res) => {
    const send = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(value));
    };
    try {
      const account = await resolveAccount(req);   // 宿主自己认人，绝不认浏览器给的账号
      if (!account?.id) return send(401, { ok: false, error: '没有权限进入花园' });
      const url = new URL(req.url, 'http://local');

      if (url.pathname === '/garden/api/state' && req.method === 'GET') {
        const scene = parseScene(url.searchParams.get('scene'));
        if (!scene) return send(400, { ok: false, error: '没有这个场景' });
        const out = await service.state(account.id, scene);
        return send(out.status ?? 200, out);
      }
      if (url.pathname === '/garden/api/greenhouse/codex' && req.method === 'GET') {
        return send(200, await service.codex(account.id));
      }
      if (url.pathname !== '/garden/api/action' || req.method !== 'POST') return send(404, { ok: false, error: '没有这个入口' });
      if (req.headers['x-garden-action'] !== '1' || !String(req.headers['content-type']).startsWith('application/json')) return send(403, { ok: false, error: '请从花园页面操作' });
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(403, { ok: false, error: '请求来源不匹配' });
      let body = '';
      for await (const part of req) { body += part; if (Buffer.byteLength(body) > 8192) return send(413, { ok: false, error: '请求过大' }); }
      let input;
      try { input = JSON.parse(body); } catch { return send(400, { ok: false, error: '请求格式有误' }); }
      const scene = parseScene(input?.scene);
      if (!scene) return send(400, { ok: false, error: '没有这个场景' });
      /* 这条路由永远是玩家本人在页面上点的，actor 钉死 'user'；AI 那条走 cat/black/farm */
      const result = await service.action(account.id, scene, input, req.headers['idempotency-key'], 'user');
      send(result.status ?? 200, result);
    } catch {
      send(503, { ok: false, error: '花园暂时连接不上，请稍后重试' });
    }
  };
}
