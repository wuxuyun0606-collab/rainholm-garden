import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startGarden } from './helper.mjs';

test('launcher, role separation, sessions and persistence', { timeout: 20000 }, async t => {
  const g = await startGarden(t, { launcher: true });
  assert.notEqual(g.keys.user, g.keys.ai);
  assert.equal((await g.request('/garden/api/state')).status, 401);
  assert.equal((await g.request('/garden/')).status, 302);
  assert.equal((await g.request('/connect/')).status, 200);
  assert.equal((await g.json('/garden/api/connection', undefined, g.keys.ai)).status, 403);
  assert.equal((await g.json('/garden/api/action', {}, g.keys.ai)).status, 403);
  assert.equal((await g.json('/garden/api/cat/black/pending', undefined, g.keys.ai)).status, 403);
  assert.equal((await g.json('/auth/login', { key: g.keys.ai })).status, 401);
  const login = await g.json('/auth/login', { key: g.keys.user }, undefined, { Origin: g.origin });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie'); assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
  assert.equal((await g.request('/garden/api/connection', { headers: { Cookie: cookie.split(';')[0] } })).status, 200);
  const tampered = cookie.split(';')[0].slice(0,-1) + '!';
  assert.equal((await g.request('/garden/api/connection', { headers: { Cookie: tampered } })).status, 401);
  const before = JSON.parse(await readFile(join(g.data, '.garden-keys.json')));
  await g.restart();
  assert.deepEqual(JSON.parse(await readFile(join(g.data, '.garden-keys.json'))), before);
  if (process.platform !== 'win32') assert.equal((await stat(join(g.data, '.garden-keys.json'))).mode & 0o777, 0o600);
  assert.ok(!g.output().includes(g.keys.user)); assert.ok(!g.output().includes(g.keys.ai));
});

test('official SDK client executes MCP against the shared save and retry ledger', { timeout: 20000 }, async t => {
  const g = await startGarden(t);
  const client = new Client({ name: 'garden-integration-test', version: '1' });
  const transport = new StreamableHTTPClientTransport(new URL(g.origin + '/mcp'), { requestInit: { headers: { Authorization: 'Bearer ' + g.keys.ai } } });
  t.after(() => client.close());
  await client.connect(transport);
  assert.deepEqual((await client.listTools()).tools.map(x => x.name).sort(), ['garden_action','garden_map','garden_state']);
  const state = await client.callTool({ name: 'garden_state', arguments: {} }); assert.equal(state.isError, false);
  const map = await client.callTool({ name: 'garden_map', arguments: { scene: 'cathome' } }); assert.equal(map.isError, false);
  const action = { action: 'plant', scene: 'garden', plot: 3, seedType: 'common', requestId: 'test-mcp-plant-0001' };
  const planted = JSON.parse((await client.callTool({ name: 'garden_action', arguments: action })).content[0].text); assert.equal(planted.ok, true);
  const replay = JSON.parse((await client.callTool({ name: 'garden_action', arguments: action })).content[0].text); assert.equal(replay.replayed, true);
  const malformed = await client.callTool({ name: 'garden_action', arguments: { action: 'run_shell', command: 'anything' } }); assert.equal(malformed.isError, true);
  const conflicting = await client.callTool({ name: 'garden_action', arguments: { ...action, plot: 4 } }); assert.equal(conflicting.isError, true);
  const chat = await g.json('/garden/api/messages', { text: '测试：帮我看看三号田' }, g.keys.user); assert.equal(chat.status, 200);
  const afterChat = JSON.parse((await client.callTool({ name: 'garden_state', arguments: {} })).content[0].text); assert.equal(afterChat.messages[0].by, 'user');
  await client.close();
  await g.restart();
  const persisted = await (await g.json('/garden/api/ai/action', action, g.keys.ai)).json(); assert.equal(persisted.replayed, true);
  const saved = JSON.parse(await readFile(join(g.data, 'garden-save.json'))); assert.equal(saved.wallet, 144);
  assert.equal((await g.json('/mcp', { jsonrpc:'2.0',id:1,method:'tools/list' }, g.keys.user)).status, 401);
});

test('Actions schema and manual chat exchange share the protected AI operations', async t => {
  const g = await startGarden(t);
  const schema = await (await g.request('/openapi.json')).json(); assert.equal(schema.openapi, '3.1.0');
  assert.equal(schema.components.securitySchemes.gardenKey.scheme, 'bearer');
  assert.equal(Object.keys(schema.paths).length, 3);
  for (const path of Object.keys(schema.paths)) {
    if (path.endsWith('/action')) continue;
    assert.equal((await g.json(path, undefined, g.keys.ai)).status, 200);
  }
  const action = { action:'water',scene:'garden',plot:1,requestId:'test-relay-water-0001' };
  assert.equal((await g.json('/garden/api/relay', action, g.keys.ai)).status, 403);
  const applied = await (await g.json('/garden/api/relay', action, g.keys.user)).json(); assert.equal(applied.ok, true);
  const replay = await (await g.json('/garden/api/relay', action, g.keys.user)).json(); assert.equal(replay.replayed, true);
  assert.equal((await g.json('/garden/api/relay', { ...action, unknown: true }, g.keys.user)).status, 400);
  const cmd = { action:'move',scene:'cathome',x:800,y:600,requestId:'test-move-home-00001' };
  assert.equal((await g.json('/garden/api/ai/action', cmd, g.keys.ai)).status, 200);
  assert.equal((await (await g.json('/garden/api/cat/black/pending?scene=garden',undefined,g.keys.user)).json()).pending, null);
  assert.equal((await (await g.json('/garden/api/cat/black/pending?scene=cathome',undefined,g.keys.user)).json()).pending.x, 800);
});
