import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { verifyOAuth } from '../support/oauth-case.mjs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const config = JSON.parse(await readFile(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'));
test('Cloudflare runtime persists the shared garden and authenticates clients', { timeout: 60000 }, async t => {
  const data = await mkdtemp(join(tmpdir(), 'garden-cloudflare-'));
  const keys = { user: randomBytes(32).toString('base64url'), ai: randomBytes(32).toString('base64url') };
  const base = 'https://garden.example.com';
  let mf;
  const options = { name: 'garden-test', modules: true, scriptPath: resolve('.cloudflare/worker.mjs'),
    compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
    bindings: { GARDEN_USER_KEY: keys.user, GARDEN_AI_KEY: keys.ai },
    durableObjects: { GARDEN: { className: 'Garden', useSQLite: true } },
    resourcePersistencePath: data, isolatedResourcePersistencePath: data,
    assets: { directory: resolve('.cloudflare/assets'), binding: 'ASSETS',
      assetConfig: { html_handling: 'none', not_found_handling: 'none' },
      routerConfig: { has_user_worker: true }, run_worker_first: config.assets.run_worker_first },
  };
  t.after(async () => { await mf?.dispose(); await rm(data, { recursive: true, force: true }); });
  mf = new Miniflare(convertV4MiniflareOptions(options));
  const request = (path, init) => mf.dispatchFetch(base + path, { redirect: 'manual', ...init });
  const json = (path, body, key, headers = {}) => request(path, { method: body === undefined ? 'GET' : 'POST',
    headers: { ...(key ? { Authorization: 'Bearer ' + key } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const connect = await request('/connect/'); assert.equal(connect.status, 200, await connect.text());
  const unauth = await request('/garden/api/state'); assert.equal(unauth.status, 401, await unauth.text());
  const login = await json('/auth/login', { key: keys.user }, undefined, { Origin: base });
  assert.equal(login.status, 200, await login.text());
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/garden/', { headers: { Cookie: cookie } })).status, 200);
  const state = await (await json('/garden/api/state', undefined, keys.ai)).json(); assert.equal(state.state.coins, 152);
  const action = { action: 'plant', scene: 'garden', plot: 3, seedType: 'common', requestId: 'cloudflare-plant-0001' };
  const planted = await json('/garden/api/ai/action', action, keys.ai); assert.equal(planted.status, 200, await planted.text());
  await mf.dispose(); mf = new Miniflare(convertV4MiniflareOptions(options));
  const retry = await (await json('/garden/api/ai/action', action, keys.ai)).json(); assert.equal(retry.replayed, true, JSON.stringify(retry));
  const restored = await (await json('/garden/api/state', undefined, keys.ai)).json(); assert.equal(restored.state.coins, 144);
  assert.equal((await json('/garden/api/connection', undefined, keys.ai)).status, 403);
  const mcp = await json('/mcp', {jsonrpc:'2.0',id:1,method:'tools/list'}, keys.ai, {Accept:'application/json, text/event-stream'});
  assert.equal(mcp.status, 200, await mcp.text());
  await mf.unsafeEvictDurableObject('garden-test', 'Garden', { name: 'personal-garden' });
  assert.equal((await (await json('/garden/api/ai/action', action, keys.ai)).json()).replayed, true);
  assert.equal((await json('/garden/api/ai/action', { ...action, plot: 4 }, keys.ai)).status, 409);
  assert.equal((await json('/garden/api/ai/action', action, keys.ai, { Origin: 'https://evil.example' })).status, 403);
  const messages = await json('/garden/api/messages', { text: 'persist across sleep' }, keys.user); assert.equal(messages.status, 200);
  await mf.unsafeEvictDurableObject('garden-test', 'Garden', { name: 'personal-garden' });
  const client = new Client({ name: 'cf-garden-test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
    requestInit: { headers: { Authorization: 'Bearer ' + keys.ai } },
    fetch: (url, init) => mf.dispatchFetch(url, init),
  }));
  const live = JSON.parse((await client.callTool({ name: 'garden_state', arguments: {} })).content[0].text);
  assert.equal(live.messages[0].text, 'persist across sleep');
  for (const scene of ['garden', 'greenhouse', 'cathome']) {
    const map = await client.callTool({ name: 'garden_map', arguments: { scene } }); assert.equal(map.isError, false);
  }
  const commands = await Promise.all(Array.from({ length: 5 }, () => client.callTool({ name: 'garden_action', arguments: {action:'water', scene:'garden', plot:3, requestId:'cf-concurrent-water-0001'} })));
  assert.equal(commands.map(c => JSON.parse(c.content[0].text)).filter(c => !c.replayed).length, 1);
  await client.close();
  await verifyOAuth({ request, json, keys, restart: () => mf.unsafeEvictDurableObject('garden-test', 'Garden', { name: 'personal-garden' }) });
  const assets = await request('/garden/connect-link.css'); assert.equal(assets.status, 200);
  assert.equal((await request('/garden-save.json')).status, 404);
  assert.equal((await request('/.dev.vars')).status, 404);
  const backup = await (await json('/garden/api/backup', undefined, keys.user)).text();
  assert.equal(JSON.parse(backup).wallet, 144); assert.ok(!backup.includes(keys.user)); assert.ok(!backup.includes(keys.ai));
  assert.equal((await json('/garden/api/backup', undefined, keys.ai)).status, 403);
  const schema = await (await request('/openapi.json')).json(); assert.equal(schema.servers[0].url, base);

  const registered = await (await json('/register', { client_name:'epoch-test', redirect_uris:['https://client.example.com/cb'], token_endpoint_auth_method:'none' })).json();
  assert.ok(registered.client_id);
  options.bindings.GARDEN_OAUTH_EPOCH = 'new-test-epoch';
  await mf.dispose(); mf = new Miniflare(convertV4MiniflareOptions(options));
  const oldClient = await request('/authorize?' + new URLSearchParams({client_id:registered.client_id,redirect_uri:'https://client.example.com/cb'}));
  assert.equal(oldClient.status, 400); assert.equal((await oldClient.json()).error, 'invalid_client');
  assert.equal((await (await json('/garden/api/state', undefined, keys.ai)).json()).state.coins, 144);
  options.bindings.GARDEN_AI_KEY = keys.user;
  await mf.dispose(); mf = new Miniflare(convertV4MiniflareOptions(options));
  assert.equal((await request('/healthz')).status, 503);

});
