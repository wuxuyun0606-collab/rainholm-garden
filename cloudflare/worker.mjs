import { DurableObject } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import { createServer } from 'node:http';
import { createGardenHandler } from '../server/http.mjs';
import { validateKeys, publicOrigin } from '../server/access.mjs';
import { ensureScenes } from '../server/scenes.mjs';
import { JsonStore } from './store.mjs';
import mapSources from '../.cloudflare/map-sources.json';
import example from '../data/example-save.json';

export class Garden extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.store = new JsonStore(ctx.storage);
    this.queue = Promise.resolve();
    this.handler = null;
  }
  async initialize(origin) {
    const keys = validateKeys({ user: this.env.GARDEN_USER_KEY, ai: this.env.GARDEN_AI_KEY });
    const settings = this.store.load('settings') || {};
    this.origin = publicOrigin(this.env.GARDEN_PUBLIC_URL || settings.origin || origin);
    const epoch = String(this.env.GARDEN_OAUTH_EPOCH || '1');
    if (settings.origin !== this.origin || settings.epoch !== epoch) {
      this.store.save('oauth', { clients: {}, tokens: {} });
      this.store.save('settings', { origin: this.origin, epoch });
    }
    this.record = this.store.load('garden');
    if (!this.record) {
      this.record = structuredClone(example);
      const now = Date.now();
      for (const farm of [this.record.farm, this.record.greenhouse?.farm]) if (farm) {
        farm.createdAt = now; farm.lastTickAt = now;
      }
      ensureScenes(this.record);
      this.store.save('garden', this.record);
    }
    // All HTTP requests are serialized by fetch(). Each transaction rolls back
    // its in-memory copy if the callback or atomic SQLite write fails.
    const transact = async (_account, fn) => {
      const next = structuredClone(this.record), before = JSON.stringify(next);
      const result = fn(next);
      if (JSON.stringify(next) !== before) {
        this.store.save('garden', next);
        this.record = next;
      }
      return result;
    };
    this.handler = await createGardenHandler({
      keys, publicBase: this.origin, localHosts: false, transact, mapSources,
      agentStorage: { load: async () => this.store.load('agent'), save: value => this.store.save('agent', value) },
      oauthStorage: { load: async () => this.store.load('oauth'), save: async value => this.store.save('oauth', value) },
      staticHandler: async (req, res) => {
        const assetUrl = new URL(req.url, this.origin);
        if (assetUrl.pathname.endsWith('/')) assetUrl.pathname += 'index.html';
        const response = await this.env.ASSETS.fetch(new Request(assetUrl, { method: req.method }));
        const headers = Object.fromEntries(response.headers);
        headers['cache-control'] = 'no-store';
        res.writeHead(response.status, headers);
        res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
      },
    });
  }
  fetch(request) {
    const run = async () => {
      try {
        const url = new URL(request.url);
        if (!this.handler) await this.initialize(url.origin);
        if (url.origin !== this.origin) return new Response('Use the configured garden URL.', { status: 403 });
        // Ports are isolate-wide. A request-scoped ephemeral server avoids both
        // collisions and leaked port registrations after object eviction.
        const server = createServer((req, res) => {
          // The Node bridge uses an internal virtual host. Restore only the
          // platform-routed URL host, already matched to the public origin.
          req.headers.host = url.host;
          return this.handler(req, res);
        });
        try {
          await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, resolve); });
          const response = await httpServerHandler({ port: server.address().port }).fetch(request);
          const body = await response.arrayBuffer();
          await this.ctx.storage.sync();
          return new Response([204,304].includes(response.status) || request.method === 'HEAD' ? null : body,
            { status: response.status, headers: response.headers });
        } finally { await new Promise(resolve => server.close(resolve)); }
      } catch (error) {
        console.error('[garden] cloud request failed:', error.name || 'Error');
        // Discard any in-memory state after a storage failure; load durable data
        // on the next request. Never return configuration values or secrets.
        this.handler = null;
        return Response.json({ ok: false, error: 'Garden unavailable. Check the deployment configuration and storage limits.' }, { status: 503 });
      }
    };
    const task = this.queue.then(run); this.queue = task.catch(() => {}); return task;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // The platform routes asset requests directly to ASSETS, avoiding Worker
    // and Durable Object charges. Only dynamic routes reach this entrypoint.
    if (url.pathname === '/connect') return Response.redirect(url.origin + '/connect/', 302);
    if (url.pathname === '/connect/') {
      url.pathname = '/connect/index.html';
      return env.ASSETS.fetch(new Request(url, request));
    }
    return env.GARDEN.get(env.GARDEN.idFromName('personal-garden')).fetch(request);
  },
};
