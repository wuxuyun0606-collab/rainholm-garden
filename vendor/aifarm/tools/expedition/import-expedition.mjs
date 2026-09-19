#!/usr/bin/env node
// 📥 秘境文案导入器 —— 把 DS 产出的 .txt 文案解析成 content/expeditions.json 里的一张地图。
//
// 这是个「通用文本→结构」转换工具：它只按固定标签搬字段、配默认数值、注册装饰、合并回 JSON，
// 不解读、不评判内容含义。跑什么、发不发都由你决定（跑完自己 npm run build + bash deploy.sh）。
//
// 用法：
//   node tools/expedition/import-expedition.mjs <文案.txt> <地图英文id> [--dry]
//     <地图英文id>  例：mushroom_forest（事件 id 用文案里「事件 · 标题 · id」给的那个）
//     --dry         只解析、打印结果，不写文件（先看看解析对不对）
//
// 文案格式（每个事件一块，字段用中文冒号；空行随意）：
//   事件 · <标题> · <english_id>
//   类型：纯剧情 / 掉落 / 分支 / 奇遇 / 战斗
//   触发层：浅层 / 深层 / 终景
//   出现频率：常见 / 偶见 / 稀有
//   故事：<正文>
//   掉落：金币 / 银币 / 加速药水 / 装饰品：名字          （仅"掉落"类；数量脚本自动配）
//   选项：                                              （分支/奇遇）
//     A. <选项文字> → <后果1>；<后果2>
//     B. ...
//   敌人： / 难度：易·中·难 / 赢：<叙事> 战利品：<掉落> / 败：<叙事> / 记入见闻：<名>   （战斗）
//   模糊提示：<可选>
//
// 选项后果词（用「；」分隔，可叠加）：
//   得到：<金币/银币/加速药水/装饰品：名字>  状态+1 / 状态-1  获得加成：<文字>
//   进入战斗：<敌人名>  跳转：<事件id或标题>  纯剧情后果：<文字>  无事发生

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, "..", "..");
const JSON_PATH = path.join(ROOT, "content", "expeditions.json");

// —— 参数 ——
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const pos = argv.filter((a) => !a.startsWith("--"));
const [txtFile, mapId] = pos;
const DRY = flags.has("--dry");
if (!txtFile || !mapId) {
  console.error("用法: node tools/expedition/import-expedition.mjs <文案.txt> <地图英文id> [--dry]");
  process.exit(1);
}

// —— 默认数值（文案不写数字，这里统一配；不满意跑完手改 JSON 即可）——
const COINS_BY_LAYER = { shallow: 35, deep: 80, finale: 160 };
const SILVER = 20, POTION = 1;
const WEIGHT_BY_FREQ = { 常见: 5, 偶见: 3, 稀有: 2 };
const LAYER = { 浅层: "shallow", 深层: "deep", 终景: "finale" };
const TYPE = { 纯剧情: "story", 掉落: "drop", 分支: "choice", 奇遇: "encounter", 战斗: "combat" };
const DIFF = { 易: "easy", 中: "mid", 难: "hard" };

const warnings = [];
const warn = (m) => warnings.push(m);

// 装饰登记表：名字 → {id,name}；遇到「装饰品：X」就登记一个（visitLine 先给通用占位，回头自己润色）
const decorReg = new Map();
let decorSeq = 0;
function decorId(name) {
  if (decorReg.has(name)) return decorReg.get(name).id;
  decorSeq += 1;
  const id = `${mapId}_dec${decorSeq}`;
  decorReg.set(name, { id, name, from: mapId, visitLine: `摆着一件从秘境带回的「${name}」，来历不必细说，看着就叫人想起那趟奇遇。` });
  return id;
}

// 解析一份掉落物名 → ExpDrop（金币/银币/加速药水/装饰品：名字）
function parseDrop(s, layer) {
  s = s.trim();
  if (/^金币/.test(s)) return { t: "coins", n: COINS_BY_LAYER[layer] ?? 50 };
  if (/^银币/.test(s)) return { t: "silver", n: SILVER };
  if (/^(加速)?药水/.test(s)) return { t: "potion", n: POTION };
  const m = s.match(/^装饰品[：:]\s*(.+)$/);
  if (m) return { t: "decor", id: decorId(m[1].trim()) };
  warn(`看不懂的掉落「${s}」——已跳过`);
  return null;
}

