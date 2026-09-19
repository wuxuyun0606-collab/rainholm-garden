// 把 DS 的「内容填充完成稿.txt」(Markdown 表格) 解析成结构化 content/*.json。
// 待实现机制的原文照存，不丢失。运行: node tools/parse-content.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "../docs/# AI 农场 · 内容填充完成稿.txt");
const OUT = resolve(__dirname, "../content");
mkdirSync(OUT, { recursive: true });

const lines = readFileSync(SRC, "utf8").split(/\r?\n/);

// —— 扫描：跟踪当前 major / sub / group，收集每张表的行 ——
let major = "",
  sub = "",
  group = "";
const rows = []; // {major, sub, group, cols:{}}
let header = null;

function isTableRow(l) {
  return l.trim().startsWith("|") && l.trim().endsWith("|");
}
function cells(l) {
  return l
    .trim()
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim());
}
function isSep(c) {
  return c.every((x) => /^:?-{2,}:?$/.test(x));
}

for (const raw of lines) {
  const l = raw.trim();
  if (l.startsWith("## ")) {
    const t = l.slice(3);
    if (t.includes("作物科清单")) major = "families";
    else if (t.includes("普通作物")) major = "common";
    else if (t.includes("奇幻作物")) major = "fantasy";
    else if (t.includes("限定作物")) major = "limited";
    else if (t.startsWith("D.") || t.includes("动物")) major = "animals";
    else if (t.startsWith("E.") || t.includes("季节")) major = "seasons";
    else if (t.startsWith("F.") || t.includes("真实节日")) major = "festivals";
    else if (t.startsWith("G.") || t.includes("随机日常事件")) major = "events";
    else if (t.startsWith("H.") || t.includes("土地品阶")) major = "landTiers";
    else if (t.startsWith("I.") || t.includes("品相档")) major = "qualities";
    else if (t.startsWith("J.") || t.includes("文案池")) major = "flavor";
    else major = "other";
    sub = group = "";
    header = null;
    continue;
  }
  if (l.startsWith("### ")) {
    const t = l.slice(4);
    if (t.startsWith("B1") || t.includes("花")) sub = "flower";
    else if (t.startsWith("B2") || t.includes("植物")) sub = "plant";
    else if (t.startsWith("B3") || t.includes("能吃")) sub = "edible";
    else if (t.startsWith("B4") || t.includes("会动")) sub = "moving";
    else if (t.startsWith("C1") || t.includes("节日解锁")) sub = "festival";
    else if (t.startsWith("C2") || t.includes("时间段")) sub = "timewindow";
    else if (t.startsWith("C3") || t.includes("图鉴解锁度")) sub = "codex";
    else if (t.startsWith("C4") || t.includes("特殊操作")) sub = "action";
    else if (t.startsWith("A1") || t.includes("全年")) sub = "allyear";
    else if (t.startsWith("A2") || t.includes("跨季")) sub = "cross";
    else if (t.startsWith("A3") || t.includes("单一季节")) sub = "single";
    else sub = "";
    group = "";
    header = null;
    continue;
  }
  // 加粗的季节小标题（A3 春夏秋冬）
  const bold = l.match(/^\*\*(.+?)\*\*$/);
  if (bold) {
    const b = bold[1];
    if (b.includes("春")) group = "春";
    else if (b.includes("夏")) group = "夏";
    else if (b.includes("秋")) group = "秋";
    else if (b.includes("冬")) group = "冬";
    header = null;
    continue;
  }
  if (isTableRow(l)) {
    const c = cells(l);
    if (isSep(c)) continue;
    if (!header) {
      header = c;
      continue;
    }
    const obj = {};
    header.forEach((h, i) => (obj[h] = c[i] ?? ""));
    rows.push({ major, sub, group, cols: obj });
  } else {
    // 非表格行：表格结束
    if (l === "" || l.startsWith("---") || l.startsWith(">")) header = null;
  }
}

