import { randomBytes, createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { networkInterfaces } from 'node:os';

export const newKey = () => randomBytes(32).toString('base64url');
export const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
export async function loadKeys(dataDir, env = process.env) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const file = resolve(dataDir, '.garden-keys.json');
  let keys;
  if (env.GARDEN_USER_KEY || env.GARDEN_AI_KEY) {
    keys = { user: env.GARDEN_USER_KEY, ai: env.GARDEN_AI_KEY };
  } else {
    try { keys = JSON.parse(await readFile(file, 'utf8')); }
    catch (e) {
      if (e.code !== 'ENOENT') throw new Error('Cannot read private garden keys; restore the key file before starting.');
      keys = { user: newKey(), ai: newKey() };
      try { await writeFile(file, JSON.stringify(keys), { mode: 0o600, flag: 'wx' }); }
      catch (e) { if (e.code !== 'EEXIST') throw e; keys = JSON.parse(await readFile(file, 'utf8')); }
    }
    await chmod(file, 0o600);
  }
  return validateKeys(keys);
}

export function validateKeys(keys) {
  if (![keys?.user, keys?.ai].every(k => typeof k === 'string' && /^[A-Za-z0-9_+/=-]{32,256}$/.test(k)) || equal(keys.user, keys.ai)) {
    throw new Error('User and AI keys must be distinct 32–256 character random Base64 or Base64url strings.');
  }
  return keys;
}

export function publicOrigin(value) {
  if (!value) return '';
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('GARDEN_PUBLIC_URL must be an HTTPS site root, without a path or credentials.');
  }
  return url.origin;
}

export function createAccess(keys, publicBase = '', { localHosts = true } = {}) {
  const allowedHosts = new Set(localHosts ? ['localhost', '127.0.0.1', '[::1]'] : []);
  if (localHosts) for (const entries of Object.values(networkInterfaces())) for (const item of entries || []) {
    if (item.family === 'IPv4') allowedHosts.add(item.address);
  }
  if (publicBase) allowedHosts.add(new URL(publicBase).hostname);
  const mac = value => createHmac('sha256', keys.user).update(value).digest('base64url');
  const seal = data => { const body = Buffer.from(JSON.stringify(data)).toString('base64url'); return body + '.' + mac(body); };
  const unseal = value => {
    if (typeof value !== 'string' || value.length > 4096) return null;
    const [body, signature, extra] = value.split('.');
    if (extra || !body || !equal(signature, mac(body))) return null;
    try { const data = JSON.parse(Buffer.from(body, 'base64url')); return data.exp > Date.now() ? data : null; } catch { return null; }
  };
  const bearer = req => /^Bearer ([A-Za-z0-9_.+\/=-]+)$/i.exec(String(req.headers.authorization || ''))?.[1] || req.headers['x-garden-key'];
  const role = req => {
    const key = bearer(req);
    if (key) return equal(key, keys.user) ? 'user' : equal(key, keys.ai) ? 'ai' : null;
    const cookie = /(?:^|;\s*)rainholm_session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
    return unseal(cookie)?.kind === 'session' ? 'user' : null;
  };
  const hostAllowed = req => {
    try { const host = new URL('http://' + req.headers.host); return !host.username && !host.password && host.pathname === '/' && allowedHosts.has(host.hostname); } catch { return false; }
  };
  const browserAllowed = req => {
    if (req.headers['sec-fetch-site'] === 'cross-site') return false;
    if (req.headers.origin) {
      try {
        const origin = new URL(req.headers.origin);
        if (!['http:', 'https:'].includes(origin.protocol)) return false;
        if (publicBase ? origin.origin !== publicBase : origin.host !== req.headers.host) return false;
      } catch { return false; }
    }
    return true;
  };
  const cookie = (value, maxAge) => `rainholm_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${publicBase ? '; Secure' : ''}`;
  const loginCookie = () => cookie(seal({ kind: 'session', exp: Date.now() + 7 * 86400000, nonce: newKey() }), 7 * 86400);
  return { keys, bearer, role, hostAllowed, browserAllowed, seal, unseal, loginCookie, logoutCookie: () => cookie('', 0) };
}
