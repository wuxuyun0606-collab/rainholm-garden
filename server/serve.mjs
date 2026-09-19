


import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newRecord } from './garden.mjs';
import { SceneService, createSceneApiHandler, checkRuleDrift, ensureScenes, SCENES } from './scenes.mjs';
import { buildMap, renderMapMd, MAP_SCENES } from './ai-map.mjs';

const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const WEB = resolve(ROOT, 'web');
const DATA_DIR = process.env.GARDEN_DATA ? resolve(process.env.GARDEN_DATA) : resolve(ROOT, 'data');
const SAVE_FILE = resolve(DATA_DIR, 'garden-save.json');
/* 示例档永远从仓库自带的 data/ 里读，不跟着 GARDEN_DATA 走 —— 换存档目录的人
   多半是想另开一局，而不是想丢掉示例开局。 */
const EXAMPLE_FILE = resolve(ROOT, 'data', 'example-save.json');
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '127.0.0.1';
const ACCOUNT = 'local';              /* 单机单账号，没有第二个人 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const LOOPBACK_ONLY = LOOPBACK_HOSTS.has(HOST === '::1' ? '[::1]' : HOST);

await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });

/* ── 存档：唯一写入口 ─────────────────────────────────────────────────────── */
let queue = Promise.resolve();

async function loadRecord() {
  try { return JSON.parse(await readFile(SAVE_FILE, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  try {
    const record = JSON.parse(await readFile(EXAMPLE_FILE, 'utf8'));
    /* 示例档里的时间戳是打包那天定的，直接开局的话两块示范田一进门就熟了。
       第一次落地时把两台引擎的钟拨到现在 —— 种下去的那一刻就是你按下 start 的那一刻。 */
    const now = Date.now();
    for (const farm of [record.farm, record.greenhouse?.farm]) {
      if (!farm) continue;
      farm.createdAt = now;
      farm.lastTickAt = now;
    }
    return record;
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return newRecord('小小花园');
}

function transact(_accountId, fn) {
  const task = queue.then(async () => {
    const record = await loadRecord();
    const before = JSON.stringify(record);
    /* 回调抛异常 ＝ 这一整笔不落盘：内存里那份跟着本次事务一起丢，下一笔重新读，等于回滚。 */
    const result = fn(record);
    const after = JSON.stringify(record);
    if (after !== before) {
      await writeFile(SAVE_FILE + '.tmp', after, { mode: 0o600 });
      await rename(SAVE_FILE + '.tmp', SAVE_FILE);
    }
    return result;
  });
  queue = task.then(() => { }, () => { });
  return task;
}

const service = new SceneService({ transact });
checkRuleDrift();   /* 启动时对一次花房数值和上游的账，漂了就在日志里喊 */
const api = createSceneApiHandler({ service, resolveAccount: async () => ({ id: ACCOUNT }) });

/* ── 黑猫口子 catcontrol20260912 ───────────────────────────────────────────
 * 产品设定：白猫 ＝ 使用者（在页面上点地面指挥），黑猫 ＝ 你的 AI。
 * 这两条就是留给「把自己的 AI 接进来」的口子 —— 你的 AI（脚本、机器人、
 * 别的服务，随便什么）往 POST 里塞一个坐标或一句话，页面每 3 秒来取一次，
 * 黑猫就走过去 / 在头顶冒一句。
 *
 *   curl -X POST http://127.0.0.1:5173/garden/api/cat/black \
 *        -H 'Content-Type: application/json' -d '{"x":1200,"y":880,"say":"我来了"}'
 *
 * 只存在内存里，**不落存档**：这是「此刻让黑猫做什么」，不是花园的状态，
 * 进程重启就该忘掉。新的一条直接盖掉旧的（AI 改主意了就以最后一句为准）。
 * 前端 GET 一次就清空 —— 同一条指令不会被两个标签页各执行一遍。
 *
 * ⚠️ 没有鉴权，也不打算有：整个服务默认只听 127.0.0.1，能连上这个端口的人
 *    本来就能种你的地。要放到公网，照文件头那条，自己在前面架反代 + 登录。 */
const SAY_MAX = 30;                     /* 气泡最多 30 字，超了截断（前端还会再截一次） */
let blackPending = null;                /* { x?, y?, say?, ts } —— 顶多一条 */

function sendJson(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(value));
}

// Browser requests must come from this service. Command-line AI clients may
// omit Origin, but JSON writes cannot be submitted by a cross-site HTML form.
function browserRequestAllowed(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  if (req.headers.origin) {
    try {
      const origin = new URL(req.headers.origin);
      if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host) return false;
    } catch { return false; }
  }
  if (req.method === 'POST') {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') return false;
  }
  return true;
}

async function readBody(req, limit = 4096) {
  let body = '';
  for await (const part of req) {
    body += part;
    if (Buffer.byteLength(body) > limit) return null;
  }
  return body;
}


const FARM_ACTIONS = ['plant', 'water', 'harvest'];

function newIdempotencyKey() {
  return `cat-black-${Date.now().toString(36)}-${randomUUID().replace(/-/g, '')}`;   /* 49 位，落在 16–100 内 */
}

async function catBlackFarm(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: '只收 POST' });
  const body = await readBody(req);
  if (body === null) return sendJson(res, 413, { ok: false, error: '请求过大' });
  let input;
  try { input = body ? JSON.parse(body) : {}; }
  catch { return sendJson(res, 400, { ok: false, error: '请求格式有误' }); }

  const scene = input?.scene === undefined || input?.scene === null || input?.scene === '' ? 'garden' : input.scene;
  if (!SCENES.includes(scene)) return sendJson(res, 400, { ok: false, error: '没有这个场景（只有 garden / greenhouse）' });
  if (!FARM_ACTIONS.includes(input?.action)) return sendJson(res, 400, { ok: false, error: '只接 plant / water / harvest' });
  /* plot 是给 AI 用的人话字段（1 起），引擎里叫 plotId；两个都收，plot 优先 */
  const plotId = Number(input?.plot ?? input?.plotId);
  if (!Number.isSafeInteger(plotId) || plotId < 1) return sendJson(res, 400, { ok: false, error: '要指明第几块地（plot，从 1 起）' });
  if (input.action === 'plant' && !['common', 'fantasy'].includes(input?.seedType)) {
    return sendJson(res, 400, { ok: false, error: '种之前要说普通还是奇幻种子（seedType: common|fantasy）' });
  }

  let out = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const snapshot = await service.state(ACCOUNT, scene);
    if (!snapshot?.ok) return sendJson(res, snapshot?.status ?? 503, { ok: false, error: snapshot?.error ?? '花园读不到', by: 'black' });
    const order = { scene, action: input.action, plotId, revision: snapshot.state.revision };
    if (input.action === 'plant') order.seedType = input.seedType;
    out = await service.action(ACCOUNT, scene, order, newIdempotencyKey(), 'black');
    if (out?.status === 409 && attempt === 0) continue;   /* 玩家同一瞬间也点了一下：重取版本再来一次 */
    break;
  }

  /* 说一句：走的还是原来那条内存 pending，前端 3 秒内取走冒泡。文案由调用方给，服务端不编。
     只在真的落了地才说 —— 失败了还冒一句「我收了」是撒谎。 */
  if (out?.ok && typeof input?.say === 'string' && input.say.trim()) {
    blackPending = { ts: Date.now(), say: Array.from(input.say.trim()).slice(0, SAY_MAX).join('') };
  }
  return sendJson(res, out?.status ?? 200, { ...out, by: 'black' });
}

