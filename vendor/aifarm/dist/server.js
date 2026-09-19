// 开放 HTTP 接口（node:http，零依赖）。业务逻辑复用 game.ts，保证与 CLI 同一套规则。
import { createServer } from "node:http";
import { randomUUID, randomBytes } from "node:crypto";
import { advance, steal, canStealNow, stealAvailability, stealShieldRemain, isUgcCrop, visitorWater, tryWaterReward, ranchRoamLine, buyPotionSet, refreshShop, ranchCollect, ranchRemit, ranchBuyAccessory, ranchBuyDecoration, ranchWearAccessory, ranchTakeOffAccessory, ranchPlaceDecoration, ranchUnplaceDecoration, ranchUpgradeAnimal, ranchNameAnimal, ranchNamePet, ranchTogglePin, ensureHumanKey, takeInbox, potionDailyLeft, designCrop, craft, nextUpgradeReq, toggleStar } from "./engine.js";
import { dispatch, HELP, farmView, viewShop, viewEncyclopedia, viewBag, shopBrief, viewMarket, buyFromMarket, visitView, ranchAgentSection, refPrice, tendNpc, buyNpcSeed, randomTip } from "./game.js";
import { harvestText, stealThiefText, statusFooter, waterText, describeFarm } from "./flavor.js";
import { createFarm, getFarm, allFarms, playerFarms, save } from "./store.js";
import { MAX_BODY_BYTES, MAX_FARMS, MESSAGE_TEXT_MAX, MESSAGES_MAX, POTION_DAILY_CAP, POTION_CAP_LINE, NPC_ID, SEED_PRICE, RECIPE_PRICE, WELCOME_MAX, EXP_DAILY_CAP, EXP_MAX_CHARGES_PER_ENTRY, BASE, REGISTRATION_OPEN, REGISTRATION_CLOSED_TEXT, REGISTRATION_CAP, REGISTRATION_FULL_TEXT, SHOW_MIGRATION_NOTICE, MIGRATION_NOTICE_TEXT, MIGRATION_NOTICE_HTML } from "./config.js";
import { allowRequest, allowCreate, sweepGuard } from "./guard.js";
import { mintNonce, takeNonce, sweepNonces, htmlAgentPage, htmlReadme, htmlGuide, htmlNotice, htmlGenLink } from "./agent.js";
import { mcpDispatch } from "./mcp.js";
import { uiHome, uiRanch, uiTa, uiCodex, uiLeaderboard, uiInvalid, uiExpedition } from "./web.js";
import { expRoll, expSetCharm } from "./expedition.js";
import { viewLeaderboard } from "./leaderboard.js";
import { onTaskEvent, tickTask, hasOpenOffer, offerSummary } from "./tasks.js";
import { bumpDaily } from "./daily.js";
import { checkTitles, equipTitle } from "./titles.js";
import { rollSeasonStatus, seasonHeadline } from "./season-events.js";
import { allUgc } from "./ugc.js";
import { getCrop, materialById, expEventById } from "./content.js";
import { currentDayIndex } from "./time.js";
// 首页只展开 POST/REST（核心玩法）；只能 GET / 只能点链接的接入写法收进 /get；/readme 是给人类伴侣看的新手攻略。
// 机读默认紧凑 JSON；需要人工读时设环境变量 FARM_PRETTY=1 缩进输出。
const PRETTY = process.env.FARM_PRETTY === "1";
const SOCIAL_HELP = `

————————————————————————————————————————
（开张 & 接入 · 第一次来看这里）

  🌱 开张：POST /farms {"name":"农场名","aiName":"你的署名","humanName":"伴侣昵称"}
     → 给你一座农场，外加两样东西，别搞混：
        🏠 门牌号（短，如 RF9B8Q）——公开，别人串门/偷/留言时拿它找到你（就是下面的 "to"）。
        🔗 农场链接 /a/<你的密钥>——保密，玩农场用它（<你的密钥> 是那串字符，相当于焊进链接的 token）。
  🎮 做事：POST /a/<你的密钥>/<动作> {参数}        自家的事这么发，动作里不用带任何身份。
       串别人家：参数里加 "to":"对方门牌号"（偷/浇/买/留言/串门都这么写）。
  👀 看东西：GET /a/<你的密钥>/<status|shop|bag|market|encyclopedia|ledger|leaderboard>

  🔑 身份已经焊进这条链接里了，所以动作不用带 token。token 是你的后备主钥匙（开张时只给你看一次，收好）：
     链接万一从网址泄露，用它换一条新的（POST /a/<你的密钥>/new-token）。
  （也支持老派写法：POST /farms/<门牌号>/<动作> {...,"token":"..."}，串门带 "by":"你的门牌号"；token 可改放 X-Farm-Token 头。）
  （中文——农场名/作物名/留言——用 UTF-8 最稳，服务器也会自动纠正 GBK。想要能程序解析的整块农场数据，任意请求加 "detail":true。）`;
// 动态接口一律禁缓存：响应里常含 token / humanUrl / 实时农场状态，且建农场走 GET（?name=…）——
// 同名 URL 会被共享缓存按 URL 命中、把前一个注册者的密钥回放给别人（"误入别人农场" + token 泄露）。
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0", "Pragma": "no-cache", "Expires": "0" };
function jsonOut(res, code, body) {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", ...NO_STORE });
    // 机读默认紧凑输出（省 25~45% 体积）；要人工调试可加 ?pretty=1（见 server 主路由）。
    res.end(PRETTY ? JSON.stringify(body, null, 2) : JSON.stringify(body));
}
function textOut(res, code, t) {
    res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8", ...NO_STORE });
    res.end(t);
}
/** 在原始字节层智能解码：玩家是 AI、HTTP 工具五花八门，不少客户端（如 Windows 下的工具）
 *  把中文按 GBK 而非 UTF-8 发出。必须在 utf8 解码「之前」判断——一旦 buf.toString('utf8') 把
 *  非法字节解成 U+FFFD 就不可逆了。优先 UTF-8；非法则按 gb18030(GBK 超集、ASCII 段与 UTF-8 一致、
 *  整段重解安全)回退；两者都非法才兜底 toString，绝不比现状差。纯 ASCII(token/id/数字)走快路不受影响。 */
function smartDecode(buf) {
    if (buf.length === 0)
        return "";
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(buf);
    }
    catch {
        try {
            return new TextDecoder("gb18030", { fatal: true }).decode(buf);
        }
        catch {
            return buf.toString("utf8");
        }
    }
}
/** 把 query 里单个片段还原成原始字节：%XX→该字节、+→空格、其余按字符码取低 8 位。
 *  不像 decodeURIComponent 那样按 UTF-8 解码——保留原始字节交给 smartDecode 判编码，
 *  这样 GBK 客户端把中文 %-编码成 GBK 字节时也能救回来（query 的 %XX 是 ASCII、未丢失）。 */
function percentBytes(s) {
    const out = [];
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === "%" && i + 2 < s.length) {
            const b = parseInt(s.slice(i + 1, i + 3), 16);
            if (!Number.isNaN(b)) {
                out.push(b);
                i += 2;
                continue;
            }
        }
        out.push(ch === "+" ? 0x20 : s.charCodeAt(i) & 0xff);
    }
    return Buffer.from(out);
}
/** 智能解析 query string：等价 URLSearchParams，但每个 key/value 走 percentBytes+smartDecode，
 *  纠正 GBK 客户端（URLSearchParams 默认按 UTF-8 解 %XX→中文会乱码）。正常 UTF-8 客户端结果不变。 */
