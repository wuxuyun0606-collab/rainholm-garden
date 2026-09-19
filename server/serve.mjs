import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newRecord } from './garden.mjs';
import { ensureScenes } from './scenes.mjs';
import { loadKeys, publicOrigin } from './access.mjs';
import { createGardenHandler } from './http.mjs';

const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const DATA_DIR = process.env.GARDEN_DATA ? resolve(process.env.GARDEN_DATA) : resolve(ROOT, 'data');
const SAVE_FILE = resolve(DATA_DIR, 'garden-save.json');
/* 示例档永远从仓库自带的 data/ 里读，不跟着 GARDEN_DATA 走 —— 换存档目录的人
   多半是想另开一局，而不是想丢掉示例开局。 */
const EXAMPLE_FILE = resolve(ROOT, 'data', 'example-save.json');
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '127.0.0.1';
const ACCOUNT = 'local';              /* 单机单账号，没有第二个人 */
const PUBLIC_BASE = publicOrigin(process.env.GARDEN_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL);
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) throw new Error('Invalid PORT');

await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });

/* ── 存档：唯一写入口 ─────────────────────────────────────────────────────── */
let queue = Promise.resolve();

async function loadRecord() {
  try { return JSON.parse(await readFile(SAVE_FILE, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  try {
    const record = JSON.parse(await readFile(EXAMPLE_FILE, 'utf8'));
    /* 示例档里的时间戳是打包那天定的，直接开局的话两块示范田一进门就熟了。
       第一次落地时把两台引擎的钟拨到现在 —— 种下去的那一刻就是你按下 start 的那一刻。 */
    const now = Date.now();
    for (const farm of [record.farm, record.greenhouse?.farm]) {
      if (!farm) continue;
      farm.createdAt = now;
      farm.lastTickAt = now;
    }
    return record;
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return newRecord('小小花园');
}

function transact(_accountId, fn) {
  const task = queue.then(async () => {
    const record = await loadRecord();
    const before = JSON.stringify(record);
    /* 回调抛异常 ＝ 这一整笔不落盘：内存里那份跟着本次事务一起丢，下一笔重新读，等于回滚。 */
    const result = fn(record);
    const after = JSON.stringify(record);
    if (after !== before) {
      await writeFile(SAVE_FILE + '.tmp', after, { mode: 0o600 });
      await rename(SAVE_FILE + '.tmp', SAVE_FILE);
    }
    return result;
  });
  queue = task.then(() => { }, () => { });
  return task;
}

let effectivePort = PORT;
const handler = await createGardenHandler({ root: ROOT, dataDir: DATA_DIR, transact,
  keys: await loadKeys(DATA_DIR), publicBase: PUBLIC_BASE,
  baseUrl: () => PUBLIC_BASE || `http://127.0.0.1:${effectivePort}` });
const server = createServer(handler);

/* 启动前把存档铺一次：示例档里的两块示范田在这一刻就落进 data/garden-save.json，
   省得第一次 GET /state 才建。ensureScenes 顺手把花房那八盆补齐。 */
await transact(ACCOUNT, record => ensureScenes(record));

server.listen(PORT, HOST, () => {
  effectivePort = server.address().port;
  console.log(`Rainholm Garden ready: ${PUBLIC_BASE || `http://127.0.0.1:${effectivePort}`}/connect/`);
  console.log('Player and AI access are separate. Use node start.mjs for connection setup.');
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
