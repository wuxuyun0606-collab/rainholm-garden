#!/usr/bin/env node
// 🗺️ 快捷追加秘境：把 DS 按《通用秘境文案模板》填好的 markdown 解析成数据，合并进 content/expeditions.json。
//
// 用法：
//   node tools/expedition/add-map.mjs <稿件.md> --id <mapId> [--dry-run] [--force]
//     --id      秘境的英文 id（必填，作物名是中文不能当 id，如 rusty_clocktown）
//     --dry-run 只打印将生成的 JSON + 待你配的数值清单，不写文件（先这样看一眼）
//     --force   map id 已存在时也覆盖（默认存在就报错，防误覆盖）
//
// 它做机械的 90%：解析类型/层/频率/故事/掉落/选项/战斗、生成装饰条目、解析后果词、
// 给金币/银币填「按层默认值」。剩下要你过一遍的（默认金额、装饰 visitLine、boss 大胜奖励）
// 会在结尾的「⚠️ 待配清单」里列出来。数值平衡是你的活，脚本只省体力。
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const D = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(D, "../../content/expeditions.json");

// —— 可调默认值（数值平衡先用这些垫，再手动微调）——
const COIN_BY_LAYER = { shallow: 35, deep: 55, finale: 200 };
const SILVER_DEFAULT = 45;
const POTION_DEFAULT = 1;
const WEIGHT = { 常见: 5, 偶见: 3, 稀有: 2 };
const TYPE = { 纯剧情: "story", 掉落: "drop", 分支: "choice", 奇遇: "encounter", 战斗: "combat" };
const LAYER = { 浅层: "shallow", 深层: "deep", 终景: "finale" };
const DIFF = { 易: "easy", 中: "mid", 难: "hard" };
const DEFAULT_CRIT = [{ t: "potion", n: 2 }]; // boss 大胜默认额外犒赏；不想要就删该事件的 critDrops
const VISITLINE_TODO = "（待补 visitLine：一句串门时展示这件摆件的氛围话）";

// —— CLI ——
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const getFlag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const mapId = getFlag("--id");
const dry = args.includes("--dry-run");
const force = args.includes("--force");
if (!file || !mapId) { console.error("用法: node tools/expedition/add-map.mjs <稿件.md> --id <mapId> [--dry-run] [--force]"); process.exit(1); }

const text = readFileSync(resolve(process.cwd(), file), "utf8");
const todos = [];
const warn = (m) => todos.push(m);

// —— 秘境设定 ——
const setSetting = (label) => {
  const re = new RegExp(`${label}[^：:\\n]*[：:]\\s*([^\\n]+)`);
  const m = text.match(re);
  return m ? m[1].replace(/\*+/g, "").trim() : "";
};
const mapName = setSetting("名字");
const place = setSetting("是个什么地方");
const tone = setSetting("基调");
const intro = setSetting("引子");
if (!mapName) warn("没解析到「名字」，map.name 留空了，去稿件确认 - **名字**：… 这行。");
if (!intro) warn("没解析到「引子」，map.intro 留空了。");

// —— 装饰登记表（name → id），同一秘境内去重 ——
const decorByName = new Map();
let decorSeq = 0;
const decorIdFor = (raw) => {
  // 稿里常写成「名字（一句描述）」——描述别混进 name，剥出来留作 visitLine 的写作素材。
  const m = raw.trim().match(/^(.+?)\s*[（(]([^）)]*)[）)]\s*$/);
  const key = (m ? m[1] : raw).trim();
  const desc = m ? m[2].trim() : "";
  if (!decorByName.has(key)) {
    decorByName.set(key, { id: `exp_${mapId}_${++decorSeq}`, name: key, from: mapId, visitLine: VISITLINE_TODO });
    warn(desc
      ? `装饰「${key}」visitLine 待补（先占位）——稿里括注可作素材：「${desc}」`
      : `装饰「${key}」的 visitLine 待补（先占位）。`);
  }
  return decorByName.get(key).id;
};