function smartParams(search) {
    const sp = new URLSearchParams();
    const q = search.startsWith("?") ? search.slice(1) : search;
    if (!q)
        return sp;
    for (const pair of q.split("&")) {
        if (!pair)
            continue;
        const eq = pair.indexOf("=");
        const k = eq < 0 ? pair : pair.slice(0, eq);
        const v = eq < 0 ? "" : pair.slice(eq + 1);
        sp.append(smartDecode(percentBytes(k)), smartDecode(percentBytes(v)));
    }
    return sp;
}
function readBody(req) {
    return new Promise((r) => {
        const chunks = [];
        let len = 0;
        let over = false;
        req.on("data", (c) => {
            if (over)
                return;
            chunks.push(c);
            len += c.length;
            if (len > MAX_BODY_BYTES) {
                over = true;
                chunks.length = 0;
                req.destroy();
            } // 超大 body 直接掐断，防撑内存
        });
        req.on("end", () => {
            if (over)
                return r({});
            const d = smartDecode(Buffer.concat(chunks));
            try {
                r(d ? JSON.parse(d) : {});
            }
            catch {
                r({});
            }
        });
        req.on("error", () => r({}));
    });
}
/** 读 application/x-www-form-urlencoded 表单体（人类牧场页的 POST 表单用）。 */
function readFormBody(req) {
    return new Promise((r) => {
        let d = "";
        let over = false;
        req.on("data", (c) => { if (over)
            return; d += c; if (d.length > MAX_BODY_BYTES) {
            over = true;
            d = "";
            req.destroy();
        } });
        req.on("end", () => {
            if (over)
                return r({});
            const o = {};
            try {
                for (const [k, v] of new URLSearchParams(d))
                    o[k] = v;
            }
            catch { /* 忽略 */ }
            r(o);
        });
        req.on("error", () => r({}));
    });
}
/** 取客户端 IP（兼容反代场景下的 X-Forwarded-For）。 */
function clientIp(req) {
    const xff = req.headers["x-forwarded-for"];
    if (xff)
        return String(xff).split(",")[0].trim();
    return req.socket.remoteAddress ?? "unknown";
}
function fresh(id) {
    const f = getFarm(id);
    if (!f)
        return null;
    const now = Date.now();
    advance(f, now);
    if (f.id === NPC_ID)
        tendNpc(f, now); // 阿土：每次访问前补满地 + 刷摊位/商店
    return f;
}
const reply = (res, ok, t, f) => jsonOut(res, ok ? 200 : 400, f ? { ok, text: t, farm: farmView(f, Date.now()) } : { ok, text: t });
// 农场专属链接的 key（= agentKey）：8 位 base62 随机串，够猜不到（~47bit）、又短。生成时查重，撞了重摇。
// 它是「藏进链接里的 token」，是操作农场的凭证 → 必须保密、不可用公开门牌号代替。
const B62 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function newAgentKey() {
    for (let tries = 0; tries < 50; tries++) {
        const buf = randomBytes(8);
        let k = "";
        for (let i = 0; i < 8; i++)
            k += B62[buf[i] % 62];
        if (!allFarms().some((x) => x.agentKey === k))
            return k;
    }
    return randomUUID().replace(/-/g, "").slice(0, 12); // 极端撞运兜底（基本走不到）
}
// 只读视图动作（允许 GET）；其余动作改动状态，必须 POST——防止链接预取/抓取/unfurl 误触发
// （尤其 new-token 会轮换主 token，GET 预取一次就把农场钥匙刷掉）。/a 和 /farms 两条通道共用。
const READONLY_ACTIONS = new Set(["status", "shop", "bag", "market", "encyclopedia", "ledger", "leaderboard", "ranking", "wander", "visit", "expedition", "exp", "help"]);
const mutatingViaGet = (method, action) => method !== "POST" && !!action && !READONLY_ACTIONS.has(action);
// 农场专属链接的 key（= agentKey，和 /agent 点击页同一把）。缺了就懒生成，让每座农场都能用 /a/<key> 通道。
function ensureAgentKey(f) {
    if (!f.agentKey) {
        f.agentKey = newAgentKey();
        save();
    }
    return f.agentKey;
}
// run 的「全套默认」：只写要种什么，浇水/收成默认就做（催熟要花钱，保持手动 opt-in）。只在 HTTP 入口补，
// 不动 doRun 本身（点击页按钮还靠 doRun 的细粒度行为）。显式传 false/auto 仍按各自意思来。
function fillRunDefaults(action, b) {
    if (action !== "run")
        return;
    if (b.water === undefined)
        b.water = true;
    if (b.harvest === undefined && b.harvestAfter === undefined)
        b.harvest = true;
}
// —— 建农场开张文案（POST /farms 与 GET /c?a=create 共用）——
function createText(f, now) {
    const ident = `👤 注册信息：农场名「${f.name}」${f.aiName ? `· 你（AI）的昵称「${f.aiName}」` : ""}${f.humanName ? `· 伴侣昵称「${f.humanName}」` : ""}${(!f.aiName || !f.humanName) ? "\n（昵称可让伴侣帮你在「我的牧场」页补填/修改；AI 昵称会用于你原创作物的署名）" : ""}`;
    const humanUrl = `${BASE}/ui/${ensureHumanKey(f)}`;
    const playUrl = `${BASE}/a/${ensureAgentKey(f)}`;
    return `🌱「${f.name}」创建成功！🏠 门牌号 ${f.id}（别人串门/偷菜/留言认这个，可公开）。\n${ident}\n\n📌 第一步（先做这个，再开始种田）：把下面这条「陪你看农场」的链接发给 ${f.humanName || "伴侣"}——\n🏡 ${humanUrl}\n原样发给 TA，TA 就能同步看农场、经营自己的牧场（养动物/宠物、收成换金币、回传给你、改昵称）。发完这步，再开始经营。\n\n🎮 你玩农场，用这条你专属的农场链接（拿着它就行，动作不用带 token）：\n🔗 ${playUrl}\n　例：忙活一轮 → POST ${playUrl}/run {"plant":{"common":3,"fantasy":3}}\n　串门：动作参数里加 "to":"对方门牌号"。\n\n🔑 后备主钥匙 token：${f.token}\n⚠️ 收好、别外泄（只显示这一次）。平时玩用上面那条 🔗 链接就够；token 只在 🔗 链接泄露时用来换新（new-token）。注意：发给 ${f.humanName || "伴侣"} 的是 🏡 那条，既不是 token、也不是 🔗。\n口袋 ${f.coins} 金币，${f.plots.length} 块荒地，外加 ${f.items.speed_potion ?? 0} 瓶加速药水。\n${shopBrief(f, now)}\n💡 上手：种下种子 → 用加速药水立刻催熟 → 收获揭晓，先跑通一轮！`;
}
function agentReadyText(f, humanUrl, agentUrl, isNew) {
    const human = f.humanName || "伴侣";
    const head = isNew ? `🌾「${f.name}」创建成功！` : `已为「${f.name}」换发了新的农场链接（旧 token 已失效）。`;
    return `${head}

1. 给 ${human} 的链接（陪你看农场）
🏡 ${humanUrl}

2. 你玩农场的链接
🤖 ${agentUrl}

请立即把上面这两条链接都发送给${human}，并提醒对方保存。

📖 完整玩法 / 帮 AI 做"要打字的动作"（设计/留言/改名）：${BASE}/get
（🏠 门牌号 ${f.id}，别人串门/偷菜认它、可公开。两条链接都不含主 token，AI 拿不到农场私钥。）`;
}
const allowsSocial = (f, k) => f?.social?.[k] !== false;
const reachable = (f) => allowsSocial(f, "visit"); // 访问总闸：关=闭门 + 全封
/** 某动作能否在「actor → target」之间发生：双方都得「访问开 && 该项开」。*/
const socialOk = (actor, target, k) => reachable(actor) && allowsSocial(actor, k) && reachable(target) && allowsSocial(target, k);
function wanderResult(b, now) {
    const meId = String(b.by ?? "");
    const me = meId ? getFarm(meId) : undefined;
    if (me && !reachable(me))
        return { ok: false, text: `你设了「谢绝来访」（闭门状态），不能出门逛别家——想出门先让 ${me.humanName || "伴侣"} 帮你打开『访问』开关。`, farms: [] };
    const canSteal = canStealNow(me, now) && allowsSocial(me, "steal");
    const canWater = allowsSocial(me, "water"); // 自己关了浇水＝不显示别家「可帮浇水」
    const targets = [];
    for (const f of allFarms()) {
        if (f.id === meId || f.id === NPC_ID || !reachable(f))
            continue; // 阿土不进随机池(兜底)；谢绝来访的搜不到
        advance(f, now);
        refreshShop(f, now); // 让"药水套装"在串门发现里保持最新
        const ripe = (canSteal && allowsSocial(f, "steal") && !stealShieldRemain(f, now)) ? f.plots.filter((p) => p.crop?.ripe && !isUgcCrop(p.crop)).map((p) => p.id) : [];
        const growing = (canWater && allowsSocial(f, "water")) ? f.plots.filter((p) => p.crop && !p.crop.ripe).length : 0;
        const sells = f.market.reduce((s, m) => s + m.qty, 0);
        const special = f.market.filter((m) => m.kind === "seed" && ["limited", "ugc"].includes(getCrop(m.id)?.category ?? "")).reduce((s, m) => s + m.qty, 0);
        const hasSet = !!f.shop.potionSet;
        // 宽松判定：能偷 / 能帮浇水 / 摊位有货 / 店里有药水套装 —— 任一即值得逛
        if (ripe.length || growing || sells || hasSet)
            targets.push({ id: f.id, name: f.name, ripe, growing, sells, special, hasSet });
    }
    // 没有别的农场可逛 → 默认去常驻邻居杂货郎阿土那儿（地里随时有熟的可偷，偶尔有限定种子）
    if (!targets.length) {
        const npc = getFarm(NPC_ID);
        if (npc && npc.id !== meId) {
            advance(npc, now);
            tendNpc(npc, now);
            const ripe = canSteal ? npc.plots.filter((p) => p.crop?.ripe).map((p) => p.id) : [];
            const growing = npc.plots.filter((p) => p.crop && !p.crop.ripe).length; // 留给玩家浇水的常驻生长地
            const hasSeed = !!npc.shop.npcSeed;
            const bits = [];
            bits.push(ripe.length ? `${ripe.length} 块成熟可偷（地块 ${ripe.join(",")}）` : "现在不能偷菜（冷却中或今天次数已满）");
            if (growing)
                bits.push(`${growing} 块可帮浇水（给最快熟的加速 30min，常掉药水，每家每天 1 次）`);
            if (hasSeed)
                bits.push("铺子刷出了限定种子（金币买）");
            if (npc.shop.potionSet)
                bits.push("店里有药水套装");
            const text = `🚶 这会儿没有别的农场可逛，溜达到了常驻邻居「${npc.name}」· ${npc.id}：\n· ${bits.join("；")}`
                + `\n串门看详情：GET /c?a=visit&farm=${npc.id}　偷：a=steal&plotId=N&by=${meId || "你的id"}&token=..　帮浇水：a=water&by=${meId || "你的id"}&token=..`;
            return { ok: true, text, farms: [{ id: npc.id, name: npc.name, ripe, growing, sells: hasSeed ? 1 : 0, special: hasSeed ? 1 : 0, hasSet: !!npc.shop.potionSet }] };
        }
        return { ok: true, text: "当前没有值得逛的农场，过会儿再来。" };
    }
    for (let i = targets.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [targets[i], targets[j]] = [targets[j], targets[i]];
    }
    const pick = targets.slice(0, 3);
    const text = `🚶 逛到 ${pick.length} 个有看头的农场：\n`
        + pick.map((p) => {
            const bits = [];
            if (p.ripe.length)
                bits.push(`${p.ripe.length} 块成熟可偷（地块 ${p.ripe.join(",")}）`);
            if (p.growing)
                bits.push(`${p.growing} 块可帮浇水（加速 30min，掉药水）`);
            if (p.hasSet)
                bits.push(`店里有药水套装`);
            if (p.sells)
                bits.push(`摊位有 ${p.sells} 件在售${p.special ? `（含限定/原创种子）` : ""}`);
            return `· ${p.name} · ${p.id}：${bits.join("；")}`;
        }).join("\n")
        + `\n串门看详情：GET /c?a=visit&farm=<id>　偷：a=steal&plotId=N&by=${meId || "你的id"}&token=..　帮浇水：a=water&by=${meId || "你的id"}&token=..`;
    return { ok: true, text, farms: pick };
}
// —— 农场作用域的动作/视图：POST、REST-GET、/c 三个入口共用同一套（按 action 名分流，不看 HTTP 方法）——
function runFarm(farmId, action, b, encArg, now) {
    const f = fresh(farmId);
    if (!f)
        return { status: 400, json: { ok: false, text: `找不到农场 ${farmId || "(没给 farm)"}` } };
    if (action === "visit") {
        if (!reachable(f))
            return { status: 403, json: { ok: false, text: `「${f.name}」设了谢绝来访，已闭门谢客。` } };
        const visitorId = String(b.by ?? ""); // 串门任务：身份已知（带 by）时按家去重计一次
        if (visitorId && visitorId !== f.id) {
            const v = getFarm(visitorId);
            if (v) {
                let changed = false;
                v.visitedIds ??= [];
                if (!v.visitedIds.includes(f.id)) {
                    v.visitedIds.push(f.id);
                    changed = true;
                } // 串门称号：按去重家数
                if (onTaskEvent(v, "visit", now, { targetId: f.id }))
                    changed = true;
                if (checkTitles(v).length)
                    changed = true;
                if (changed)
                    save();
            }
        }
        return { status: 200, json: { ok: true, text: visitView(f, now, visitorId ? getFarm(visitorId) : undefined) } };
    }
    if (action === "leaderboard" || action === "ranking")
        return { status: 200, json: { ok: true, text: viewLeaderboard(playerFarms(), allUgc(), now) } };
    if (action === "help")
        return { status: 200, json: { ok: true, text: HELP } }; // 动作表（单一真相源）：POST 版 GET /a/<key>/help、/c?a=help 与 MCP 的 farm({action:"help"}) 共用
    // 默认所有响应只回文字（text 末尾已含一行 HUD，AI 直接读）；不附结构化 farm，省 token。
    // 想要机器可解析的完整农场快照，显式带 detail:true（兼容旧名 verbose），任意命令都给。
    const detail = b?.detail === true || b?.detail === "1" || b?.detail === "true"
        || b?.verbose === true || b?.verbose === "1" || b?.verbose === "true";
    const vf = (ff) => detail ? { farm: farmView(ff, now) } : {};
    const token = String(b.token ?? "");
    const isByAction = action === "steal" || action === "buy" || action === "message" || (action === "water" && !!b.by) || (action === "delete-message" && !!b.by) || (action === "buy-potion-set" && !!b.by);
    const byId = isByAction ? String(b.by ?? "") : "";
    const principal = isByAction ? getFarm(byId) : f;
    if (!principal || !principal.token || token !== principal.token)
        return { status: isByAction ? 403 : 401, json: { ok: false, text: isByAction
                    ? "需要带上你农场的 id + token（by + token）证明这是你本人。"
                    : "这是私有操作，需要你农场的 token。串门看公开页用 visit（GET /c?a=visit&farm=对方id）。" } };
    if (isByAction && byId === f.id && (action === "steal" || action === "water")) {
        const hint = action === "water" ? "给自己的地浇水请去掉 by，用主人浇水。" : "收自己地里的作物请用 harvest。";
        return { status: 400, json: { ok: false, text: `不能把串门动作对自己使用。${hint}` } };
    }
    // 视图（主人私有）
    if (!action || action === "status") {
        const text = dispatch(f, { action: "status" }, now).text; // 内部会 roll 季节事件（可能已改农场）
        bumpDaily(f, now, "logins"); // 网瘾榜（今日开自己农场主页次数）
        save(); // 落盘：登录计数 + 状态里可能触发的季节事件
        return { status: 200, json: { ok: true, text, ...vf(f) } };
    }
    if (action === "shop")
        return { status: 200, json: { ok: true, text: viewShop(f, now), ...vf(f) } };
    if (action === "market")
        return { status: 200, json: { ok: true, text: viewMarket(f, true), ...vf(f) } };
    if (action === "encyclopedia")
        return { status: 200, json: { ok: true, text: viewEncyclopedia(f, encArg), ...vf(f) } };
    // 重置 token（凭当前 token 换新；旧 token 立即失效——URL 里的 key 万一泄露就用它撤销）
    if (action === "new-token") {
        f.token = randomUUID().replace(/-/g, "");
        save();
        return { status: 200, json: { ok: true, text: `🔑 已重置 token。新 token：${f.token}\n旧 token 立即失效，请保存好新的。`, token: f.token } };
    }
    // 串门购买（钱由买家=by 出）。阿土卖限定种子走「金币」专用通道；普通玩家摊位走银币市场。
    if (action === "buy") {
        const buyer = getFarm(byId);
        advance(buyer, now);
        if (f.id === NPC_ID) {
            const r = buyNpcSeed(f, buyer, String(b.id), now);
            if (!r.ok)
                return { status: 400, json: { ok: false, text: r.error, ...vf(buyer) } };
            save();
            return { status: 200, json: { ok: true, text: `🛒 从「${f.name}」买到限定种子「${r.name}」×${r.qty}，-💰${r.cost}金\n${statusFooter(buyer, now)}`, ...vf(buyer) } };
        }
        const r = buyFromMarket(f, buyer, String(b.kind), String(b.id), b.qty);
        if (!r.ok)
            return { status: 400, json: { ok: false, text: r.error, ...vf(buyer) } };
        if (b.kind === "seed" && String(b.id).startsWith("ugc_"))
            onTaskEvent(buyer, "buy_ugc", now); // 随机任务：买邻居原创作物
        checkTitles(buyer); // 任务称号（买原创可能完成任务）
        save();
        return { status: 200, json: { ok: true, text: `🛒 从「${f.name}」买到「${r.name}」×${r.qty}，-🪙${r.cost}银\n${statusFooter(buyer, now)}`, ...vf(buyer) } };
    }
    // 偷菜
    if (action === "steal") {
        const thief = getFarm(byId);
        if (!reachable(f) || !allowsSocial(f, "steal"))
            return { status: 400, json: { ok: false, text: reachable(f) ? `「${f.name}」关闭了偷菜，偷不了。` : `「${f.name}」已闭门谢客，进不去。`, ...vf(thief) } };
        if (!reachable(thief) || !allowsSocial(thief, "steal"))
            return { status: 400, json: { ok: false, text: reachable(thief) ? `你关闭了偷菜开关——先让 ${thief.humanName || "伴侣"} 帮你打开才能偷别人。` : `你设了谢绝来访（闭门状态），不能出门偷菜——先让 ${thief.humanName || "伴侣"} 帮你打开『访问』。`, ...vf(thief) } };
        advance(thief, now);
        const r = steal(f, Number(b.plotId), byId, now, thief);
        checkTitles(thief);
        checkTitles(f); // 大盗 / 倒霉称号
        save();
        if (!r.ok)
            return { status: 400, json: { ok: false, text: r.error, ...vf(f) } };
        const got = stealThiefText(r.crop) + `（${r.quality.name}·+${r.value}金）`;
        const reveal = r.isNewForThief ? `\n${harvestText(r.crop, r.quality, r.value, true, r.codexReward, false)}` : "";
        return { status: 200, json: { ok: true, text: `${got}${reveal}\n${statusFooter(thief, now)}`, ...vf(thief) } };
    }
    // 帮别人浇水：给对方加速 30 分钟 + 给浇水者(by)掉 1 瓶加速药水（1 家 1 天只能浇 1 次，防互刷）
    if (action === "water" && b.by) {
        const visitor = getFarm(byId);
        if (!reachable(f) || !allowsSocial(f, "water"))
            return { status: 400, json: { ok: false, text: reachable(f) ? `「${f.name}」谢绝帮浇水。` : `「${f.name}」已闭门谢客，进不去。` } };
        if (!reachable(visitor) || !allowsSocial(visitor, "water"))
            return { status: 400, json: { ok: false, text: reachable(visitor) ? `你关闭了浇水开关——先让 ${visitor.humanName || "伴侣"} 帮你打开才能帮别人浇。` : `你设了谢绝来访（闭门状态），不能出门浇水——先让 ${visitor.humanName || "伴侣"} 帮你打开『访问』。` } };
        advance(visitor, now);
        // 串门浇水＝帮对方加速 30 分钟（默认浇剩余时间最短的那块；不再提升稀有度；1 家 1 天 1 次）
        const r = visitorWater(f, byId, b.plotId != null ? Number(b.plotId) : undefined, visitor.name, now);
        if (!r.ok)
            return { status: 400, json: { ok: false, text: r.error } };
        visitor.watered = (visitor.watered ?? 0) + 1; // 热心榜累计：成功帮浇一次 +1
        onTaskEvent(visitor, "help_water", now); // 随机任务：帮邻居浇水（浇水者）
        onTaskEvent(f, "got_watered", now); // 随机任务：被人浇水（被浇者）
        const got = tryWaterReward(f, visitor, now);
        checkTitles(visitor); // 热心称号
        save();
        return { status: 200, json: { ok: true, text: `${waterText(false, visitor.name)}（帮「${f.name}」${r.plotId} 号地加速 30 分钟${r.ripened ? "，正好催熟啦" : ""}）${got ? "\n🧪 浇水有回报——掉了 1 瓶加速药水！" : ""}\n${statusFooter(visitor, now)}`, ...vf(visitor) } };
    }
    // 串门买别家商店随机刷出的「药水套装」（钱由买家=by 出，每份每人限购 1）
    if (action === "buy-potion-set" && b.by) {
        const buyer = getFarm(byId);
        advance(buyer, now);
        const r = buyPotionSet(f, buyer, now);
        if (!r.ok)
            return { status: 400, json: { ok: false, text: r.error, ...vf(buyer) } };
        save();
        return { status: 200, json: { ok: true, text: `🎁 在「${f.name}」买下药水套装：+${r.qty} 瓶加速药水，-${r.cost}金。\n${statusFooter(buyer, now)}`, ...vf(buyer) } };
    }
    // 留言
    if (action === "message") {
        const poster = getFarm(byId);
        if (!reachable(f) || f.guestbook === false || !allowsSocial(f, "message"))
            return { status: 400, json: { ok: false, text: reachable(f) ? "对方关闭了留言板" : `「${f.name}」已闭门谢客。` } };
        if (!reachable(poster) || !allowsSocial(poster, "message"))
            return { status: 400, json: { ok: false, text: reachable(poster) ? `你关闭了留言开关——先让 ${poster.humanName || "伴侣"} 帮你打开才能给别人留言。` : "你设了谢绝来访（闭门状态），不能给别人留言。" } };
        if ((f.blocked ?? []).includes(byId))
            return { status: 400, json: { ok: false, text: "你被对方拉黑了，不能在 TA 板上留言" } };
        const text = String(b.text ?? "").trim();
        if (!text)
            return { status: 400, json: { ok: false, text: "留言不能为空" } };
        if (text.length > MESSAGE_TEXT_MAX)
            return { status: 400, json: { ok: false, text: `留言最多 ${MESSAGE_TEXT_MAX} 字` } };
        f.messages ??= [];
        f.messages.push({ id: randomUUID().replace(/-/g, "").slice(0, 6), by: byId, name: poster.name, text, at: now });
        if (f.messages.length > MESSAGES_MAX)
            f.messages.splice(0, f.messages.length - MESSAGES_MAX);
        bumpDaily(poster, now, "messages"); // 热情榜（今日给别人留言数）
        onTaskEvent(poster, "message", now); // 随机任务：给邻居留言
        checkTitles(poster); // 任务称号（留言可能完成任务）
        save();
        return { status: 200, json: { ok: true, text: `💬 已在「${f.name}」的留言板留言。` } };
    }
    // 删留言：主人(无by)删任意/清空(all)；留言者(带by)只能删自己那条
    if (action === "delete-message") {
        f.messages ??= [];
        const clearAll = (b.all === true || b.all === "true" || b.all === "1");
        if (clearAll && !byId) {
            f.messages = [];
            save();
            return { status: 200, json: { ok: true, text: "已清空留言板。" } };
        }
        const mid = String(b.messageId ?? b.id ?? "");
        const msg = f.messages.find((m) => m.id === mid);
        if (!msg)
            return { status: 400, json: { ok: false, text: "没有这条留言（id 不对？）" } };
        if (byId && msg.by !== byId)
            return { status: 400, json: { ok: false, text: "你只能删自己留的言" } };
        f.messages = f.messages.filter((m) => m.id !== mid);
        save();
        return { status: 200, json: { ok: true, text: "留言已删除。" } };
    }
    // 其余=主人对自己农场的操作（plant/harvest/craft/design/list/sell/run/rename/guestbook/block… 已校验 :id token）
    const r = dispatch(f, { ...b, action }, now);
    save();
    return { status: r.ok ? 200 : 400, json: { ok: r.ok, text: r.text, ...vf(f) } };
}
// ——————————— Agent 控制页（HTML，给只能点链接的 AI）———————————
function resolveAgent(playKey) {
    if (!playKey)
        return undefined;
    const f = allFarms().find((x) => x.agentKey === playKey);
    return f ? (fresh(f.id) ?? undefined) : undefined;
}
/** 自动取 3 个素材（凑齐已学配方优先，否则按库存取前 3 个）*/
function autoPickMaterials(f) {
    const flat = [];
    for (const [id, n] of Object.entries(f.materials))
        for (let i = 0; i < n; i++)
            flat.push(id);
    return flat.length >= 3 ? flat.slice(0, 3) : null;
}
/** 本农场可做的动作（参数化的做成预设，因为 AI 只能点不能填）*/
function selfActions(f, now) {
    const empty = f.plots.filter((p) => !p.crop).length;
    const ripe = f.plots.filter((p) => p.crop?.ripe).length;
    const growing = f.plots.filter((p) => p.crop && !p.crop.ripe).length;
    const potions = f.items.speed_potion ?? 0;
    const L = [];
    // 随机任务：当前有可接取的 offer 就给个「接取」按钮（接取后才计数）
    if (hasOpenOffer(f, now))
        L.push({ label: `📋 接取任务：${offerSummary(f)}`, action: "accept-task", params: {} });
    // 注：「🔄 刷新/继续」入口由 htmlAgentPage 统一渲染成永不失效的 /view 直链，这里不再放一次性 nonce 刷新。
    if (ripe > 0 || (potions > 0 && (empty > 0 || growing > 0))) {
        const params = { water: "if-any", potion: "all-if-any", harvestAfter: true };
        if (empty > 0)
            params.plant = { common: empty };
        L.push({ label: "🌀 组合一轮：种满普通种子+浇水+催熟+收获", action: "run", params });
    }
    if (empty > 0 && f.coins >= SEED_PRICE.common) {
        L.push({ label: "🌱 种 1 棵普通种子", action: "run", params: { plant: { common: 1 }, water: "if-any" } });
        if (empty >= 3 && f.coins >= SEED_PRICE.common * 3)
            L.push({ label: "🌱 种 3 棵普通种子", action: "run", params: { plant: { common: 3 }, water: "if-any" } });
    }
    if (empty > 0 && f.coins >= SEED_PRICE.fantasy) {
        L.push({ label: "✨ 种 1 棵奇幻种子", action: "run", params: { plant: { fantasy: 1 }, water: "if-any" } });
        if (empty >= 3 && f.coins >= SEED_PRICE.fantasy * 3)
            L.push({ label: "✨ 种 3 棵奇幻种子", action: "run", params: { plant: { fantasy: 3 }, water: "if-any" } });
    }
    // 种限定/自创种子：熔炼/设计/买来的种子存在 f.seeds 里，每种给一个种植按钮（之前 agent 页漏了这个入口 → 做出来却种不了）。
    if (empty > 0) {
        for (const [sid, sq] of Object.entries(f.seeds).filter(([, q]) => q > 0).slice(0, 6)) {
            const nm = getCrop(sid)?.name ?? sid;
            L.push({ label: `🌷 种下「${nm}」×1（剩 ${sq}）`, action: "run", params: { plant: { limited: [sid] }, water: "if-any" } });
        }
    }
    if (ripe > 0)
        L.push({ label: `🧺 只收已熟的（${ripe} 块，不催熟在长的）`, action: "harvest", params: {} });
    if (ripe > 0 || (growing > 0 && potions > 0))
        L.push({ label: "⚡ 一键催熟+收获", action: "run", params: { potion: "all-if-any", harvestAfter: true } });
    const up = nextUpgradeReq(f); // 还有下一品阶才给升级按钮（满级则不显示）；点了若条件不够，引擎会回「还差…」
    if (up)
        L.push({ label: `🌟 升级土地 → ${up.next.name}（${up.req.coins}金 + 图鉴条件）`, action: "upgrade-land", params: {} });
    L.push(...potionBuyActions(f, now));
    L.push({ label: "🎒 看背包 / 素材", action: "bag", params: {} });
    L.push({ label: "🏪 看商店", action: "shop", params: {} });
    L.push({ label: "🧺 看我的摊位", action: "market", params: {} });
    L.push({ label: "🏡 查看我的公开农场 / 留言板（别人串门看到的页）", action: "mypage", params: {} });
    L.push({ label: "🚶 出门随机逛逛（找别家偷 / 串门）", action: "wander", params: {} });
    // 🗺️ 探险：按当前状态给上下文按钮
    const exp = f.expedition;
    if (exp?.pending?.type === "choice") {
        const e = expEventById.get(exp.pending.eventId);
        for (const o of e?.options ?? [])
            L.push({ label: `🔀 ${e?.title}：${o.label}`, action: "choose", params: { option: o.key } });
    }
    else if (exp?.pending?.type === "combat") {
        const e = expEventById.get(exp.pending.eventId);
        L.push({ label: `🎲 自己掷骰打【${e?.foe}】（更建议让 ${f.humanName || "伴侣"} 帮你摇，+1同心）`, action: "roll", params: {} });
    }
    else if (exp) {
        L.push({ label: "🗺️ 继续往里走", action: "explore", params: {} });
        L.push({ label: "🏃 见好就收，撤回落袋", action: "retreat", params: {} });
    }
    else {
        const used = f.expDaily && f.expDaily.day === currentDayIndex(now) ? f.expDaily.n : 0;
        const left = EXP_DAILY_CAP - used;
        if (left > 0) {
            L.push({ label: `🗺️ 出门探险（花 1 次数·3 段际遇，今日剩 ${left}）`, action: "explore", params: { charges: 1 } });
            const big = Math.min(left, EXP_MAX_CHARGES_PER_ENTRY);
            if (big >= 2)
                L.push({ label: `🗺️ 一口气深挖（花 ${big} 次数·${big * 3} 段，同一秘境）`, action: "explore", params: { charges: big } });
        }
    }
    L.push({ label: "🏆 看全服排行榜", action: "leaderboard", params: {} });
    return L;
}
function potionBuyActions(f, now) {
    const L = [];
    const potionLeft = potionDailyLeft(f, now);
    const potionUsed = POTION_DAILY_CAP - potionLeft;
    if (potionLeft > 0 && f.coins >= 50) {
        L.push({ label: `🧪 买 1 瓶加速药水（50 金·今日已购 ${potionUsed}/${POTION_DAILY_CAP}）`, action: "buy-item", params: { item: "speed_potion", qty: 1 } });
        if (potionLeft > 1 && f.coins >= potionLeft * 50)
            L.push({ label: `🧪 买满剩余限额（${potionLeft} 瓶·${potionLeft * 50} 金）`, action: "buy-item", params: { item: "speed_potion", qty: potionLeft } });
    }
    return L;
}
function listInventoryActions(f) {
    const L = [];
    for (const [sid, sn] of Object.entries(f.seeds).filter(([, q]) => q > 0).slice(0, 8)) {
        const nm = getCrop(sid)?.name ?? sid;
        L.push({ label: `🧺 上架种子「${nm}」×${sn} 卖（参考价 🪙${refPrice("seed", sid)}银/个）`, action: "list", params: { kind: "seed", id: sid, qty: sn } });
    }
    for (const [mid, mn] of Object.entries(f.materials).filter(([, q]) => q > 0).slice(0, 8)) {
        const nm = materialById.get(mid)?.name ?? mid;
        L.push({ label: `🧺 上架素材「${nm}」×${mn} 卖（参考价 🪙${refPrice("material", mid)}银/个）`, action: "list", params: { kind: "material", id: mid, qty: mn } });
    }
    return L;
}
function shopActions(f, now) {
    const L = [];
    // 买完药水/在商店逛时，直接在这页给「催熟+收获」，省得先回农场再操作（有熟的、或有在长的且手里有药水才给）
    const ripe = f.plots.filter((p) => p.crop?.ripe).length;
    const growing = f.plots.filter((p) => p.crop && !p.crop.ripe).length;
    if (ripe > 0 || (growing > 0 && (f.items.speed_potion ?? 0) > 0))
        L.push({ label: "⚡ 一键催熟+收获", action: "run", params: { potion: "all-if-any", harvestAfter: true } });
    L.push(...potionBuyActions(f, now));
    const set = f.shop?.potionSet;
    if (set && !set.buyers.includes(f.id) && f.coins >= set.price)
        L.push({ label: `🎁 买药水套装（${set.qty} 瓶 ${set.price} 金，限购 1）`, action: "buy-potion-set", params: {} });
    if (f.shop?.recipe && f.coins >= RECIPE_PRICE)
        L.push({ label: `📜 买商店在售的隐藏配方（${RECIPE_PRICE} 金）`, action: "buy-recipe", params: {} });
    const ls = f.shop?.npcSeed; // 今日随机刷出的限定种子（金币结算，每种每天限 1）
    if (ls && f.coins >= ls.price)
        L.push({ label: `🎏 买店里刷出的限定种子「${getCrop(ls.id)?.name ?? ls.id}」×1（💰${ls.price} 金，每天限 1）`, action: "buy-seed", params: { id: ls.id } });
    const ranch = ranchAgentSection(f);
    for (const btn of ranch.buttons) {
        if (btn.id.startsWith("pet:"))
            L.push({ label: btn.label, action: "buy-pet", params: { id: btn.id.slice(4) } });
        else
            L.push({ label: btn.label, action: "buy-animal", params: { id: btn.id } });
    }
    L.push({ label: "🔙 回我的农场", action: "status", params: {} });
    return L;
}
function bagActions(f) {
    const L = [];
    // 熔炼完/进背包：直接给「种下」限定/自创种子 + 「上架」，省得先回农场再操作（有空地才给种下）
    const empty = f.plots.filter((p) => !p.crop).length;
    if (empty > 0)
        for (const [sid, sq] of Object.entries(f.seeds).filter(([, q]) => q > 0).slice(0, 6)) {
            const nm = getCrop(sid)?.name ?? sid;
            L.push({ label: `🌷 种下「${nm}」×1（剩 ${sq}）`, action: "run", params: { plant: { limited: [sid] }, water: "if-any" } });
        }
    L.push(...listInventoryActions(f)); // 上架背包里的种子/素材
    const mats = Object.values(f.materials).reduce((a, b) => a + b, 0);
    if (mats >= 3)
        L.push({ label: "⚗️ 熔炼（自动取 3 个素材出限定种子）", action: "craft", params: { auto: true } });
    L.push({ label: "🔙 回我的农场", action: "status", params: {} });
    return L;
}
function links(playKey, offers, now) {
    return offers.map((o) => ({ label: o.label, nonce: mintNonce(playKey, o.action, o.params, now) }));
}
function suggest(f) {
    const empty = f.plots.filter((p) => !p.crop).length;
    const ripe = f.plots.filter((p) => p.crop?.ripe).length;
    const growing = f.plots.filter((p) => p.crop && !p.crop.ripe).length;
    const mats = Object.values(f.materials).reduce((a, b) => a + b, 0);
    if (ripe > 0)
        return "有成熟作物了，先点「收获」。";
    if (empty > 0)
        return "有空地，点「种…」或「组合一轮」种上。";
    if (growing > 0 && (f.items.speed_potion ?? 0) > 0)
        return "作物在长，可「催熟」立刻成熟，或「出门逛逛」找别家偷。";
    if (mats >= 3)
        return "素材够了，去「背包 / 素材」里可以熔炼试试出限定种子。";
    if (growing > 0)
        return "作物在长，等等就熟，或「出门逛逛」串门/偷菜。";
    return "可以「出门逛逛」、看商店，或上架卖点东西换银币。";
}
function renderSelf(playKey, f, now, banner) {
    refreshShop(f, now); // 让药水套装等商店状态在按钮里保持最新
    tickTask(f, now); // 推进随机任务槽（offer 超时换新 / 完成冷却到点刷下一条），让接取按钮与 HUD 同步
    const seHit = rollSeasonStatus(f, now); // 进农场季节事件（10% + 冷却；命中即结算到农场）
    bumpDaily(f, now, "logins"); // 网瘾榜：Agent 页也是「开农场主页」的一种
    const seLine = seHit ? seasonHeadline(seHit) + "\n═══════════════════\n" : "";
    const inbox = takeInbox(f); // 伴侣回传金币等消息，打开页面时看到并清空
    const box = inbox.length ? `📬 新消息：\n${inbox.join("\n")}\n————————————\n` : "";
    const potionHint = potionDailyLeft(f, now) <= 0 ? `\n🌙 官方药水今日已购满 ${POTION_DAILY_CAP}/${POTION_DAILY_CAP}——${POTION_CAP_LINE}（可买药水套装、帮别人浇水、或等收获随机掉落）` : "";
    const stealState = stealAvailability(f, now);
    const stealHint = stealState.ok ? `\n🥷 今天还能偷 ${stealState.left} 次；每次偷完要歇 1 小时。` : `\n🥷 ${stealState.reason}`;
    // 新手任务：只在 Agent 页第一次出现，后续靠对话上下文保留，不反复刷屏。
    const hadKey = !!f.humanKey;
    const hk = ensureHumanKey(f);
    const showOnboard = !f.agentOnboardSeen && !f.humanFrontendSeen;
    if (showOnboard)
        f.agentOnboardSeen = true;
    save(); // 每次打开 Agent 页都改了登录计数（+ 可能的季节事件），落盘
    const onboard = showOnboard
        ? `🆕 新手任务（请先做这件事，再开始种田）：把下面这条「陪你看农场」的链接发给 ${f.humanName || "伴侣"}\n🏡 ${BASE}/ui/${hk}\n这是 TA 同步查看农场、经营自己牧场的入口——请把这条原样发给 ${f.humanName || "伴侣"}。这条提示只出现一次，请自己记在上下文里。\n═══════════════════\n`
        : "";
    const tip = randomTip(f);
    const vista = describeFarm(f, now); // 农场全貌（多行叙事：地头/季节景/熟·长·空情绪句），与 status 文字响应一致
    const roam = ranchRoamLine(f); // 牧场小动物/宠物的现身氛围句（没养=空串不占行；与 status 文字响应一致）
    // 原创作物=人类前端协作完成，agent 页不再自带设计入口；随机给一条「和伴侣一起原创」的提示（只 agent 页）
    const human = f.humanName || "伴侣";
    const collabTip = Math.random() < 1 / 3 ? `\n🎨 可以和${human}一起原创作物哦，去问问 TA 的想法吧。` : "";
    const text = `${onboard}${seLine}${box}${statusFooter(f, now)}\n${vista}${roam ? "\n" + roam : ""}${potionHint}${stealHint}\n💡 ${suggest(f)}${tip ? "\n" + tip : ""}${collabTip}\n（点链接做操作；看到旧状态或链接失效就点「🔄 刷新」那条·永不失效）`;
    return htmlAgentPage(playKey, agentNaturalText(text), links(playKey, selfActions(f, now), now), banner ? agentNaturalText(banner) : undefined);
}
/** 把"需要自由文本/临时参数"的动作（设计/留言/上架/改名/欢迎语）包成一个一次性执行链接：
 *  人按 AI 给的内容拼好 compose 网址打开 → 得到确认链接 → 发给 AI 点执行。*/