/* aifarm-20260918：AI 可读地图。坐标一律现读 web 那几份源文件，不落死数（见 ai-map.mjs 文件头）。 */
async function catBlackMap(req, res, wantMarkdown) {
  if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: '只收 GET' });
  const scene = new URL(req.url, 'http://local').searchParams.get('scene') || 'garden';
  if (!MAP_SCENES.includes(scene)) return sendJson(res, 400, { ok: false, error: `没有这个场景（只有 ${MAP_SCENES.join(' / ')}）` });
  let map;
  try { map = await buildMap({ root: ROOT, scene, service, account: ACCOUNT, port: PORT }); }
  catch (e) { return sendJson(res, 500, { ok: false, error: '地图现算失败：' + (e?.message || e) }); }
  if (!wantMarkdown) return sendJson(res, 200, map);
  res.writeHead(200, {
    'Content-Type': 'text/markdown; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  });
  res.end(renderMapMd(map));
}

async function catBlackApi(req, res, path) {
  if (path === '/garden/api/cat/black/pending') {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: '只收 GET' });
    const pending = blackPending;
    blackPending = null;                /* 取走即清 */
    return sendJson(res, 200, { ok: true, pending });
  }
  if (path === '/garden/api/cat/black/farm') return catBlackFarm(req, res);
  if (path === '/garden/api/cat/black/map') return catBlackMap(req, res, false);
  if (path === '/garden/api/cat/black/map.md') return catBlackMap(req, res, true);
  if (path !== '/garden/api/cat/black') return sendJson(res, 404, { ok: false, error: '没有这个入口' });
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: '只收 POST' });
  const body = await readBody(req);
  if (body === null) return sendJson(res, 413, { ok: false, error: '请求过大' });
  let input;
  try { input = body ? JSON.parse(body) : {}; }
  catch { return sendJson(res, 400, { ok: false, error: '请求格式有误' }); }

  const order = { ts: Date.now() };
  /* 坐标是花园底图的世界坐标（1536×1024），跟 web/host-cat.js 里那套同一把尺。
     只认成对的有限数：给一半等于没给，直接当没说。 */
  const x = Number(input?.x), y = Number(input?.y);
  if (Number.isFinite(x) && Number.isFinite(y)) { order.x = x; order.y = y; }
  if (typeof input?.say === 'string' && input.say.trim()) {
    order.say = Array.from(input.say.trim()).slice(0, SAY_MAX).join('');
  }
  if (order.x === undefined && order.say === undefined) {
    return sendJson(res, 400, { ok: false, error: '要么给 x/y，要么给 say，总得说一句' });
  }
  blackPending = order;                 /* 新的盖旧的 */
  return sendJson(res, 200, { ok: true, pending: order });
}

