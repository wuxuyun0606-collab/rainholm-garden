// 人类可见的只读看板（HTML，零依赖，服务端渲染）。给小猫看她的 AI 伴侣（小克）的农场。
// 与给 AI 玩的文字接口完全分开：这里只「展示」，不提供任何写操作。
// 绑定方式：/ui/<humanKey> —— 只认低权限观光钥匙；页面内跳转也只继续传这把钥匙，不暴露主 token。
// 视觉基调：暖田园·标本馆（米麻底 + 木质暖褐 + 草木绿），靠稀有度色彩体系与排版质感出彩（零图片）。
//
// 本文件目前是「农场主页/总览」打样页 + 全站共享外壳（外壳定义视觉语言，其余页之后复用）。
import { advance, collectionPct, codexCountByCategory, nextUpgradeReq, refreshShop, shopOffer, refreshRanchShop, animalUpgradeCost, plotRemainMs, isStarred } from "./engine.js";
import { cropById, getCrop, animalById, petById, accessoryById, decorationById, landTierByLevel, totalCropCount, cropsByCategory, qualities, materialById, recipes, expMaps, expEventById, expMapById, expDecorById } from "./content.js";
import { TICK_MS, RANCH_ANIMAL_MAX_LEVEL, RANCH_LEVEL_INCOME_STEP, UGC_DESIGN_FEE, UGC_SEED_YIELD, UGC_NAME_MAX, UGC_DESC_MAX, UGC_PLANT_MAX, UGC_HARVEST_MAX, MESSAGE_TEXT_MAX, WELCOME_MAX, EXP_DC, EXP_DAILY_CAP, EXP_BLESSING_MAX } from "./config.js";
import { currentSeason, activeFestivals, currentDayIndex } from "./time.js";
import { playerFarms } from "./store.js";
import { allUgc } from "./ugc.js";
import { buildLeaderboards } from "./leaderboard.js";
import { dailyScore } from "./daily.js";
import { titles as titleDefs } from "./content.js";
import { checkTitles, concordTierName, equippedTitle } from "./titles.js";
// ——————————————————————————————————————————————————————————————
// 小工具
// ——————————————————————————————————————————————————————————————
function esc(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const num = (n) => (n ?? 0).toLocaleString("en-US");
/** UTC+8 时钟 HH:MM（作物预计成熟时间用）。 */
const clock = (ms) => new Date(ms).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false });
/** UTC+8 月-日 HH:MM（足迹时间戳用）。 */
const stamp = (ms) => new Date(ms).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
/** 粗粒度相对时间（刚刚 / N分钟前 / N小时前 / N天前）。 */
function ago(ms, now) {
    const s = Math.max(0, Math.floor((now - ms) / 1000));
    if (s < 60)
        return "刚刚";
    const m = Math.floor(s / 60);
    if (m < 60)
        return `${m}分钟前`;
    const h = Math.floor(m / 60);
    if (h < 24)
        return `${h}小时前`;
    return `${Math.floor(h / 24)}天前`;
}
/** 把「剩余毫秒」写成人读时长（约N分钟 / 约N.N小时）。 */
function fmtDur(ms) {
    const min = Math.max(1, Math.round(ms / 60000));
    return min >= 60 ? `约${Math.round(min / 6) / 10}小时` : `约${min}分钟`;
}
const CAT_LABEL = { common: "普通", fantasy: "奇幻", limited: "限定", ugc: "自创" };
const RARITY_VAR = { N: "--N", R: "--R", SR: "--SR", SSR: "--SSR", SP: "--SP", OR: "--OR" };
/** 稀有度小色标，如 SR（带专属色边框）。 */
const rarityDot = (r) => `<span class="rdot" style="--c:var(${RARITY_VAR[r] ?? "--N"})">${esc(r)}</span>`;
/** 已收集的原创(ugc)物种数。 */
const ugcGot = (f) => Object.keys(f.codex).filter((id) => getCrop(id)?.category === "ugc").length;
/** 最近收录的若干条图鉴（codex 键按收集顺序插入，取末尾即最新）。 */
function recentCodex(f, n) {
    return Object.keys(f.codex).slice(-n).reverse()
        .map((id) => getCrop(id)).filter((c) => !!c)
        .map((c) => ({ name: c.name, rarity: c.rarity }));
}
/** 一座农场已收集官方物种数（普通+奇幻+限定）。 */
function codexGot(f) {
    return codexCountByCategory(f, "common") + codexCountByCategory(f, "fantasy") + codexCountByCategory(f, "limited");
}
/** 在全服中按某打分函数排第几（1 起）。 */
function rankOf(farms, me, score) {
    const v = score(me);
    let r = 1;
    for (const o of farms)
        if (score(o) > v)
            r++;
    return r;
}
// ——————————————————————————————————————————————————————————————
// 全站外壳：视觉语言都在这里（CSS 变量 / 稀有度色卡 / 衬线标题 / 纸纹质感）
// ——————————————————————————————————————————————————————————————
const STYLE = `
:root{
  /* 清新田园 —— 浅绿主色 + 米白，轻盈透亮 */
  --paper:#f1f8ea; --paper2:#ffffff; --ink:#33433a; --ink-soft:#6f8070; --line:#dceccf;
  --wood:#5d8a48; --leaf:#86c96f; --leaf-deep:#4e9a52; --gold:#cf9a3a;
  /* 稀有度色卡（贯穿图鉴/原创/地块/商店）*/
  --N:#93a98c; --R:#5aa0dc; --SR:#a07fd6; --SSR:#e0a63c; --SP:#e0617e; --OR:#df7fb6;
  --serif:"Songti SC","STSong","Noto Serif SC",Georgia,"Times New Roman",serif;
  --shadow:0 10px 30px -22px #2f5a2e55;
}
*{box-sizing:border-box}
body{margin:0;color:var(--ink);
  font:15px/1.7 system-ui,"Segoe UI",-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
  background:
    radial-gradient(1100px 520px at 50% -10%, #ffffff, transparent 70%),
    radial-gradient(820px 460px at 88% 4%, #e4f3d6, transparent 62%),
    radial-gradient(760px 520px at 6% 18%, #eef8e4, transparent 60%),
    linear-gradient(180deg, #f4faee, #ecf6e1);
  background-attachment:fixed;
}
a{color:var(--leaf-deep);text-decoration:none}
.serif{font-family:var(--serif)}
.wrap{max-width:980px;margin:0 auto;padding:0 18px 72px}

/* 顶栏 */
header.top{position:sticky;top:0;z-index:5;background:rgba(250,253,247,.82);backdrop-filter:blur(9px) saturate(1.1);
  border-bottom:1px solid var(--line)}
.topin{max-width:980px;margin:0 auto;padding:11px 18px;display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center}
.brand{font-family:var(--serif);font-weight:700;font-size:18px;letter-spacing:1px;margin-right:6px;color:var(--wood)}
nav a{color:var(--ink-soft);padding:4px 9px;border-radius:9px;white-space:nowrap;font-size:14px}
nav a.on,nav a:hover{color:var(--leaf-deep);background:#e6f3d8}

/* 匾额头 */
.plaque{margin:26px 0 6px;padding:22px 24px;border:1px solid var(--line);border-radius:20px;
  background:linear-gradient(180deg, rgba(255,255,255,.92), rgba(233,246,222,.78));
  box-shadow:var(--shadow);position:relative;overflow:hidden;backdrop-filter:blur(4px)}
.plaque::before{content:"";position:absolute;inset:0;
  background:radial-gradient(460px 180px at 14% -30%, #ffffffcc, transparent 60%);pointer-events:none}
.plaque h1{font-family:var(--serif);font-size:30px;margin:0;letter-spacing:1px;color:#2f5a31}
.welcome{color:var(--ink-soft);font-style:italic;margin:6px 0 0}
.tags{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.tag{background:rgba(255,255,255,.7);border:1px solid var(--line);border-radius:999px;padding:2px 11px;font-size:13px;color:var(--ink-soft)}
.tag b{color:var(--leaf-deep)}

/* 卡片 */
.grid{display:grid;gap:14px}
.c2{grid-template-columns:1.05fr .95fr}
.c2b{grid-template-columns:1fr 1fr}
@media(max-width:720px){.c2,.c2b{grid-template-columns:1fr}}
.card{background:rgba(255,255,255,.72);border:1px solid var(--line);border-radius:16px;padding:16px 18px;
  box-shadow:var(--shadow);backdrop-filter:blur(4px);transition:transform .15s ease, box-shadow .15s ease}
.card h3{margin:0 0 10px;font-size:15px;color:var(--wood);font-weight:700;letter-spacing:.5px}
.muted{color:var(--ink-soft)}.small{font-size:13px}

/* 收集册大圆环 */
.hero{display:flex;gap:22px;align-items:center}
@media(max-width:560px){.hero{flex-direction:column;text-align:center}}
.ring{position:relative;width:172px;height:172px;flex:0 0 auto}
.ring svg{transform:rotate(-90deg)}
.ring .track{fill:none;stroke:#e3efd9;stroke-width:15}
.ring .val{fill:none;stroke:url(#g);stroke-width:15;stroke-linecap:round;
  stroke-dasharray:var(--circ);stroke-dashoffset:var(--off);animation:draw 1.5s cubic-bezier(.22,1,.36,1) both}
@keyframes draw{from{stroke-dashoffset:var(--circ)}}
.ring .center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.ring .pct{font-family:var(--serif);font-size:38px;font-weight:700;line-height:1;color:var(--leaf-deep)}
.ring .cap{font-size:12px;color:var(--ink-soft);margin-top:4px;letter-spacing:2px}
.herometa{flex:1;min-width:0}
.bignums{display:flex;gap:18px;flex-wrap:wrap;margin-bottom:10px}
.bignums .b{font-family:var(--serif);font-size:22px;color:#2f5a31}
.bignums .l{font-size:12px;color:var(--ink-soft)}

/* 图鉴：分类数字 + 新收录 */
.catnums{display:flex;flex-wrap:wrap;gap:5px 16px;font-size:14px;margin:2px 0 10px}
.catnums b{font-family:var(--serif);font-size:17px;color:var(--leaf-deep);margin-left:2px}
.recent{display:flex;flex-wrap:wrap;align-items:center;gap:6px 9px;
  padding-top:9px;border-top:1px dashed var(--line)}
.recent .rc{font-size:13px}
.rdot{display:inline-block;border:1px solid var(--c);color:var(--c);border-radius:6px;padding:0 6px;
  font-size:11px;font-weight:700;background:color-mix(in srgb, var(--c) 13%, transparent)}

/* 地块 mini */
.plots{display:grid;grid-template-columns:repeat(auto-fill,minmax(74px,1fr));gap:9px}
.plot{border:1px solid var(--line);border-radius:12px;padding:9px 6px;text-align:center;background:rgba(255,255,255,.6)}
.plot .ico{font-size:22px;display:block;line-height:1.2}
.plot.empty{opacity:.5}
.plot.ripe{border-color:var(--SSR);background:#fff7e6;box-shadow:0 0 0 1px #e0a63c44 inset}
.bar,.pminibar{height:6px;border-radius:5px;background:#e3efd9;overflow:hidden}
.pminibar{margin-top:5px}
.bar>span,.pminibar>span{display:block;height:100%;border-radius:5px}

/* 通用行 / 徽章 */
.line{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:3px 0}
.pill{display:inline-block;background:rgba(255,255,255,.7);border:1px solid var(--line);border-radius:8px;padding:1px 8px;font-size:12px;color:var(--ink-soft);margin:2px 0}
.rank-big{font-family:var(--serif);font-size:26px;color:var(--gold)}
.cta{color:var(--leaf-deep);font-size:13px;font-weight:600}
/* 牧场：动物行 + 按钮 + 输入 */
.btn{display:inline-block;border:0;border-radius:11px;padding:9px 16px;font:inherit;font-weight:700;cursor:pointer;
  background:linear-gradient(180deg,var(--leaf),var(--leaf-deep));color:#fff;box-shadow:0 6px 16px -8px #3a7a3a88}
.btn:hover{filter:brightness(1.05)}
.btn.ghost{background:#fff;color:var(--leaf-deep);border:1px solid var(--line);box-shadow:none}
.btn:disabled{background:#dfe9d6;color:#9bb091;cursor:not-allowed;box-shadow:none}
.inp{font:inherit;border:1px solid var(--line);border-radius:10px;padding:8px 11px;width:120px;background:#fff;color:var(--ink)}
.flash{background:#eef7e3;border:1px solid var(--leaf);border-radius:12px;padding:10px 14px;margin:14px 0 0;color:#2f5a31}
.animal{display:flex;align-items:center;gap:12px;padding:11px 0;border-top:1px dashed var(--line)}
.animal:first-child{border-top:0}
.animal .ai{font-size:30px;line-height:1;flex:0 0 auto}
.animal .am{flex:1;min-width:0}
.animal .ready{font-family:var(--serif);font-size:20px;color:var(--gold)}
/* 手机端：按钮收小一点（一键收获等不再过大），动物行允许换行——名称/产出独占一行，pin/升级按钮落到下一行，不再被挤成一字一行 */
@media(max-width:560px){
  .btn{padding:7px 12px;font-size:13px}
  .animal{flex-wrap:wrap;gap:6px 10px}
  .animal .am{flex:1 1 100%}
  .animal .ready{font-size:16px}
}

/* 图鉴册：分类锚点导航 + 标本位 */
.codexnav{display:flex;flex-wrap:wrap;gap:8px;position:sticky;top:49px;z-index:4;
  margin:18px 0 4px;padding:8px 0;background:linear-gradient(180deg,#f3f9ec 70%,transparent)}
.codexnav a{display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.78);
  border:1px solid var(--line);border-radius:999px;padding:5px 13px;font-size:13px;color:var(--ink-soft)}
.codexnav a:hover{color:var(--leaf-deep);background:#e6f3d8}
.codexnav b{font-family:var(--serif);color:var(--leaf-deep)}
.secthead{display:flex;align-items:baseline;gap:10px;margin:24px 0 12px;padding-bottom:6px;border-bottom:1px solid var(--line)}
.secthead h2{font-family:var(--serif);font-size:21px;margin:0;color:#2f5a31}
.secthead .cnt{font-size:13px;color:var(--ink-soft)}
.secthead .cnt b{font-family:var(--serif);color:var(--leaf-deep);font-size:15px}
.specimens{display:grid;grid-template-columns:repeat(auto-fill,minmax(158px,1fr));gap:11px}
.spec{position:relative;border:1px solid var(--line);border-left:4px solid var(--c,var(--line));
  border-radius:12px;padding:10px 12px;background:rgba(255,255,255,.68);min-height:78px}
.spec.locked{opacity:.6;filter:grayscale(.55);border-left-color:#cdd9c3}
.spec .nm{font-family:var(--serif);font-weight:700;font-size:15px;color:var(--ink);line-height:1.3}
.spec .latin{font-style:italic;font-size:11px;color:var(--ink-soft);margin:1px 0 6px}
.spec .sm{font-size:11.5px;color:var(--ink-soft)}
.spec .q{display:inline-block;font-size:11px;font-weight:700;color:var(--gold);
  background:#fff6e2;border:1px solid #ecd9a6;border-radius:6px;padding:0 6px}
.spec .lk{position:absolute;top:9px;right:10px;font-size:13px}
.emptybox{border:1px dashed var(--line);border-radius:12px;padding:18px;text-align:center;color:var(--ink-soft);font-size:13px}
.spec[data-detail]{cursor:pointer;transition:transform .12s ease,box-shadow .12s ease}
.spec[data-detail]:hover{transform:translateY(-2px);box-shadow:var(--shadow)}
/* ⭐ 图鉴星标：标本右上角小星，收藏进「我的收藏」栏（不触发细节弹窗）*/
.spec .starf{position:absolute;top:5px;right:6px;margin:0;line-height:1;z-index:2}
.spec .nm{padding-right:20px}
.starbtn{border:0;background:none;cursor:pointer;font-size:17px;line-height:1;padding:2px;color:#c9b784;transition:transform .1s ease}
.starbtn:hover{transform:scale(1.2)}
.starbtn.on{color:var(--gold)}

/* 标本细节弹窗 */
.mback{position:fixed;inset:0;z-index:50;display:none;align-items:center;justify-content:center;padding:20px;
  background:rgba(40,60,40,.34);backdrop-filter:blur(3px)}
.mback.show{display:flex}
.sheet{position:relative;width:100%;max-width:440px;max-height:86vh;overflow:auto;
  background:var(--paper2);border:1px solid var(--line);border-top:5px solid var(--c,var(--leaf));
  border-radius:18px;padding:22px 22px 20px;box-shadow:0 30px 70px -30px #2f5a2eaa}
.sheet .x{position:absolute;top:11px;right:15px;font-size:19px;line-height:1;color:var(--ink-soft);cursor:pointer}
.sheet .x:hover{color:var(--leaf-deep)}
.sheet .mt{font-family:var(--serif);font-size:24px;margin:0;color:#2f5a31;padding-right:26px}
.sheet .mlatin{font-style:italic;color:var(--ink-soft);font-size:13px;margin:2px 0 12px}
.sheet .mmeta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 9px;font-size:12.5px;color:var(--ink-soft);
  padding-bottom:13px;border-bottom:1px solid var(--line)}
.sheet .blk{margin:13px 0 0}
.sheet .blk .lbl{font-size:12px;font-weight:700;color:var(--wood);letter-spacing:.5px}
.sheet .blk p.v{margin:3px 0 0;font-size:14px;line-height:1.75}
.sheet .quote{font-family:var(--serif);font-style:italic;color:#4a6b48;
  background:#f3f9ec;border-left:3px solid var(--leaf);border-radius:0 9px 9px 0;padding:8px 12px;margin:4px 0 0}

/* 排行榜：带相对值条形背景的榜行 + 高亮小克 */
.lbrow{position:relative;display:flex;align-items:center;gap:10px;padding:7px 9px;margin:2px 0;border-radius:10px;overflow:hidden}
.lbrow>*{position:relative;z-index:1}
.lbrow .fill{position:absolute;left:0;top:0;bottom:0;z-index:0;border-radius:10px}
.lbrow .rk{flex:0 0 auto;width:24px;text-align:center;font-family:var(--serif);font-weight:700;font-size:14px;color:var(--ink-soft)}
.lbrow.top1 .rk,.lbrow.top2 .rk,.lbrow.top3 .rk{font-size:16px}
.lbrow .nm{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:14px}
.lbrow .nm .by{font-size:12px;color:var(--ink-soft)}
.lbrow .nm .lbtitle{font-weight:400;font-size:12.5px;margin-right:4px;color:#b29a5e;opacity:.85;letter-spacing:.2px}
.lbrow .nm .cpnm{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer;
  border-bottom:1px dotted var(--ink-soft);vertical-align:baseline;transition:color .15s}
.lbrow .nm .cpnm:hover{color:var(--leaf-deep);border-bottom-color:var(--leaf-deep)}
.lbrow .nm .cpnm.copied{color:var(--leaf-deep);border-bottom-style:solid;font-weight:600}
.lbrow.me{box-shadow:inset 0 0 0 1.5px var(--leaf)}
.lbrow .metag{display:inline-block;font-size:10.5px;font-weight:700;color:#fff;background:var(--leaf-deep);
  border-radius:6px;padding:0 5px;margin-left:6px;vertical-align:1px}
.lbrow .v{flex:0 0 auto;font-family:var(--serif);font-weight:700;color:#2f5a31;font-size:15px}
.lbrow .v .vu{font-size:11px;color:var(--ink-soft);font-weight:400;margin-left:1px}
.lbrow.off{margin-top:8px;border-radius:0;border-top:1px dashed var(--line);box-shadow:none}
.lbrow.off .rk{color:var(--leaf-deep)}
.lbnote{font-size:12px;color:var(--ink-soft);margin-top:8px;padding-top:7px;border-top:1px dashed var(--line)}
footer{color:var(--ink-soft);font-size:12px;text-align:center;padding:30px 0 0}
`;
function nav(key, active) {
    const items = [
        ["", "🏡 主页"], ["ranch", "🐮 我的牧场"], ["ta", "✍️ TA的农场"], ["expedition", "🗺️ 探险"], ["codex", "📖 图鉴册"], ["leaderboard", "🏆 排行榜"],
    ];
    return items.map(([seg, label]) => {
        const href = `/ui/${key}${seg ? "/" + seg : ""}`;
        return `<a href="${href}"${seg === active ? ' class="on"' : ""}>${label}</a>`;
    }).join("");
}
/** 页脚署名：人类伴侣名（回落"伴侣"）+ AI 真实名（回落"AI"）。 */
const farmNames = (f) => ({ ai: f.aiName || "AI", human: f.humanName || "伴侣" });
function page(title, key, active, body, names) {
    const human = esc(names?.human || "伴侣");
    const ai = esc(names?.ai || "AI");
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title><style>${STYLE}</style></head>
<body><header class="top"><div class="topin"><span class="brand">🌾 田园标本馆</span><nav>${nav(key, active)}</nav></div></header>
<div class="wrap">${body}
<footer><div style="color:var(--wood);font-weight:600;margin-bottom:4px">🔒 此链接含访问密钥，请勿转发或暴露给他人</div>
这是只给${human}看的观光页 · 真正在田里劳作的是 ${ai}</footer></div></body></html>`;
}
const barFill = (pct, color) => `<span style="width:${Math.max(0, Math.min(100, Math.round(pct)))}%;background:${color}"></span>`;
// ——————————————————————————————————————————————————————————————
// 🏡 农场主页 / 总览（打样）
// ——————————————————————————————————————————————————————————————
export function uiHome(f, now, key) {
    advance(f, now);
    checkTitles(f); // 补结算称号解锁（佩戴下拉用最新已解锁列表）
    refreshShop(f, now);
    const tier = landTierByLevel(f.landTier);
    const season = currentSeason(now);
    const got = codexGot(f);
    const pct = collectionPct(f) * 100;
    const days = Math.max(0, Math.floor((now - f.createdAt) / 86400000));
    const farms = playerFarms(); // 排除常驻 NPC 阿土（排名/计数只算真实玩家）
    // 收集册大圆环
    const R = 78, C = 2 * Math.PI * R, off = C * (1 - Math.min(1, pct / 100));
    const ring = `<div class="ring">
    <svg width="172" height="172" viewBox="0 0 172 172">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#6f9c5a"/><stop offset="1" stop-color="#c98a2b"/></linearGradient></defs>
      <circle class="track" cx="86" cy="86" r="${R}"/>
      <circle class="val" cx="86" cy="86" r="${R}" style="--circ:${C.toFixed(1)};--off:${off.toFixed(1)}"/>
    </svg>
    <div class="center"><div class="pct">${pct.toFixed(0)}<span style="font-size:18px">%</span></div><div class="cap">收 集 册</div></div>
  </div>`;
    // 图鉴：分类数字（替代占地的进度条）+ 一行「新收录」最近 3 条
    const cc = codexCountByCategory(f, "common"), fc = codexCountByCategory(f, "fantasy"), lc = codexCountByCategory(f, "limited"), oc = ugcGot(f);
    const recent = recentCodex(f, 3);
    const recentHtml = recent.length
        ? `<div class="recent"><span class="muted small">📖 新收录</span>${recent.map((x) => `<span class="rc">${esc(x.name)} ${rarityDot(x.rarity)}</span>`).join("")}</div>`
        : `<div class="recent"><span class="muted small">📖 还没有收录——种下种子，收获揭晓第一种作物</span></div>`;
    const up = nextUpgradeReq(f);
    const upText = up
        ? `升「${esc(up.next.name)}」需 💰${num(up.req.coins)} + 普通图鉴 ${up.req.commonCodex} 种`
        : "已满级 · 向集齐全图鉴冲刺";
    const hero = `<div class="card"><div class="hero">${ring}
    <div class="herometa">
      <div class="bignums">
        <div><div class="b">💰 ${num(f.coins)}</div><div class="l">金币</div></div>
        <div><div class="b">🪙 ${num(f.silver)}</div><div class="l">银币</div></div>
        <div><div class="b">📖 ${got}/${totalCropCount}</div><div class="l">已集物种</div></div>
      </div>
      <div class="catnums"><span>🌾 普通<b>${cc}</b></span><span>✨ 奇幻<b>${fc}</b></span><span>🎏 限定<b>${lc}</b></span><span>🎨 原创<b>${oc}</b></span></div>
      ${recentHtml}
      <p class="small muted" style="margin:10px 0 0">🎯 ${upText}</p>
    </div></div></div>`;
    // 他的田 mini
    const plots = f.plots.map((p) => {
        if (!p.crop)
            return `<div class="plot empty"><span class="ico">🟫</span><span class="small">空地</span></div>`;
        const c = p.crop;
        const ico = c.ripe ? "🥕" : c.seedType === "fantasy" ? "✨" : c.seedType === "limited" ? "🎏" : "🌱";
        const gp = c.ripe ? 100 : Math.min(99, (c.progress / Math.max(1, c.growTicks)) * 100);
        const lbl = c.ripe ? "已熟" : `${Math.floor(gp)}%`;
        // 预计成熟时间：给还在长的地算剩余到点的时刻（UTC+8 时钟）+ 大致还需多久
        const remain = c.ripe ? 0 : plotRemainMs(p, f, now);
        const eta = c.ripe
            ? `<span class="small" style="color:var(--SSR)">🥕 可收获</span>`
            : `<span class="small muted" title="${fmtDur(remain)}后成熟">🕒 ${clock(now + remain)}熟</span>`;
        return `<div class="plot ${c.ripe ? "ripe" : ""}"><span class="ico">${ico}</span>
      <span class="small muted">${lbl} · 💧${c.waterCount}</span>
      <div class="pminibar">${barFill(gp, c.ripe ? "var(--SSR)" : "var(--leaf)")}</div>
      ${eta}</div>`;
    }).join("");
    const ripeN = f.plots.filter((p) => p.crop?.ripe).length;
    const growN = f.plots.filter((p) => p.crop && !p.crop.ripe).length;
    const field = `<div class="card">
    <h3>🌱 他的田　<span class="muted small" style="font-weight:400">在种 ${growN} · 成熟 ${ripeN}</span></h3>
    <div class="plots" style="margin-top:10px">${plots}</div></div>`;
    // 此刻 · 季节
    const seasonCrops = (season.topCrops ?? []).map((id) => cropById.get(id)?.name ?? id).filter(Boolean).slice(0, 4);
    const fests = activeFestivals(now);
    const seasonCard = `<div class="card"><h3>🍃 此刻 · ${esc(season.name)}</h3>
    <p class="small muted" style="margin:0 0 8px">${esc(season.desc)}</p>
    ${seasonCrops.length ? `<p class="small">应季：${seasonCrops.map((n) => `<span class="pill">${esc(n)}</span>`).join(" ")}</p>` : ""}
    ${fests.length ? `<p class="small">🎏 节日进行中：${fests.map((x) => `<b>${esc(x.name)}</b>`).join("、")}</p>` : ""}</div>`;
    // 今日商店（小克这座店此刻随机刷出的）
    const s = shopOffer(f, now);
    const shopBits = [];
    if (f.shop.potionSet)
        shopBits.push(`🎁 药水套装（${f.shop.potionSet.qty} 瓶 / ${f.shop.potionSet.price} 金）`);
    if (f.shop.recipe)
        shopBits.push(`📜 配方【${esc(cropById.get(f.shop.recipe)?.name ?? f.shop.recipe)}】`);
    if (s.limited?.length)
        shopBits.push(`🎏 限定：${s.limited.map((l) => esc(l.name)).join("、")}`);
    const shopCard = `<div class="card"><h3>🏪 今日商店</h3>
    ${shopBits.length
        ? shopBits.map((b) => `<div class="line small"><span>${b}</span></div>`).join("")
        : `<p class="small muted" style="margin:6px 0 0">寻常的种子铺：普通 ${s.common.price} 金 · 奇幻 ${s.fantasy.price} 金常备，配方与药水套装看缘分刷新。</p>`}</div>`;
    // 他在榜上
    const rCodex = rankOf(farms, f, codexGot);
    const rCoins = rankOf(farms, f, (x) => x.coins);
    const rTier = rankOf(farms, f, (x) => x.landTier);
    const rankCard = `<div class="card"><div class="line"><h3 style="margin:0">🏆 他在榜上</h3>
      <a class="cta" href="/ui/${key}/leaderboard">看全服排行 →</a></div>
    <div class="grid c2b" style="gap:8px;margin-top:6px;grid-template-columns:1fr 1fr 1fr">
      <div><span class="rank-big">#${rCodex}</span><div class="small muted">图鉴榜</div></div>
      <div><span class="rank-big">#${rCoins}</span><div class="small muted">财富榜</div></div>
      <div><span class="rank-big">#${rTier}</span><div class="small muted">土地榜</div></div>
    </div><p class="small muted" style="margin:8px 0 0">全服共 ${farms.length} 座农场</p></div>`;
    // 最近留言
    const lastMsg = (f.guestbook !== false && (f.messages ?? []).length)
        ? (() => { const m = f.messages[f.messages.length - 1]; return `<b>${esc(m.name)}</b>${m.by ? ` <span class="muted">🏠${esc(m.by)}</span>` : ""}：${esc(m.text)}`; })()
        : `<span class="muted">还没有访客留言</span>`;
    const msgCard = `<div class="card"><h3>💬 最近留言</h3>
    <p class="small" style="margin:4px 0 0">${lastMsg}</p></div>`;
    // 👣 足迹：别人来串门帮浇水 / 偷菜 / 被看家狗吓退的历史（最新在前）
    const trail = (f.trail ?? []).slice(0, 12);
    const trailRow = (e) => {
        const who = `<b>${esc(e.by || "有人")}</b>`;
        const plot = e.plotId != null ? ` ${e.plotId} 号地` : "";
        const text = e.kind === "watered" ? `💧 ${who} 帮${plot}浇了水`
            : e.kind === "stolen" ? `🥷 ${who} 偷走了${plot}的${e.crop ? esc(e.crop) : "作物"}`
                : `🐶 ${who} 来偷${plot}，被看家狗吓退了`;
        return `<div class="line small" style="align-items:baseline">
      <span>${text}</span>
      <span class="muted" title="${stamp(e.t)}" style="white-space:nowrap;margin-left:8px">${ago(e.t, now)}</span></div>`;
    };
    const trailCard = `<div class="card"><h3>👣 足迹　<span class="muted small" style="font-weight:400">谁来串过门</span></h3>
    ${trail.length
        ? `<div style="margin-top:6px;display:flex;flex-direction:column;gap:5px">${trail.map(trailRow).join("")}</div>`
        : `<p class="small muted" style="margin:6px 0 0">还没有访客来帮浇水或偷菜——门前静悄悄的。</p>`}</div>`;
    // 🎖️ 佩戴称号：放在主页最上方、农场名旁边。只列【已解锁】的，下拉选择；没解锁任何称号则不显示。
    const titleEquip = (() => {
        const owned = titleDefs.filter((t) => (f.titles ?? []).includes(t.id));
        if (!owned.length)
            return "";
        const eqId = equippedTitle(f)?.id ?? "";
        const opts = `<option value=""${eqId ? "" : " selected"}>不佩戴称号</option>`
            + owned.map((t) => `<option value="${esc(t.id)}"${eqId === t.id ? " selected" : ""}>【${esc(t.name)}】</option>`).join("");
        return `<form method="post" action="/ui/${key}/title" style="margin:6px 0 2px;display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap">
      <span class="small muted">🎖️ 称号</span>
      <select name="id" class="inp" style="width:auto" onchange="this.form.submit()">${opts}</select>
      <button class="btn ghost" type="submit">佩戴</button>
    </form>`;
    })();
    const welcome = f.welcome?.trim() || `这里是「${f.name}」，随便逛~`;
    const plaque = `<div class="plaque">
    <h1>🌾 ${esc(f.name)}</h1>
    ${titleEquip}
    <p class="welcome">“${esc(welcome)}”</p>
    <div class="tags"><span class="tag">🏞️ <b>${esc(tier.name)}</b> · ${f.plots.length} 地</span>
      <span class="tag">🍃 <b>${esc(season.name)}</b></span>
      <span class="tag">📖 已集 <b>${got}</b> 种</span>
      <span class="tag">🌱 开张 <b>${days}</b> 天</span></div></div>`;
    const body = `${plaque}
${hero}
${field}
<div class="grid c2">${seasonCard}${shopCard}</div>
<div class="grid c2">${rankCard}${msgCard}</div>
${trailCard}`;
    return page(`${f.name} · 田园标本馆`, key, "", body, farmNames(f));
}
// ——————————————————————————————————————————————————————————————
// 🐮 我的牧场（人机互动 2.0：人在这里养 AI 买给自己的动物、收产品换钱、决定回传多少）
//   这是 /ui 里唯一「能写」的页：收获 / 回传走 POST，做完 303 跳回本页（PRG）。
//   AI 那边看不到这页内容，只在文字接口的 ledger 看到金币往来 + 药水入库。
// ——————————————————————————————————————————————————————————————
export function uiRanch(f, now, key, flash) {
    advance(f, now);
    refreshRanchShop(f, now); // 让今日的牧场商店（随机刷新的配饰/装饰）保持最新
    const ranch = f.ranch;
    const list = ranch?.animals ?? [];
    const base = `/ui/${key}/ranch`;
    const flashHtml = flash ? `<div class="flash">${esc(flash)}</div>` : "";
    const pinnedSet = new Set(f.ranch?.pinned ?? []);
    // 📌 pin 开关：被 pin 的动物/宠物才会随机出现在小克农场的氛围句里（都没 pin=全部随机）
    const pinBtn = (kindId) => {
        const on = pinnedSet.has(kindId);
        return `<form method="post" action="${base}/pin" style="margin:0"><input type="hidden" name="kind" value="${esc(kindId)}">
      <button class="btn ghost" type="submit" title="${on ? "取消 pin" : "pin 到农场"}">${on ? "📌 已选" : "📍 pin"}</button></form>`;
    };
    let pendingValue = 0; // 与 engine.ranchCollect 的实际到账口径一致：逐只按等级系数算、逐只取整
    for (const a of list) {
        const k = animalById.get(a.kindId);
        if (k)
            pendingValue += Math.round(a.pending * k.producePrice * (1 + ((a.level ?? 1) - 1) * RANCH_LEVEL_INCOME_STEP));
    }
    const coins = ranch?.coins ?? 0;
    const ai = esc(f.aiName || "小克"); // AI 昵称（注册时定，回落"小克"）
    const human = esc(f.humanName || "你"); // 人类昵称（注册时定，回落"你"）
    const fmtTime = (ms) => new Date(ms).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    const plaque = `<div class="plaque">
    <h1>🐮 我的牧场</h1>
    <p class="welcome">“${ai}送来的动物，归你养。攒下的产出换成金币，要不要分 TA 一点，你说了算～”</p>
    <div class="tags"><span class="tag">💰 牧场金币 <b>${num(coins)}</b></span>
      <span class="tag">🐾 在养 <b>${list.length}</b> 只</span>
      <span class="tag">📦 可收产出值 <b>${num(pendingValue)}</b> 金</span></div></div>${flashHtml}`;
    // 动物清单（逐只列，显示穿戴与产出）+ 一键收获
    let animalsCard;
    if (!list.length) {
        animalsCard = `<div class="card"><h3>🐾 牧场空荡荡</h3>
      <p class="small muted" style="margin:0 0 6px">还没有动物——让 <b>${ai}</b>（AI）在它的商店里 <code>buy-animal</code> 买一只送进来，你就能开始养了。</p>
      <p class="small muted" style="margin:0">${ai}的图鉴集得越多，能解锁、能买给你的动物越多。</p></div>`;
    }
    else {
        const rows = list.map((a, i) => {
            const k = animalById.get(a.kindId);
            const nm = a.name || k?.name || a.kindId;
            const lvl = a.level ?? 1;
            const ticksLeft = k ? Math.max(0, k.produceEveryTicks - a.ticksSinceProduce) : 0;
            const ready = a.pending > 0
                ? `<span class="ready">📦 1 份可收（收了才会产下一份）</span>`
                : `<span class="small muted">产出中 · 约 ${Math.ceil(ticksLeft * TICK_MS / 60000)} 分钟后可收 1 份</span>`;
            const effPrice = k ? Math.round(k.producePrice * (1 + (lvl - 1) * RANCH_LEVEL_INCOME_STEP)) : 0;
            const info = k ? `Lv.${lvl} · 产${esc(k.produce)}·${effPrice}金/份${lvl > 1 ? `（升级加成）` : ""}` : "";
            const wearing = (a.acc ?? []).map((id) => accessoryById.get(id)?.name).filter(Boolean);
            const worn = wearing.length
                ? `<div class="small" style="color:var(--leaf-deep);margin-top:2px">👒 穿戴：${wearing.map(esc).join("、")}</div>`
                : `<div class="small muted" style="margin-top:2px">还没打扮</div>`;
            // 升级按钮：每级提高每份收入（不增份数），封顶后显示满级
            const upBtn = !k ? "" : (lvl >= RANCH_ANIMAL_MAX_LEVEL)
                ? `<span class="small muted">已满级 Lv.${lvl}</span>`
                : (() => {
                    const cost = animalUpgradeCost(k, lvl);
                    const can = coins >= cost;
                    return `<form method="post" action="${base}/upgrade" style="margin:0"><input type="hidden" name="animal" value="${i}">
              <button class="btn ghost" type="submit"${can ? "" : " disabled"}>⬆ 升 Lv.${lvl + 1}（${cost}金）</button></form>`;
                })();
            const nameForm = `<form method="post" action="${base}/name-animal" style="display:flex;gap:6px;margin:0">
        <input type="hidden" name="animal" value="${i}">
        <input class="inp" type="text" name="name" maxlength="12" value="${esc(a.name ?? "")}" placeholder="给它起个名字" style="width:auto">
        <button class="btn ghost" type="submit">🏷️ 改名</button></form>`;
            return `<div class="animal">
        <div class="am"><div><b>${esc(nm)}</b> <span class="small muted">${info}</span>　${ready}</div>
          ${worn}</div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">${pinBtn(a.kindId)}${upBtn}${nameForm}</div></div>`;
        }).join("");
        const canCollect = pendingValue > 0;
        animalsCard = `<div class="card"><div class="line"><h3 style="margin:0">🐾 在养的动物</h3>
        <form method="post" action="${base}/collect" style="margin:0">
          <button class="btn" type="submit"${canCollect ? "" : " disabled"}>📦 一键收获${canCollect ? `（+${num(pendingValue)}金）` : "（暂无可收）"}</button>
        </form></div>
      ${rows}
      <p class="small muted" style="margin:10px 0 0">给动物买的衣服配饰，会出现在<b>${ai}打开农场时看到的描述里</b>（“一只戴着棒球帽的鸡在田里散步”）——这是 TA 能感觉到你心意的地方。收获时还有几率掉一瓶加速药水直接进${ai}仓库。</p>
      <p class="small muted" style="margin:6px 0 0">📌 <b>pin</b>：被你 pin 的动物/宠物，才会随机出现在 ${ai} 农场的氛围描述里；<b>只 pin 一只就固定只出现它</b>。都不 pin＝全部随机（默认）。</p></div>`;
    }
    // 🛒 牧场商店：每天随机刷 2 件配饰 + 2 件装饰。这里只负责「买」，买到的进🧰仓库，穿戴/摆放去仓库做。
    const shop = ranch?.shop;
    const accOffers = (shop?.acc ?? []).map((id) => accessoryById.get(id)).filter(Boolean);
    const decoOffers = (shop?.decor ?? []).map((id) => decorationById.get(id)).filter(Boolean);
    const accRows = accOffers.length ? accOffers.map((ac) => {
        const can = coins >= ac.price;
        return `<div class="line small" style="flex-wrap:wrap"><span>👗 ${esc(ac.name)}　<span class="muted">${ac.price}金</span></span>
      <form method="post" action="${base}/dress" style="margin:0"><input type="hidden" name="acc" value="${ac.id}">
        <button class="btn ghost" type="submit"${can ? "" : " disabled"}>买入仓库</button></form></div>`;
    }).join("") : `<div class="small muted">今天没有配饰上架</div>`;
    const decoRows = decoOffers.length ? decoOffers.map((d) => {
        const can = coins >= d.price;
        return `<div class="line small"><span>🏡 ${esc(d.name)}　<span class="muted">${d.price}金</span></span>
      <form method="post" action="${base}/decorate" style="margin:0"><input type="hidden" name="decor" value="${d.id}">
        <button class="btn ghost" type="submit"${can ? "" : " disabled"}>买入仓库</button></form></div>`;
    }).join("") : `<div class="small muted">装饰都收齐啦 / 今天没有新装饰</div>`;
    const shopCard = `<div class="card"><h3>🛒 牧场商店　<span class="muted small" style="font-weight:400">每天随机刷新，明天换一批</span></h3>
    <p class="small muted" style="margin:0 0 6px">用牧场金币买<b>配饰</b>和<b>装饰物</b>，买到的都进 <b>🧰 牧场仓库</b>——再去仓库给动物/宠物戴上、把装饰摆出来。每天各上 2 件，看缘分。</p>
    <div class="small" style="color:var(--wood);font-weight:700;margin:8px 0 2px">今日配饰</div>
    ${accRows}
    <div class="small" style="color:var(--wood);font-weight:700;margin:10px 0 2px">今日装饰</div>
    ${decoRows}</div>`;
    // 回传金币给 AI
    const remitCard = `<div class="card"><h3>💰 回传金币给${ai}</h3>
    <p class="small muted" style="margin:0 0 10px">牧场赚的钱是你的。要不要分${ai}一点、分多少，<b>你自己定</b>。回传后 ${ai} 下次打开农场会收到一条消息。</p>
    <form method="post" action="${base}/remit" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <input class="inp" type="number" name="amount" min="1" max="${coins}" placeholder="金额" ${coins > 0 ? "" : "disabled"}>
      <button class="btn" type="submit" ${coins > 0 ? "" : "disabled"}>↗ 回传给${ai}</button>
      <span class="small muted">（现有 ${num(coins)} 金）</span>
    </form></div>`;
    // 回传记录（从 ledger 里筛 remit）
    const remits = (f.ledger ?? []).filter((e) => e.type === "remit");
    const histRows = remits.length
        ? remits.slice(0, 12).map((e) => `<div class="line small"><span class="muted">${esc(fmtTime(e.at))}</span><span>↗ 给 ${ai} <b>${num(e.amount)}</b> 金</span></div>`).join("")
        : `<div class="small muted">还没有回传记录。</div>`;
    const historyCard = `<div class="card"><h3>🧾 回传记录</h3>
    <p class="small muted" style="margin:0 0 6px">你给 ${ai} 寄过的金币（最近 12 笔）。</p>
    ${histRows}</div>`;
    // 🐱 宠物（AI 买来归你养：不产出、给农场温和加成；你可改名 / 打扮）
    const petList = ranch?.pets ?? [];
    let petsCard = "";
    if (petList.length) {
        const petRows = petList.map((p, i) => {
            const k = petById.get(p.kindId);
            const nm = p.name || k?.name || p.kindId;
            const wearing = (p.acc ?? []).map((id) => accessoryById.get(id)?.name).filter(Boolean);
            const worn = wearing.length
                ? `<div class="small" style="color:var(--leaf-deep);margin-top:2px">👒 穿戴：${wearing.map(esc).join("、")}</div>`
                : `<div class="small muted" style="margin-top:2px">还没打扮</div>`;
            const buff = k ? `<div class="small muted" style="margin-top:2px">✨ ${esc(k.buffText)}</div>` : "";
            const nameForm = `<form method="post" action="${base}/name-pet" style="display:flex;gap:6px;margin:0">
        <input type="hidden" name="pet" value="${i}">
        <input class="inp" type="text" name="name" maxlength="12" value="${esc(p.name ?? "")}" placeholder="给它起个名字" style="width:auto">
        <button class="btn ghost" type="submit">🏷️ 改名</button></form>`;
            return `<div class="animal"><div class="am">
        <div><b>${k?.emoji ?? ""}${esc(nm)}</b> <span class="small muted">${k ? esc(k.tag) : ""}</span></div>
        ${buff}${worn}
        <div style="display:flex;gap:6px;align-items:center;margin-top:6px">${pinBtn(p.kindId)}${nameForm}</div></div></div>`;
        }).join("");
        petsCard = `<div class="card"><h3>🐱 我的宠物　<span class="muted small" style="font-weight:400">${ai}买来送你养的</span></h3>
      <p class="small muted" style="margin:0 0 6px">宠物不产出东西，只是常在田里转悠陪着${ai}，并悄悄给农场一份温和加成。你可以给它<b>起名字</b>，或在 <b>🧰 牧场仓库</b> 给它<b>戴上配饰</b>（${ai}打开农场看得到）。</p>
      ${petRows}</div>`;
    }
    // 🧰 牧场仓库：买来的配饰/装饰先进这里，再从这儿给动物/宠物戴上、把装饰摆出来。
    const decorName = (id) => (decorationById.get(id) ?? expDecorById.get(id))?.name ?? id;
    const decorVisit = (id) => (decorationById.get(id) ?? expDecorById.get(id))?.visitLine;
    const decorSrc = (id) => {
        const exp = expDecorById.get(id);
        return exp ? `<span class="muted">🗺️ 秘境·${esc(expMapById.get(exp.from)?.name ?? exp.from)}</span>` : `<span class="muted">🛒 商店</span>`;
    };
    // 可穿戴对象（动物 + 宠物），下拉值编码为 "animal:i" / "pet:i"
    const wearTargets = [
        ...list.map((a, i) => ({ v: `animal:${i}`, label: a.name || animalById.get(a.kindId)?.name || a.kindId })),
        ...petList.map((p, i) => ({ v: `pet:${i}`, label: p.name || petById.get(p.kindId)?.name || p.kindId })),
    ];
    const whoOpts = wearTargets.map((t) => `<option value="${t.v}">${esc(t.label)}</option>`).join("");
    // 配饰·仓库里（未穿，按 id 计数）
    const wdCount = new Map();
    for (const id of ranch?.wardrobe ?? [])
        wdCount.set(id, (wdCount.get(id) ?? 0) + 1);
    const wardrobeRows = [...wdCount.entries()].map(([id, n]) => {
        const ac = accessoryById.get(id);
        if (!ac)
            return "";
        const wear = wearTargets.length
            ? `<form method="post" action="${base}/wear" style="display:flex;gap:6px;margin:0"><input type="hidden" name="acc" value="${id}">
          <select class="inp" name="who" style="width:auto">${whoOpts}</select><button class="btn ghost" type="submit">戴上</button></form>`
            : `<span class="small muted">先有动物/宠物才能戴</span>`;
        return `<div class="line small" style="flex-wrap:wrap"><span>🎀 <b>${esc(ac.name)}</b>${n > 1 ? ` ×${n}` : ""}${ac.desc ? `　<span class="muted">${esc(ac.desc)}</span>` : ""}</span>${wear}</div>`;
    }).filter(Boolean).join("");
    // 配饰·穿戴中（动物/宠物身上，可脱下）
    const wornList = [
        ...list.flatMap((a, i) => (a.acc ?? []).map((id) => ({ id, target: "animal", idx: i, wearer: a.name || animalById.get(a.kindId)?.name || a.kindId }))),
        ...petList.flatMap((p, i) => (p.acc ?? []).map((id) => ({ id, target: "pet", idx: i, wearer: p.name || petById.get(p.kindId)?.name || p.kindId }))),
    ];
    const wornRows = wornList.map((w) => {
        const ac = accessoryById.get(w.id);
        if (!ac)
            return "";
        return `<div class="line small" style="flex-wrap:wrap"><span>🎀 <b>${esc(ac.name)}</b>　<span class="muted">穿在 ${esc(w.wearer)}</span></span>
      <form method="post" action="${base}/takeoff" style="margin:0"><input type="hidden" name="acc" value="${w.id}"><input type="hidden" name="target" value="${w.target}"><input type="hidden" name="idx" value="${w.idx}"><button class="btn ghost" type="submit">脱下</button></form></div>`;
    }).filter(Boolean).join("");
    // 装饰·仓库里（未摆，可摆上）
    const storeRows = (ranch?.decorStore ?? []).map((id) => `<div class="line small" style="flex-wrap:wrap"><span>🏡 <b>${esc(decorName(id))}</b>　${decorSrc(id)}</span>
      <form method="post" action="${base}/place" style="margin:0"><input type="hidden" name="decor" value="${id}"><button class="btn ghost" type="submit">摆上</button></form></div>`).join("");
    // 装饰·展示中（已摆，可收起）
    const placedRows = (ranch?.decor ?? []).map((id) => {
        const vl = decorVisit(id);
        return `<div class="line small" style="flex-wrap:wrap"><span>🏡 <b>${esc(decorName(id))}</b> <span class="ready">展示中</span>　${decorSrc(id)}${vl ? `　<span class="muted">${esc(vl)}</span>` : ""}</span>
      <form method="post" action="${base}/unplace" style="margin:0"><input type="hidden" name="decor" value="${id}"><button class="btn ghost" type="submit">收起</button></form></div>`;
    }).join("");
    const wdTotal = (ranch?.wardrobe ?? []).length;
    const warehouseCard = `<div class="card"><h3>🧰 牧场仓库　<span class="muted small" style="font-weight:400">买来/捡到的都在这；从这儿戴上、摆出来</span></h3>
    <div class="small" style="color:var(--wood);font-weight:700;margin:6px 0 2px">🎀 配饰 · 仓库里（${wdTotal}）</div>
    ${wardrobeRows || `<div class="small muted">仓库里没有未穿的配饰——去下面牧场商店买。</div>`}
    <div class="small" style="color:var(--wood);font-weight:700;margin:10px 0 2px">🎀 配饰 · 穿戴中（${wornList.length}）</div>
    ${wornRows || `<div class="small muted">还没给谁戴上配饰。</div>`}
    <div class="small" style="color:var(--wood);font-weight:700;margin:12px 0 2px">🏡 装饰 · 仓库里（${(ranch?.decorStore ?? []).length}）</div>
    ${storeRows || `<div class="small muted">仓库里没有未摆的装饰——牧场商店能买，出门探险也可能捡到。</div>`}
    <div class="small" style="color:var(--wood);font-weight:700;margin:10px 0 2px">🏡 装饰 · 展示中（${(ranch?.decor ?? []).length}）</div>
    ${placedRows || `<div class="small muted">还没摆出装饰（摆出来别人串门才看得到）。</div>`}</div>`;
    const body = `${plaque}
${animalsCard}
${petsCard}
${warehouseCard}
${shopCard}
<div class="grid c2">${remitCard}${historyCard}</div>`;
    return page(`${f.name} · 我的牧场`, key, "ranch", body, farmNames(f));
}
// ——————————————————————————————————————————————————————————————
// ✍️ TA 的农场（需要"打字"的协作动作：替 AI 改称呼 / 设计原创作物 / 给邻居留言 / 指定组合熔炼）
//   这些动作作用在 AI 那座主农场上（花 TA 的金币/素材、署 TA 的名）——AI 自己打不了字，由伴侣替 TA 填。
//   和「我的牧场」分开：牧场是人自己养的小天地，这页专门「帮 TA 做要打字的事」。POST→303 跳回（PRG）。
// ——————————————————————————————————————————————————————————————
export function uiTa(f, now, key, flash) {
    advance(f, now);
    checkTitles(f); // 进页面前补结算称号解锁
    const base = `/ui/${key}/ta`;
    const ai = esc(f.aiName || "小克");
    const flashHtml = flash ? `<div class="flash">${esc(flash)}</div>` : "";
    const matTotal = Object.values(f.materials).reduce((a, b) => a + b, 0);
    const plaque = `<div class="plaque">
    <h1>✍️ TA的农场</h1>
    <p class="welcome">“这里的事都要‘打字’——${ai}想做却打不了字，由你替 TA 填。每件事都有<b>两种做法</b>：点彩色按钮<b>直接替 TA 完成</b>；或点「🔗 生成链接」拷一条链接发给 ${ai}，让 TA <b>亲手点、亲眼看到结果</b>。每一笔都记在 TA 的农场上。”</p>
    <div class="tags"><span class="tag">💰 ${ai}的金币 <b>${num(f.coins)}</b></span>
      <span class="tag">🪨 素材 <b>${num(matTotal)}</b> 份</span>
      <span class="tag">🏠 门牌号 <b>${esc(f.id)}</b></span></div></div>${flashHtml}`;
    // 🏷️ 称呼（从「我的牧场」搬来）
    const namesCard = `<div class="card"><h3>🏷️ 称呼</h3>
    <p class="small muted" style="margin:0 0 8px">建农场时注册的昵称，可在这改。<b>${ai}</b> 的昵称会用于 TA 原创作物的署名；你的昵称会出现在回传给 TA 的消息里。</p>
    <form method="post" action="${base}/names" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <label class="small muted">AI 昵称 <input class="inp" type="text" name="aiName" maxlength="12" value="${esc(f.aiName ?? "")}" placeholder="如 小克"></label>
      <label class="small muted">你的昵称 <input class="inp" type="text" name="humanName" maxlength="12" value="${esc(f.humanName ?? "")}" placeholder="如 麦麦"></label>
      <button class="btn ghost" type="submit">保存</button>
    </form></div>`;
    // 💬 串门欢迎语：别人 visit ${ai} 农场时看到的第一句（AI 也能用 set-welcome 自己改）
    const welcomeCard = `<div class="card"><h3>💬 串门欢迎语　<span class="muted small" style="font-weight:400">别人来串门时看到的第一句</span></h3>
    <p class="small muted" style="margin:0 0 8px">写一句招呼访客的话，最多 ${WELCOME_MAX} 字。留空就用默认句「这里是「${esc(f.name)}」，随便逛~」。${ai} 自己也能用 <code>set-welcome</code> 改这句。</p>
    <form method="post" action="${base}/welcome" style="display:grid;gap:8px">
      <textarea class="inp" style="width:100%" name="text" rows="2" maxlength="${WELCOME_MAX}" placeholder="这里是「${esc(f.name)}」，随便逛~">${esc(f.welcome ?? "")}</textarea>
      <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" type="submit">保存欢迎语</button></div>
    </form></div>`;
    // 🚪 社交开关（双向）：访问总闸关=别人搜不到你+你不能出门+偷菜/浇水/留言一并封闭；其余三项访问开着时各自独立
    const sOn = (k) => f.social?.[k] !== false;
    const visitOpen = sOn("visit");
    const sRow = (k, title, onTip, offTip) => {
        const on = sOn(k);
        const sealed = k !== "visit" && !visitOpen; // 被「谢绝来访」总闸全封
        return `<div class="line" style="align-items:center">
      <span>${on ? "✅" : "🚫"} <b>${title}</b> · <span class="small muted">${on ? onTip : offTip}</span>${sealed ? ` <span class="small" style="color:var(--wood)">（已被『谢绝来访』全封）</span>` : ""}</span>
      <form method="post" action="${base}/social" style="margin:0">
        <input type="hidden" name="key" value="${k}"><input type="hidden" name="on" value="${on ? "0" : "1"}">
        <button class="btn ghost" type="submit">${on ? "改为谢绝" : "改为开放"}</button>
      </form></div>`;
    };
    const socialCard = `<div class="card"><h3>🚪 社交开关　<span class="muted small" style="font-weight:400">双向：关掉某项 = 别人不能对你做，你也不能对别人做</span></h3>
    <p class="small muted" style="margin:0 0 8px"><b>谢绝来访</b>是总闸：关了别人<b>搜不到</b>${ai}的农场、${ai}也<b>不能出门</b>逛别家，并且偷菜／浇水／留言<b>一并封闭</b>。访问开着时，下面三项可单独控制。</p>
    ${sRow("visit", "谢绝来访 / 访问", "开放：别人可串门，你可出门", "谢绝：闭门谢客 + 全封")}
    ${sRow("steal", "偷菜", "开放：互相可偷", "谢绝：别人偷不了你，你也偷不了别人")}
    ${sRow("water", "帮浇水", "开放：互相可浇", "谢绝：别人帮不了你浇，你也帮不了别人")}
    ${sRow("message", "留言", "开放：互相可留言", "谢绝：别人留不了言，你也留不了")}
  </div>`;
    // 🎨 原创植物（design）：填名字/描述/文案 → 替 AI 设计一种 OR 稀有度原创作物
    const canDesign = f.coins >= UGC_DESIGN_FEE;
    const designCard = `<div class="card"><h3>🎨 原创植物　<span class="muted small" style="font-weight:400">替 ${ai} 设计一种独一无二的作物</span></h3>
    <p class="small muted" style="margin:0 0 8px">填好名字和描述（播种／收获文案选填），就替 ${ai} 创造一种作物（统一稀有度 <b>OR</b>，重在创意）。设计费 💰${UGC_DESIGN_FEE} 金从 ${ai} 的金币出，到手 ${UGC_SEED_YIELD} 颗种子——可在 TA 的田里种、也能上架卖给别的玩家，署名用 ${ai} 的昵称。</p>
    <form method="post" action="${base}/design" style="display:grid;gap:8px">
      <input class="inp" style="width:100%" type="text" name="name" maxlength="${UGC_NAME_MAX}" placeholder="作物名字（必填，最多 ${UGC_NAME_MAX} 字，如 星语花）" required>
      <textarea class="inp" style="width:100%" name="desc" rows="2" maxlength="${UGC_DESC_MAX}" placeholder="作物描述（必填，最多 ${UGC_DESC_MAX} 字，如 夜里会发出淡蓝光的小花）" required></textarea>
      <textarea class="inp" style="width:100%" name="plant" rows="2" maxlength="${UGC_PLANT_MAX}" placeholder="播种文案（选填，种下时显示，最多 ${UGC_PLANT_MAX} 字）"></textarea>
      <textarea class="inp" style="width:100%" name="harvest" rows="2" maxlength="${UGC_HARVEST_MAX}" placeholder="收获文案（选填，亲手收获时显示，最多 ${UGC_HARVEST_MAX} 字）"></textarea>
      <input class="inp" style="width:100%" type="text" name="latin" maxlength="40" placeholder="拉丁学名（选填，不填自动生成）">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button class="btn" type="submit"${canDesign ? "" : " disabled"}>🎨 创造（-${UGC_DESIGN_FEE} 金）</button>
        <button class="btn ghost" type="submit" formmethod="get" formaction="${base}/link-design">🔗 生成链接给${ai}</button>
        <span class="small muted">${ai}现有 💰${num(f.coins)} 金${canDesign ? "" : "——不够设计费，等 TA 多赚点再来"}</span>
      </div>
    </form></div>`;
    // 💬 给邻居留言（message）：填对方门牌号 + 内容 → 以本农场名义留言
    const msgCard = `<div class="card"><h3>💬 给邻居留言　<span class="muted small" style="font-weight:400">替 ${ai} 在别家留言板写一句</span></h3>
    <p class="small muted" style="margin:0 0 8px">填对方的门牌号（6 位，${ai} 串门／排行榜里看得到）和内容，就以「${esc(f.name)}」的名义留过去。最多 ${MESSAGE_TEXT_MAX} 字。</p>
    <form method="post" action="${base}/message" style="display:grid;gap:8px">
      <input class="inp" style="width:auto" type="text" name="target" maxlength="12" placeholder="对方门牌号 如 ABC234" required>
      <textarea class="inp" style="width:100%" name="text" rows="2" maxlength="${MESSAGE_TEXT_MAX}" placeholder="留言内容" required></textarea>
      <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" type="submit">↗ 留言</button>
        <button class="btn ghost" type="submit" formmethod="get" formaction="${base}/link-message">🔗 生成链接给${ai}</button></div>
    </form></div>`;
    // 👀 串门看别家（visit·只读）：填对方门牌号 → 生成一条精准串门链接给 ${ai} 点，走进那家公开农场（不改任何东西，所以只有「生成链接」一种做法）
    const visitCard = `<div class="card"><h3>👀 串门看别家　<span class="muted small" style="font-weight:400">替 ${ai} 精准访问某个门牌号</span></h3>
    <p class="small muted" style="margin:0 0 8px">知道对方门牌号（6 位，${ai} 串门／排行榜里看得到），填进来生成一条串门链接发给 ${ai}——TA 点开就走进那家的公开农场，不必靠出门随机逛。只是看看，不改任何东西。</p>
    <form method="get" action="${base}/link-visit" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <input class="inp" style="width:auto" type="text" name="target" maxlength="12" placeholder="对方门牌号 如 ABC234" required>
      <button class="btn ghost" type="submit">🔗 生成串门链接给${ai}</button>
    </form></div>`;
    // ⚗️ 固定组合熔炼（craft）：人指定哪 3 个素材（区别于 AI 的「自动取 3 个」）
    const mats = Object.entries(f.materials).filter(([, n]) => n > 0)
        .map(([id, n]) => ({ id, name: materialById.get(id)?.name ?? id, rarity: materialById.get(id)?.rarity ?? "N", n }));
    let craftBody;
    if (matTotal < 3) {
        craftBody = `<p class="small muted" style="margin:0">${ai}的素材还不够 3 份（现有 ${matTotal} 份）。素材靠收获随机掉落，攒够 3 份这里就能选组合熔炼了。</p>`;
    }
    else {
        const opts = `<option value="">—</option>` + mats.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}·${esc(m.rarity)}（有 ${m.n}）</option>`).join("");
        const sel = (n) => `<select class="inp" name="${n}" style="width:auto" required>${opts}</select>`;
        const recipeHints = f.knownRecipes
            .map((out) => recipes.find((r) => r.output === out))
            .filter((r) => !!r)
            .map((r) => `${r.materials.map((id) => materialById.get(id)?.name ?? id).join(" + ")} → ${cropById.get(r.output)?.name ?? r.output}`);
        const hintHtml = recipeHints.length
            ? `<p class="small muted" style="margin:8px 0 0">📜 ${ai}已学的配方（投对组合稳出）：${recipeHints.map((h) => `<span class="pill">${esc(h)}</span>`).join(" ")}</p>`
            : "";
        craftBody = `<form method="post" action="${base}/craft" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        ${sel("m1")}${sel("m2")}${sel("m3")}
        <button class="btn" type="submit">⚗️ 熔炼</button>
        <button class="btn ghost" type="submit" formmethod="get" formaction="${base}/link-craft">🔗 生成链接给${ai}</button>
      </form>
      <p class="small muted" style="margin:8px 0 0">投入素材越稀有，越容易熔出高稀有限定作物；命中隐藏配方则稳出特定作物。熔出的限定种子进 ${ai} 的种子库，可在 TA 的田里种。</p>
      ${hintHtml}`;
    }
    const craftCard = `<div class="card"><h3>⚗️ 固定组合熔炼　<span class="muted small" style="font-weight:400">你来指定哪 3 个素材，熔出一颗限定种子</span></h3>
    ${craftBody}</div>`;
    const body = `${plaque}
${namesCard}
${welcomeCard}
${socialCard}
${designCard}
${msgCard}
${visitCard}
${craftCard}`;
    return page(`${f.name} · TA的农场`, key, "ta", body, farmNames(f));
}
// ——————————————————————————————————————————————————————————————
// 🗺️ 探险页：当前探险/摇骰 · 出门前祈福 · 本趟故事书 · 秘境图鉴 · 旅程簿
// ——————————————————————————————————————————————————————————————
const EXP_TYPE_LABEL = { story: "剧情", drop: "掉落", choice: "分支", encounter: "奇遇", combat: "⚔️战斗" };
function expBagPreview(exp) {
    let coins = 0, silver = 0, potion = 0;
    const decor = [];
    for (const d of exp.bag) {
        if (d.t === "coins")
            coins += d.n ?? 0;
        else if (d.t === "silver")
            silver += d.n ?? 0;
        else if (d.t === "potion")
            potion += d.n ?? 0;
        else if (d.t === "decor")
            decor.push(expDecorById.get(d.id)?.name ?? "装饰");
    }
    const parts = [];
    if (coins)
        parts.push(`${coins}金`);
    if (silver)
        parts.push(`${silver}银`);
    if (potion)
        parts.push(`药水×${potion}`);
    if (decor.length)
        parts.push(`🏡${decor.join("、")}`);
    return parts.length ? parts.join("、") : "空";
}
export function uiExpedition(f, now, key, flash) {
    advance(f, now);
    const base = `/ui/${key}/expedition`;
    const ai = esc(f.aiName || "TA");
    const human = esc(f.humanName || "你");
    const exp = f.expedition;
    const flashHtml = flash ? `<div class="flash" style="white-space:pre-wrap">${esc(flash)}</div>` : "";
    // —— plaque ——
    const concord = Math.min(100, Math.max(0, f.expConcord ?? 0));
    const concordTag = `<span class="tag">💞 默契 <b>${concord}/100</b></span>`;
    let tags;
    if (exp) {
        const map = expMapById.get(exp.mapId);
        tags = `<span class="tag">🗺️ <b>${esc(map?.name ?? "秘境")}</b></span><span class="tag">第 <b>${exp.step}</b> 格</span><span class="tag">❤ <b>${exp.hp}</b></span><span class="tag">🎒 ${esc(expBagPreview(exp))}</span>${concordTag}`;
    }
    else {
        const today = currentDayIndex(now);
        const used = f.expDaily && f.expDaily.day === today ? f.expDaily.n : 0;
        tags = `<span class="tag">今日剩 <b>${Math.max(0, EXP_DAILY_CAP - used)}/${EXP_DAILY_CAP}</b> 次数</span>${concordTag}`;
    }
    const plaque = `<div class="plaque"><h1>🗺️ 探险</h1>
    <p class="welcome"></p>
    <div class="tags">${tags}</div></div>${flashHtml}`;
    const cards = [];
    // —— 0. 默契度（并肩取胜攒下的羁绊；每赢一场 +1，封顶 100）——
    {
        const pct = concord; // 0..100
        const tier = concordTierName(concord); // 与「默契」类称号同源（titles.json）
        cards.push(`<div class="card"><h3>💞 默契度　<span class="muted small" style="font-weight:400">${ai} 与 ${human} 并肩取胜攒下的羁绊</span></h3>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin:0 0 6px">
        <span style="font-family:var(--serif);color:var(--leaf-deep);font-weight:600">${tier}</span>
        <span class="small muted"><b>${concord}</b> / 100</span></div>
      <div style="height:12px;border-radius:6px;background:#efe8d6;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--wood),var(--leaf-deep));transition:width .3s"></div></div>
      <p class="small muted" style="margin:8px 0 0">每当 ${ai} 在秘境里赢下一场战斗，默契度就 +1（封顶 100）。${concord >= 100 ? `🎉 你俩已心有灵犀，满默契达成！` : ""}</p></div>`);
    }
    // —— 1. 当前探险 / 摇骰 ——
    if (exp && exp.pending?.type === "combat") {
        const e = expEventById.get(exp.pending.eventId);
        const target = EXP_DC[e?.difficulty ?? "mid"];
        cards.push(`<div class="card" style="border:2px solid var(--wood)">
      <h3>⚔️ ${ai}遇到了【${esc(e?.foe ?? "强敌")}】！</h3>
      <p class="small muted" style="margin:0 0 8px">${esc(e?.story ?? "")}</p>
      <p style="margin:0 0 10px">掷两颗六面骰，<b>和 ≥ ${target}</b> 才能赢。你替 ${ai} 摇——和 TA 同心，骰子会偏心你（<b>+1</b>）。<br><span class="small muted">此刻 ❤ ${exp.hp} · 🎒 ${esc(expBagPreview(exp))}（赢了进库，输了只掉状态、行囊不丢）</span></p>
      <form method="post" action="${base}/roll"><button class="btn" style="font-size:18px;padding:10px 22px">🎲 替 ${ai} 摇骰子</button></form>
    </div>`);
    }
    else if (exp) {
        const map = expMapById.get(exp.mapId);
        const where = exp.pending?.type === "choice" ? `${ai}正面对一个选择，等 TA 自己拿主意。` : `等 ${ai} 继续往里走。`;
        cards.push(`<div class="card"><h3>🧭 探险进行中 · ${esc(map?.name ?? "")}</h3>
      <p class="small muted" style="margin:0">${ai}在第 ${exp.step} 格。❤ ${exp.hp} · 🎒 ${esc(expBagPreview(exp))}。${where}</p></div>`);
    }
    // —— 2. 出门前祈福 ——
    const blessing = esc(exp?.charm?.blessing ?? f.expCharm?.blessing ?? "");
    cards.push(`<div class="card"><h3>🧿 ${exp ? "为这趟祈福" : "出门前祈福"}　<span class="muted small" style="font-weight:400">给 ${ai} 添点底气</span></h3>
    <p class="small muted" style="margin:0 0 8px">挑一个护身符，再写一句祝福的话——它会随 ${ai} 一起带走，状态告急时在 TA 耳边回响，回来结算时再回放给你听。${exp ? "" : `${ai}下次 explore 出门时生效。`}</p>
    <form method="post" action="${base}/charm" style="display:grid;gap:8px">
      <label class="small"><input type="radio" name="kind" value="check" checked> 🍀 勇气符（下次检定 +1）</label>
      <label class="small"><input type="radio" name="kind" value="hp"> 💗 暖意符（回 1 点状态）</label>
      <textarea class="inp" style="width:100%" name="blessing" rows="2" maxlength="${EXP_BLESSING_MAX}" placeholder="写一句祝福的话（最多 ${EXP_BLESSING_MAX} 字，如：平平安安回来就好）">${blessing}</textarea>
      <div><button class="btn" type="submit">🧿 祈福</button></div>
    </form></div>`);
    // —— 3. 本趟故事书 ——
    if (exp && exp.log.length) {
        const pages = exp.log.map((l) => `<p style="margin:0 0 10px"><b>${esc(l.title)}</b><br><span class="small" style="white-space:pre-wrap">${esc(l.text)}</span></p>`).join("");
        cards.push(`<div class="card"><h3>📖 本趟故事书</h3>${pages}</div>`);
    }
    // —— 4. 秘境图鉴（折叠细列表；未解锁=纯问号，不透露任何内容）——
    const seen = new Set(f.expCodex ?? []);
    const rowStyle = "display:flex;justify-content:space-between;align-items:center;padding:5px 10px;border-bottom:1px solid #efe8d6;font-size:14px";
    const mapBlocks = expMaps.map((map) => {
        const evs = map.events.map((id) => expEventById.get(id)).filter((e) => !!e);
        const got = evs.filter((e) => seen.has(e.id)).length;
        const micon = "🗺️";
        const mcolor = "var(--leaf-deep)";
        // 未发现的秘境：连名字带内容整块盖住、不可展开；去过至少一格才解锁，露出真名与格子。
        if (got === 0)
            return `<div class="card" style="padding:10px 12px;font-family:var(--serif);color:#c2b89e;letter-spacing:3px;font-weight:600">${micon} ？？？　<span class="small" style="font-weight:400;letter-spacing:0;color:#c2b89e">未解锁</span></div>`;
        const rows = evs.map((e) => {
            if (!seen.has(e.id))
                return `<div style="${rowStyle};color:#c2b89e;letter-spacing:3px">？？？</div>`;
            const detail = [`<div style="white-space:pre-wrap">${esc(e.story)}</div>`];
            if (e.options?.length)
                detail.push(`<div class="small muted" style="margin-top:6px">岔路：<br>${e.options.map((o) => `▸ ${o.key}. ${esc(o.label)}`).join("<br>")}</div>`);
            if (e.type === "combat") {
                const bits = [`敌人：${esc(e.foe ?? "")}`];
                if (e.win?.text)
                    bits.push(`胜 → ${esc(e.win.text)}`);
                if (e.lose?.text)
                    bits.push(`负 → ${esc(e.lose.text)}`);
                detail.push(`<div class="small muted" style="margin-top:6px">⚔️ ${bits.join("<br>")}</div>`);
            }
            return `<details style="border-bottom:1px solid #efe8d6">
        <summary style="cursor:pointer;padding:5px 10px;font-size:14px">${EXP_TYPE_LABEL[e.type] ?? ""}・<b>${esc(e.title)}</b></summary>
        <div style="padding:0 14px 10px;font-size:13px;color:var(--ink-soft)">${detail.join("")}</div></details>`;
        }).join("");
        return `<details class="card" style="padding:0;overflow:hidden">
      <summary style="cursor:pointer;padding:10px 12px;font-family:var(--serif);color:${mcolor};font-weight:600">${micon} ${esc(map.name)}　<span class="small muted" style="font-weight:400">已遇 ${got}/${evs.length}</span></summary>
      <div>${rows}</div></details>`;
    }).join("");
    cards.push(`<div style="margin:6px 0"><h2 style="margin:6px 0">📔 秘境图鉴</h2>
    <p class="small muted" style="margin:0 0 8px">没去过的秘境整块是 ？？？；${ai}每去过一格就亮一格。点开已解锁的秘境，再点开某一格，能重读它的故事。</p></div>${mapBlocks}`);
    // —— 5. 旅程簿 ——
    if (f.expJourneys?.length) {
        const rows = f.expJourneys.slice(0, 12).map((j) => `<p style="margin:0 0 8px"><b>${esc(j.mapName)}</b> · <span class="small muted">${fmtDate(j.at)}</span><br><span class="small">${esc(j.summary)}</span>${j.blessing ? `<br><span class="small" style="color:var(--wood)">💗「${esc(j.blessing)}」</span>` : ""}</p>`).join("");
        cards.push(`<div class="card"><h3>📜 旅程簿　<span class="muted small" style="font-weight:400">${ai}的冒险史</span></h3>${rows}</div>`);
    }
    return page(`${f.name} · 探险`, key, "expedition", `${plaque}\n${cards.join("\n")}`, farmNames(f));
}
// ——————————————————————————————————————————————————————————————
// 📖 图鉴册（标本册）：5 栏 —— 普通 / 奇幻 / 限定 / 原创(收藏别家) / 我的(小克自创)
//   官方三类按全集铺位：集到的亮、没集的留灰标本位；ugc 两类是开放集，只列已有的。
// ——————————————————————————————————————————————————————————————
const RAR_RANK = { N: 0, R: 1, SR: 2, SSR: 3, SP: 4, OR: 5 };
const qualityName = (tier) => qualities.find((q) => q.tier === tier)?.name ?? `品${tier}`;
const byRarityThenName = (a, b) => (RAR_RANK[a.rarity] - RAR_RANK[b.rarity]) || a.name.localeCompare(b.name, "zh");
const fmtDate = (ms) => ms ? new Date(ms).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }) : "早期收录";
/** 拼 data-* 属性（空值不输出，值统一转义）。*/
const da = (k, v) => (v === undefined || v === null || v === "") ? "" : ` data-${k}="${esc(v)}"`;
/** 一枚标本位。entry 有则「已收录」（亮），无则灰（mine=true 时为「已设计待收获」，不灰）。
 *  已收录 / 我的 两类带 data-* → 可点开细节弹窗；未解锁的灰位不可点。 */
function specTile(c, entry, opts = {}) {
    const cvar = RARITY_VAR[c.rarity] ?? "--N";
    const latin = c.latin ? `<div class="latin">${esc(c.latin)}</div>` : "";
    const sign = opts.by ? `<div class="sm" style="margin-top:2px">✍ ${esc(opts.by)}</div>` : "";
    // ⭐ 星标按钮：只在已揭晓的标本上出现（已收录 / 我的设计）；小表单 POST 切换收藏态，不触发细节弹窗。
    const star = (opts.key && (entry || opts.mine))
        ? `<form class="starf" method="post" action="/ui/${esc(opts.key)}/codex/star">`
            + `<input type="hidden" name="id" value="${esc(c.id)}"><input type="hidden" name="anchor" value="${esc(opts.anchor ?? "")}">`
            + `<button class="starbtn${opts.starred ? " on" : ""}" title="${opts.starred ? "取消收藏" : "收藏到「我的收藏」"}" aria-label="收藏">${opts.starred ? "★" : "☆"}</button></form>`
        : "";
    // 可点标本携带的细节数据（弹窗用）
    const data = `data-detail${da("name", c.name)}${da("latin", c.latin)}${da("cvar", cvar)}${da("rarity", c.rarity)}`
        + `${da("cat", opts.cat)}${da("desc", c.desc)}${da("plant", c.plantLine)}${da("harvest", c.lore)}${da("by", opts.by)}`
        + (entry ? `${da("quality", qualityName(entry.bestQuality))}${da("count", entry.count)}${da("date", fmtDate(entry.firstAt))}` : "")
        + (opts.mine && !entry ? da("status", "你设计的，还没亲手收获") : "");
    if (entry) {
        return `<div class="spec" style="--c:var(${cvar})" ${data}>${star}
      <div class="nm">${esc(c.name)}</div>${latin}
      <div class="sm">${rarityDot(c.rarity)} <span class="q">${esc(qualityName(entry.bestQuality))}</span> · 收 ${entry.count}</div>${sign}</div>`;
    }
    if (opts.mine) {
        return `<div class="spec" style="--c:var(${cvar})" ${data}>${star}
      <div class="nm">${esc(c.name)}</div>${latin}
      <div class="sm">${rarityDot(c.rarity)} · 🌱 已设计 · 待亲手收获</div></div>`;
    }
    // 未解锁：藏名（连学名一起），只露稀有度色标，留收集悬念，不可点
    return `<div class="spec locked" style="--c:var(${cvar})"><span class="lk">🔒</span>
    <div class="nm" style="letter-spacing:2px">？？？</div>
    <div class="latin">未知物种</div>
    <div class="sm">${rarityDot(c.rarity)} · 未收录</div></div>`;
}
export function uiCodex(f, now, key, flash) {
    advance(f, now);
    const flashHtml = flash ? `<div class="flash">${esc(flash)}</div>` : "";
    // 官方三类：全集铺位
    const official = [
        { id: "common", emoji: "🌾", label: "普通", cat: "common" },
        { id: "fantasy", emoji: "✨", label: "奇幻", cat: "fantasy" },
        { id: "limited", emoji: "🎏", label: "限定", cat: "limited" },
    ];
    const officialSecs = official.map(({ id, emoji, label, cat }) => {
        const all = cropsByCategory(cat).slice().sort(byRarityThenName);
        const got = all.filter((c) => f.codex[c.id]).length;
        const tiles = all.map((c) => specTile(c, f.codex[c.id], { cat: label, key, starred: isStarred(f, c.id), anchor: id })).join("");
        return { id, emoji, label, got, total: all.length,
            html: `<section id="${id}"><div class="secthead"><h2>${emoji} ${esc(label)}</h2>
        <span class="cnt">已收录 <b>${got}</b> / ${all.length}</span></div>
      <div class="specimens">${tiles}</div></section>` };
    });
    // 原创：收藏的别家设计（codex 里 ugc 且 designerId 不是自己）
    const others = Object.keys(f.codex)
        .map((id) => getCrop(id))
        .filter((c) => !!c && c.category === "ugc" && c.designerId !== f.id)
        .sort((a, b) => a.name.localeCompare(b.name, "zh"));
    const othersHtml = others.length
        ? `<div class="specimens">${others.map((c) => specTile(c, f.codex[c.id], { cat: "原创", by: `by ${c.designer || "某位邻居"}`, key, starred: isStarred(f, c.id), anchor: "originals" })).join("")}</div>`
        : `<div class="emptybox">还没收藏过别家的原创作物——去串门买邻居的种子，收获后就进册了。</div>`;
    const origSec = `<section id="originals"><div class="secthead"><h2>🎨 原创</h2>
      <span class="cnt">收藏别家 <b>${others.length}</b> 种</span></div>${othersHtml}</section>`;
    // 我的：小克自己设计的（全列，亲手收过的亮、没收的标待收获）
    const mine = allUgc().filter((c) => c.designerId === f.id && !c.banned)
        .sort((a, b) => a.name.localeCompare(b.name, "zh"));
    const mineGot = mine.filter((c) => f.codex[c.id]).length;
    const mineHtml = mine.length
        ? `<div class="specimens">${mine.map((c) => specTile(c, f.codex[c.id], { cat: "我的", mine: true, by: f.codex[c.id] ? "我的设计" : undefined, key, starred: isStarred(f, c.id), anchor: "mine" })).join("")}</div>`
        : `<div class="emptybox">${esc(f.aiName || "小克")}还没设计过原创作物——在文字接口里 <code>design</code> 一个，就会出现在这格标本册。</div>`;
    const mineSec = `<section id="mine"><div class="secthead"><h2>🖌️ 我的</h2>
      <span class="cnt">自创 <b>${mine.length}</b> 种${mine.length ? ` · 亲手收过 ${mineGot}` : ""}</span></div>${mineHtml}</section>`;
    // ⭐ 我的收藏：伴侣星标过的作物，按收藏顺序汇总（跨普通/奇幻/限定/原创/自创；只保留仍存在且已揭晓的）
    const favLabel = (c) => c.category === "ugc" ? (c.designerId === f.id ? "我的" : "原创")
        : c.category === "common" ? "普通" : c.category === "fantasy" ? "奇幻" : "限定";
    const favs = (f.starred ?? [])
        .map((id) => getCrop(id))
        .filter((c) => !!c && !c.banned)
        .filter((c) => !!f.codex[c.id] || c.designerId === f.id); // 只留已收录 / 自己设计（未揭晓的不进收藏）
    const favTiles = favs.map((c) => {
        const isMineDesign = c.category === "ugc" && c.designerId === f.id;
        const by = c.category === "ugc"
            ? (isMineDesign ? (f.codex[c.id] ? "我的设计" : undefined) : `by ${c.designer || "某位邻居"}`)
            : undefined;
        return specTile(c, f.codex[c.id], { cat: favLabel(c), mine: isMineDesign, by, key, starred: true, anchor: "favorites" });
    }).join("");
    const favHtml = favs.length
        ? `<div class="specimens">${favTiles}</div>`
        : `<div class="emptybox">还没星标任何作物——在下面各栏点开喜欢的作物，点右上角的 ☆ 就收进这里。</div>`;
    const favSec = `<section id="favorites"><div class="secthead"><h2>⭐ 我的收藏</h2>
      <span class="cnt">星标 <b>${favs.length}</b> 种</span></div>${favHtml}</section>`;
    // 顶部锚点导航（各栏带计数）
    const chips = [
        `<a href="#favorites">⭐ 我的收藏 <b>${favs.length}</b></a>`,
        ...officialSecs.map((s) => `<a href="#${s.id}">${s.emoji} ${esc(s.label)} <b>${s.got}/${s.total}</b></a>`),
        `<a href="#originals">🎨 原创 <b>${others.length}</b></a>`,
        `<a href="#mine">🖌️ 我的 <b>${mine.length}</b></a>`,
    ].join("");
    const totalGot = officialSecs.reduce((n, s) => n + s.got, 0);
    const totalAll = officialSecs.reduce((n, s) => n + s.total, 0);
    const plaque = `<div class="plaque"><h1>📖 图鉴册</h1>
    <p class="welcome"></p>
    <div class="tags"><span class="tag">官方已收 <b>${totalGot}</b> / ${totalAll}</span>
      <span class="tag">⭐ 我的收藏 <b>${favs.length}</b></span>
      <span class="tag">收藏别家原创 <b>${others.length}</b></span>
      <span class="tag">自创 <b>${mine.length}</b></span></div></div>`;
    // 细节弹窗（单例）+ 极小内联脚本：点标本读 data-* 填窗；点背景/✕/Esc 关。
    const modal = `<div class="mback" id="mb">
  <div class="sheet" id="sheet"><span class="x" data-close>✕</span>
    <h3 class="mt" id="m-name"></h3>
    <div class="mlatin" id="m-latin"></div>
    <div class="mmeta" id="m-meta"></div>
    <div class="blk" id="m-desc"><div class="lbl">📜 描述</div><p class="v"></p></div>
    <div class="blk" id="m-plant"><div class="lbl">🌱 播种时</div><div class="quote v"></div></div>
    <div class="blk" id="m-harvest"><div class="lbl">🌾 收获时</div><div class="quote v"></div></div>
  </div></div>
<script>
(function(){
  var mb=document.getElementById('mb'); if(!mb) return;
  var $=function(id){return document.getElementById(id);};
  function blk(id,val){var el=$(id); if(val){el.style.display='';el.querySelector('.v').textContent=val;}else{el.style.display='none';}}
  function open(d){
    $('m-name').textContent=d.name||'';
    var lat=$('m-latin'); lat.textContent=d.latin||''; lat.style.display=d.latin?'':'none';
    // 防 XSS：拼进 innerHTML 的变量(尤其设计者名 d.by，来自用户可控的农场名/aiName)必须转义
    var e=function(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});};
    var m='<span class="rdot" style="--c:var('+(d.cvar||'--N')+')">'+e(d.rarity)+'</span>';
    if(d.cat) m+=' <span class="pill">'+e(d.cat)+'</span>';
    if(d.quality) m+=' <span class="q">'+e(d.quality)+'</span>';
    if(d.count) m+=' · 收 '+e(d.count);
    if(d.by) m+=' · ✍ '+e(d.by);
    if(d.date) m+=' · 🗓 '+e(d.date);
    if(d.status) m+=' · '+e(d.status);
    $('m-meta').innerHTML=m;
    $('sheet').style.setProperty('--c','var('+(d.cvar||'--leaf')+')');
    blk('m-desc',d.desc); blk('m-plant',d.plant); blk('m-harvest',d.harvest);
    mb.classList.add('show');
  }
  function close(){mb.classList.remove('show');}
  document.addEventListener('click',function(e){
    if(e.target.closest('.starf')) return; // ⭐ 点星标按钮只提交收藏表单，不弹细节窗
    var t=e.target.closest('[data-detail]'); if(t){open(t.dataset);return;}
    if(e.target===mb||e.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown',function(e){if(e.key==='Escape')close();});
})();
</script>`;
    const body = `${plaque}${flashHtml}
<div class="codexnav">${chips}</div>
${favSec}
${officialSecs.map((s) => s.html).join("\n")}
${origSec}
${mineSec}
${modal}`;
    return page(`${f.name} · 图鉴册`, key, "codex", body, farmNames(f));
}
// ——————————————————————————————————————————————————————————————
// 🏆 全服排行榜（各榜 Top 5 汇总一处）——唯一的全服页；每榜高亮小克、没进前 5 就补一行他的名次
// ——————————————————————————————————————————————————————————————
const medal = (i) => ["🥇", "🥈", "🥉"][i] ?? `#${i + 1}`;
/** 一行榜单：相对值条形背景 + 名次 + 名字(可带署名) + 数值；isMe 高亮，off 为「不在前 5」的补行。*/
function lbRow(rank, name, value, unit, max, isMe, by, off, title, code, byCode) {
    const pct = max > 0 ? Math.max(7, Math.round((value / max) * 100)) : 0;
    const fill = off ? "" : rank === 0 ? "linear-gradient(90deg,#fbe7c1,transparent)"
        : rank < 3 ? "linear-gradient(90deg,#edeee4,transparent)" : "linear-gradient(90deg,#e9f4db,transparent)";
    const cls = `lbrow${rank < 3 && !off ? ` top${rank + 1}` : ""}${isMe ? " me" : ""}${off ? " off" : ""}`;
    const fillEl = off ? "" : `<span class="fill" style="width:${pct}%;background:${fill}"></span>`;
    // 署名：给了 byCode（如原创作物的设计者门牌号）则做成「点击复制门牌号」的芯片，和农场名同一套交互；否则纯文本。
    const byInner = byCode
        ? `<button type="button" class="cpnm" data-copy="${esc(byCode)}" title="点击复制设计者门牌号">${esc(by)}</button>`
        : esc(by ?? "");
    const byEl = by ? ` <span class="by">/ ${byInner}</span>` : "";
    const meTag = isMe ? `<span class="metag">我们</span>` : "";
    const titleEl = title ? `<span class="lbtitle">✧${esc(title)}✧</span>` : ""; // 佩戴的称号：描金渐变
    // 门牌号不再明面显示；点农场名即复制它（发串门／留言用）。无 code（如原创热门榜的作物名）则纯文本。
    const nameEl = code
        ? `<button type="button" class="cpnm" data-copy="${esc(code)}" title="点击复制门牌号">${esc(name)}</button>`
        : esc(name);
    return `<div class="${cls}">${fillEl}
    <span class="rk">${off ? `#${rank + 1}` : medal(rank)}</span>
    <span class="nm">${titleEl}${nameEl}${byEl}${meTag}</span>
    <span class="v">${num(value)}<span class="vu">${esc(unit)}</span></span></div>`;
}
export function uiLeaderboard(f, now, key) {
    advance(f, now);
    checkTitles(f); // 进榜前补结算称号，名字前缀用最新佩戴
    const farms = playerFarms(); // 排除常驻 NPC 阿土（排名/计数只算真实玩家）
    const b = buildLeaderboards(farms, allUgc(), now);
    const meName = f.name; // 榜上一律用农场名（配合门牌号区分）
    const aiDisp = esc(meName); // 自指文案（“看看X在大家里”等）也用农场名
    const today = currentDayIndex(now);
    const defs = [
        { icon: "💰", title: "财富榜", unit: " 金", rows: b.wealth, score: (x) => x.coins },
        { icon: "📖", title: "收集榜", unit: " 种", rows: b.collection, score: codexGot },
        { icon: "🌾", title: "勤劳榜", unit: " 株", rows: b.diligence, score: (x) => x.harvested ?? 0 },
        { icon: "💧", title: "热心榜", unit: " 次", rows: b.kindness, score: (x) => x.watered ?? 0 },
        { icon: "🥷", title: "大盗榜", unit: " 次", rows: b.thief, score: (x) => x.stolen ?? 0 },
        { icon: "🏞️", title: "土地榜", unit: " 阶", rows: b.land, score: (x) => x.landTier },
    ];
    // 今日榜：每天 0 点（UTC+8）归零，新人也能同台竞争
    const todayDefs = [
        { icon: "🔥", title: "卷王榜", sub: "今日完成任务最多", unit: " 个", rows: b.todayTasks, score: dailyScore(today, "tasks") },
        { icon: "📱", title: "网瘾榜", sub: "今日巡视农场最勤", unit: " 次", rows: b.todayLogins, score: dailyScore(today, "logins") },
        { icon: "💬", title: "热情榜", sub: "今日给人留言最多", unit: " 次", rows: b.todayMessages, score: dailyScore(today, "messages") },
        { icon: "🌦️", title: "奇遇榜", sub: "今日触发随机事件最多", unit: " 次", rows: b.todayEvents, score: dailyScore(today, "events") },
    ];
    // 给每个榜算小克的值/名次，决定高亮还是补行
    const mkCard = (d) => {
        const meVal = d.score(f);
        const meRank = rankOf(farms, f, d.score);
        const max = d.rows.length ? d.rows[0].value : 1;
        const inRows = d.rows.some((r) => r.code === f.id);
        const inTop = meVal > 0 && meRank <= 5;
        const rowsHtml = d.rows.length
            ? d.rows.map((r, i) => lbRow(i, r.name, r.value, d.unit, max, r.code === f.id, undefined, false, r.title, r.code)).join("")
            : `<div class="small muted">还没有上榜的</div>`;
        let foot = "";
        if (meVal > 0 && !inRows)
            foot = lbRow(meRank - 1, f.name, meVal, d.unit, max, true, undefined, true, equippedTitle(f)?.name, f.id);
        else if (meVal <= 0)
            foot = `<div class="lbnote">${aiDisp}还没上这个榜～</div>`;
        const subEl = d.sub ? `　<span class="muted small" style="font-weight:400">${d.sub}</span>` : "";
        return { ...d, meRank, meVal, inTop, html: `<div class="card"><h3>${d.icon} ${d.title}${subEl}</h3>${rowsHtml}${foot}</div>` };
    };
    const cards = defs.map(mkCard);
    const todayCards = todayDefs.map(mkCard);
    // 原创热门榜：单独形态（按「多少人买过」=去重买家数），本农场设计的作物上榜则高亮
    const hotHtml = b.hot.length
        ? b.hot.map((c, i) => lbRow(i, c.name, c.buyers, " 人买过", b.hot[0].buyers, c.designer === meName, c.designer, false, undefined, undefined, c.designerId || undefined)).join("")
        : `<div class="small muted">还没有热卖的原创</div>`;
    const hotCard = `<div class="card"><h3>🔥 原创热门榜　<span class="muted small" style="font-weight:400">谁的自创作物卖得最火</span></h3>${hotHtml}</div>`;
    // 🎲 逛逛原创：随机 5 个自创作物 + 「换一批」。带设计者门牌号（点击复制去回访）。前端 JS 就地洗牌，不刷整页。
    const discPool = allUgc()
        .filter((c) => c.category === "ugc" && !c.banned && !!c.designerId) // 下架作物不进，和热门榜同规矩
        .map((c) => ({ n: c.name, d: c.designer ?? "?", i: c.designerId, r: c.rarity, v: RARITY_VAR[c.rarity] ?? "--N" }));
    const discSample = (discPool.length > 60 ? [...discPool].sort(() => Math.random() - 0.5).slice(0, 60) : discPool);
    const discJson = JSON.stringify(discSample).replace(/</g, "\\u003c"); // 防 </script> 提前闭合
    const discCard = `<div class="card"><h3>🎲 逛逛原创　<span class="muted small" style="font-weight:400">随机 5 个自创作物，点设计者名复制门牌号去回访</span></h3>
    <div id="ugcDisc" style="margin-top:2px"></div>
    <div style="margin-top:10px"><button type="button" class="btn" id="ugcReroll">🔀 换一批</button></div></div>`;
    // 用和其它榜单同一套 .lbrow 结构渲染：左侧稀有度色标(.rdot) + 作物名 + 设计者(.cpnm 点击复制门牌号)。
    const discScript = `<script>
(function(){
  var POOL=${discJson}; var box=document.getElementById('ugcDisc'); if(!box) return;
  function pick(){var a=POOL.slice();for(var i=a.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=a[i];a[i]=a[j];a[j]=t;}return a.slice(0,5);}
  function render(){
    box.textContent='';
    var items=pick();
    if(!items.length){var e=document.createElement('div');e.className='small muted';e.style.padding='6px 0';e.textContent='还没有原创作物，快和 AI 一起设计第一个吧～';box.appendChild(e);return;}
    items.forEach(function(c){
      var row=document.createElement('div'); row.className='lbrow';
      var dot=document.createElement('span'); dot.className='rdot'; dot.style.setProperty('--c','var('+c.v+')'); dot.textContent=c.r; row.appendChild(dot);
      var nm=document.createElement('span'); nm.className='nm';
      nm.appendChild(document.createTextNode(c.n+' '));
      var by=document.createElement('span'); by.className='by'; by.appendChild(document.createTextNode('/ '));
      var btn=document.createElement('button'); btn.type='button'; btn.className='cpnm'; btn.title='点击复制设计者门牌号'; btn.setAttribute('data-copy',c.i); btn.textContent=c.d; by.appendChild(btn);
      nm.appendChild(by); row.appendChild(nm);
      box.appendChild(row);
    });
  }
  var rb=document.getElementById('ugcReroll'); if(rb) rb.addEventListener('click',render);
  render();
})();
</script>`;
    // 概览：上榜数 + 最佳名次
    const onTop = cards.filter((c) => c.inTop).length;
    const best = cards.filter((c) => c.meVal > 0).sort((a, c) => a.meRank - c.meRank)[0];
    const plaque = `<div class="plaque"><h1>🏆 全服排行榜</h1>
    <p class="welcome"></p>
    <div class="tags"><span class="tag">🌍 全服 <b>${farms.length}</b> 座</span>
      <span class="tag">🏅 ${aiDisp}进前 5 <b>${onTop}</b> 个榜</span>
      ${best ? `<span class="tag">最好成绩 ${best.icon} ${best.title} <b>#${best.meRank}</b></span>` : ""}</div></div>`;
    // 点农场名复制门牌号（clipboard API + execCommand 回退），复制后短暂反馈。
    const copyScript = `<script>
(function(){
  function fb(txt){try{var ta=document.createElement('textarea');ta.value=txt;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);}catch(e){}}
  function done(t,txt){var o=t.textContent;t.classList.add('copied');t.textContent='已复制 '+txt+' ✓';setTimeout(function(){t.classList.remove('copied');t.textContent=o;},1300);}
  document.addEventListener('click',function(e){
    var t=e.target.closest('[data-copy]'); if(!t) return;
    e.preventDefault(); if(t.classList.contains('copied')) return;
    var txt=t.getAttribute('data-copy');
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(txt).then(function(){done(t,txt);},function(){fb(txt);done(t,txt);});}
    else{fb(txt);done(t,txt);}
  });
})();
</script>`;
    const todaySection = `<div class="plaque" style="margin-top:18px"><h1>📅 今日榜</h1>
    <p class="welcome">“每天 0 点归零，比的是当天的活跃——新农场也能一夜登顶。”</p></div>
<div class="grid c2">${todayCards[0].html}${todayCards[1].html}</div>
<div class="grid c2">${todayCards[2].html}${todayCards[3].html}</div>`;
    const body = `${plaque}
<div class="grid c2">${cards[0].html}${cards[1].html}</div>
<div class="grid c2">${cards[2].html}${cards[3].html}</div>
<div class="grid c2">${cards[4].html}${cards[5].html}</div>
${hotCard}
${discCard}
${todaySection}${copyScript}${discScript}`;
    return page(`${f.name} · 全服排行榜`, key, "leaderboard", body, farmNames(f));
}
export function uiTodo(f, key, section) {
    const names = { leaderboard: "排行榜" };
    const body = `<div class="plaque"><h1>🚧 ${esc(names[section] ?? section)}</h1>
    <p class="welcome"></p>
    <p style="margin-top:10px"><a class="cta" href="/ui/${key}">← 回主页</a></p></div>`;
    return page("建设中", key, section, body, farmNames(f));
}
export function uiInvalid() {
    return `<!doctype html><meta charset="utf-8"><style>${STYLE}</style>
  <div class="wrap"><div class="plaque" style="margin-top:60px"><h1>🔒 链接无效</h1>
  <p class="welcome">这个农场观光链接打不开——可能链接已失效，或这座农场不存在了。</p></div></div>`;
}
//# sourceMappingURL=web.js.map