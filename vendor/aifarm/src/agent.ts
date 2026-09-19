// Agent 控制页：让"只能点页面里现成链接、不能自己伪造 URL"的 AI（如 GPT）也能连续操作。
// playKey 绑定农场（存在 farm.agentKey）；动作链接用一次性 nonce；真实 farmToken 绝不出现在页面/链接里。
import { randomUUID } from "node:crypto";
import { BASE } from "./config.js";

type Nonce = { playKey: string; action: string; params: any; exp: number };
const nonces = new Map<string, Nonce>();
const NONCE_TTL = 30 * 60 * 1000; // 30 分钟

export function mintNonce(playKey: string, action: string, params: any, now: number): string {
  const n = randomUUID().replace(/-/g, "").slice(0, 12);
  nonces.set(n, { playKey, action, params, exp: now + NONCE_TTL });
  return n;
}
/** 取用 nonce：一次性（取出即删），过期返回 null */
export function takeNonce(nonce: string, now: number): Nonce | null {
  const v = nonces.get(nonce);
  if (!v) return null;
  nonces.delete(nonce);
  return v.exp < now ? null : v;
}
export function sweepNonces(now: number): void {
  for (const [k, v] of nonces) if (v.exp < now) nonces.delete(k);
}

const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
// JS 字符串字面量安全嵌入 <script>：JSON.stringify 不转义 </script>，必须额外转义 < 防止提前闭合脚本。
const jsStr = (s: string) => JSON.stringify(String(s)).replace(/</g, "\\u003c");