/* ── 静态 ─────────────────────────────────────────────────────────────────── */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  /* Live2D 小猫的 moc3 二进制。白名单是拒收制，缺这行猫会 404 静默消失。 */
  '.moc3': 'application/octet-stream',
  /* duoscenes-20260915：小窝两幕双猫的带 alpha 循环片（VP9 alpha_mode=1）。
     白名单是拒收制，缺这行视频会 404，幕布上只剩一张静帧。 */
  '.webm': 'video/webm',
};

function deny(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = createServer(async (req, res) => {
  // Reject arbitrary Host names on a loopback-only server (DNS rebinding).
  if (LOOPBACK_ONLY) {
    try {
      const host = new URL(`http://${req.headers.host}`);
      if (!LOOPBACK_HOSTS.has(host.hostname)) return deny(res, 403, '请求主机不匹配');
    } catch { return deny(res, 400, '请求主机有误'); }
  }
  let path;
  try { path = decodeURIComponent(new URL(req.url, 'http://local').pathname); }
  catch { return deny(res, 400, '请求地址有误'); }

  try {
    if (path === '/' || path === '/garden') {
      res.writeHead(302, { Location: '/garden/', 'Cache-Control': 'no-store' });
      return res.end();
    }
    if (!path.startsWith('/garden/')) return deny(res, 404, 'Not found');
    if (path.startsWith('/garden/api/') && !browserRequestAllowed(req)) {
      return sendJson(res, 403, { ok: false, error: '请求来源或内容类型不匹配' });
    }
    /* 黑猫口子走自己的处理器：走位/说话那两条不碰存档、不认账号，别塞进场景 API 里。
       aifarm-20260918：底下又多了 /farm（种地，这条是要落存档的）和 /map、/map.md（读地图）。 */
    if (path === '/garden/api/cat/black' || path.startsWith('/garden/api/cat/black/')) {
      return catBlackApi(req, res, path);
    }
    if (path.startsWith('/garden/api/')) return api(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') return deny(res, 405, '不支持的方法');

    let relative = path.replace(/^\/garden\/?/, '');
    if (relative === '' || relative.endsWith('/')) relative += 'index.html';
    relative = normalize(relative);
    const file = resolve(WEB, relative);
    if (file !== WEB && !file.startsWith(WEB + '/')) return deny(res, 403, '越界');

    const ext = extname(file);
    /* 白名单扩展名：备份文件、临时档、写漏的存档一律不外发 */
    if (!Object.hasOwn(MIME, ext)) return deny(res, 404, '没有这个东西');

    const st = await stat(file).catch(() => null);
    if (!st || !st.isFile()) return deny(res, 404, '没有这个东西');
    /* 换图 = 覆盖文件，刷新就该看见，所以一律 no-cache + ETag：
       浏览器每次来问一句，没换就 304（省流量），换了立刻拿到新的。 */
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache, must-revalidate' });
      return res.end();
    }
    const buf = await readFile(file).catch(() => null);
    if (!buf) return deny(res, 404, '没有这个东西');

    const head = {
      'Content-Type': MIME[ext],
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'Cache-Control': 'no-cache, must-revalidate',
      ETag: etag,
      'Last-Modified': new Date(st.mtimeMs).toUTCString(),
    };

    /* duoscenes-20260915：单段 Range。只在浏览器真的开口要（Range: bytes=…）时走这条，
       没开口的一律还是原来那条 200 全量 —— 老行为一个字节都没变。
       加它是因为 <video> 在一部分浏览器（尤其 iOS/Safari）上不认不支持 Range 的源，
       整片拉不动就只剩一张静帧。多段 Range 不接（浏览器对小片单段就够），
       格式不认识就当没说过，照常发全量，这是 RFC 允许的做法。 */
    const rangeHdr = req.headers.range;
    const m = typeof rangeHdr === 'string' && /^bytes=(\d*)-(\d*)$/.exec(rangeHdr.trim());
    if (m && (m[1] !== '' || m[2] !== '')) {
      let start, end;
      if (m[1] === '') { const n = Number(m[2]); start = Math.max(0, st.size - n); end = st.size - 1; }
      else { start = Number(m[1]); end = m[2] === '' ? st.size - 1 : Math.min(Number(m[2]), st.size - 1); }
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= st.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}`, 'Cache-Control': 'no-cache, must-revalidate' });
        return res.end();
      }
      head['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
      head['Accept-Ranges'] = 'bytes';
      head['Content-Length'] = String(end - start + 1);
      res.writeHead(206, head);
      return res.end(req.method === 'HEAD' ? undefined : buf.subarray(start, end + 1));
    }

    head['Accept-Ranges'] = 'bytes';
    res.writeHead(200, head);
    res.end(req.method === 'HEAD' ? undefined : buf);
  } catch (e) {
    try { deny(res, 500, '花园暂时打不开'); } catch { /* 响应已经开始就算了 */ }
    console.error('[garden]', e?.message || e);
  }
});

/* 启动前把存档铺一次：示例档里的两块示范田在这一刻就落进 data/garden-save.json，
   省得第一次 GET /state 才建。ensureScenes 顺手把花房那八盆补齐。 */
await transact(ACCOUNT, record => ensureScenes(record));

server.listen(PORT, HOST, () => {
  console.log(`Rainholm Garden on http://${HOST}:${PORT}/garden/  ·  save=${SAVE_FILE}`);
  if (HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1') {
    console.warn('⚠️  监听的不是回环地址，这个服务没有任何鉴权，请自己在前面加一层。');
  }
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