// —— 归一化 helpers ——
const num = (v) => {
  const n = parseInt(String(v).replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
};
const pick = (o, ...keys) => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== "") return o[k];
  return "";
};

// —— families ——
const families = rows
  .filter((r) => r.major === "families")
  .map((r) => {
    const o = r.cols;
    return {
      id: o["科id"],
      name: o["科名"],
      latin: o["假拉丁科名"],
      category: o["倾向类别"],
      theme: o["主题一句话"],
      plantLines: [o["播种句1"], o["播种句2"]].filter(Boolean),
      harvestLines: [o["收获句1"], o["收获句2"]].filter(Boolean),
    };
  });

// —— 机制分类（按 docs/MECHANICS-TIERS.md 的规则，启发式打标，可在数据里手改）——
function classify(text) {
  const t = text || "";
  const has = (re) => re.test(t);
  // 🔒 dormant：需要尚未建的子系统
  if (has(/有雾|雾天|雨天|阴天|晴天才|大风天|下雨|雨后膨胀|雨天自动/)) return ["dormant", "weather"];
  if (has(/移动一格|飞离|飞走|横着移动|横移|拦截|追上去|逮住|往影子里|阴影角|只能种在|盘旋/)) return ["dormant", "movement"];
  if (has(/送给|双方各|两家|他人的地|别人的地|同服玩家|友谊|对方作物|互相能看见/)) return ["dormant", "social"];
  if (has(/注视|盯着|背对|移开视线|被人看|装死/)) return ["dormant", "gaze"];
  if (has(/使用后|使用可|撒在|合成|兑换|立即成熟|翻倍|提前预览|暂停全服|授粉|可制作|可提炼|恢复类|驱虫|降低被偷|加速|解锁.*图鉴|随机解锁/))
    return ["dormant", "item"];
  // 🔶 approx：时辰 / 农历 / 满月 / 长线统计
  if (has(/农历/)) return ["approx", "lunar"];
  if (has(/满月/)) return ["approx", "lunar"];
  if (has(/凌晨|正午|午夜|日出|日落|黄昏|黎明|整点|那几秒|几十秒|准时|0:00|12:00|1:00|1:30/)) return ["approx", "time"];
  if (has(/连续.*天|累计.*次|巡视.*次/)) return ["approx", "stat"];
  // ✅ active：纯 flavor 或无特殊机制
  return ["active", null];
}

// —— crops ——
const crops = [];
for (const r of rows.filter((x) => ["common", "fantasy", "limited"].includes(x.major))) {
  const o = r.cols;
  if (!pick(o, "id")) continue;
  const base = {
    id: o["id"],
    name: o["名称"],
    latin: o["学名"],
    desc: o["描述"],
    category: r.major, // common / fantasy / limited
    rarity: o["稀有度"],
    growTicks: num(pick(o, "生长tick")),
    water: num(pick(o, "需水")),
    seedPrice: num(pick(o, "种子价")),
    sellPrice: num(pick(o, "售价", "基准售价")),
    family: null, // 待补：crop→科 归属
    mechanicText: (() => {
      const k = Object.keys(o).find((x) => x.startsWith("特殊机制"));
      return k && o[k] ? o[k] : null;
    })(),
  };
  {
    const txt = [base.mechanicText, pick(o, "解锁条件"), pick(o, "收获产出")].filter(Boolean).join(" ");
    const [status, system] = classify(txt);
    base.mechanicStatus = status; // active / approx / dormant
    base.mechanicSystem = system; // weather/movement/social/gaze/item/lunar/time/stat/null
  }
  if (r.major === "common") {
    base.availability = r.sub; // allyear / cross / single
    base.seasons = pick(o, "可种季节") || (r.group ? r.group : null);
  } else if (r.major === "fantasy") {
    base.fantasyType = r.sub; // flower/plant/edible/moving
  } else if (r.major === "limited") {
    base.unlockType = r.sub; // festival/timewindow/codex/action
    base.unlockCond = pick(o, "解锁条件");
    base.produce = pick(o, "收获产出") || null;
  }
  crops.push(base);
}

