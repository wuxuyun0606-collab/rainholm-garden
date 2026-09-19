import test from 'node:test';
import { startGarden } from './helper.mjs';
import { verifyOAuth } from './support/oauth-case.mjs';

test('remote MCP OAuth: consent, PKCE, refresh, audience and revocation', { timeout: 20000 }, async t => {
  const g = await startGarden(t, { publicBase: 'https://garden.example.com' });
  await verifyOAuth(g);
});