// —— 后果词 → outcome ——
function parseOutcome(raw, layer) {
  const s = raw.trim();
  let m;
  // 先认显式后果词：这些段的氛围文字里可能顺带提到「金币/银币/药水」等字眼（如“它拿金币敲壳”），
  // 必须抢在下面的宽松关键字之前拦下，否则一句氛围话会被误判成发资源。
  if ((m = s.match(/纯剧情后果[：:]\s*(.+)$/))) return { t: "none", text: m[1].trim() };
  if ((m = s.match(/获得加成[：:]\s*(.+)$/))) return { t: "buff", mod: 1, text: m[1].trim() };
  if ((m = s.match(/进入战斗[：:]\s*(.+)$/))) return { t: "combat", foe: m[1].trim(), difficulty: "mid" };
  if ((m = s.match(/跳转[：:]\s*(.+)$/))) return { t: "jump", _toTitle: m[1].trim() }; // 稍后按标题解析成 id
  if ((m = s.match(/装饰品[：:]\s*(.+)$/))) return { t: "decor", id: decorIdFor(m[1]) };
  // 再认宽松资源关键字：用于「得到：金币」「银币」「加速药水」「状态+1」这类没有显式后果词的段。
  if (/加速药水/.test(s)) return { t: "potion", n: POTION_DEFAULT };
  if (/银币/.test(s)) { warn(`银币数量用默认 ${SILVER_DEFAULT}（「${s}」），按需改。`); return { t: "silver", n: SILVER_DEFAULT }; }
  if (/金币/.test(s)) { const n = COIN_BY_LAYER[layer] ?? 35; warn(`金币数量用默认 ${n}（「${s}」），按需改。`); return { t: "coins", n }; }
  if ((m = s.match(/状态\s*([+\-]?\d+)/))) return { t: "status", n: parseInt(m[1], 10) };
  if (/无事发生|无事|^继续$/.test(s)) return { t: "none" };
  warn(`后果没认出来，当纯文字处理：「${s}」`);
  return { t: "none", text: s };
}
const parseOutcomes = (raw, layer) => raw.split(/[；;]+/).map((p) => p.trim()).filter(Boolean).map((p) => parseOutcome(p, layer));

// —— 掉落（顶层 drop 事件）——
function parseDrops(raw, layer) {
  if (!raw || /^无$/.test(raw.trim())) return undefined;
  const out = parseOutcomes(raw, layer)
    .filter((o) => ["coins", "silver", "potion", "decor"].includes(o.t))
    .map((o) => (o.t === "decor" ? { t: "decor", id: o.id } : { t: o.t, n: o.n }));
  return out.length ? out : undefined;
}

// —— 把一段 event 文本拆成 field 表 ——
// DS 实际格式里，战斗子字段（敌人/难度/赢/败/记入见闻）多写成顶层 `- 敌人：`，所以也当已知字段；
// 若写成缩进在 `- 战斗：` 下，parseCombat 会回退去 f.战斗 块里捞。
const KNOWN = ["类型", "触发层", "出现频率", "故事", "掉落", "选项", "战斗", "敌人", "难度", "赢", "败", "记入见闻"];
function parseFields(block) {
  const fields = {};
  let cur = null;
  for (const rawline of block.split("\n")) {
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(rawline)) continue; // 跳过 markdown 分隔线，别污染上一字段
    if (/^\s*[-*•]?\s*\*{0,2}模糊提示/.test(rawline)) continue; // 模糊提示字段已废弃（前端不再展示），整行丢弃
    const norm = rawline.replace(/^\s*[-*•]\s*/, "").replace(/\*\*/g, "").trim();
    const label = KNOWN.find((k) => new RegExp(`^${k}[：:（(]`).test(norm));
    if (label) {
      const inline = norm.slice(label.length).replace(/^[（(][^）)]*[）)]/, "").replace(/^[：:]\s*/, "");
      cur = label; fields[cur] = inline ? inline + "\n" : "";
    } else if (cur) {
      fields[cur] += rawline + "\n";
    }
  }
  for (const k of Object.keys(fields)) fields[k] = fields[k].replace(/\n+$/, "");
  return fields;
}

// —— 战斗子字段 ——
const sub = (block, label) => { const m = (block || "").match(new RegExp(`${label}[：:]\\s*([^\\n]+)`)); return m ? m[1].trim() : ""; };
function parseCombat(f, layer, ev) {
  const get = (label) => (f[label] || "").trim() || sub(f.战斗, label); // 顶层字段优先，回退战斗块
  const foe = get("敌人");
  const diffRaw = get("难度");
  const difficulty = DIFF[diffRaw] ?? "mid";
  const record = get("记入见闻") || foe;
  const loseText = get("败");
  let winRaw = get("赢");
  let winDrops = [];
  const wi = winRaw.search(/战利品[：:]/);
  let winText = winRaw;
  if (wi >= 0) {
    winText = winRaw.slice(0, wi).trim().replace(/[。，,；;\s]+$/, "");
    const loot = winRaw.slice(wi).replace(/^战利品[：:]/, "");
    winDrops = parseOutcomes(loot, "finale").map((o) => (o.t === "decor" ? { t: "decor", id: o.id } : { t: o.t, n: o.n }));
  }
  if (!winDrops.length) warn(`战斗「${ev.title}」没解析到战利品，win.drops 留空，记得补。`);
  if (DIFF[diffRaw] === undefined) warn(`战斗「${ev.title}」难度没认出（用 mid）。`);
  ev.foe = foe; ev.difficulty = difficulty; ev.record = record;
  ev.win = { text: winText, drops: winDrops, critDrops: DEFAULT_CRIT.slice() };
  ev.lose = { text: loseText };
}

