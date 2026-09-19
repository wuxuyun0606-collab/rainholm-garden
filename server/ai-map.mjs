


import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const MAP_SCENES = ['garden', 'greenhouse', 'cathome'];

/* ── 宽松 JSON：把源码里那一段字面量洗成 JSON.parse 吃得下的东西 ───────────────
   只做三件事：去注释、单引号转双引号、裸键名补引号、去尾逗号。
   不求通用，只求够读这四份文件；洗不动的宁可抛错（上面会报 500），不猜。 */
function relax(src) {
  let out = '', i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '"' || c === "'") {
      const q = c;
      let j = i + 1, body = '';
      while (j < n && src[j] !== q) {
        if (src[j] === '\\') { body += src[j] + src[j + 1]; j += 2; continue; }
        body += src[j]; j++;
      }
      out += q === '"' ? '"' + body + '"' : JSON.stringify(body.replace(/\\'/g, "'"));
      i = j + 1; continue;
    }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); i = e < 0 ? n : e; continue; }
    out += c; i++;
  }
  return out
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/,(\s*[}\]])/g, '$1');
}

/** 从源码里按声明抠出后面那一整段 `[...]` / `{...}`（括号配平，跳字符串和注释） */
function literalAfter(src, declRe) {
  const m = declRe.exec(src);
  if (!m) return null;
  let i = m.index + m[0].length;
  while (i < src.length && /\s/.test(src[i])) i++;
  if (src[i] !== '[' && src[i] !== '{') return null;
  let depth = 0, j = i, inStr = null;
  for (; j < src.length; j++) {
    const c = src[j];
    if (inStr) { if (c === '\\') { j++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '/' && src[j + 1] === '*') { const e = src.indexOf('*/', j + 2); j = e < 0 ? src.length : e + 1; continue; }
    if (c === '/' && src[j + 1] === '/') { const e = src.indexOf('\n', j); j = e < 0 ? src.length : e - 1; continue; }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return src.slice(i, j);
}

function pick(src, declRe, what) {
  const lit = literalAfter(src, declRe);
  if (lit === null) throw new Error(`地图取不到 ${what}：源文件里没找到这段声明`);
  try { return JSON.parse(relax(lit)); }
  catch (e) { throw new Error(`地图解不开 ${what}：${e.message}`); }
}

/* ── 现读四份源 ─────────────────────────────────────────────────────────────── */
export async function readSources(ROOT) {
  const WEB = resolve(ROOT, 'web');
  const [appJs, catJs, walkRaw, duoJs, namesRaw] = await Promise.all([
    readFile(resolve(WEB, 'app.js'), 'utf8'),
    readFile(resolve(WEB, 'host-cat.js'), 'utf8'),
    readFile(resolve(WEB, 'walk-map.json'), 'utf8'),
    readFile(resolve(WEB, 'assets/v7/duoscenes-20260915.js'), 'utf8').catch(() => ''),
    readFile(resolve(ROOT, 'server', 'map-names.json'), 'utf8').catch(() => '{}'),
  ]);

  const world = (() => {
    const m = /WORLD_W\s*=\s*(\d+)\s*,\s*WORLD_H\s*=\s*(\d+)/.exec(catJs);
    if (!m) throw new Error('地图取不到世界尺寸：host-cat.js 里没找到 WORLD_W/WORLD_H');
    return { w: Number(m[1]), h: Number(m[2]) };
  })();

  /* TURF.garden.home 是 TURF 里唯一一处写成字面量的 home（小窝/花房那两处是变量名），
     所以头一个匹配就是花园的。CH_HOME / GH_HOME 各自按变量名取。 */
  const gardenHome = (() => {
    const m = /home:\s*\{\s*white:\s*\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\]\s*,\s*black:\s*\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\]\s*\}/.exec(catJs);
    if (!m) throw new Error('地图取不到花园起手位：host-cat.js 里没找到 TURF.garden.home');
    return { white: [Number(m[1]), Number(m[2])], black: [Number(m[3]), Number(m[4])] };
  })();

  return {
    world,
    beds: pick(appJs, /^const beds\s*=\s*/m, 'app.js beds'),
    pots: pick(appJs, /^const pots\s*=\s*/m, 'app.js pots'),
    covers: pick(appJs, /^const unopenedCovers\s*=\s*/m, 'app.js unopenedCovers'),
    sceneDoors: pick(appJs, /^const SCENE_DOORS\s*=\s*/m, 'app.js SCENE_DOORS'),
    chFloor: pick(catJs, /\bvar CH_FLOOR\s*=\s*/, 'host-cat.js CH_FLOOR'),
    chBlock: pick(catJs, /\bvar CH_BLOCK\s*=\s*/, 'host-cat.js CH_BLOCK'),
    chRoam: pick(catJs, /\bvar CH_ROAM\s*=\s*/, 'host-cat.js CH_ROAM'),
    chHome: pick(catJs, /\bvar CH_HOME\s*=\s*/, 'host-cat.js CH_HOME'),
    ghFloor: pick(catJs, /\bvar GH_FLOOR\s*=\s*/, 'host-cat.js GH_FLOOR'),
    ghBlock: pick(catJs, /\bvar GH_BLOCK\s*=\s*/, 'host-cat.js GH_BLOCK'),
    ghExtra: pick(catJs, /\bvar GH_EXTRA\s*=\s*/, 'host-cat.js GH_EXTRA'),
    ghRoam: pick(catJs, /\bvar GH_ROAM\s*=\s*/, 'host-cat.js GH_ROAM'),
    gardenRoam: pick(catJs, /\bvar ROAM\s*=\s*/, 'host-cat.js ROAM'),
    ghHome: pick(catJs, /\bvar GH_HOME\s*=\s*/, 'host-cat.js GH_HOME'),
    gardenHome,
    walk: JSON.parse(walkRaw),
    duo: duoJs ? pick(duoJs, /\bvar CFG\s*=\s*/, 'duoscenes CFG') : {},
    names: JSON.parse(namesRaw),
  };
}

