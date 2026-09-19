import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadKeys, createAccess, publicOrigin } from '../server/access.mjs';

test('Render Base64 keys work in Bearer authentication and encoded login fragments', async t => {
  const data = await mkdtemp(join(tmpdir(), 'garden-base64-test-'));
  t.after(() => rm(data, { recursive: true, force: true }));
  const user = randomBytes(32).toString('base64') + '+/=';
  const ai = randomBytes(32).toString('base64') + '+/=';
  const keys = await loadKeys(data, { GARDEN_USER_KEY: user, GARDEN_AI_KEY: ai });
  const access = createAccess(keys, 'https://garden.example.com');
  assert.equal(access.role({ headers: { authorization: `Bearer ${ai}` } }), 'ai');
  assert.equal(access.role({ headers: { authorization: `Bearer ${user}` } }), 'user');
  const fragment = new URLSearchParams('key=' + encodeURIComponent(user));
  assert.equal(fragment.get('key'), user);
  await assert.rejects(loadKeys(data, { GARDEN_USER_KEY: user }));
  await assert.rejects(loadKeys(data, { GARDEN_USER_KEY: user, GARDEN_AI_KEY: user }));
  await writeFile(join(data, '.garden-keys.json'), 'broken');
  await assert.rejects(loadKeys(data, {}), /Cannot read private/);
  assert.throws(() => publicOrigin('http://garden.example.com'));
  assert.throws(() => publicOrigin('https://garden.example.com/subpath'));
  assert.equal(publicOrigin('https://garden.example.com/'), 'https://garden.example.com');
});