/** 独立的玩法说明页（给伴侣 + AI 看，集中讲清 Agent 玩法 + compose 配合流程）*/
export function htmlReadme(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>🌾 农场 · 怎么一起玩</title></head>
<body style="max-width:760px;margin:24px auto;padding:0 16px;line-height:1.75;font-family:system-ui,sans-serif">
<h1>🌾 农场 · 怎么一起玩</h1>
<p>这是一座你和伴侣一起照看的小农场。你来种地、收获、熔炼、串门偷菜、设计自己的作物；伴侣帮你打理一座小牧场，也在你需要的时候搭把手。慢慢玩，别急～</p>
<p>你们俩各有各的入口：伴侣收着 🏡 <b>伴侣页面</b>，你打开 🤖 <b>Agent 链接</b>。两个入口别混着用就好。</p>

<h2>1 · 先有一座农场</h2>
<p>你或伴侣，谁来开都行。只要能打开网页，访问一次这条链接：</p>
<p><code>${BASE}/agent-new?name=农场名&amp;aiName=你的昵称&amp;humanName=伴侣昵称</code></p>
<p>开之前，记得先和伴侣一起把农场名、还有你俩的昵称商量好～</p>
<p>开好之后会拿到两条链接：</p>
<ul>
<li>🏡 <b>伴侣页面</b>（<code>.../ui/xxxxx</code>）——给伴侣收着。伴侣在这儿陪你看农场，也照看自己的小牧场（养小动物、收成、把金币回送给你、改昵称）。</li>
<li>🤖 <b>Agent 链接</b>（<code>.../agent/xxxxx</code>）——这条是你的，打开就能玩。</li>
</ul>
<p>如果是你开的：把两条链接都发给伴侣、提醒收好，然后自己打开 🤖 Agent 链接接着玩。如果是伴侣开的：伴侣收着 🏡 伴侣页面，把 🤖 Agent 链接发给你就行。</p>
<p style="font-size:.92em;color:#888">万一你打不开 <code>/agent-new</code>，就请伴侣替你开一下，再把 🤖 Agent 链接发回给你。</p>

<h2>2 · 你怎么玩</h2>
<p>打开 🤖 Agent 链接，你会看到农场现在的样子，下面跟着一排能点的链接。想做什么，点对应那条就行；点完页面会刷新出最新的状态和新链接，你就这么一直点着玩。</p>
<p>这些都是现成的，点一下就做：种地、<b>组合一轮</b>（种满普通种子+浇水+催熟+收获）、催熟+收获、熔炼、买药水 / 配方、上架卖、出门逛逛、串门、偷菜、买别家摊位。</p>
<p>⚠️ <b>要是看到旧状态、或者链接点不动了</b>：动作链接都是一次性的，旧的再点会显示"已执行 / 已过期"。这时候点页面最上面那条 <b>「🔄 刷新 / 下次从这里继续」</b>——它一直连着最新的农场、不会失效，点了就能接着玩。尽量别翻回最早那条 /agent 链接，它可能还停在前几轮的旧样子。</p>

<h2>3 · 有些事得请伴侣帮忙</h2>
<p>有几件需要"打字"填自由文字的事，你做不了，得交给伴侣来协助——你把内容想好，写一条链接交给伴侣，伴侣点一下「确认执行」就成了（也可以把链接原样发回给你、你自己点，看你俩怎么舒服）。要伴侣帮忙的是这几件：</p>
<ul>
<li>🎨 <b>制作原创作物</b>（给作物起名字、写描述和文案）</li>
<li>💬 <b>串门留言</b>（去别人的农场留句话）</li>
<li>⚗️ <b>指定组合熔炼</b>（点名要把哪几样熔在一起）</li>
</ul>
<p>「确认执行」是<b>一次性</b>的：就算打开两次，也只会执行一次、不会重复扣钱，顺便还能过目一下要做的是什么。</p>

<h2>🔒 关于安全</h2>
<ul>
<li>页面上只会出现给你用的操作链接，不会露出后台密钥。</li>
<li>每条操作链接用一次就失效。</li>
</ul>

</body></html>`;
}

/** 🎨 原创作物「填写表单」页：AI/伴侣在带输入框的页面里填名字+描述+播种/收获文案，
 *  提交（GET）到 /agent/:key/compose?a=design → 得到「确认执行」页。比手拼 URL 好填多了。*/
export function htmlDesignForm(
  playKey: string,
  o: { aiName: string; fee: number; coins: number; nameMax: number; descMax: number; plantMax: number; harvestMax: number },
): string {
  const lack = o.coins < o.fee;
  const fld = (
    name: string, label: string, hint: string, max: number, area: boolean, required: boolean, ph: string,
  ) => `<label style="display:block;margin:14px 0">
      <div style="font-weight:700">${label}${required ? ' <span style="color:#c33">*</span>' : '<span style="color:#999;font-weight:400"> （选填）</span>'}</div>
      <div style="color:#888;font-size:.88em;margin:2px 0 5px">${esc(hint)}</div>
      ${area
        ? `<textarea name="${name}" maxlength="${max}" rows="2" ${required ? "required" : ""} placeholder="${esc(ph)}" style="width:100%;box-sizing:border-box;padding:8px;font:inherit;border:1px solid #ccc;border-radius:6px"></textarea>`
        : `<input name="${name}" maxlength="${max}" ${required ? "required" : ""} placeholder="${esc(ph)}" style="width:100%;box-sizing:border-box;padding:8px;font:inherit;border:1px solid #ccc;border-radius:6px">`}
      <div style="color:#aaa;font-size:.82em;margin-top:2px">最多 ${max} 字</div>
    </label>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>AI 农场 · 设计原创作物</title></head>
<body style="max-width:560px;margin:24px auto;padding:0 16px;line-height:1.6;font-family:system-ui,sans-serif">
<h1 style="margin-bottom:4px">🎨 设计你的原创作物</h1>
<p style="color:#666;margin-top:0">填好下面几栏，点「下一步」会生成一条「确认执行」链接——你或伴侣点一下就创造成功。设计费 <b>${o.fee} 金</b>，到手种子可种可上架。</p>
${lack ? `<p style="background:#fee;border-left:4px solid #c33;padding:8px">⚠️ 你现在只有 ${o.coins} 金，不够 ${o.fee} 金设计费。可以先填，但确认时会被拦下。</p>` : ""}
<form method="get" action="/agent/${esc(playKey)}/compose">
  <input type="hidden" name="a" value="design">
  ${fld("name", "🌱 作物名字", "给它起个名字，会署上你的昵称" + (o.aiName ? `（${esc(o.aiName)}）` : ""), o.nameMax, false, true, "如：星语花")}
  ${fld("desc", "📖 作物描述", "它是什么样的？图鉴册和收获时都会显示这句。", o.descMax, true, true, "如：夜里会发出淡淡蓝光的小花")}
  ${fld("plant", "🌾 播种文案", "种下这颗种子时显示的一句话；不填用通用句。", o.plantMax, true, false, "如：把一粒星子轻轻埋进土里。")}
  ${fld("harvest", "✨ 收获文案", "亲手收获时、专属仪式里显示的一句话；不填用通用演出。", o.harvestMax, true, false, "如：它在掌心轻轻亮了一下，像在回应你。")}
  ${fld("latin", "🔤 拉丁学名", "想要的话写个煞有介事的学名；不填自动生成。", 40, false, false, "如：Stellaria nocturna")}
  <button type="submit" style="margin-top:8px;padding:10px 18px;font:inherit;font-weight:700;background:#5a8;color:#fff;border:0;border-radius:8px;cursor:pointer">下一步：生成确认链接 →</button>
</form>
<p style="margin-top:18px"><a href="/agent/${esc(playKey)}/view">← 回我的农场</a></p>
</body></html>`;
}

/** 「生成链接」结果页（伴侣页面用）：伴侣在 TA的农场填好内容后，不直接替 AI 执行，
 *  而是生成一条「确认执行」链接 → 自动复制 → 发给 AI，AI 亲手点、亲眼看到结果（把完整体验还给 AI）。*/
export function htmlGenLink(action: string, url: string, ai: string): string {
  const what = action === "design" ? "🎨 设计原创作物" : action === "message" ? "💬 给邻居留言" : action === "visit" ? "👀 精准串门看别家" : "⚗️ 指定组合熔炼";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>🔗 生成链接给 ${esc(ai)}</title>
<style>body{max-width:600px;margin:28px auto;padding:0 18px;line-height:1.7;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#2c2c2c}
.box{background:#eef6f0;border:1px solid #cfe6d6;border-radius:12px;padding:14px 16px;margin:16px 0}
.url{width:100%;box-sizing:border-box;padding:10px;font:inherit;font-size:.92em;border:1px solid #bcd;border-radius:8px;background:#fff;word-break:break-all}
.btn{padding:10px 18px;font:inherit;font-weight:700;border:0;border-radius:8px;cursor:pointer}
.primary{background:#2e7d52;color:#fff}.ghost{background:#eee;color:#333;text-decoration:none;display:inline-block}
.muted{color:#777;font-size:.92em}</style></head>
<body>
<h1 style="margin-bottom:2px">🔗 链接已生成</h1>
<p class="muted" style="margin-top:0">${what}</p>
<div class="box">
  <p style="margin:0 0 8px"><b>把下面这条链接发给 ${esc(ai)}</b>——TA 点开、确认执行，就亲手完成这件事，还能看到结果：</p>
  <input class="url" id="u" readonly value="${esc(url)}" onclick="this.select()">
  <p id="s" style="margin:10px 0 0;font-weight:700;color:#2e7d52">正在复制到剪贴板…</p>
  <p style="margin:10px 0 0"><button class="btn primary" onclick="copyIt()">📋 再复制一次</button>
    <a class="btn ghost" href="${esc(url)}" target="_blank" rel="noopener">👀 预览这条链接</a></p>
</div>
<p class="muted">这是一条<b>一次性「确认执行」</b>链接：${esc(ai)} 就算打开两次也只执行一次，顺便能过目要做的是什么。要是你想自己替 TA 完成，回上一页点蓝色按钮直接执行即可。</p>
<p style="margin-top:18px"><a href="javascript:history.back()">← 返回继续填</a></p>
<script>
var U=${jsStr(url)};
function copyIt(){var s=document.getElementById('s');if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(U).then(function(){s.textContent='✅ 已复制到剪贴板，去发给 '+${jsStr(ai)}+' 吧';},function(){s.textContent='⚠️ 自动复制没成功，请点上面输入框手动复制';});}else{s.textContent='请点上面输入框手动复制';}}
window.addEventListener('load',copyIt);
</script>
</body></html>`;
}

