import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';

test('standalone garden: shared save and browser request boundaries', { timeout: 20000 }, async t => {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const data = await mkdtemp(join(tmpdir(), 'rainholm-test-'));
  const root = fileURLToPath(new URL('../', import.meta.url));
  const userKey = randomBytes(32).toString('hex'), aiKey = randomBytes(32).toString('hex');
  const child = spawn(process.execPath, ['server/serve.mjs'], {
    cwd: root,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), GARDEN_DATA: data, GARDEN_USER_KEY: userKey, GARDEN_AI_KEY: aiKey, GARDEN_PUBLIC_URL: '', RENDER_EXTERNAL_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', b => { logs += b; });
  child.stderr.on('data', b => { logs += b; });
  t.after(async () => {
    if (child.exitCode === null) {
      const stopped = once(child, 'exit');
      child.kill('SIGTERM');
      await stopped;
    }
    await rm(data, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${port}`;
  const request = (path, options = {}) => fetch(origin + path, { ...options, headers: { Authorization: 'Bearer ' + userKey, ...options.headers } });
  const post = (path, body, headers = {}) => request(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (path.includes('/cat/black') ? aiKey : userKey), ...headers }, body: JSON.stringify(body),
  });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) break;
    try { ready = (await request('/garden/api/state')).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(ready, logs);

  await t.test('page and its direct resources load; private files stay outside web root', async () => {
    const page = await request('/garden/');
    assert.equal(page.status, 200);
    const html = await page.text();
    for (const [, ref] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      if (!ref || ref.startsWith('http')) continue;
      assert.equal((await request(new URL(ref, origin + '/garden/').pathname + new URL(ref, origin + '/garden/').search)).status, 200, ref);
    }
    for (const path of ['/garden/.env', '/garden/data/garden-save.json', '/garden/%2e%2e%2fdata/garden-save.json']) {
      assert.ok([403, 404].includes((await request(path)).status), path);
    }
  });

  await t.test('all three maps are built from the released frontend source', async () => {
    for (const scene of ['garden', 'greenhouse', 'cathome']) {
      const json = await request(`/garden/api/cat/black/map?scene=${scene}`);
      assert.equal(json.status, 200, await json.clone().text());
      const md = await request(`/garden/api/cat/black/map.md?scene=${scene}`);
      assert.equal(md.status, 200);
      assert.ok((await md.text()).length > 200);
    }
  });

  await t.test('cross-site origins, forms and DNS rebinding cannot mutate or consume commands', async () => {
    const cmd = '/garden/api/cat/black';
    assert.equal((await post(cmd, { say: 'test' })).status, 200);
    assert.equal((await post(cmd, { say: 'blocked' }, { Origin: 'https://example.org' })).status, 403);
    assert.equal((await post(cmd, { say: 'blocked' }, { Origin: 'null' })).status, 403);
    assert.equal((await post(cmd, { say: 'blocked' }, { Origin: 'invalid-origin' })).status, 403);
    assert.equal((await post(cmd, { say: 'blocked' }, { 'Content-Type': 'text/plain' })).status, 403);
    assert.equal((await post(cmd, { say: 'blocked' }, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await request(cmd + '/pending', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    const reboundStatus = await new Promise((resolve, reject) => {
      const req = httpRequest(origin + '/garden/api/state', { headers: { Host: `example.org:${port}` } }, res => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(reboundStatus, 403);
    const pending = await (await request(cmd + '/pending', { headers: { Origin: origin } })).json();
    assert.equal(pending.pending.say, 'test');
    assert.equal((await (await request(cmd + '/pending')).json()).pending, null);
    assert.equal((await post(cmd, { say: 'same-origin' }, { Origin: origin })).status, 200);
    assert.equal((await post(cmd, { say: 'x'.repeat(5000) })).status, 413);
  });

  await t.test('AI and player actions update the same wallet and save; player retries are idempotent', async () => {
    const before = await (await request('/garden/api/state')).json();
    const ai = await post('/garden/api/cat/black/farm', { scene: 'garden', action: 'plant', plot: 3, seedType: 'common' });
    assert.equal(ai.status, 200, await ai.clone().text());
    let save = JSON.parse(await readFile(join(data, 'garden-save.json'), 'utf8'));
    assert.equal(save.farm.plots[2].crop.seedType, 'common');
    const state = await (await request('/garden/api/state')).json();
    assert.ok(state.state.revision > before.state.revision);
    const key = 'test-player-water-0001';
    const action = { scene: 'garden', action: 'water', plotId: 3, revision: state.state.revision };
    const headers = { 'X-Garden-Action': '1', 'Idempotency-Key': key, Origin: origin };
    const first = await post('/garden/api/action', action, headers);
    assert.equal(first.status, 200, await first.clone().text());
    const replay = await (await post('/garden/api/action', action, headers)).json();
    assert.equal(replay.replayed, true);
    save = JSON.parse(await readFile(join(data, 'garden-save.json'), 'utf8'));
    assert.equal(save.farm.plots[2].crop.waterCount, 1);
    assert.equal(save.farm.coins, save.greenhouse.farm.coins);
    assert.equal(save.farm.coins, save.wallet);
    const gh = await post('/garden/api/cat/black/farm', { scene: 'greenhouse', action: 'plant', plot: 1, seedType: 'common' });
    assert.equal(gh.status, 200, await gh.clone().text());
    const after = JSON.parse(await readFile(join(data, 'garden-save.json'), 'utf8'));
    assert.equal(after.greenhouse.farm.plots[0].crop.seedType, 'common');
    assert.ok(after.wallet < save.wallet);
    assert.equal(after.farm.coins, after.greenhouse.farm.coins);
  });
});
