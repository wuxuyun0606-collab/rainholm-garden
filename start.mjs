#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { loadKeys, publicOrigin } from './server/access.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: {
  lan: { type: 'boolean' }, port: { type: 'string' }, host: { type: 'string' },
  'data-dir': { type: 'string' }, 'public-base-url': { type: 'string' },
  'no-open': { type: 'boolean' }, 'show-access': { type: 'boolean' }, help: { type: 'boolean' },
} });
if (values.help) {
  console.log('node start.mjs [--lan] [--port 5173] [--data-dir PATH] [--public-base-url https://garden.example.com] [--no-open] [--show-access]'); process.exit(0);
}
if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Install Node.js 20 or newer.');
process.chdir(root);
try { createRequire(import.meta.url).resolve('@modelcontextprotocol/sdk/server/index.js'); }
catch {
  console.log('Preparing the official MCP dependencies from package-lock.json…');
  const setup = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--ignore-scripts'], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (setup.status !== 0) process.exit(setup.status || 1);
}
const dataDir = resolve(values['data-dir'] || process.env.GARDEN_DATA || resolve(root, 'data'));
const keys = await loadKeys(dataDir);
const port = Number(values.port || process.env.PORT || 5173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be 1–65535.');
const host = values.host || (values.lan ? '0.0.0.0' : process.env.HOST || '127.0.0.1');
const publicBase = publicOrigin(values['public-base-url'] || process.env.GARDEN_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL);
const lanIps = Object.values(networkInterfaces()).flat().filter(x => x && x.family === 'IPv4' && !x.internal).map(x => x.address);
const origin = publicBase || `http://${values.lan ? lanIps[0] || '127.0.0.1' : '127.0.0.1'}:${port}`;
if (values['show-access']) {
  console.log(`Player: ${origin}/connect/#key=${encodeURIComponent(keys.user)}\nAI key: ${keys.ai}\nMCP: ${origin}/mcp\nHeader: Authorization: Bearer <AI key>`);
  process.exit(0);
}
const child = spawn(process.execPath, ['server/serve.mjs'], { cwd: root,
  env: { ...process.env, GARDEN_DATA: dataDir, PORT: String(port), HOST: host, GARDEN_PUBLIC_URL: publicBase }, stdio: ['inherit','pipe','inherit'] });
let opened = false;
child.stdout.on('data', chunk => {
  process.stdout.write(chunk);
  if (opened || !String(chunk).includes('Rainholm Garden ready:')) return;
  opened = true;
  console.log(`Connection page: ${origin}/connect/`);
  if (values.lan) console.log('Same Wi-Fi addresses: ' + lanIps.map(ip => `http://${ip}:${port}/connect/`).join(' , '));
  console.log('Cloud chat connectors require a public HTTPS URL. --public-base-url does not create a tunnel.');
  console.log('Keys are stored privately in the data directory. Run node start.mjs --show-access with the same options to view them.');
  if (!values['no-open'] && !publicBase) {
    const url = `http://127.0.0.1:${port}/connect/#key=${encodeURIComponent(keys.user)}`;
    const cmd = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]];
    const browser = spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true });
    browser.on('error', () => console.log('Open the connection page manually and use --show-access to view the player key.')); browser.unref();
  }
});
child.on('error', () => { console.error('Could not start the garden.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code || 0; });
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => child.kill(signal));
