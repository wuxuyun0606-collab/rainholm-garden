import express from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { InvalidGrantError, InvalidTokenError, InvalidClientMetadataError, InvalidScopeError, InvalidTargetError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { newKey, equal } from './access.mjs';

const hash = s => createHash('sha256').update(s).digest('hex');
const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

// A single garden owner approves narrowly scoped AI access. Protocol endpoints,
// registered redirect validation, client authentication and PKCE use the SDK.
export async function createOAuth({ access, publicBase, dataDir }) {
  if (!publicBase) return { verify: async () => false, app: null };
  const resource = publicBase + '/mcp';
  const file = join(dataDir, '.garden-oauth.json');
  let state = { clients: {}, tokens: {} };
  try { state = JSON.parse(await readFile(file, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw new Error('Cannot read private OAuth state. Restore it before starting.'); }
  if (!state.clients || !state.tokens) throw new Error('Invalid OAuth state.');
  const pending = new Map(), codes = new Map();
  let writes = Promise.resolve();
  const persist = () => {
    for (const [key, token] of Object.entries(state.tokens)) if (token.exp <= Date.now()) delete state.tokens[key];
    const snapshot = JSON.stringify(state);
    const next = writes.then(async () => { await writeFile(file + '.tmp', snapshot, { mode: 0o600 }); await rename(file + '.tmp', file); });
    writes = next.catch(() => {}); return next;
  };
  function checkResource(value) { if (value && value.toString() !== resource) throw new InvalidTargetError('This authorization is only for this garden MCP resource.'); }
  function checkScopes(scopes) { if (scopes?.some(s => s !== 'garden:play')) throw new InvalidScopeError('Only garden:play is supported.'); }
  function codeFor(client, code) {
    const item = codes.get(code);
    if (!item || item.clientId !== client.client_id || item.exp < Date.now()) throw new InvalidGrantError('Invalid or expired code.');
    return item;
  }
  async function issue(clientId, grant = randomUUID()) {
    const accessToken = newKey(), refreshToken = newKey();
    if (Object.keys(state.tokens).length > 2000) throw new InvalidGrantError('Too many active grants; revoke unused connections.');
    state.tokens[hash(accessToken)] = { kind: 'access', clientId, grant, exp: Date.now() + 3600000 };
    state.tokens[hash(refreshToken)] = { kind: 'refresh', clientId, grant, exp: Date.now() + 30 * 86400000 };
    await persist();
    return { access_token: accessToken, refresh_token: refreshToken, token_type: 'Bearer', expires_in: 3600, scope: 'garden:play' };
  }
  const provider = {
    clientsStore: {
      getClient: id => Object.hasOwn(state.clients, id) ? state.clients[id] : undefined,
      async registerClient(client) {
        if (Object.keys(state.clients).length >= 200) throw new InvalidClientMetadataError('Client limit reached.');
        if (!client.redirect_uris?.length || client.redirect_uris.length > 10) throw new InvalidClientMetadataError('Register 1–10 redirect URIs.');
        for (const uri of client.redirect_uris) {
          const u = new URL(uri);
          if (u.protocol !== 'https:' || u.username || u.password || u.hash) throw new InvalidClientMetadataError('Redirects must use HTTPS without credentials or fragments.');
        }
        checkScopes(client.scope?.split(' ').filter(Boolean));
        const saved = { ...client, client_id: randomUUID(), client_id_issued_at: Math.floor(Date.now() / 1000) };
        state.clients[saved.client_id] = saved; await persist(); return saved;
      },
    },
    async authorize(client, params, res) {
      checkResource(params.resource); checkScopes(params.scopes);
      for (const [key, value] of pending) if (value.exp < Date.now()) pending.delete(key);
      for (const [key, value] of codes) if (value.exp < Date.now()) codes.delete(key);
      if (pending.size >= 200) throw new InvalidGrantError('Too many pending authorizations.');
      const id = newKey(), csrf = newKey();
      pending.set(id, { clientId: client.client_id, params, csrf: hash(csrf), exp: Date.now() + 600000, attempts: 0 });
      res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'" });
      res.cookie('rh_oauth_csrf', csrf, { httpOnly: true, secure: true, sameSite: 'lax', path: '/oauth/approve', maxAge: 600000 });
      res.type('html').send(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/connect/style.css"><title>授权花园伙伴</title><main><p class="eyebrow">RAINHOLM GARDEN</p><h1>让 AI 走进花园</h1><p>客户端：<strong>${escape(client.client_name || 'MCP client')}</strong></p><p>回调域名：${escape(new URL(params.redirectUri).host)}</p><p>授权后，该客户端可以读取花园状态和最近消息、指挥黑猫、种浇收。它不能取得玩家钥匙，也不能管理连接设置。只有你主动发起的连接才应继续。</p><form method="post" action="/oauth/approve"><input type="hidden" name="transaction" value="${id}"><label for="key">玩家钥匙</label><input id="key" name="key" type="password" required autocomplete="off"><button name="decision" value="approve">授权这个伙伴</button><button name="decision" value="deny" formnovalidate class="secondary">取消</button></form></main></html>`);
    },
    async challengeForAuthorizationCode(client, code) { return codeFor(client, code).params.codeChallenge; },
    async exchangeAuthorizationCode(client, code, _verifier, redirectUri, requestedResource) {
      const item = codeFor(client, code); checkResource(requestedResource);
      if (redirectUri !== item.params.redirectUri) throw new InvalidGrantError('Redirect mismatch.');
      codes.delete(code); return issue(client.client_id);
    },
    async exchangeRefreshToken(client, refreshToken, scopes, requestedResource) {
      checkScopes(scopes); checkResource(requestedResource);
      const item = state.tokens[hash(refreshToken)];
      if (!item || item.kind !== 'refresh' || item.clientId !== client.client_id || item.exp < Date.now()) throw new InvalidGrantError('Invalid refresh token.');
      // Rotate refresh tokens; a replay revokes the old credential automatically.
      delete state.tokens[hash(refreshToken)]; return issue(client.client_id, item.grant);
    },
    async verifyAccessToken(token) {
      if (typeof token !== 'string') throw new InvalidTokenError('Missing token.');
      const item = state.tokens[hash(token)];
      if (!item || item.kind !== 'access' || item.exp <= Date.now()) throw new InvalidTokenError('Invalid or expired token.');
      return { token, clientId: item.clientId, scopes: ['garden:play'], expiresAt: Math.floor(item.exp / 1000), resource: new URL(resource) };
    },
    async revokeToken(client, request) {
      const item = state.tokens[hash(request.token)];
      if (item?.clientId === client.client_id) {
        for (const [key, value] of Object.entries(state.tokens)) if (value.grant === item.grant && value.clientId === client.client_id) delete state.tokens[key];
        await persist();
      }
    },
  };
  const app = express(); app.disable('x-powered-by');
  app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use(mcpAuthRouter({ provider, issuerUrl: new URL(publicBase), resourceServerUrl: new URL(resource), scopesSupported: ['garden:play'], resourceName: 'Rainholm Garden' }));
  app.post('/oauth/approve', express.urlencoded({ extended: false, limit: '8kb' }), async (req, res) => {
    const item = pending.get(req.body.transaction);
    const csrf = /(?:^|;\s*)rh_oauth_csrf=([^;]+)/.exec(req.headers.cookie || '')?.[1];
    if (!item || item.exp < Date.now() || !csrf || !equal(hash(csrf), item.csrf) || req.headers.origin !== publicBase) return res.status(403).send('授权已过期或请求来源不匹配，请从客户端重新连接。');
    if (++item.attempts > 5) { pending.delete(req.body.transaction); return res.status(429).send('尝试过多，请重新连接。'); }
    const target = new URL(item.params.redirectUri);
    if (item.params.state) target.searchParams.set('state', item.params.state);
    if (req.body.decision === 'deny') target.searchParams.set('error', 'access_denied');
    else {
      if (!equal(req.body.key, access.keys.user)) return res.status(401).send('玩家钥匙不正确。请返回后重新填写。');
      const code = newKey(); codes.set(code, { ...item, exp: Date.now() + 60000 }); target.searchParams.set('code', code);
    }
    pending.delete(req.body.transaction);
    res.set('Referrer-Policy', 'no-referrer'); return res.redirect(303, target.toString());
  });
  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  app.use((_error, _req, res, _next) => res.status(400).json({ error: 'invalid_request' }));
  return { app, provider, verify: async token => { try { await provider.verifyAccessToken(token); return true; } catch { return false; } } };
}
