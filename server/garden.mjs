import { makeFarm } from '../vendor/aifarm/dist/game.js';
import { advance, plant, water, harvest, upgradeLand, nextUpgradeReq } from '../vendor/aifarm/dist/engine.js';
import { rollSeasonHarvest } from '../vendor/aifarm/dist/season-events.js';
import { checkTitles } from '../vendor/aifarm/dist/titles.js';
import { getCrop, landTierByLevel } from '../vendor/aifarm/dist/content.js';
import { currentSeason } from '../vendor/aifarm/dist/time.js';
import { TICK_MS, GROW_TICKS, SEED_PRICE, WATER_LUCK_PER, WATER_LUCK_CAP } from '../vendor/aifarm/dist/config.js';

export const UPSTREAM_COMMIT = '03c307408075dccdcb0ac2c65a543189655873f7';
export function newRecord(name = '小小花园') {
  return { farm: makeFarm(name), revision: 0, receipts: {}, history: [] };
}
export function publicView(record, now) {
  const f = record.farm;
  return {
    revision: record.revision, now, name: f.name, coins: f.coins, season: currentSeason(now).name,
    land: { tier: f.landTier, name: landTierByLevel(f.landTier).name, count: f.plots.length, next: nextUpgradeReq(f) },
    rules: { tickMs: TICK_MS, seedPrice: SEED_PRICE, growTicks: GROW_TICKS, waterCap: Math.round(WATER_LUCK_CAP / WATER_LUCK_PER) },
    plots: f.plots.map(p => ({
      id: p.id, state: !p.crop ? 'empty' : p.crop.ripe ? 'ripe' : 'growing',
      seedType: p.crop?.seedType ?? null, progress: p.crop?.progress ?? 0,
      growTicks: p.crop?.growTicks ?? 0, watered: p.crop?.waterCount ?? 0,
      readyAt: !p.crop || p.crop.ripe ? null : f.lastTickAt + (p.crop.growTicks - p.crop.progress) * TICK_MS,
    })),
    codex: Object.entries(f.codex).flatMap(([id, entry]) => {
      const c = getCrop(id); return c ? [{ id, name: c.name, rarity: c.rarity, category: c.category, count:entry.count, bestQuality:entry.bestQuality, firstAt:entry.firstAt }] : [];
    }),
    history: record.history ?? [], harvested: f.harvested ?? 0,
  };
}
// transact(accountId, callback) MUST serialize with every writer (including AI),
// atomically commit farm + revision + receipts, and roll back if callback throws.
export class GardenService {
  constructor({ transact, clock = Date.now }) { this.transact = transact; this.clock = clock; }
  async state(accountId) {
    return this.transact(accountId, record => {
      const now = this.clock();
      if (advance(record.farm, now)) record.revision++;
      return { ok: true, state: publicView(record, now) };
    });
  }
  async action(accountId, input, key) {
    if (!input || !['plant','water','harvest','upgrade'].includes(input.action)) return { ok:false, status:400, error:'不支持的花园操作' };
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(key ?? '')) return { ok:false, status:400, error:'缺少操作编号，请刷新后重试' };
    if (!Number.isSafeInteger(input.revision) || input.revision < 0) return { ok:false, status:400, error:'缺少有效版本号' };
    if (input.action !== 'upgrade' && (!Number.isSafeInteger(input.plotId) || input.plotId < 1)) return { ok:false, status:400, error:'请选择一块田' };
    if (input.action === 'plant' && !['common','fantasy'].includes(input.seedType)) return { ok:false, status:400, error:'请选择普通或奇幻种子' };
    const canonical = JSON.stringify([input.action,input.plotId ?? null,input.seedType ?? null,input.revision]);
    return this.transact(accountId, record => {
      record.receipts ??= {}; record.history ??= [];
      if (Object.hasOwn(record.receipts,key)) {
        const receipt = record.receipts[key];
        if (receipt.canonical !== canonical) return { ok:false,status:409,error:'操作编号已用于另一项操作' };
        return { ...receipt.response, replayed:true };
      }
      const now = this.clock();
      // Time advancement does not invalidate the revision supplied before this request.
      if (input.revision !== record.revision) return {ok:false,status:409,error:'菜地刚刚有变化，已为你刷新',state:publicView(record,now)};
      advance(record.farm,now);
      const f = record.farm; let result;
      if (input.action === 'plant') result = plant(f,input.plotId,input.seedType,undefined,now);
      if (input.action === 'water') result = water(f,input.plotId,'主人',true);
      if (input.action === 'upgrade') result = upgradeLand(f,now);
      if (input.action === 'harvest') {
        const p = f.plots.find(p=>p.id===input.plotId);
        const season = p?.crop?.ripe ? rollSeasonHarvest(f,now) : null;
        result = harvest(f,input.plotId,now,season?.mod);
      }
      checkTitles(f); record.revision++;
      let reveal = null;
      if (input.action === 'harvest' && result.ok) {
        reveal = {id:result.crop.id,name:result.crop.name,rarity:result.crop.rarity,quality:result.quality.name,value:result.value,codexReward:result.codexReward,isNew:result.isNew,at:now};
        record.history.unshift(reveal); record.history = record.history.slice(0,100);
      }
      const response = {ok:result.ok,status:result.ok?200:422,error:result.error ?? null,reveal,capped:result.capped??false,state:publicView(record,now)};
      record.receipts[key] = {canonical,response:structuredClone(response)};
      return response;
    });
  }
}
export function createApiHandler({ service, resolveAccount }) {
  return async (req,res) => {
    const send = (status,value) => {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
    try {
      const account = await resolveAccount(req); // Host verifies its own session. Never trust browser account IDs.
      if (!account?.id) return send(401,{ok:false,error:'没有权限进入花园'});
      const path = new URL(req.url,'http://local').pathname;
      if (path === '/garden/api/state' && req.method === 'GET') return send(200,await service.state(account.id));
      if (path !== '/garden/api/action' || req.method !== 'POST') return send(404,{ok:false,error:'没有这个入口'});
      if (req.headers['x-garden-action'] !== '1' || !String(req.headers['content-type']).startsWith('application/json')) return send(403,{ok:false,error:'请从花园页面操作'});
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(403,{ok:false,error:'请求来源不匹配'});
      let body='';for await(const part of req){body+=part;if(Buffer.byteLength(body)>8192)return send(413,{ok:false,error:'请求过大'});}
      let input;try{input=JSON.parse(body);}catch{return send(400,{ok:false,error:'请求格式有误'});}
      const result=await service.action(account.id,input,req.headers['idempotency-key']);send(result.status??200,result);
    }catch{send(503,{ok:false,error:'花园暂时连接不上，请稍后重试'});}
  };
}