// —— 解析所有事件 ——
const blocks = text.split(/^###\s*事件/m).slice(1);
const events = [];
const titleToId = new Map();
for (const b of blocks) {
  const head = b.match(/[·•・]\s*(.+?)\s*[·•・]\s*([A-Za-z0-9_]+)/);
  if (!head) { warn(`有个事件块的标题行没解析出「标题 · id」，跳过：${b.slice(0, 30)}…`); continue; }
  const title = head[1].trim(), id = head[2].trim();
  const f = parseFields(b);
  const type = TYPE[(f.类型 || "").trim()] ?? "story";
  const layer = LAYER[(f.触发层 || "").trim()] ?? "shallow";
  const weight = WEIGHT[(f.出现频率 || "").trim()] ?? 3;
  const ev = { id, map: mapId, title, type, layer, weight, story: (f.故事 || "").trim() };
  const drops = parseDrops(f.掉落, layer);
  if (drops) ev.drops = drops;
  if (f.选项) {
    const opts = [];
    for (const line of f.选项.split("\n")) {
      const m = line.match(/^\s*([A-Za-z])[.．、]\s*(.+?)\s*(?:→|->|=>)\s*(.+)\s*$/);
      if (m) opts.push({ key: m[1].toUpperCase(), label: m[2].trim(), outcomes: parseOutcomes(m[3], layer) });
    }
    if (opts.length) ev.options = opts;
    else warn(`事件「${title}」标了选项但没解析到 A./B. 行。`);
  }
  if (type === "combat" || f.战斗 || f.敌人) parseCombat(f, layer, ev);
  titleToId.set(title, id);
  events.push(ev);
}

// —— 解析跳转目标（标题 → id）——
for (const ev of events) {
  for (const o of ev.options ?? []) {
    for (const oc of o.outcomes) {
      if (oc.t === "jump") {
        const to = titleToId.get(oc._toTitle);
        if (to) { oc.to = to; delete oc._toTitle; }
        else { warn(`跳转目标「${oc._toTitle}」在本稿里找不到对应事件，请改成存在的标题。`); oc.t = "none"; delete oc._toTitle; }
      }
    }
  }
}

// —— 组装 map ——
const finale = events.find((e) => e.layer === "finale" && e.type === "combat");
const map = {
  id: mapId,
  name: mapName,
  theme: [place, tone].filter(Boolean).join("　"),
  intro,
  unlock: null,
  events: events.map((e) => e.id),
  ...(finale ? { finale: finale.id } : {}),
};
const decorations = [...decorByName.values()];

// —— 配额自检 ——
const count = (t) => events.filter((e) => e.type === t).length;
const quota = `事件 ${events.length}（剧情${count("story")}/掉落${count("drop")}/分支${count("choice")}/奇遇${count("encounter")}/战斗${count("combat")}）`;

// —— 输出 ——
const data = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { maps: [], events: [], decorations: [] };
const exists = data.maps.some((m) => m.id === mapId);
if (exists && !force) { console.error(`✋ map id「${mapId}」已存在于 expeditions.json。要覆盖加 --force，或换个 id。`); process.exit(1); }

console.log(`\n🗺️  ${mapName || "(无名)"}  id=${mapId}`);
console.log(`📦  ${quota}，装饰 ${decorations.length} 件\n`);
if (todos.length) { console.log("⚠️  待你配 / 确认："); todos.forEach((t, i) => console.log(`   ${i + 1}. ${t}`)); console.log(""); }

if (dry) {
  console.log("—— DRY RUN（未写文件）。下面是将合并的内容：——");
  console.log(JSON.stringify({ map, events, decorations }, null, 2));
  process.exit(0);
}

// —— 合并写回（按 id 去重；--force 时替换同 id）——
const upsert = (arr, items, key = "id") => {
  for (const it of items) {
    const i = arr.findIndex((x) => x[key] === it[key]);
    if (i >= 0) arr[i] = it; else arr.push(it);
  }
};
upsert(data.maps, [map]);
upsert(data.events, events);
upsert(data.decorations, decorations);
writeFileSync(OUT, JSON.stringify(data, null, 2) + "\n", "utf8");
console.log(`✅ 已合并进 ${OUT}`);
console.log(`   下一步：把上面「待配清单」里的金额/visitLine/critDrops 过一遍，再 npm run build。`);