// 解析一条选项后果串（用「；」/「;」分隔）→ ExpOutcome[]
function parseOutcomes(raw, layer, evId) {
  const parts = raw.split(/[；;]/).map((x) => x.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    let m;
    if ((m = p.match(/^得到[：:]\s*(.+)$/))) {
      const d = parseDrop(m[1], layer);
      if (d) out.push(d.t === "decor" ? { t: "decor", id: d.id } : { t: d.t, n: d.n });
    } else if ((m = p.match(/^状态\s*([+\-]\s*\d+)/))) {
      out.push({ t: "status", n: parseInt(m[1].replace(/\s/g, ""), 10) });
    } else if ((m = p.match(/^获得加成[：:]\s*(.+)$/))) {
      out.push({ t: "buff", mod: 1, text: m[1].trim() });
    } else if ((m = p.match(/^进入(战斗|角力)[：:]\s*(.+)$/))) {
      const foe = m[2].replace(/[（(].*$/, "").trim(); // 去掉括号里的说明
      out.push({ t: "combat", foe, difficulty: "mid" });
    } else if ((m = p.match(/^跳转[：:]\s*(.+)$/))) {
      out.push({ t: "jump", to: m[1].trim() });
    } else if ((m = p.match(/^(纯剧情后果|结果|后果)[：:]\s*(.+)$/))) {
      out.push({ t: "none", text: m[2].trim() });
    } else if (/^无事发生/.test(p)) {
      out.push({ t: "none" });
    } else {
      out.push({ t: "none", text: p }); // 兜底：整句当叙事
    }
  }
  if (!out.length) { warn(`事件 ${evId} 有个选项没解析出任何后果`); out.push({ t: "none" }); }
  return out;
}

// —— 读文案，按「事件 ·」切块 ——
const rawText = fs.readFileSync(path.resolve(process.cwd(), txtFile), "utf8");
const lines = rawText.split(/\r?\n/);

// 抽秘境设定（名字/是个什么地方/基调/引子）
const grab = (label) => {
  const re = new RegExp(`^${label}[：:]\\s*(.*)$`);
  const i = lines.findIndex((l) => re.test(l.trim()));
  if (i < 0) return "";
  let val = lines[i].trim().match(re)[1];
  // 续接后续非空、非"字段行"的行（引子可能换行）
  for (let j = i + 1; j < lines.length; j++) {
    const t = lines[j].trim();
    if (!t) { if (val) break; else continue; }
    if (/^(名字|是个什么地方|基调|引子|专属装饰方向|八、|事件\s*·)/.test(t)) break;
    val += t;
  }
  return val.trim();
};
const mapName = grab("名字") || mapId;
const mapTheme = grab("是个什么地方") || grab("基调") || "";
const mapIntro = grab("引子") || mapTheme;

// 切事件块
const blocks = [];
let cur = null;
for (const line of lines) {
  const t = line.trim();
  const head = t.match(/^事件\s*·\s*(.+?)\s*·\s*([a-zA-Z0-9_]+)\s*$/);
  if (head) { cur = { title: head[1].trim(), id: head[2].trim(), body: [] }; blocks.push(cur); continue; }
  if (cur) cur.body.push(line);
}
if (!blocks.length) { console.error("❌ 没解析到任何「事件 · 标题 · id」块，检查文案格式。"); process.exit(1); }

// 逐块解析成 ExpEvent
const FIELD_RE = /^(类型|触发层|出现频率|故事|掉落|选项|敌人|难度|赢|败|记入见闻|模糊提示)[：:]\s*(.*)$/;
const OPT_RE = /^([A-Z])[.、]\s*(.+)$/;

function parseBlock(b) {
  const f = {}; // 字段名 → 值（故事/赢/败可多行累积）
  const opts = [];
  let key = null;
  for (const line of b.body) {
    const t = line.trim();
    const om = t.match(OPT_RE);
    if (om && (key === "选项" || opts.length)) {
      // 选项行： "A. 文字 → 后果"
      const arrow = om[2].split(/→|->/);
      opts.push({ key: om[1], label: arrow[0].trim(), rawOutcome: (arrow[1] ?? "").trim() });
      key = "选项";
      continue;
    }
    const fm = t.match(FIELD_RE);
    if (fm) { key = fm[1]; f[key] = fm[2]; continue; }
    if (!t) continue;
    if (key && key !== "选项") f[key] = (f[key] ? f[key] + "" : "") + t; // 续行（故事/赢/败换行）
  }

  const type = TYPE[f["类型"]?.trim()] ?? "story";
  const layer = LAYER[f["触发层"]?.trim()] ?? "shallow";
  const weight = WEIGHT_BY_FREQ[f["出现频率"]?.trim()] ?? 3;
  const ev = { id: b.id, map: mapId, title: b.title, type, layer, weight, story: (f["故事"] ?? "").trim() };
  if (!ev.story) warn(`事件 ${b.id} 没有「故事：」`);

  if (type === "drop") {
    const d = f["掉落"] ? parseDrop(f["掉落"], layer) : null;
    if (d) ev.drops = [d]; else warn(`掉落事件 ${b.id} 没配出掉落`);
  }

  if (type === "choice" || type === "encounter") {
    if (!opts.length) warn(`${b.id} 是分支/奇遇但没解析到选项`);
    ev.options = opts.map((o) => ({ key: o.key, label: o.label, outcomes: parseOutcomes(o.rawOutcome, layer, b.id) }));
  }

  if (type === "combat") {
    ev.foe = (f["敌人"] ?? b.title).trim();
    ev.difficulty = DIFF[f["难度"]?.trim()] ?? "mid";
    if (f["记入见闻"]) ev.record = f["记入见闻"].trim();
    // 赢：叙事 + 战利品：X
    const winRaw = (f["赢"] ?? "").trim();
    const spoil = winRaw.split(/战利品[：:]/);
    ev.win = { text: spoil[0].trim() };
    if (spoil[1]) { const d = parseDrop(spoil[1], layer); if (d) ev.win.drops = [d]; }
    else warn(`战斗 ${b.id} 没写「战利品：」，赢了没掉落`);
    ev.lose = { text: (f["败"] ?? "").trim() };
  }

  if (f["模糊提示"]) ev.hint = f["模糊提示"].trim();
  return ev;
}

const events = blocks.map(parseBlock);

// —— 组装 map ——
const finaleEv = events.find((e) => e.layer === "finale" && e.type === "combat")
  ?? events.find((e) => e.layer === "finale");
const map = {
  id: mapId, name: mapName, theme: mapTheme, intro: mapIntro,
  unlock: null, events: events.map((e) => e.id),
  ...(finaleEv ? { finale: finaleEv.id } : {}),
};

// —— 合并回 expeditions.json（同 id 覆盖，事件按 map 去旧补新，装饰去重追加）——
const doc = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
doc.maps = doc.maps.filter((m) => m.id !== mapId).concat([map]);
doc.events = doc.events.filter((e) => e.map !== mapId).concat(events);
const decors = [...decorReg.values()];
const haveDecor = new Set(doc.decorations.map((d) => d.id));
doc.decorations = doc.decorations.concat(decors.filter((d) => !haveDecor.has(d.id)));

// —— 报告 ——
const byType = events.reduce((a, e) => ((a[e.type] = (a[e.type] || 0) + 1), a), {});
console.log(`\n📥 解析「${mapName}」(${mapId})`);
console.log(`   事件 ${events.length} 个：`, byType);
console.log(`   装饰 ${decors.length} 件：`, decors.map((d) => `${d.name}(${d.id})`).join("、") || "无");
console.log(`   压轴(finale)：${finaleEv ? finaleEv.title : "（无 终景 事件）"}`);
if (warnings.length) { console.log(`\n⚠️  ${warnings.length} 条提示（不致命，建议核对）：`); warnings.forEach((w) => console.log("   · " + w)); }

if (flags.has("--json")) { console.log("\n" + JSON.stringify({ map, events, decorations: decors }, null, 2)); process.exit(0); }
if (DRY) { console.log("\n(--dry：没写文件。解析结果如上，觉得对了去掉 --dry 再跑。)"); process.exit(0); }

fs.writeFileSync(JSON_PATH, JSON.stringify(doc, null, 2) + "\n", "utf8");
console.log(`\n✅ 已合并进 ${path.relative(ROOT, JSON_PATH)}`);
console.log(`   下一步：npm run build → bash deploy.sh test content/expeditions.json content/expeditions.json 之外无需，直接 build 后 deploy 整包`);
console.log(`   （装饰的 visitLine 是通用占位，想润色就到 expeditions.json 的 decorations 里改。）`);