/* ── 小工具 ─────────────────────────────────────────────────────────────────── */
const round1 = v => Math.round(v * 10) / 10;
function bbox(points) {
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
function centroid(points) {
  const n = points.length;
  return [round1(points.reduce((s, p) => s + p[0], 0) / n), round1(points.reduce((s, p) => s + p[1], 0) / n)];
}

/* ── 一张地图 ───────────────────────────────────────────────────────────────── */
export async function buildMap({ root, scene, service, account, port = 5173, baseUrl, sources }) {
  if (!MAP_SCENES.includes(scene)) throw new Error('没有这个场景');
  const S = sources || await readSources(root);
  const base = baseUrl || `http://127.0.0.1:${port}`;
  const nameOf = (bucket, id, fallback) => S.names?.[bucket]?.[id] ?? fallback ?? id;

  /* 门牌：页面上那几颗钮的钮心（世界坐标）＋ walk-map 给的靠门站位 */
  const doors = (S.sceneDoors[scene] ?? []).map(([id, label, x, y]) => ({ id, label, x, y }));
  const approach = S.walk?.scenes?.[scene]?.doors ?? {};
  for (const [to, pt] of Object.entries(approach)) {
    if (Array.isArray(pt?.approach)) doors.push({ id: `approach_${to}`, label: `走到门口（去${to === 'garden' ? '花园' : '花房'}）`, x: pt.approach[0], y: pt.approach[1] });
  }

  /* 地块：菜畦读 beds 四点多边形，花盆读 pots 点位；状态一律现问 service */
  let plots = [];
  let stateBlock = null;
  if (scene === 'garden' || scene === 'greenhouse') {
    const out = await service.state(account, scene);
    stateBlock = out?.state ?? null;
    const live = new Map(((stateBlock?.plots ?? stateBlock?.flowerPlots) ?? []).map(p => [p.id, p]));
    const tpl = S.names?.plotNameTemplate?.[scene] ?? '{n} 号';
    const geom = scene === 'garden' ? S.beds : S.pots;
    plots = geom.map((g, i) => {
      const index = i + 1, p = live.get(index) ?? {};
      const polygon = scene === 'garden' ? g : null;
      const cover = scene === 'garden' ? S.covers.find(c => c.slot === index) : null;
      return {
        index,
        name: tpl.replace('{n}', String(index)),
        center: polygon ? centroid(polygon) : [g[0], g[1]],
        polygon,
        box: polygon ? bbox(polygon) : (cover ? [cover.x, cover.y, cover.x + cover.width, cover.y + cover.height] : null),
        /* 底图上一直画着 8 畦，但引擎按土地等级只开前几块 —— 没开的这几块地在图上有位置、
           没状态，种下去引擎会拒。别把它当「空土」，那是两回事。 */
        unlocked: live.has(index),
        state: p.state ?? (live.has(index) ? null : 'locked'),
        seedType: p.seedType ?? null,
        progress: p.progress ?? null,
        growTicks: p.growTicks ?? null,
        watered: p.watered ?? null,
        readyAt: p.readyAt ?? null,
        canWater: p.canWater ?? null,
        needsWater: p.needsWater ?? null,
        lastActor: p.lastActor ?? null,
        lastActionAt: p.lastActionAt ?? null,
        lastAction: p.lastAction ?? null,
      };
    });
  }

  /* 家具 / 禁行区 */
  let furniture = [], floor = [], homes = null, roam = null;
  if (scene === 'cathome') {
    const order = S.names?.cathomeBlockOrder ?? [];
    furniture = S.chBlock.map((pts, i) => ({
      id: order[i]?.id ?? `ch_block_${i + 1}`,
      name: order[i]?.name ?? '（未命名）',
      box: bbox(pts),
      polygon: pts,
    }));
    floor = [{ id: 'ch_floor', label: '小窝地板（等距菱形，判的是脚点）', points: S.chFloor }];
    homes = S.chHome; roam = S.chRoam;
  } else {
    const forb = S.walk?.scenes?.[scene]?.forbidden ?? [];
    furniture = forb.map(f => ({
      id: f.id,
      name: nameOf(scene, f.id, f.label),
      box: bbox(f.points),
      polygon: f.points,
      expand: f.expand ?? 0,
    }));
    if (scene === 'greenhouse') {
      /* walk-map 漏圈、host-cat.js 里当 GH_EXTRA 补上的那盆白花，也得在图上 */
      for (const pts of S.ghExtra) {
        furniture.push({ id: 'gh_plant_door', name: nameOf('greenhouse', 'gh_plant_door', '门边那盆白花'), box: bbox(pts), polygon: pts, expand: 0 });
      }
      floor = [{ id: 'gh_floor', label: '花房地砖', points: S.ghFloor }];
      homes = S.ghHome; roam = S.ghRoam;
    } else {
      floor = (S.walk?.scenes?.garden?.walkable ?? []).map(w => ({ id: w.id, label: w.label, points: w.points }));
      /* 花园白猫的活动区是**两块**（野餐垫下半张 + 左侧草坪），所以这里可能是数组套数组 */
      homes = S.gardenHome; roam = S.gardenRoam;
    }
  }

  /* 双猫互动幕：只报这个场景的 */
  const duo = Object.values(S.duo ?? {})
    .filter(c => c?.scene === scene)
    .map(c => ({ key: c.name, label: c.label, rect: c.rect, hotBox: c.hot?.box ?? null, spots: c.spots, loop: c.loop !== false }));

  const notes = [
    `坐标是底图世界坐标，原点在左上，整张图 ${S.world.w}×${S.world.h}，跟页面 coord() 同一把尺；给黑猫的 x/y 直接用这套数，不用换算。`,
    '白猫＝使用者（玩家在页面上点地面指挥），黑猫＝AI（你）。走位和说话都只落在黑猫身上。',
    `让黑猫走过去 / 冒一句：curl -s -X POST ${base}/garden/api/cat/black -H 'Authorization: Bearer <AI_KEY>' -H 'Content-Type: application/json' -d '{"x":1200,"y":880,"say":"我来了"}'`,
    `让黑猫种地（跟玩家同一片地）：curl -s -X POST ${base}/garden/api/cat/black/farm -H 'Authorization: Bearer <AI_KEY>' -H 'Content-Type: application/json' -d '{"scene":"garden","action":"plant","plot":3,"seedType":"common","say":"我去种 3 号畦"}'`,
    `看地里现状（带每块地最后是谁动的）：curl -s -H 'Authorization: Bearer <AI_KEY>' '${base}/garden/api/state?scene=garden'`,
    `这张图的人话版：curl -s -H 'Authorization: Bearer <AI_KEY>' '${base}/garden/api/cat/black/map.md?scene=${scene}'`,
    '种/浇/收走的是和玩家同一把事务锁、同一份存档：玩家收完你下次拉 state 就看得见，你收完玩家页面 30 秒内自己刷出来。',
    scene === 'cathome'
      ? '小窝服务端没有数据（没有地块、没有金币、没有 api/state），这张图只有坐标；猫此刻站在哪只有页面知道。'
      : '地块的 state：empty 空土 / growing 生长中 / ripe 可收获；readyAt 是毫秒时间戳，没熟透之前收会被引擎拒掉。',
  ];

  return {
    scene,
    generatedAt: Date.now(),
    world: S.world,
    units: 'world px',
    doors,
    homes,
    roam,
    duo,
    plots,
    furniture,
    floor,
    wallet: stateBlock ? { coins: stateBlock.coins, revision: stateBlock.revision, season: stateBlock.season, nextTickAt: stateBlock.nextTickAt } : null,
    notes,
    sources: [
      'web/app.js（beds / pots / unopenedCovers / SCENE_DOORS）',
      'web/host-cat.js（CH_* / GH_* / TURF.garden.home / WORLD_W·H）',
      'web/walk-map.json（禁行区与可走地面）',
      'web/assets/v7/duoscenes-20260915.js（双猫互动幕）',
      'server/map-names.json（中文名覆盖）',
      'GET /garden/api/state（地里现状）',
    ],
  };
}

/* ── 人话版 ─────────────────────────────────────────────────────────────────── */
const SCENE_CN = { garden: '花园', greenhouse: '小花房', cathome: '小窝' };

export function renderMapMd(map) {
  const L = [];
  const stamp = new Date(map.generatedAt).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  L.push(`# Rainholm ${SCENE_CN[map.scene] ?? map.scene} · AI 自用地图（现算于 ${stamp}）\n`);
  L.push(`坐标：底图世界坐标，${map.world.w}×${map.world.h}，原点左上，单位 ${map.units}。白猫＝使用者，黑猫＝AI。\n`);

  L.push('## 现在地里什么状态');
  if (!map.plots.length) {
    L.push('- 这个场景服务端没有数据（没有地块，也没有 api/state）。');
  } else {
    if (map.wallet) L.push(`- 钱包 ${map.wallet.coins} 金 · 季节 ${map.wallet.season} · revision ${map.wallet.revision}`);
    const locked = map.plots.filter(p => p.unlocked === false).map(p => p.name);
    if (locked.length) L.push(`- 还没开垦（底图上有、引擎里没开，种不了）：${locked.join('、')}`);
    for (const p of map.plots) {
      const who = p.lastActor ? `　最后动手：${p.lastActor === 'black' ? '我（黑猫）' : '玩家'}` : '';
      const ready = p.readyAt ? `　熟于 ${new Date(p.readyAt).toISOString().replace('T', ' ').slice(0, 16)} UTC` : '';
      L.push(`- ${p.name}（中心 ${p.center[0]},${p.center[1]}）：${p.state ?? '—'}${p.seedType ? ' · ' + p.seedType : ''}${p.state === 'growing' ? ` · 进度 ${p.progress}/${p.growTicks} · 浇了 ${p.watered} 次` : ''}${ready}${who}`);
    }
  }
  L.push('');

  L.push('## 门在哪');
  for (const d of map.doors) L.push(`- ${d.label}：${d.x},${d.y}（\`${d.id}\`）`);
  if (map.homes) L.push(`- 起手位：白猫 ${map.homes.white?.join(',')}　黑猫 ${map.homes.black?.join(',')}`);
  if (map.roam) {
    /* 花园白猫有两块活动区，所以这里可能是数组套数组 —— 分块写，别糊成一串数 */
    const box = v => Array.isArray(v?.[0]) ? v.map(b => `[${b.join(',')}]`).join(' 或 ') : `[${(v ?? []).join(',')}]`;
    L.push(`- 常待的一片（x0,y0,x1,y1）：白猫 ${box(map.roam.white)}　黑猫 ${box(map.roam.black)}`);
  }
  L.push('');

  if (map.duo.length) {
    L.push('## 能一起做的事（双猫幕）');
    L.push('| 键 | 哪儿 | 热区盒（左,上,宽,高） | 白猫站位 | 黑猫站位 |');
    L.push('|---|---|---|---|---|');
    for (const d of map.duo) L.push(`| \`${d.key}\` | ${d.label} | ${d.hotBox ? d.hotBox.join(',') : '—'} | ${d.spots?.white?.join(',') ?? '—'} | ${d.spots?.black?.join(',') ?? '—'} |`);
    L.push('');
  }

  if (map.plots.length) {
    L.push('## 地块位置表');
    L.push('| 号 | 名字 | 中心 | 外接盒（左上→右下） | 状态 | 最后动手 |');
    L.push('|---|---|---|---|---|---|');
    for (const p of map.plots) {
      L.push(`| ${p.index} | ${p.name} | ${p.center.join(',')} | ${p.box ? p.box.slice(0, 2).join(',') + ' → ' + p.box.slice(2).join(',') : '—'} | ${p.state ?? '—'} | ${p.lastActor ?? '—'} |`);
    }
    L.push('');
  }

  L.push('## 家具与禁行区（猫的脚点进不去）');
  if (map.scene === 'garden') L.push('菜畦在这张表里又出现了一遍 —— 那是给猫看的禁行区（外接矩形，比地块本身大一圈，免得猫半只爪子踩进土里），种地认上面那张地块表。\n');
  L.push('| 名字 | id | 左上 | 右下 |');
  L.push('|---|---|---|---|');
  for (const f of map.furniture) L.push(`| ${f.name} | \`${f.id}\` | ${f.box[0]},${f.box[1]} | ${f.box[2]},${f.box[3]} |`);
  L.push('');
  L.push('可走地面：' + (map.floor.map(f => `${f.label}(${f.id})`).join('、') || '—'));
  L.push('');

  L.push('## 怎么下令');
  L.push('```bash');
  for (const n of map.notes) {
    const at = n.indexOf('curl ');
    if (at < 0) continue;
    const why = n.slice(0, at).replace(/[：:]\s*$/, '').trim();
    if (why) L.push(`# ${why}`);
    L.push(n.slice(at));
  }
  L.push('```');
  for (const n of map.notes) if (!n.includes('curl ')) L.push(`- ${n}`);
  L.push('');
  L.push('_来源：' + map.sources.join(' / ') + '，全部现读，不落死数。_');
  return L.join('\n') + '\n';
}