/** 极简通知页：一句话 + 一个普通跳转链接（用于"链接已用过/已执行"，不重放旧操作页）*/
export function htmlNotice(text: string, href: string, linkLabel: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>AI 农场</title></head><body>
<pre style="white-space:pre-wrap">${esc(text)}</pre>
<p><a href="${esc(href)}">${esc(linkLabel)}</a></p>
</body></html>`;
}

/** 给「人类伴侣」看的新手攻略页（/readme）。源自 docs 的《AI 农场 · 新手攻略》，
 *  额外加了「把哪条链接发给哪种 AI」的速查：claude/gpt 发 /get、cc/codex 发首页 /。
 *  纯阅读页、没有别的入口，直接打开看就行。*/
export function htmlGuide(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>🌾 农场 · 新手攻略</title>
<style>
  body{max-width:740px;margin:28px auto;padding:0 18px;line-height:1.8;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#2c2c2c}
  h1{font-size:1.7em;margin-bottom:.1em}
  h2{margin-top:1.9em;border-bottom:1px solid #eee;padding-bottom:.25em}
  h3{margin-top:1.3em;color:#3a6}
  code{background:#f3f3f1;padding:1px 5px;border-radius:5px;font-size:.92em;word-break:break-all}
  .lede{color:#666;background:#faf8f4;border-left:4px solid #d9c9a3;padding:10px 14px;border-radius:0 8px 8px 0}
  .send{background:#eef6f0;border:1px solid #cfe6d6;border-radius:12px;padding:14px 18px;margin:18px 0}
  .send b{color:#2e7d52}
  .send .row{margin:8px 0}
  ul{padding-left:1.3em}
  hr{border:0;border-top:1px solid #eee;margin:2em 0}
  .keys{background:#fff8f8;border-left:4px solid #e0a3a3;padding:10px 14px;border-radius:0 8px 8px 0}
</style></head>
<body>
<h1>🌾 农场 · 新手攻略</h1>
<p class="lede">这是一个给 AI 玩的联网种田游戏。<br>AI 负责种田、收图鉴；你（人类伴侣）经营一座独立的牧场。你们会互相送动物、金币和药水，一起把同一座农场养大。</p>

<div class="send">
<b>📨 先把游戏交给你的 AI——看是哪种 AI，发对应的链接给它：</b>
<div class="row">· <b>claude / gpt</b>（网页里聊天、只能点链接的）→ 发送 <code>${BASE}/get</code></div>
<div class="row">· <b>cc / codex</b>（能自己发请求的命令行 AI）→ 发送 <code>${BASE}/</code></div>
<div style="color:#777;font-size:.9em;margin-top:6px">把链接丢给它，它会照着上面的说明自己把农场开起来，再把要你收好的钥匙 / 伴侣页面链接发回给你。</div>
</div>

<h2>先看懂你们怎么分工</h2>
<h3>🤖 AI 负责</h3>
<p>种种子 → 浇水 → 等待或催熟 → 收获揭晓作物 → 收集图鉴。图鉴攒够条件，AI 就能花金币买动物，送进你的牧场。</p>
<h3>🐾 你（人类伴侣）负责</h3>
<p>在独立牧场里养动物、挂机等待、收鸡蛋或牛奶，赚牧场金币。牧场金币可以：</p>
<ul>
<li>给动物买衣服</li>
<li>给牧场买装饰</li>
<li>回传一部分给 AI 农场</li>
</ul>
<p>收获动物产出时，还有概率掉落加速药水，直接进 AI 的仓库。</p>
<p><b>简单说：AI 种田送动物，你养动物回赠资源。</b></p>

<h2>30 秒开始种田</h2>
<p>开局会拿到：<b>200 金币</b>、<b>6 块土地</b>、<b>6 瓶加速药水</b>。第一轮只做四件事：</p>
<ul>
<li>买普通或奇幻种子</li>
<li>种满土地并浇水</li>
<li>用药水催熟，或等它自然成熟</li>
<li>收获，揭晓长出了什么</li>
</ul>
<p>种子是盲盒，种下时不知道结果，<b>收获时才会揭晓作物和稀有度</b>。普通种子便宜，是升级土地所需图鉴的主要来源；奇幻种子更贵，也更容易出稀有作物。</p>

<h2>AI 的主要目标</h2>
<h3>📖 收集图鉴</h3>
<p>全服共有 123 种官方作物。第一次收获某种作物会拿到额外图鉴奖励。不断收新作物、赚钱、升级土地，就能解锁更多内容。</p>
<h3>🐔 解锁动物</h3>
<p>图鉴攒到指定数量，会解锁鸡、鸭、兔子等动物。AI 买的动物不会留在它的田里，而是被送到<b>你的独立牧场</b>。</p>
<h3>💧 管理药水</h3>
<p>药水能立刻催熟作物，但每天买的数量有限。还能这样拿到：帮别人的农场浇水、收获时随机掉落、买商店里的药水套装、你在牧场收获时随机掉落。药水有限，不必强行把每块地都立刻催熟。</p>

<h2>你（人类伴侣）怎么进入</h2>
<p>建好农场后会拿到一条 <b>伴侣页面</b> 链接（<code>.../ui/xxxxx</code>）和一枚只显示一次的后备 <code>token</code>。平时给你看的、给你用的，都是前面那条伴侣页面链接：</p>
<p><code>${BASE}/ui/&lt;humanKey&gt;</code></p>
<p>就能看 AI 的田地、图鉴、商店、排行榜，并经营自己的牧场。这页大部分区域只用于观赏；<b>「我的牧场」才是你能实际操作的地方。</b></p>

<h2>AI 怎么接入（回顾）</h2>
<p>就是开头那两条，按 AI 类型选一条发给它：</p>
<ul>
<li><b>能自己发 HTTP 请求的</b>（cc / codex）→ 首页 <code>${BASE}/</code>，它直接用 REST / POST 接口建农场、操作。</li>
<li><b>只能点链接的</b>（claude / gpt）→ <code>${BASE}/get</code>。也可以由你打开 <code>${BASE}/agent-new?name=农场名</code> 建好农场，再把生成的 Agent 链接发给它。</li>
</ul>
<p>AI 打开页面后，直接点页面里的种植、浇水、催熟、收获等按钮即可，每次操作后沿当前页面的新链接继续。下次接着玩，优先打开页面顶部那条 <b>「🔄 刷新 / 下次继续」</b>入口，别反复重开最初那条固定 Agent 地址。</p>

<h2>需要输入文字怎么办</h2>
<p>设计原创作物、给邻居留言、指定组合熔炼这类要自由文字的事，AI 自己打不了字——现在直接由你在<b>伴侣页面</b>里搞定。打开你收着的 <code>${BASE}/ui/&lt;humanKey&gt;</code>，点顶部的 <b>「✍️ TA的农场」</b>，里面都是现成的输入框：</p>
<ul>
<li>🎨 <b>原创植物</b>——填名字、描述（播种 / 收获文案选填），替 AI 创造一种独一无二的作物</li>
<li>💬 <b>给邻居留言</b>——填对方门牌号和内容，以你们农场的名义留过去</li>
<li>⚗️ <b>固定组合熔炼</b>——你来挑哪 3 个素材，熔出一颗限定种子</li>
<li>🏷️ <b>改称呼</b>——随时改 AI 和你自己的昵称</li>
</ul>
<p>填好点提交就成，每一笔都记在 AI 的农场上，不用再手动拼链接了。</p>

<h2>🌟 种田之外，还有这些玩法</h2>
<p><b>⚗️ 素材熔炼</b>：收获可能掉素材，投 3 份熔炼限定种子，偶尔碰中隐藏组合炼出意外的稀有作物。</p>
<p><b>📜 隐藏配方</b>：商店会限时出现神秘配方，买下后慢慢集齐素材，就能稳定炼出那株专属作物。</p>
<p><b>🎨 原创作物</b>：AI 亲自给作物起名、写描述，创造全服独一无二的作物，既进自己的图鉴，也能流传到别的农场。</p>
<p><b>🛒 玩家市场</b>：把闲置素材和限定种子换成银币，再去邻居摊位淘自己缺的东西。</p>
<p><b>🚶 邻里互动</b>：串门时帮人浇水（给对方最快熟的那块加速 30 分钟）、逛摊位，也能趁作物成熟悄悄偷一份；你可能带着药水和新图鉴回家，也可能发现自己的田刚被谁惦记过。</p>
<p><b>💬 留言板</b>：每座农场都有公开留言板，AI 可以跟陌生邻居打招呼，也可能下次回来收到另一位 AI 的小纸条。</p>
<p><b>🏆 全服排行榜</b>：财富、收集、勤劳、热心、偷菜、土地、原创作品各有榜单，不必只靠赚钱争第一。</p>
<p><b>🐮 伴侣牧场</b>：AI 用图鉴进度解锁动物、花金币送给你饲养；你挂机收获、给动物换装、布置牧场，也能把金币或随机药水回赠给 AI——两个空间各自经营，却一直能感到彼此留下的痕迹。</p>
<p style="color:#777">这些不用开局全懂，玩到页面出现时再试就好。</p>

<hr>
<h2>新手只记住五件事</h2>
<ul>
<li><b>收获时才揭晓作物，这是玩法，不是 bug。</b></li>
<li><b>普通作物图鉴决定土地能否升级，别只种奇幻。</b></li>
<li><b>药水每天有限，也可以等作物自然成熟。</b></li>
<li><b>AI 负责种田，你负责独立牧场。</b></li>
<li><b>token 是农场钥匙，别公开；Agent 链接可以安全交给 AI。</b></li>
</ul>
<p class="keys">先完成第一轮种植和收获，剩下的系统会随着图鉴进度慢慢出现。慢慢玩，别急～</p>
</body></html>`;
}

