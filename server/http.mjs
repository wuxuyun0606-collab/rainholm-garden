import { readFile, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, extname, normalize } from 'node:path';
import { SceneService, createSceneApiHandler, checkRuleDrift } from './scenes.mjs';
import { renderMapMd } from './ai-map.mjs';
import { createAccess, equal } from './access.mjs';
import { createAgent } from './agent.mjs';
import { handleMcp } from './mcp.mjs';
import { openapi } from './openapi.mjs';
import { createOAuth } from './oauth.mjs';

// Shared HTTP behavior; each host supplies its own durable transaction storage.
export async function createGardenHandler({ root = '/', dataDir, transact, keys,
  publicBase = '', baseUrl = () => publicBase, mapSources, oauthStorage, agentStorage,
  staticHandler, localHosts = true }) {
  const ROOT = root, WEB = resolve(root, 'web'), DATA_DIR = dataDir;
  const PUBLIC_BASE = publicBase, ACCOUNT = 'local';
  const service = new SceneService({ transact });
  checkRuleDrift();   /* 启动时对一次花房数值和上游的账，漂了就在日志里喊 */
  const api = createSceneApiHandler({ service, resolveAccount: async () => ({ id: ACCOUNT }) });

  const access = createAccess(keys, PUBLIC_BASE, { localHosts });
  const agent = createAgent({ root: ROOT, service, transact, baseUrl, mapSources,
    liveState: await agentStorage?.load(), saveLiveState: agentStorage?.save });
  const loginAttempts = new Map();

  function sendJson(res, status, value, headers = {}) {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', ...headers,
    });
    res.end(JSON.stringify(value));
  }

  async function jsonBody(req, limit = 16384) {
    if (String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') {
      const e = new Error('Content-Type must be application/json'); e.status = 403; throw e;
    }
    const chunks = []; let size = 0;
    for await (const part of req) {
      chunks.push(part); size += part.length;
      if (size > limit) { const e = new Error('Request too large'); e.status = 413; throw e; }
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { const e = new Error('Invalid JSON'); e.status = 400; throw e; }
  }

  function requireRole(req, res, roles) {
    const role = access.role(req);
    if (roles.includes(role)) return true;
    sendJson(res, role ? 403 : 401, { ok: false, error: role ? 'This key has a different role.' : 'Sign in or supply the correct Bearer key.' });
    return false;
  }

  async function connectionApi(req, res, path) {
    if (!access.browserAllowed(req)) return sendJson(res, 403, { ok: false, error: 'Cross-site request denied.' });
    if (path === '/auth/login' && req.method === 'POST') {
      const id = req.socket.remoteAddress;
      const now = Date.now();
      const entry = loginAttempts.get(id) || { count: 0, until: now + 60000 };
      if (entry.until < now) { entry.count = 0; entry.until = now + 60000; }
      if (entry.count++ >= 20) return sendJson(res, 429, { ok: false, error: 'Too many attempts; wait one minute.' });
      if (loginAttempts.size > 1000) loginAttempts.clear();
      loginAttempts.set(id, entry);
      const input = await jsonBody(req);
      if (!equal(input.key, access.keys.user)) return sendJson(res, 401, { ok: false, error: '请输入玩家钥匙，AI 钥匙不能登录网页。' });
      loginAttempts.delete(id);
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': access.loginCookie() });
    }
    if (path === '/auth/logout' && req.method === 'POST') return sendJson(res, 200, { ok: true }, { 'Set-Cookie': access.logoutCookie() });
    if (!requireRole(req, res, ['user'])) return;
    if (path === '/garden/api/backup' && req.method === 'GET') {
      const save = await transact(ACCOUNT, record => structuredClone(record));
      return sendJson(res, 200, save, { 'Content-Disposition': 'attachment; filename=rainholm-garden-save.json' });
    }
    if (path === '/garden/api/connection' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, baseUrl: PUBLIC_BASE || `http://${req.headers.host}`, publicReady: !!PUBLIC_BASE,
        aiKey: access.keys.ai, mcpPath: '/mcp', openapiPath: '/openapi.json', oauth: !!PUBLIC_BASE });
    }
    if (path === '/garden/api/relay' && req.method === 'POST') {
      const out = await agent.execute(await jsonBody(req)); return sendJson(res, out.status || 200, out);
    }
    if (path === '/garden/api/messages' && req.method === 'POST') return sendJson(res, 200, agent.say((await jsonBody(req)).text));
    return sendJson(res, 404, { ok: false });
  }

  async function aiApi(req, res, path) {
    if (path === '/garden/api/cat/black/pending') {
      if (!requireRole(req, res, ['user'])) return;
      if (req.method !== 'GET') return sendJson(res, 405, { ok: false });
      const scene = new URL(req.url, 'http://local').searchParams.get('scene');
      return sendJson(res, 200, { ok: true, pending: agent.pending(scene) });
    }
    if (!requireRole(req, res, ['ai', 'user'])) return;
    const url = new URL(req.url, 'http://local');
    const scene = url.searchParams.get('scene') || 'garden';
    if (path === '/garden/api/ai/state' && req.method === 'GET') {
      return sendJson(res, 200, await agent.state(scene, Number(url.searchParams.get('since') || 0)));
    }
    if ((path === '/garden/api/cat/black/map' || path === '/garden/api/cat/black/map.md') && req.method === 'GET') {
      const map = await agent.map(scene);
      if (path.endsWith('.md')) {
        res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(renderMapMd(map));
      }
      return sendJson(res, 200, map);
    }
    if (!requireRole(req, res, ['ai'])) return;
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false });
    const body = await jsonBody(req, 4096);
    let input;
    if (path === '/garden/api/ai/action') input = body;
    else if (path === '/garden/api/cat/black/farm') input = { ...body, plot: body.plot ?? body.plotId, requestId: body.requestId || randomUUID() };
    else if (path === '/garden/api/cat/black') input = { ...body, action: body.x !== undefined ? 'move' : 'say', requestId: body.requestId || randomUUID() };
    else return sendJson(res, 404, { ok: false });
    delete input.plotId;
    const out = await agent.execute(input); return sendJson(res, out.status || 200, out);
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

  const oauth = await createOAuth({ access, publicBase: PUBLIC_BASE, dataDir: DATA_DIR, storage: oauthStorage });

  return async (req, res) => {
    if (!access.hostAllowed(req)) return deny(res, 403, '请求主机不匹配');
    let path;
    try { path = decodeURIComponent(new URL(req.url, 'http://local').pathname); }
    catch { return deny(res, 400, '请求地址有误'); }

    try {
      if (path === '/healthz' && req.method === 'GET') return sendJson(res, 200, { ok: true });
      if (PUBLIC_BASE && (path.startsWith('/.well-known/') || ['/authorize','/token','/register','/revoke','/oauth/approve'].includes(path))) return oauth.app(req, res);
      if (path === '/openapi.json' && req.method === 'GET') return sendJson(res, 200, openapi(PUBLIC_BASE || baseUrl()));
      if (path === '/privacy' && req.method === 'GET') return sendJson(res, 200, { service: 'Rainholm Garden', data: 'Game saves and access credentials stay on this deployment. Connected AI services receive the state and messages you request or share. No analytics. The deployment owner controls retention and backups.' });
      if (path === '/mcp') {
        if (!access.browserAllowed(req)) return sendJson(res, 403, { error: 'Cross-site request denied.' });
        const token = access.bearer(req);
        if (access.role(req) !== 'ai' && !await oauth.verify(token)) {
          return sendJson(res, 401, { error: 'AI authorization required.' }, { 'WWW-Authenticate': PUBLIC_BASE ? `Bearer resource_metadata="${PUBLIC_BASE}/.well-known/oauth-protected-resource/mcp"` : 'Bearer realm="rainholm-garden"' });
        }
        const body = req.method === 'POST' ? await jsonBody(req, 32768) : undefined;
        return await handleMcp(req, res, agent, body);
      }
      if (path.startsWith('/auth/') || ['/garden/api/connection','/garden/api/relay','/garden/api/messages','/garden/api/backup'].includes(path)) return await connectionApi(req, res, path);
      if (path.startsWith('/garden/api/')) {
        if (!access.browserAllowed(req)) return sendJson(res, 403, { ok: false, error: 'Cross-site request denied.' });
        if (path.startsWith('/garden/api/cat/black') || path.startsWith('/garden/api/ai/')) return await aiApi(req, res, path);
        if (!requireRole(req, res, req.method === 'GET' ? ['user','ai'] : ['user'])) return;
        return await api(req, res);
      }
      if (path === '/' || path === '/garden' || path === '/connect') {
        res.writeHead(302, { Location: path === '/garden' ? '/garden/' : '/connect/', 'Cache-Control': 'no-store' }); return res.end();
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return deny(res, 405, '不支持的方法');
      if (!path.startsWith('/garden/') && !path.startsWith('/connect/')) return deny(res, 404, 'Not found');
      if ((path === '/garden/' || path === '/garden/index.html') && access.role(req) !== 'user') {
        res.writeHead(302, { Location: '/connect/', 'Cache-Control': 'no-store' }); return res.end();
      }
      if (staticHandler) return await staticHandler(req, res, path);
      let relative = path.startsWith('/connect/') ? 'connect/' + path.slice('/connect/'.length) : path.slice('/garden/'.length);
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
        ...(path.startsWith('/connect/') ? { 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" } : {}),
        'Content-Type': MIME[ext],
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
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
      try { sendJson(res, e.status || 400, { ok: false, error: e.status ? e.message : '请求无效，检查参数或稍后重试。' }); } catch { /* 响应已经开始就算了 */ }
      console.error('[garden] request failed:', e.name || 'Error');
    }
  };
}