// —— animals ——
const animals = rows
  .filter((r) => r.major === "animals")
  .map((r) => {
    const o = r.cols;
    return {
      id: o["id"],
      name: o["名称"],
      desc: o["描述"],
      category: o["类别"],
      produce: o["产出物"],
      produceEveryTicks: num(o["产出节奏"]),
      producePrice: num(o["产出单价"]),
      buyCost: num(o["购买价"]),
      unlockCond: o["解锁条件"] === "—" ? null : o["解锁条件"],
    };
  })
  .filter((a) => a.id);

// —— seasons ——
const seasons = rows
  .filter((r) => r.major === "seasons")
  .map((r) => {
    const o = r.cols;
    return {
      name: o["季节"],
      desc: o["季节描述"],
      ambience: (o["氛围句（6条）"] || o["氛围句"] || "").split(/；|;/).map((s) => s.trim()).filter(Boolean),
      topCrops: (o["当季高产作物"] || "").split(/、|,/).map((s) => s.trim()).filter(Boolean),
      shopBias: o["商店偏好"],
    };
  })
  .filter((s) => s.name);

// —— festivals ——
const festivals = rows
  .filter((r) => r.major === "festivals")
  .map((r) => {
    const o = r.cols;
    return {
      name: o["节日"],
      dateWindow: o["日期窗口"],
      cropId: o["限定作物"],
      enterText: o["进入文案"],
      harvestText: o["收获文案"],
      ambience: o["氛围"],
    };
  })
  .filter((f) => f.name);

// —— events ——
const events = rows
  .filter((r) => r.major === "events")
  .map((r) => {
    const o = r.cols;
    return {
      id: o["id"],
      name: o["名称"],
      effect: o["效果"],
      weight: num(o["权重"]),
      lines: [o["文案1"], o["文案2"]].filter(Boolean),
    };
  })
  .filter((e) => e.id);

// —— landTiers ——
const landTiers = rows
  .filter((r) => r.major === "landTiers")
  .map((r) => {
    const o = r.cols;
    return {
      tier: num(o["阶"]),
      name: o["名称"],
      plots: num(o["地块数"]),
      maxRarity: o["最高稀有度"],
      upgradeCost: o["升级花费"] === "—" ? null : o["升级花费"],
      achieveText: o["达成文案"],
    };
  })
  .filter((t) => t.name);

// —— qualities ——
const qualities = rows
  .filter((r) => r.major === "qualities")
  .map((r) => {
    const o = r.cols;
    return {
      tier: num(o["档"]),
      name: o["名称"],
      sizeRange: o["尺寸区间"],
      priceFactor: parseFloat(o["价格系数"]) || null,
      lines: [o["包装句1"], o["包装句2"]].filter((s) => s && !s.includes("朴素，无修饰")),
    };
  })
  .filter((q) => q.name);

// —— 写出 ——
const meta = { contentVersion: 1, generatedFrom: "docs/内容填充完成稿.txt", counts: {} };
const out = { families, crops, animals, seasons, festivals, events, "land-tiers": landTiers, qualities };
for (const [k, v] of Object.entries(out)) {
  meta.counts[k] = v.length;
  writeFileSync(resolve(OUT, `${k}.json`), JSON.stringify(v, null, 2), "utf8");
}
writeFileSync(resolve(OUT, "meta.json"), JSON.stringify(meta, null, 2), "utf8");

// —— 报告 ——
console.log("解析完成，各表数量：");
console.log(meta.counts);
const byCat = (c) => crops.filter((x) => x.category === c).length;
console.log(`作物细分: 普通 ${byCat("common")} / 奇幻 ${byCat("fantasy")} / 限定 ${byCat("limited")}`);
const missing = crops.filter((c) => !c.id || !c.name || c.growTicks == null);
if (missing.length) console.log("⚠️ 字段缺失的作物:", missing.map((m) => m.id || "?"));