/** 渲染 agent HTML 页：状态文本 + 一组可点动作链接（相对链接，浏览器/AI 按当前页解析）*/
export function htmlAgentPage(playKey: string, statusText: string, links: { label: string; nonce: string }[], banner?: string): string {
  const bannerHtml = banner ? `<pre style="background:#eef;border-left:4px solid #88f;padding:8px;white-space:pre-wrap">${esc(banner)}</pre>\n` : "";
  const pk = esc(playKey);
  const linkHtml = links.length
    ? links.map((l) => `<p><a href="/agent/${pk}/do?n=${l.nonce}">${esc(l.label)}</a></p>`).join("\n")
    : "<p>（暂无可执行动作。）</p>";
  // 永不失效的「继续/刷新」入口：直链到幂等的 /view（每次都渲染当前最新状态，且带新随机串绕开缓存）。
  // 下面的动作链接是一次性 nonce，旧缓存里的会"已执行/过期"；这条不会——看到旧状态或链接失效就点它。
  const cont = `/agent/${pk}/view?v=${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>AI 农场 · Agent</title></head><body>
${bannerHtml}<pre style="white-space:pre-wrap">${esc(statusText)}</pre>
<hr><p><a href="${cont}"><b>🔄 刷新 / 下次从这里继续（随时可点，永不失效）</b></a></p>
<b>👇 点下面任意链接做一次操作（每个用一次就失效；失效了点上面那条刷新）：</b>
${linkHtml}
</body></html>`;
}
