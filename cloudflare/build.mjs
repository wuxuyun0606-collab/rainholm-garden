import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';
import { build } from 'esbuild';
import { readSources } from '../server/ai-map.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, '.cloudflare');
await mkdir(out, { recursive: true });
await writeFile(resolve(out, 'map-sources.json'), JSON.stringify(await readSources(root)));
await rm(resolve(out, 'assets'), { recursive: true, force: true });
await cp(resolve(root, 'web'), resolve(out, 'assets/garden'), { recursive: true, filter: source => source !== resolve(root, 'web/connect') });
await cp(resolve(root, 'web/connect'), resolve(out, 'assets/connect'), { recursive: true });
await writeFile(resolve(out, 'assets/_headers'), `/connect/*\n  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'\n  X-Frame-Options: DENY\n/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n`);
const contentPath = resolve(root, 'vendor/aifarm/dist/content.js');
await build({ entryPoints: [resolve(root, 'cloudflare/worker.mjs')], outfile: resolve(out, 'worker.mjs'),
  bundle: true, format: 'esm', platform: 'node', target: 'es2022', sourcemap: false,
  external: ['cloudflare:*', 'node:*', ...builtinModules],
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire('/worker.mjs');" },
  plugins: [{ name: 'bundle-upstream-content', setup(builder) {
    builder.onLoad({ filter: /vendor\/aifarm\/dist\/content\.js$/ }, async () => {
      let contents = await readFile(contentPath, 'utf8');
      const pattern = /import \{ readFileSync \} from "node:fs";[\s\S]*?const load = .*?;\n/;
      if (!pattern.test(contents)) throw new Error('Upstream content loader changed; review the Cloudflare build adapter.');
      const names = [...contents.matchAll(/load\("([a-z-]+)"\)/g)].map(m => m[1]);
      const data = Object.fromEntries(await Promise.all(names.map(async name => [name, JSON.parse(await readFile(resolve(root, 'vendor/aifarm/content', name + '.json'), 'utf8'))])));
      contents = contents.replace(pattern, () => 'const content = ' + JSON.stringify(data) + ';\nconst load = name => structuredClone(content[name]);\n');
      return { contents, loader: 'js', resolveDir: dirname(contentPath) };
    });
  } }],
});
console.log('Cloudflare bundle and static assets prepared. No private data included.');