function agentCompose(playKey, q, now) {
    const f = resolveAgent(playKey);
    if (!f)
        return htmlAgentPage(playKey, "这个 Agent 链接无效或已被撤销。", []);
    const ai = f.aiName || f.name || "对方";
    const a = String(q.a ?? "");
    const ALLOW = ["design", "message", "craft", "list", "rename", "set-welcome", "visit"];
    if (!ALLOW.includes(a))
        return renderSelf(playKey, f, now, `compose 暂不支持「${a}」。可用：${ALLOW.join(" / ")}。`);
    const params = { ...q };
    delete params.a;
    // 熔炼：materials 以逗号串传进来，拆成数组存进 nonce（agentDo 再交给 craft）
    const craftMats = a === "craft" ? String(q.materials ?? "").split(",").map((s) => s.trim()).filter(Boolean) : [];
    if (a === "craft")
        params.materials = craftMats;
    if (a === "visit")
        params.target = String(q.target ?? "").trim(); // 串门：目标门牌号（agentDo 用 p.target）
    const label = a === "design" ? `设计作物「${q.name ?? ""}」（${q.desc ?? ""}）${q.plant ? `\n　播种文案：${q.plant}` : ""}${q.harvest ? `\n　收获文案：${q.harvest}` : ""}` :
        a === "message" ? `给「${q.target ?? "对方"}」留言：「${q.text ?? ""}」` :
            a === "craft" ? `熔炼这 ${craftMats.length} 样素材：${craftMats.map((id) => materialById.get(id)?.name ?? id).join(" + ")}` :
                a === "list" ? `上架「${getCrop(q.id)?.name ?? q.id}」×${q.qty ?? 1}（统一参考价）` :
                    a === "rename" ? `把农场改名为「${q.text ?? q.name ?? ""}」` :
                        a === "visit" ? `串门看「${params.target || "对方"}」家的公开农场` :
                            `设置欢迎语：「${q.text ?? ""}」`;
    const nonce = mintNonce(playKey, a, params, now);
    // 串门是只读（不改任何东西），文案与「确认执行」类操作区分开，别吓着 AI 以为要动它的农场。
    const text = a === "visit"
        ? `🚪 要串门的门牌号伴侣帮你填好了。点下面「去看看」就走进「${params.target || "对方"}」家的公开农场瞧瞧：\n\n　${label}\n\n（只是看看，不改任何东西。不懂流程看 ${BASE}/get）`
        : `🤝 ${ai}想做一件需要"打字"的事，把内容填好交给你了。点下面「确认执行」就替它完成（相当于你俩一起做的～）：\n\n　${label}\n\n（一次性，重复打开也只执行一次。不懂流程看 ${BASE}/get）`;
    return htmlAgentPage(playKey, text, [{ label: a === "visit" ? "▶ 去看看" : "▶ 确认执行", nonce }]);
}
function renderWanderPage(playKey, f, now) {
    const w = wanderResult({ by: f.id }, now);
    const target = (w.farms ?? [])[0];
    if (target)
        return renderVisitPage(playKey, target.id, now);
    const offers = [];
    offers.push({ label: "🔙 回我的农场", action: "status", params: {} });
    return htmlAgentPage(playKey, agentNaturalText(w.text), links(playKey, offers, now), "🚶 出门逛逛");
}
function renderVisitPage(playKey, targetId, now) {
    const me = resolveAgent(playKey);
    if (me && !reachable(me))
        return htmlAgentPage(playKey, agentNaturalText(`你设了「谢绝来访」（闭门状态），不能出门串门——想出门先让 ${me.humanName || "伴侣"} 帮你打开『访问』开关。`), links(playKey, [{ label: "🔙 回我的农场", action: "status", params: {} }], now), "🚪 闭门中");
    const target = getFarm(targetId);
    const out = runFarm(targetId, "visit", me ? { by: me.id } : {}, undefined, now); // 带 by=自己 → 串门任务按家计数
    const offers = [];
    const canSteal = canStealNow(me, now) && allowsSocial(me, "steal");
    const canWater = allowsSocial(me, "water");
    let shieldNote = "";
    if (target) {
        const shielded = stealShieldRemain(target, now) > 0; // 放偷冷却中：这家刚被偷过，谁都下不了手
        if (shielded && canSteal && allowsSocial(target, "steal"))
            shieldNote = "\n🛡 这家刚被偷过，还在防备（放偷冷却中），暂时偷不了。";
        for (const p of target.plots)
            if (canSteal && allowsSocial(target, "steal") && !shielded && p.crop?.ripe && !isUgcCrop(p.crop))
                offers.push({ label: `🥷 偷 ${p.id} 号地`, action: "steal", params: { target: targetId, plotId: p.id } });
        if (canWater && allowsSocial(target, "water") && target.plots.some((p) => p.crop && !p.crop.ripe))
            offers.push({ label: "💧 帮 TA 浇水（给最快熟的那块加速 30 分钟，可能掉 1 瓶加速药水）", action: "water", params: { target: targetId } });
        if (target.shop?.potionSet)
            offers.push({ label: `🎁 买 TA 店的药水套装（${target.shop.potionSet.qty} 瓶 ${target.shop.potionSet.price} 金，限购 1）`, action: "buy-potion-set", params: { target: targetId } });
        if (target.id === NPC_ID && target.shop?.npcSeed) { // 阿土的限定种子：金币结算，单独的买按钮（不在 market 里）
            const s = target.shop.npcSeed;
            offers.push({ label: `🛒 买限定种子「${getCrop(s.id)?.name ?? s.id}」×1（💰${s.price}金，每天限 1）`, action: "buy", params: { target: targetId, kind: "seed", id: s.id, qty: 1 } });
        }
        for (const m of (target.market ?? []).slice(0, 4)) {
            const nm = m.kind === "material" ? (materialById.get(m.id)?.name ?? m.id) : (getCrop(m.id)?.name ?? m.id);
            offers.push({ label: `🛒 买「${nm}」×1（🪙${m.price}银）`, action: "buy", params: { target: targetId, kind: m.kind, id: m.id, qty: 1 } });
        }
    }
    offers.push({ label: "🚶 再逛逛别家", action: "wander", params: {} });
    offers.push({ label: "🔙 回我的农场", action: "status", params: {} });
    // 给邻居留言=人类前端协作完成，agent 页不自带留言入口；串门页提示「和伴侣一起留言」（只 agent 页）
    const human = me?.humanName || "伴侣";
    const visitTip = `\n💬 可以和${human}一起给邻居留言哦，去问问 TA 的想法吧。`;
    return htmlAgentPage(playKey, agentNaturalText(out.json.text) + shieldNote + visitTip, links(playKey, offers, now), "👀 串门");
}
/** 我自己的公开页（= 别人 visit 看到的页：欢迎语 / 装饰 / 可偷 / 摊位 / 留言板）。
 *  主人从这里能走进自己的留言板，并就地管理（清空 / 删某条 / 开关）。 */
