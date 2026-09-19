import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function startGarden(t, { publicBase = '', launcher = false } = {}) {
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(done => probe.close(done));
  const data = await mkdtemp(join(tmpdir(), 'rainholm-connect-test-'));
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  let child, output = '';
  const origin = `http://127.0.0.1:${port}`;
  const request = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = httpRequest(origin + path, { method, headers: { ...(publicBase ? { Host: new URL(publicBase).host } : {}), ...headers } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => {
        const resultHeaders = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) for (const item of Array.isArray(v) ? v : [v]) resultHeaders.append(k, item);
        resolve(new Response([204,304].includes(res.statusCode) ? null : Buffer.concat(chunks), { status: res.statusCode, headers: resultHeaders }));
      });
    });
    req.on('error', reject); req.end(body);
  });
  async function stop() {
    if (child && child.exitCode === null) { const done = once(child, 'exit'); child.kill('SIGTERM'); await done; }
  }
  async function start() {
    child = spawn(process.execPath, launcher ? ['start.mjs','--no-open'] : ['server/serve.mjs'], { cwd,
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), GARDEN_DATA: data, GARDEN_USER_KEY: '', GARDEN_AI_KEY: '', GARDEN_PUBLIC_URL: publicBase, RENDER_EXTERNAL_URL: '' },
      stdio: ['ignore','pipe','pipe'] });
    child.stdout.on('data', c => { output += c; }); child.stderr.on('data', c => { output += c; });
    for (let i = 0; i < 120; i++) {
      if (child.exitCode !== null) throw new Error('Garden exited during startup: ' + output);
      try { if ((await request('/healthz')).ok) return; } catch {}
      await new Promise(done => setTimeout(done, 50));
    }
    throw new Error('Garden startup timed out.');
  }
  t.after(async () => { await stop(); await rm(data, { recursive: true, force: true }); });
  await start();
  const keys = JSON.parse(await readFile(join(data, '.garden-keys.json'), 'utf8'));
  return { origin, data, keys, request, output: () => output, restart: async () => { await stop(); await start(); },
    json: (path, body, key, headers = {}) => request(path, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...(key ? { Authorization: 'Bearer ' + key } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }) };
}