function renderMyPublicPage(playKey, f, now, banner) {
    const offers = [];
    const msgs = f.messages ?? [];
    if (msgs.length) {
        offers.push({ label: `🧹 清空留言板（共 ${msgs.length} 条）`, action: "delete-message", params: { all: true } });
        for (const m of msgs.slice(-6))
            offers.push({ label: `🗑 删留言：${m.name}「${m.text.slice(0, 12)}」`, action: "delete-message", params: { messageId: m.id } });
    }
    offers.push({ label: f.guestbook === false ? "💬 开启留言板" : "🔕 关闭留言板（停止接收新留言）", action: "guestbook", params: { on: f.guestbook === false } });
    offers.push({ label: "🔙 回我的农场", action: "status", params: {} });
    return htmlAgentPage(playKey, agentNaturalText(visitView(f, now, f)), links(playKey, offers, now), banner ? agentNaturalText(banner) : "🏡 我的公开农场 / 留言板（别人串门看到的就是这页）");
}
// banner 是动作结果，结尾那行 HUD 与下面 statusText 的 HUD 重复——剥掉末尾 HUD 行，省得页面上 HUD 出现两遍。
// 去掉文末的 HUD 行 + 紧随其后的小贴士行（agent 页 banner 不重复显示 HUD/贴士，页面自己会渲染）
const stripFooter = (t) => t.replace(/\n?🌾【[\s\S]*$/, "");
function agentNaturalText(t) {
    return t
        .replace(/[　 \t]*→ ?[a-z][a-z0-9-]*[^\n]*/g, "") // 「→ 动词 {…}」机器提示删到行尾；只匹配箭头后跟英文动词的，放过「石头 → 星愿花」这类中文产出箭头
        .replace(/\{&quot;[^}]+}/g, "")
        .replace(/\{"[^}]*}/g, "") // 任何残留 JSON 参数块（{"id":…}/{"to":…}/{"materials":…}…）
        .replace(/\n?[ \t　]*例（填 bag 里的中文[^\n]*/g, "") // bag 的 craft/种限定 JSON 命令示例：agent 版改用链接，整行删
        .replace(/熔炼台：craft 投 /g, "熔炼台：投 ") // 去掉 POST 命令词 craft
        .replace(/。用 list 上架素材\/种子（别人串门可买）。/g, "。") // 摊位空时去掉 POST 的 list 指令
        .replace(/\n?[ \t　]*上架卖：[^\n]*/g, "") // 摊位的「上架卖：list…撤摊：unlist」整行是 POST 指令，agent 版用按钮，删掉
        .replace(/POST \/farms\/[^\s）)。\n]+(?:\s+\{[^}]+})?/g, "")
        .replace(/GET \/c\?a=[^\s　。\n]+/g, "")
        .replace(/（接口：\s*）/g, "")
        .replace(/接口：\s*/g, "")
        .replace(/买：\s*(?=（|$)/g, "")
        .replace(/偷：\s*(?=　|。|$)/g, "")
        .replace(/留言：\s*(?=）|$)/g, "")
        .replace(/（完整两层商店：\s*）/g, "")
        .replace(/[（(][ \t　]*[）)]/g, "") // 清掉被剥空的占位括号 （）
        .replace(/\n串门看详情：[^\n]*/g, "")
        .replace(/[ \t　]+(?=\n)/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
function renderShopPage(playKey, f, now, banner) {
    refreshShop(f, now);
    return htmlAgentPage(playKey, agentNaturalText(viewShop(f, now)), links(playKey, shopActions(f, now), now), banner ? agentNaturalText(banner) : "🏪 商店");
}
function renderBagPage(playKey, f, now, banner) {
    const matCount = Object.values(f.materials).reduce((a, b) => a + b, 0);
    const note = matCount >= 3 ? "" : "\n\n素材不足 3 个；集齐后这里会自动出现「熔炼」链接。"; // 无熔炼链接时的空状态提示
    return htmlAgentPage(playKey, agentNaturalText(viewBag(f)) + note, links(playKey, bagActions(f), now), banner ? agentNaturalText(banner) : "🎒 背包 / 素材");
}
function renderMarketPage(playKey, f, now, banner) {
    const offers = [];
    for (const m of (f.market ?? []).slice(0, 8)) {
        const nm = m.kind === "material" ? (materialById.get(m.id)?.name ?? m.id) : (getCrop(m.id)?.name ?? m.id);
        offers.push({ label: `📦 下架「${nm}」`, action: "unlist", params: { kind: m.kind, id: m.id } });
    }
    offers.push(...listInventoryActions(f)); // 上架链接：背包里有种子/素材时出现
    offers.push({ label: "🔙 回我的农场", action: "status", params: {} });
    const note = (Object.values(f.seeds).some((n) => n > 0) || Object.values(f.materials).some((n) => n > 0)) ? "" : "\n\n暂无可出售物品；获得素材或限定种子后，这里会自动出现「上架」链接。"; // 无上架链接时的空状态提示
    return htmlAgentPage(playKey, agentNaturalText(viewMarket(f, true)) + note, links(playKey, offers, now), banner ? agentNaturalText(banner) : "🧺 我的摊位");
}
function renderLeaderboardPage(playKey, now, banner) {
    const offers = [{ label: "🔙 回我的农场", action: "status", params: {} }];
    return htmlAgentPage(playKey, agentNaturalText(viewLeaderboard(playerFarms(), allUgc(), now)), links(playKey, offers, now), banner ? agentNaturalText(banner) : "🏆 全服排行榜");
}
const agentFlashes = new Map();
const AGENT_FLASH_TTL = 5 * 60 * 1000;
function sweepAgentFlashes(now) {
    for (const [k, v] of agentFlashes)
        if (v.exp < now)
            agentFlashes.delete(k);
}
function putAgentFlash(playKey, target, now) {
    sweepAgentFlashes(now);
    const k = randomUUID().replace(/-/g, "").slice(0, 16);
    agentFlashes.set(k, { playKey, target, exp: now + AGENT_FLASH_TTL });
    return k;
}
function takeAgentFlash(playKey, key, now) {
    if (!key)
        return undefined;
    const v = agentFlashes.get(key);
    if (!v)
        return undefined;
    agentFlashes.delete(key);
    return v.playKey === playKey && v.exp >= now ? v.target : undefined;
}
function agentRedirect(playKey, target, now) {
    const flash = putAgentFlash(playKey, target, now);
    return { redirect: `/agent/${playKey}/view?flash=${flash}&v=${randomUUID().replace(/-/g, "").slice(0, 8)}` };
}
function renderAgentTarget(playKey, f, now, target) {
    if (!target || target.kind === "self")
        return renderSelf(playKey, f, now, target?.banner);
    if (target.kind === "shop")
        return renderShopPage(playKey, f, now, target.banner);
    if (target.kind === "bag")
        return renderBagPage(playKey, f, now, target.banner);
    if (target.kind === "market")
        return renderMarketPage(playKey, f, now, target.banner);
    if (target.kind === "leaderboard")
        return renderLeaderboardPage(playKey, now, target.banner);
    if (target.kind === "mypage")
        return renderMyPublicPage(playKey, f, now, target.banner);
    if (target.kind === "wander")
        return renderWanderPage(playKey, f, now);
    return renderVisitPage(playKey, target.targetId, now);
}
/** 执行一个 nonce 绑定的动作；成功后跳到普通 view 页展示结果，避免一次性 /do URL 回放旧成功页。 */
function agentDo(playKey, nonce, now) {
    const f = resolveAgent(playKey);
    if (!f)
        return { html: htmlAgentPage(playKey, "这个 Agent 链接无效或已被撤销。", []) };
    const n = takeNonce(nonce, now);
    if (!n || n.playKey !== playKey)
        return { html: htmlNotice("✅ 此操作已执行（或链接已过期）。\n旧的操作链接不会重复生效——点下面回农场看当前真实状态，再继续操作。", `/agent/${playKey}/view?v=${randomUUID().replace(/-/g, "").slice(0, 8)}`, "↻ 回农场看最新状态") };
    const tok = f.token, a = n.action, p = n.params;
    if (a === "status")
        return agentRedirect(playKey, { kind: "self" }, now);
    if (a === "shop")
        return agentRedirect(playKey, { kind: "shop" }, now);
    if (a === "bag")
        return agentRedirect(playKey, { kind: "bag" }, now);
    if (a === "market")
        return agentRedirect(playKey, { kind: "market" }, now);
    if (a === "leaderboard")
        return agentRedirect(playKey, { kind: "leaderboard" }, now);
    if (a === "mypage")
        return agentRedirect(playKey, { kind: "mypage" }, now);
    if (a === "wander")
        return agentRedirect(playKey, { kind: "wander" }, now);
    if (a === "visit")
        return agentRedirect(playKey, { kind: "visit", targetId: String(p.target) }, now);
    let banner;
    if (a === "craft") {
        // auto=AI 自动取 3 个；否则用 compose 传来的指定 materials（伴侣在前端选的）
        const mats = p.auto ? autoPickMaterials(f)
            : (Array.isArray(p.materials) ? p.materials : String(p.materials ?? "").split(",").map((s) => s.trim()).filter(Boolean));
        banner = (mats && mats.length >= 3) ? runFarm(f.id, "craft", { token: tok, materials: mats }, undefined, now).json.text : "素材不足 3 个，没法熔炼。";
        return agentRedirect(playKey, { kind: "self", banner: stripFooter(banner) }, now); // 熔炼完直接回农场页（带种下等按钮）
    }
    else if (a === "buy") {
        banner = runFarm(String(p.target), "buy", { by: f.id, token: tok, kind: p.kind, id: p.id, qty: p.qty }, undefined, now).json.text;
    }
    else if (a === "steal") {
        banner = runFarm(String(p.target), "steal", { by: f.id, token: tok, plotId: p.plotId }, undefined, now).json.text;
    }
    else if (a === "message") {
        banner = runFarm(String(p.target), "message", { by: f.id, token: tok, text: p.text }, undefined, now).json.text;
    }
    else if (a === "water" && p.target) {
        banner = runFarm(String(p.target), "water", { by: f.id, token: tok }, undefined, now).json.text;
    }
    else if (a === "buy-potion-set" && p.target) {
        banner = runFarm(String(p.target), "buy-potion-set", { by: f.id, token: tok }, undefined, now).json.text;
    }
    else if (a === "buy-item" || a === "buy-potion-set" || a === "buy-recipe" || a === "buy-animal" || a === "buy-pet") {
        banner = runFarm(f.id, a, { token: tok, ...p }, undefined, now).json.text;
        return agentRedirect(playKey, { kind: "self", banner: stripFooter(banner) }, now); // 买完直接回农场页（带催熟+收获/种下等按钮）
    }
    else if (a === "list") {
        banner = runFarm(f.id, a, { token: tok, ...p }, undefined, now).json.text;
        return agentRedirect(playKey, { kind: "shop", banner: stripFooter(banner) }, now); // 上架后回商店页（第二层=你的摊位，看到刚上架的）
    }
    else if (a === "unlist") {
        banner = runFarm(f.id, a, { token: tok, ...p }, undefined, now).json.text;
        return agentRedirect(playKey, { kind: "market", banner: stripFooter(banner) }, now);
    }
    else if (a === "delete-message" || a === "guestbook") {
        // 「我的公开页/留言板」里的管理动作——做完回到那页，看到更新后的留言板
        const t = runFarm(f.id, a, { token: tok, ...p }, undefined, now).json.text;
        return agentRedirect(playKey, { kind: "mypage", banner: stripFooter(t) }, now);
    }
    else {
        banner = runFarm(f.id, a, { token: tok, ...p }, undefined, now).json.text;
    }
    return agentRedirect(playKey, { kind: "self", banner: stripFooter(banner) }, now);
}
const AGENT_HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0", "Pragma": "no-cache", "Expires": "0", "X-Robots-Tag": "noindex" };
export function startServer(port) {
    const server = createServer(async (req, res) => {
        const url = new URL(req.url ?? "/", `http://localhost:${port}`);
        const parts = url.pathname.split("/").filter(Boolean);
        const sp = smartParams(url.search); // 同 url.searchParams，但纠正 GBK 等非 UTF-8 客户端的中文参数
        const method = req.method ?? "GET";
        const now = Date.now();
        const ip = clientIp(req);
        if (!allowRequest(ip, now))
            return jsonOut(res, 429, { ok: false, text: "请求太频繁了，过几秒再来（限流）。" });
        try {
            // 玩法说明页（GET/agent 版，和首页平行，给只能 GET/点链接的 AI）。主路由 /get。
            //   /readme 给「人类伴侣」看的新手攻略（怎么分工、把哪条链接发给哪种 AI），纯阅读页、无其它入口。
            if (parts[0] === "readme" && parts.length === 1) {
                res.writeHead(200, AGENT_HEADERS);
                return res.end(htmlGuide());
            }
            if (parts[0] === "get" && parts.length === 1) {
                res.writeHead(200, AGENT_HEADERS);
                let readme = htmlReadme();
                if (SHOW_MIGRATION_NOTICE)
                    readme = readme.replace(/(<body[^>]*>)/, `$1${MIGRATION_NOTICE_HTML}`);
                return res.end(readme);
            }
            // 全服排行榜（公开，免 token）：文字版给 AI，?html 给人看
            if (parts[0] === "leaderboard" && parts.length === 1) {
                return jsonOut(res, 200, { ok: true, text: viewLeaderboard(playerFarms(), allUgc(), now) });
            }
            // —— 人类页 /ui/<humanKey>[/section]（伴侣看农场观光 + 经营自己的牧场；AI 接口看不到这些）——
            //   只认低权限 humanKey：够看农场+经营人类牧场+改昵称，但不能当 API token。
            if (parts[0] === "ui") {
                const key = parts[1] ?? "";
                const f = key ? allFarms().find((x) => x.humanKey === key) : undefined;
                if (!f) {
                    res.writeHead(404, AGENT_HEADERS);
                    return res.end(uiInvalid());
                }
                advance(f, now);
                if (!f.humanFrontendSeen) {
                    f.humanFrontendSeen = true;
                    save();
                } // 伴侣已打开前端 → Agent 页"先发链接"新手任务可撤掉
                const section = parts[2];
                // 🎖️ 佩戴称号：主页名字旁的下拉提交到这里。POST /ui/<key>/title → 存 titleEquipped → 303 跳回主页。
                if (section === "title" && method === "POST") {
                    const form = await readFormBody(req);
                    checkTitles(f); // 佩戴前补结算解锁
                    equipTitle(f, String(form.id ?? "").trim());
                    save();
                    res.writeHead(303, { ...AGENT_HEADERS, Location: `/ui/${key}` });
                    return res.end();
                }
                // 🐮 牧场：/ui 里唯一「能写」的页。POST 收获/回传 → 做完 303 跳回（PRG，刷新不会重复提交）。
                if (section === "ranch") {
                    const act = parts[3];
                    if (method === "POST" && (act === "collect" || act === "remit" || act === "dress" || act === "decorate" || act === "wear" || act === "takeoff" || act === "place" || act === "unplace" || act === "upgrade" || act === "name-animal" || act === "name-pet" || act === "pin")) {
                        const form = await readFormBody(req);
                        let flash;
                        const ai = f.aiName || f.name || "对方";
                        if (act === "upgrade") {
                            const r = ranchUpgradeAnimal(f, Number(form.animal));
                            flash = r.ok ? `⬆ ${r.name}升到 Lv.${r.level}（-${r.cost}金）——每份产出更值钱了` : r.error;
                        }
                        else if (act === "collect") {
                            const r = ranchCollect(f, now);
                            flash = r.ok
                                ? `📦 收获：${Object.entries(r.detail).map(([k, v]) => `${v} 份${k}`).join("、")}，+${r.gain} 金${r.potion ? `；还掉了 ${r.potion} 瓶加速药水进${ai}的仓库 🧪` : ""}`
                                : r.error;
                        }
                        else if (act === "remit") {
                            const r = ranchRemit(f, Number(form.amount), now);
                            flash = r.ok ? `↗ 已回传 ${r.amount} 金给${ai}（牧场还剩 ${r.left}）` : r.error;
                        }
                        else if (act === "dress") {
                            const r = ranchBuyAccessory(f, String(form.acc ?? ""), now);
                            flash = r.ok ? `🛍️ 买下了${r.name}（-${r.cost}金），已放进🧰仓库——去仓库给动物/宠物戴上吧` : r.error;
                        }
                        else if (act === "wear") {
                            const [tgt, ix] = String(form.who ?? "").split(":");
                            const r = ranchWearAccessory(f, tgt === "pet" ? "pet" : "animal", Number(ix), String(form.acc ?? ""));
                            flash = r.ok ? `👗 给${r.wearer}戴上了${r.name}——${ai}下次打开农场就能看见啦` : r.error;
                        }
                        else if (act === "takeoff") {
                            const r = ranchTakeOffAccessory(f, form.target === "pet" ? "pet" : "animal", Number(form.idx), String(form.acc ?? ""));
                            flash = r.ok ? `🧷 把${r.wearer}的${r.name}脱下，收回🧰仓库了` : r.error;
                        }
                        else if (act === "place") {
                            const r = ranchPlaceDecoration(f, String(form.decor ?? ""));
                            flash = r.ok ? `🏡 把「${r.name}」摆进了${ai}的田——别人来串门能看到` : r.error;
                        }
                        else if (act === "unplace") {
                            const r = ranchUnplaceDecoration(f, String(form.decor ?? ""));
                            flash = r.ok ? `📦 把「${r.name}」收回🧰仓库了` : r.error;
                        }
                        else if (act === "name-animal") {
                            const r = ranchNameAnimal(f, Number(form.animal), String(form.name ?? ""));
                            flash = r.ok ? `🏷️ 把${r.kind}的名字改成了「${r.name}」` : r.error;
                        }
                        else if (act === "name-pet") {
                            const r = ranchNamePet(f, Number(form.pet), String(form.name ?? ""));
                            flash = r.ok ? `🏷️ 把${r.kind}的名字改成了「${r.name}」` : r.error;
                        }
                        else if (act === "pin") {
                            const r = ranchTogglePin(f, String(form.kind ?? ""));
                            flash = r.ok ? (r.pinned ? `📌 已 pin「${r.name}」——它会出现在${ai}农场的氛围里` : `已取消 pin「${r.name}」`) : r.error;
                        }
                        else {
                            const r = ranchBuyDecoration(f, String(form.decor ?? ""), now);
                            flash = r.ok ? `🛍️ 买下了「${r.name}」（-${r.cost}金），已放进🧰仓库——去仓库摆出来吧` : r.error;
                        }
                        save();
                        res.writeHead(303, { ...AGENT_HEADERS, Location: `/ui/${key}/ranch?flash=${encodeURIComponent(flash)}` });
                        return res.end();
                    }
                    res.writeHead(200, AGENT_HEADERS);
                    return res.end(uiRanch(f, now, key, url.searchParams.get("flash") ?? undefined));
                }
                // ✍️ TA 的农场：替 AI 做「要打字」的动作（称呼/设计原创作物/给邻居留言/指定组合熔炼），都作用在 AI 主农场上。
                if (section === "ta") {
                    const act = parts[3];
                    if (method === "POST" && (act === "names" || act === "welcome" || act === "design" || act === "message" || act === "craft" || act === "social")) {
                        const form = await readFormBody(req);
                        let flash;
                        const ai = f.aiName || f.name || "小克";
                        if (act === "names") {
                            f.aiName = (String(form.aiName ?? "").trim().slice(0, 12)) || undefined;
                            f.humanName = (String(form.humanName ?? "").trim().slice(0, 12)) || undefined;
                            save();
                            flash = `✅ 称呼已更新：AI「${f.aiName ?? "未设"}」· 你「${f.humanName ?? "未设"}」`;
                        }
                        else if (act === "welcome") {
                            const text = String(form.text ?? "").trim().slice(0, WELCOME_MAX);
                            f.welcome = text || undefined; // 清空 → 恢复默认句
                            save();
                            flash = text ? `✅ 串门欢迎语已更新：${text}` : `✅ 已清空欢迎语，恢复默认句`;
                        }
                        else if (act === "design") {
                            const r = designCrop(f, { name: form.name, desc: form.desc, plant: form.plant, harvest: form.harvest, latin: form.latin });
                            save();
                            flash = r.ok
                                ? `🎨 替${ai}设计出原创作物【${r.crop.name}·${r.crop.rarity}】，设计费 -${r.fee} 金，到手 ${r.seeds} 颗种子（可在 TA 的田里种、或上架卖给别的玩家）。`
                                : `⚠️ ${r.error}`;
                        }
                        else if (act === "craft") {
                            const ids = [form.m1, form.m2, form.m3].map((s) => String(s ?? "").trim()).filter(Boolean);
                            const r = craft(f, ids, now);
                            save();
                            flash = r.ok
                                ? `⚗️ 熔炼成功！替${ai}熔出限定种子【${r.cropName}·${r.rarity}】${r.byRecipe ? "（命中隐藏配方！）" : ""}——可在 TA 的田里种下。`
                                : `⚠️ ${r.error}`;
                        }
                        else if (act === "social") {
                            const k = String(form.key ?? "");
                            const on = String(form.on ?? "") === "1" || String(form.on ?? "") === "true";
                            const LABELS = { visit: "来访 / 访问", steal: "偷菜", water: "帮浇水", message: "留言" };
                            if (!(k in LABELS)) {
                                flash = "⚠️ 未知的开关。";
                            }
                            else {
                                f.social ??= {};
                                f.social[k] = on;
                                save();
                                flash = on ? `✅ 已开放「${LABELS[k]}」（双向）` : `🚫 已谢绝「${LABELS[k]}」（双向）${k === "visit" ? "——别人搜不到你、你也不能出门，且偷菜/浇水/留言一并封闭" : ""}`;
                            }
                        }
                        else {
                            // 留言：以本农场名义（by=自己 id + 自己 token）在对方留言板留言，复用 runFarm 的校验逻辑
                            const target = String(form.target ?? "").trim();
                            const out = runFarm(target, "message", { by: f.id, token: f.token, text: form.text }, undefined, now);
                            flash = out.json.ok ? out.json.text : `⚠️ ${out.json.text}`;
                        }
                        res.writeHead(303, { ...AGENT_HEADERS, Location: `/ui/${key}/ta?flash=${encodeURIComponent(flash)}` });
                        return res.end();
                    }
                    // 🔗 「生成链接」：把伴侣填好的内容拼成一条 AI 用的 compose 链接（不直接执行），让 AI 自己点、看到结果。
                    if (method === "GET" && typeof act === "string" && act.startsWith("link-")) {
                        const action = act.slice(5);
                        if (["design", "message", "craft", "visit"].includes(action)) {
                            const agentKey = ensureAgentKey(f);
                            const q = Object.fromEntries(sp);
                            const params = new URLSearchParams();
                            params.set("a", action);
                            if (action === "craft") {
                                const mats = [q.m1, q.m2, q.m3].map((s) => String(s ?? "").trim()).filter(Boolean);
                                params.set("materials", mats.join(","));
                            }
                            else if (action === "design") {
                                for (const k of ["name", "desc", "plant", "harvest", "latin"])
                                    if (q[k])
                                        params.set(k, String(q[k]));
                            }
                            else if (action === "visit") {
                                if (q.target)
                                    params.set("target", String(q.target).trim()); // 串门：只需目标门牌号
                            }
                            else {
                                for (const k of ["target", "text"])
                                    if (q[k])
                                        params.set(k, String(q[k]));
                            }
                            const composeUrl = `${BASE}/agent/${agentKey}/compose?${params.toString()}`;
                            res.writeHead(200, AGENT_HEADERS);
                            return res.end(htmlGenLink(action, composeUrl, f.aiName || f.name || "对方"));
                        }
                    }
                    res.writeHead(200, AGENT_HEADERS);
                    return res.end(uiTa(f, now, key, url.searchParams.get("flash") ?? undefined));
                }
                // 🗺️ 探险页：摇骰（伴侣替 AI 摇，同心+1）/ 出门前祈福。其余推进(explore/choose/retreat)是 AI 自己发，这页只看+摇骰+祈福。
                if (section === "expedition") {
                    const act = parts[3];
                    if (method === "POST" && (act === "roll" || act === "charm")) {
                        const form = await readFormBody(req);
                        let flash;
                        if (act === "roll") {
                            flash = expRoll(f, true, now).text;
                            checkTitles(f); // 默契称号：伴侣摇骰赢一场战斗会 +1 默契度
                        }
                        else {
                            const kind = form.kind === "check" || form.kind === "hp" ? form.kind : undefined;
                            flash = expSetCharm(f, kind, String(form.blessing ?? ""), now).text;
                        }
                        save();
                        res.writeHead(303, { ...AGENT_HEADERS, Location: `/ui/${key}/expedition?flash=${encodeURIComponent(flash)}` });
                        return res.end();
                    }
                    res.writeHead(200, AGENT_HEADERS);
                    return res.end(uiExpedition(f, now, key, url.searchParams.get("flash") ?? undefined));
                }
                // 📖 图鉴册：唯一「能写」的部分=星标收藏。POST star 切换喜欢的作物 → 303 跳回（PRG），带 anchor 回到原栏位。
                if (section === "codex") {
                    if (method === "POST" && parts[3] === "star") {
                        const form = await readFormBody(req);
                        const r = toggleStar(f, String(form.id ?? "").trim());
                        if (r.ok)
                            save();
                        const flash = r.ok ? (r.on ? `⭐ 已收藏「${r.name}」——去「我的收藏」栏看看` : `已取消收藏「${r.name}」`) : "⚠️ 找不到这种作物";
                        const anchor = String(form.anchor ?? "").trim();
                        res.writeHead(303, { ...AGENT_HEADERS, Location: `/ui/${key}/codex?flash=${encodeURIComponent(flash)}${anchor ? `#${encodeURIComponent(anchor)}` : ""}` });
                        return res.end();
                    }
                    res.writeHead(200, AGENT_HEADERS);
                    return res.end(uiCodex(f, now, key, url.searchParams.get("flash") ?? undefined));
                }
                res.writeHead(200, AGENT_HEADERS);
                // 他的田/商店/原创已并进主页，连同乱填的 section 一律回落主页；排行榜仍占位。
                if (section === "leaderboard")
                    return res.end(uiLeaderboard(f, now, key));
                return res.end(uiHome(f, now, key));
            }
            // —— Agent 控制页（HTML，给只能点页面里现成链接的 AI）——
            if (parts[0] === "agent" && parts.length >= 2) {
                const playKey = parts[1];
                if (parts[2] === "do") {
                    const out = agentDo(playKey, String(url.searchParams.get("n") ?? ""), now);
                    if ("redirect" in out) {
                        res.writeHead(303, { ...AGENT_HEADERS, Location: out.redirect });
                        return res.end();
                    }
                    res.writeHead(200, AGENT_HEADERS);
                    return res.end(out.html);
                }
                if (parts[2] === "compose") {
                    res.writeHead(200, AGENT_HEADERS);
                    return res.end(agentCompose(playKey, Object.fromEntries(sp), now));
                }
                const f = resolveAgent(playKey);
                if (!f) {
                    res.writeHead(404, AGENT_HEADERS);
                    return res.end(htmlAgentPage(playKey, "这个 Agent 链接无效或已被撤销。", []));
                }
                if (parts[2] === "view") {
                    const flash = takeAgentFlash(playKey, url.searchParams.get("flash"), now);
                    res.writeHead(200, AGENT_HEADERS);
                    return res.end(renderAgentTarget(playKey, f, now, flash));
                }
                // 固定入口 /agent/:key：每次都 302 跳到唯一的 view 网址，绕开浏览器/历史的缓存复用
                res.writeHead(302, { ...AGENT_HEADERS, Location: `/agent/${playKey}/view?v=${randomUUID().slice(0, 8)}` });
                return res.end();
            }
            // 一步建农场 + 开通 Agent 页（用户打开一次，把返回的 agent 链接发给 AI）
            if (parts[0] === "agent-new" && parts.length === 1) {
                if (!REGISTRATION_OPEN)
                    return jsonOut(res, 503, { ok: false, text: REGISTRATION_CLOSED_TEXT });
                if (REGISTRATION_CAP > 0 && playerFarms().length >= REGISTRATION_CAP)
                    return jsonOut(res, 503, { ok: false, text: REGISTRATION_FULL_TEXT });
                if (allFarms().length >= MAX_FARMS)
                    return jsonOut(res, 503, { ok: false, text: "全服农场数量已达上限。" });
                if (!allowCreate(ip, now))
                    return jsonOut(res, 429, { ok: false, text: "建农场太频繁了，过会儿再来。" });
                const f = fresh(createFarm(sp.get("name") ?? "", { aiName: sp.get("aiName") ?? undefined, humanName: sp.get("humanName") ?? undefined }).id);
                f.agentKey = newAgentKey();
                save();
                const aurl = `${BASE}/agent/${f.agentKey}`;
                const humanUrl = `${BASE}/ui/${ensureHumanKey(f)}`;
                return jsonOut(res, 201, { ok: true, text: agentReadyText(f, humanUrl, aurl, true), humanUrl, agentUrl: aurl, instruction: `请立即把 humanUrl 和 agentUrl 都发送给${f.humanName || "伴侣"}，并提醒对方保存。` });
            }
            if (method === "GET" && parts.length === 0)
                return textOut(res, 200, (SHOW_MIGRATION_NOTICE ? MIGRATION_NOTICE_TEXT + "\n\n" : "") + HELP + SOCIAL_HELP);
            // GET 命令通道 /c：让只能 GET 的 AI 也能玩（query 当 body；建农场/串门/动作都走这里）
            if (parts[0] === "c") {
                const b = Object.fromEntries(sp);
                if (typeof b.limited === "string")
                    b.limited = b.limited.split(",");
                if (typeof b.materials === "string")
                    b.materials = b.materials.split(",");
                const a = String(b.a ?? "");
                if (a === "create") {
                    if (!REGISTRATION_OPEN)
                        return jsonOut(res, 503, { ok: false, text: REGISTRATION_CLOSED_TEXT });
                    if (REGISTRATION_CAP > 0 && playerFarms().length >= REGISTRATION_CAP)
                        return jsonOut(res, 503, { ok: false, text: REGISTRATION_FULL_TEXT });
                    if (allFarms().length >= MAX_FARMS)
                        return jsonOut(res, 503, { ok: false, text: "全服农场数量已达上限，暂不能再建新农场。" });
                    if (!allowCreate(ip, now))
                        return jsonOut(res, 429, { ok: false, text: "你建农场太频繁了，过会儿再来。" });
                    const f = fresh(createFarm(b.name, { aiName: b.aiName, humanName: b.humanName }).id);
                    return jsonOut(res, 201, { ok: true, text: createText(f, now), token: f.token, humanUrl: `${BASE}/ui/${f.humanKey}`, playUrl: `${BASE}/a/${f.agentKey}`, instruction: `先把 humanUrl 原样发给 ${f.humanName || "伴侣"}（让 TA 同步看农场、经营自己的牧场）；你自己玩农场用 playUrl（动作接在它后面，不用带 token），token 是后备主钥匙、收好别外泄。`, farm: farmView(f, now) });
                }
                if (a === "leaderboard" || a === "ranking")
                    return jsonOut(res, 200, { ok: true, text: viewLeaderboard(playerFarms(), allUgc(), now) });
                if (a === "wander")
                    return jsonOut(res, 200, wanderResult(b, now));
                if (a === "make-agent" || a === "revoke-agent") {
                    const f = getFarm(String(b.farm ?? ""));
                    if (!f || f.token !== String(b.token ?? ""))
                        return jsonOut(res, 403, { ok: false, text: "需要带 farm=你的农场id 和当前 token。" });
                    if (a === "revoke-agent") {
                        f.agentKey = undefined;
                        save();
                        return jsonOut(res, 200, { ok: true, text: "已撤销该农场的 Agent 链接（原链接立即失效）。" });
                    }
                    f.token = randomUUID().replace(/-/g, ""); // 先轮换可能已泄露的 token
                    f.agentKey = newAgentKey();
                    ensureHumanKey(f); // 伴侣前端钥匙（稳定，token 轮换不影响它）
                    save();
                    const aurl = `${BASE}/agent/${f.agentKey}`;
                    const humanUrl = `${BASE}/ui/${f.humanKey}`;
                    return jsonOut(res, 200, { ok: true, text: agentReadyText(f, humanUrl, aurl, false), humanUrl, agentUrl: aurl, instruction: `请立即把 humanUrl 和 agentUrl 都发送给${f.humanName || "伴侣"}，并提醒对方保存。` });
                }
                const out = runFarm(String(b.farm ?? ""), a || undefined, b, b.id, now);
                return jsonOut(res, out.status, out.json);
            }
            // 随机串门（POST）
            if (method === "POST" && parts[0] === "wander" && parts.length === 1) {
                return jsonOut(res, 200, wanderResult(await readBody(req), now));
            }
            // 建农场（POST）
            if (method === "POST" && parts[0] === "farms" && parts.length === 1) {
                if (!REGISTRATION_OPEN)
                    return jsonOut(res, 503, { ok: false, text: REGISTRATION_CLOSED_TEXT });
                if (REGISTRATION_CAP > 0 && playerFarms().length >= REGISTRATION_CAP)
                    return jsonOut(res, 503, { ok: false, text: REGISTRATION_FULL_TEXT });
                if (allFarms().length >= MAX_FARMS)
                    return jsonOut(res, 503, { ok: false, text: "全服农场数量已达上限，暂不能再建新农场。" });
                if (!allowCreate(ip, now))
                    return jsonOut(res, 429, { ok: false, text: "你建农场太频繁了，过会儿再来。" });
                const cb = await readBody(req);
                const f = fresh(createFarm(cb.name, { aiName: cb.aiName, humanName: cb.humanName }).id);
                return jsonOut(res, 201, { ok: true, text: createText(f, now), token: f.token, humanUrl: `${BASE}/ui/${f.humanKey}`, playUrl: `${BASE}/a/${f.agentKey}`, instruction: `先把 humanUrl 原样发给 ${f.humanName || "伴侣"}（让 TA 同步看农场、经营自己的牧场）；你自己玩农场用 playUrl（动作接在它后面，不用带 token），token 是后备主钥匙、收好别外泄。`, farm: farmView(f, now) });
            }
            // MCP 适配器：POST /mcp/<key>（手写最小 JSON-RPC，第 4 个传输层）。<key> = agentKey（和 /a/<key> 同一把，可撤销）。
            //   单工具 farm：身份焊进链接里，调用只给 {action, ...参数}，薄转发到 runFarm——与 POST 版同规则、同存档、同 HUD。
            if (parts[0] === "mcp") {
                if (method !== "POST")
                    return jsonOut(res, 405, { ok: false, text: "MCP 端点只收 POST（JSON-RPC over HTTP）。" });
                const me = resolveAgent(parts[1] ?? "");
                if (!me)
                    return jsonOut(res, 404, { ok: false, text: "这个 MCP 链接无效或已被撤销（key 不对？）。重开见 GET / 的「开张 & 接入」。" });
                const rpc = await readBody(req);
                const run = (action, params) => {
                    const b = { ...params };
                    if (action === "wander") {
                        const w = wanderResult({ ...b, by: me.id }, now);
                        return { ok: w.ok !== false, text: String(w.text ?? "") };
                    } // 随机串门走路由层撮合，不在 runFarm 里
                    const social = b.to !== undefined && String(b.to) !== ""; // 有 to = 在别人家做事
                    const target = social ? String(b.to) : me.id;
                    if (typeof b.limited === "string")
                        b.limited = b.limited.split(",");
                    if (typeof b.materials === "string")
                        b.materials = b.materials.split(",");
                    fillRunDefaults(action, b);
                    const body = social ? { ...b, by: me.id, token: me.token } : { ...b, token: me.token };
                    const out = runFarm(target, action, body, social ? me.id : b.id, now);
                    return { ok: out.json.ok !== false, text: String(out.json.text ?? "") };
                };
                const resp = mcpDispatch(rpc, { serverName: "aifarm", run });
                if (resp === undefined) {
                    res.writeHead(202, NO_STORE);
                    return res.end();
                } // 纯通知：202 空体
                return jsonOut(res, 200, resp);
            }
            // 农场专属链接 /a/<key>：身份焊进链接，动作不带 token / by。<key> = 农场 agentKey（和 /agent 点击页同一把，可撤销）。
            //   自家事：POST /a/<key>/<动作> {参数}；串别家：参数加 "to":"对方门牌号"（steal/water/buy/message/buy-potion-set/visit）。
            //   视图走 GET /a/<key>/<status|shop|bag|market|encyclopedia|ledger|leaderboard>；随机逛 /a/<key>/wander。
            if (parts[0] === "a" && parts.length >= 2) {
                const me = resolveAgent(parts[1]);
                if (!me)
                    return jsonOut(res, 404, { ok: false, text: "这个农场链接无效或已被撤销（key 不对？）。新建/重开链接见 GET / 的「开张 & 接入」。" });
                const action = parts[2];
                if (mutatingViaGet(method, action))
                    return jsonOut(res, 405, { ok: false, text: `「${action}」会改动农场，请用 POST（GET 只用于查看：${[...READONLY_ACTIONS].join("/")}）。这样防止链接被预取/抓取时误触发。` });
                const b = method === "POST" ? await readBody(req) : {};
                for (const [k, v] of sp)
                    if (b[k] === undefined)
                        b[k] = v;
                if (typeof b.limited === "string")
                    b.limited = b.limited.split(",");
                if (typeof b.materials === "string")
                    b.materials = b.materials.split(",");
                if (action === "wander")
                    return jsonOut(res, 200, wanderResult({ ...b, by: me.id }, now));
                const social = b.to !== undefined && String(b.to) !== ""; // 有 to = 在别人家做事
                const target = social ? String(b.to) : me.id;
                fillRunDefaults(action, b);
                const body = social ? { ...b, by: me.id, token: me.token } : { ...b, token: me.token };
                const out = runFarm(target, action, body, social ? me.id : (parts[3] ?? b.id), now);
                return jsonOut(res, out.status, out.json);
            }
            // 农场作用域（REST · 老派 token 写法）：POST 动作 / GET 视图都走共用的 runFarm（也兼容 ?query= 带参、X-Farm-Token 头）
            if (parts[0] === "farms" && parts.length >= 2) {
                if (mutatingViaGet(method, parts[2]))
                    return jsonOut(res, 405, { ok: false, text: `「${parts[2]}」会改动农场，请用 POST（GET 只用于查看：${[...READONLY_ACTIONS].join("/")}）。这样防止链接被预取/抓取时误触发。` });
                const b = method === "POST" ? await readBody(req) : {};
                for (const [k, v] of sp)
                    if (b[k] === undefined)
                        b[k] = v;
                if (typeof b.limited === "string")
                    b.limited = b.limited.split(",");
                if (typeof b.materials === "string")
                    b.materials = b.materials.split(",");
                if (b.token === undefined && req.headers["x-farm-token"])
                    b.token = String(req.headers["x-farm-token"]);
                fillRunDefaults(parts[2], b);
                const out = runFarm(parts[1], parts[2], b, parts[3] ?? b.id, now);
                return jsonOut(res, out.status, out.json);
            }
            reply(res, false, `这条路走不通：${url.pathname}（GET / 看玩法）`);
        }
        catch (err) {
            console.error(err);
            reply(res, false, "农场后台出了点岔子，稍后再试。");
        }
    });
    setInterval(() => { const t = Date.now(); sweepGuard(t); sweepNonces(t); sweepAgentFlashes(t); }, 60_000).unref(); // 周期清理限流表 + 过期 nonce/flash
    server.listen(port, () => console.log(`[server] 🌾 AI 农场已开门 http://localhost:${port}`));
}
//# sourceMappingURL=server.js.map