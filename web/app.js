const $=id=>document.getElementById(id);
const host=window.RainholmGarden??={};
/* cathome20260913：第三个场景「小窝」＝小白小黑的家。
   它跟花园/花房最大的不同：**服务端没有它的数据** —— 没有地块、没有金币、没有 api/state。
   所以这里分两张名单：allowedScenes 管「能不能去」，dataScenes 管「要不要问服务端」。
   加新场景时两张都要想一遍，别让一个没数据的场景掉进 refresh() 里空转报错。 */
const allowedScenes=['garden','greenhouse','cathome'];
const dataScenes=['garden','greenhouse'];
const sceneName={garden:'花园',greenhouse:'花房',cathome:'小窝'};
const query=new URLSearchParams(location.search);
let scene=allowedScenes.includes(host.initialScene)?host.initialScene:allowedScenes.includes(query.get('scene'))?query.get('scene'):'garden';
let night=host.isNight===true, state=null, confirmed=null, selected=null,page=0,scale=1,online=false,requestVersion=0,controller,clockOffset=0,toastTimer;

const inflight=new Map();   /* 幂等号 → {key,body,snap} */
/* 返修 R2 补验：断网/超时没拿到结果的不再挤单个 pending 互相覆盖——各笔留各笔的幂等号，排队重试 */
const pendings=new Map();   /* 幂等号 → op */
const anyBusy=()=>inflight.size>0;
const plotLock=id=>[...inflight.values(),...pendings.values()].some(o=>o.body.plotId===id);
const viewport=$('viewport'),world=$('world');
const icons=await fetch('assets/v2/icons.json').then(r=>r.ok?r.json():{}).catch(()=>({}));
const icon=name=>icons[name]||'';
const safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const beds=[[[410,390],[620,339],[681,415],[461,464]],[[686,324],[878,276],[950,352],[733,397]],[[480,489],[702,433],[759,524],[522,570]],[[767,421],[976,368],[1055,456],[821,506]],[[547,593],[779,539],[845,634],[593,686]],[[852,530],[1069,475],[1160,563],[909,615]],[[617,714],[859,654],[938,755],[674,812]],[[939,644],[1161,588],[1266,683],[996,741]]];
const unopenedCovers=[{"slot":1,"x":422,"y":344,"width":246,"height":115,"day":"unopened-1-day.png","night":"unopened-1-night.png"},{"slot":2,"x":698,"y":281,"width":239,"height":111,"day":"unopened-2-day.png","night":"unopened-2-night.png"},{"slot":3,"x":493,"y":439,"width":252,"height":125,"day":"unopened-3-day.png","night":"unopened-3-night.png"},{"slot":4,"x":780,"y":374,"width":260,"height":126,"day":"unopened-4-day.png","night":"unopened-4-night.png"},{"slot":5,"x":561,"y":546,"width":269,"height":133,"day":"unopened-5-day.png","night":"unopened-5-night.png"},{"slot":6,"x":866,"y":481,"width":278,"height":128,"day":"unopened-6-day.png","night":"unopened-6-night.png"},{"slot":7,"x":632,"y":662,"width":287,"height":137,"day":"unopened-7-day.png","night":"unopened-7-night.png"},{"slot":8,"x":956,"y":597,"width":292,"height":132,"day":"unopened-8-day.png","night":"unopened-8-night.png"}];
const pots=[[247,394],[347,346],[449,299],[545,252],[1033,303],[1118,359],[1205,420],[1289,478]];
const names={empty:'空土',growing:'生长中',ripe:'可收获'};
const flowerArt={rainholm_flower_cream_star:'cream-star',rainholm_flower_blush_chime:'blush-chime',rainholm_flower_moon_dew:'moon-dew',rainholm_flower_amber_lantern:'amber-lantern'};
/* 收获揭晓亮图鉴彩图，不是文字版
   花房照旧走 flowerArt 的日夜两版；花园作物直接取图鉴那张彩图（就是揭晓后该看到的图，
   跟卡片墙同一份素材，不碰神秘幼苗生长态）。图缺时自己摘掉，留原来的文字不至于开天窗。 */
const revealedArt=c=>scene==='greenhouse'&&flowerArt[c.id]
 ?`<img class="codex-flower" src="assets/v2/${flowerArt[c.id]}-${night?'night':'day'}.png" alt="">`
 :(scene==='garden'&&c?.id?`<img class="codex-reveal-art" src="${cropArt(c.id)}" alt="" onerror="this.remove()">`:'');
/* ── 图鉴卡片墙（codex 素材 123 种，美术 Guchen Zoran）─────────────────────
   铁律：按服务端图鉴记录的真实 cropId 查图，收获次数只读服务端，不由素材数量推导；
   未收获只给灰影 + 前端叠的「?」，名称/拉丁名/介绍/aria 一律遮成「未发现的作物」；
   灰影是另出的一张图，不是彩图降透明度；日夜复用同一张，不套场景夜幕滤镜；
   这些是揭晓后的图，绝不能用到神秘幼苗生长态。
   上游 123 条 desc 全空，介绍区按空值隐藏，不编简介。 */
const cropArt=id=>`assets/codex/${encodeURIComponent(id)}.png`;
const cropShadow=id=>`assets/codex/unknown/${encodeURIComponent(id)}.png`;
const rarityOrder=['N','R','SR','SSR','SP'];
let codexIndex=null,codexIndexWaiting=null;
const loadCodexIndex=()=>codexIndexWaiting??=fetch('assets/codex/index.json').then(r=>r.ok?r.json():null).then(j=>codexIndex=Array.isArray(j?.items)?j:null).catch(()=>null);
function codexEntries(){
 const found=new Map((state?.codex??[]).map(c=>[c.id,c]));
 if(scene!=='garden'){
  const ids=[...new Set([...Object.keys(flowerArt),...found.keys()])];
  return ids.map(id=>{const f=found.get(id);return{id,found:!!f,rarity:f?.rarity??'',name:f?.name??'',latin:'',desc:'',count:f?.count??0,
   art:flowerArt[id]?`assets/v2/${flowerArt[id]}-${night?'night':'day'}.png`:'',shadow:''}});
 }
 const list=codexIndex?.items;
 // 索引没到手就只铺已收获的：宁可少铺，也不猜没收获的是什么
 if(!Array.isArray(list))return [...found.values()].map(c=>({id:c.id,found:true,rarity:c.rarity??'',name:c.name,latin:'',desc:'',count:c.count??0,art:cropArt(c.id),shadow:''}));
 return list.map(d=>{const f=found.get(d.id);return{id:d.id,found:!!f,rarity:d.rarity??'',
  name:f?.name??d.name,latin:d.latin??'',desc:d.desc??'',count:f?.count??0,art:cropArt(d.id),shadow:cropShadow(d.id)}});
}
function codexCard(e){
 const art=e.found?e.art:e.shadow;
 // 缺图也不留空洞：已收获缺图写「图待补」，未收获缺灰影只留空框（不能写任何品种信息）
 const img=art?`<img src="${safe(art)}" alt="" loading="lazy" decoding="async">`:`<span class="art-slot${e.found?'':' blank'}" aria-hidden="true">${e.found?'图待补':''}</span>`;
 if(!e.found)return `<article class="codex-card unknown" aria-label="未发现的作物"><div class="codex-art">${img}<span class="codex-q" aria-hidden="true">?</span></div><strong class="codex-name">未发现的作物</strong></article>`;
 return `<article class="codex-card found" aria-label="${safe(e.name)}${e.rarity?'，'+safe(e.rarity):''}，已收获 ${safe(e.count)} 次"><div class="codex-art">${img}</div>`
  +`<strong class="codex-name">${safe(e.name)}</strong>${e.latin?`<em class="codex-latin">${safe(e.latin)}</em>`:''}`
  +`<span class="codex-meta">${e.rarity?`<b class="rarity r-${safe(e.rarity)}">${safe(e.rarity)}</b>`:''}<span>收获 ${safe(e.count)} 次</span></span>`
  +`${e.desc?`<p class="codex-desc">${safe(e.desc)}</p>`:''}</article>`;
}
function codexWall(){
 const entries=codexEntries();if(!entries.length)return '<div class="empty-state">第一份发现，等你来写。</div>';
 const head=`<p class="codex-progress">已发现 ${entries.filter(e=>e.found).length} / ${entries.length}</p>`;
 if(scene!=='garden')return head+`<div class="codex-grid">${entries.map(codexCard).join('')}</div>`;
 const groups=[...new Set([...rarityOrder,...entries.map(e=>e.rarity)])].filter(r=>entries.some(e=>e.rarity===r));
 return head+groups.map(r=>{const g=entries.filter(e=>e.rarity===r);
  return `<section class="codex-group"><h3 class="codex-group-title"><b class="rarity r-${safe(r)}">${safe(r)||'其他'}</b><span>${g.filter(e=>e.found).length} / ${g.length}</span></h3><div class="codex-grid">${g.map(codexCard).join('')}</div></section>`}).join('');
}
function renderCodex(){
 dialog(scene==='garden'?'花园图鉴':'花的图鉴','<p>亲手收获过的发现，都留在这里。</p>'+codexWall(),'codex');
 // 图掉了也不留空洞：换成占位块
 $('dialog-body').querySelectorAll('.codex-art img').forEach(img=>{img.onerror=()=>{const box=img.closest('.codex-art');if(!box)return;box.classList.add('art-missing');img.replaceWith(Object.assign(document.createElement('span'),{className:'art-slot',textContent:'图待补'}))}});
}
const label=()=>scene==='garden'?'田':'花盆';
const pcurrent=()=>state?.plots.find(p=>p.id===selected);
const blocked=()=>anyBusy()||pendings.size>0||!online;
const hasData=()=>dataScenes.includes(scene);
const canWater=p=>p?.state==='growing'&&p.watered<state.rules.waterCap&&p.canWater!==false;
function normalize(raw,target){
 if(!raw||!Number.isSafeInteger(raw.revision)||!raw.rules||!Number.isFinite(raw.coins)||!(raw.rules.tickMs>0)||!Number.isFinite(raw.rules.waterCap)||!['common','fantasy'].every(k=>Number.isFinite(raw.rules.seedPrice?.[k])&&raw.rules.growTicks?.[k]>0))throw Error('花园数据暂时未就绪');
 if(raw.scene&&raw.scene!==target)throw Error('场景数据不匹配，请稍后重试');
 if(target==='greenhouse'&&(raw.scene!=='greenhouse'||!Array.isArray(raw.flowerPlots)||!Array.isArray(raw.flowerCodex)))throw Error('花房暂未连接好，请稍后再来');
 const plots=target==='garden'?raw.plots:raw.flowerPlots;
 if(!Array.isArray(plots)||!plots.every(p=>Number.isSafeInteger(p.id)&&p.id>0&&['empty','growing','ripe'].includes(p.state)))throw Error('地块数据暂时未就绪');
 return {...raw,plots,codex:target==='garden'?(raw.codex??[]):raw.flowerCodex,history:target==='garden'?(raw.history??[]):(raw.flowerHistory??[])};
}
/* 返修 R1/R2：已确认状态 confirmed 与页面显示 state 分开。
   state 一律 = confirmed + 所有在途动作的乐观投影（rebuild 重算）；
   回包 revision 低于已确认的，不覆盖已确认状态（返回 false，由调用方只结那笔自己的记录）；
   接受全量状态后其余在途投影逐笔重叠，已含该笔效果的（reflected）不重复叠。 */
function accept(raw,target){
 const next=normalize(raw,target);
 if(confirmed&&next.revision<confirmed.revision)return false;
 confirmed=next;clockOffset=Number.isFinite(confirmed.now)?confirmed.now-Date.now():0;
 rebuild();return true;
}
function project(base,body){
 const a=body.action;if(a==='upgrade')return null;
 const plot=base.plots.find(p=>p.id===body.plotId);
 if(!plot)return null;
 const next={...plot};
 if(a==='plant'){
  if(plot.state!=='empty')return null;
  next.state='growing';next.seedType=body.seedType;next.watered=0;next.progress=0;
  next.growTicks=base.rules.growTicks[body.seedType]||1;
  next.readyAt=Date.now()+clockOffset+next.growTicks*base.rules.tickMs;
  next.canWater=true;next.needsWater=false;
  return {...base,coins:base.coins-(base.rules.seedPrice[body.seedType]??0),plots:base.plots.map(p=>p.id===plot.id?next:p)};
 }else if(a==='water'){
  if(!(plot.state==='growing'&&plot.watered<base.rules.waterCap&&plot.canWater!==false))return null;
  next.watered=Math.min(base.rules.waterCap,plot.watered+1);
  next.canWater=next.watered<base.rules.waterCap;next.needsWater=false;
  return {...base,plots:base.plots.map(p=>p.id===plot.id?next:p)};
 }else if(a==='harvest'){
  if(plot.state!=='ripe')return null;
  next.state='empty';next.seedType=null;next.progress=0;next.growTicks=0;next.watered=0;next.readyAt=null;next.canWater=false;next.needsWater=false;
  return {...base,plots:base.plots.map(p=>p.id===plot.id?next:p)};
 }
 return null;
}
function reflected(plot,op){
 const base=op.snap?.plot;if(!base)return false;
 const a=op.body.action,cap=confirmed?.rules.waterCap??Infinity;
 if(a==='plant')return plot.state==='growing'&&plot.seedType===op.body.seedType;
 if(a==='water')return plot.watered>=Math.min(cap,(base.watered??0)+1);
 if(a==='harvest')return plot.state==='empty';
 return false;
}
function rebuild(){
 if(!confirmed){state=null;return}
 let s=confirmed;
 for(const op of inflight.values()){
  const plot=s.plots.find(p=>p.id===op.body.plotId);
  if(plot&&reflected(plot,op))continue;   /* 这份全量已含这笔的效果，不重复叠 */
  s=project(s,op.body)??s;
 }
 state=s;
}
function notify(text){$('toast').textContent=text;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').textContent='',3600)}
function connection(text){$('connection').textContent=text}


const sfxMuted=()=>{try{return localStorage.getItem('cottageSpeakerTts')!=='on'}catch{return true}};
const buzz=p=>{const ok=typeof navigator.vibrate==='function';console.log('[vibrate]',JSON.stringify(p),ok?'':'(navigator.vibrate 不存在，跳过)');if(ok)try{navigator.vibrate(p)}catch{}};
const sfx=(()=>{
 let ctx=null,master=null,armed=false;
 try{document.addEventListener('pointerdown',()=>{armed=true;ensure()},{capture:true,passive:true})}catch(e){}
 function ensure(){
  if(ctx){if(ctx.state==='suspended')ctx.resume();return true}
  const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return false;
  ctx=new AC();master=ctx.createGain();master.gain.value=.30;master.connect(ctx.destination);return true;
 }
 function tone(type,f0,f1,dur,vol,delay=0){
  const t=ctx.currentTime+delay,osc=ctx.createOscillator(),g=ctx.createGain();
  osc.type=type;osc.frequency.setValueAtTime(f0,t);
  if(f1&&f1!==f0)osc.frequency.exponentialRampToValueAtTime(f1,t+dur*.8);
  g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(.001,t+dur);
  osc.connect(g);g.connect(master);osc.start(t);osc.stop(t+dur+.02);
 }
 function play(name,notes){
  console.log('[sfx]',name,JSON.stringify(notes.map(n=>({type:n[0],f0:n[1],f1:n[2],dur:n[3],vol:n[4],delay:n[5]||0}))),sfxMuted()?'(静音：cottageSpeakerTts=off)':'');
  if(!armed||document.hidden||sfxMuted()||!ensure())return;
  notes.forEach(n=>tone(...n));
 }
 return{
  plant(){play('plant-噗',[['sine',170,60,.13,.5],['triangle',90,50,.1,.3,.01]])},
  water(){play('water-叮咚',[['sine',780,1170,.16,.4],['sine',1560,1560,.12,.22,.09]])},
  harvest(){play('harvest-啵+叮',[['sine',300,540,.09,.45],['triangle',1980,1980,.14,.22,.26]])},
  ssr(){play('ssr-琶音',[['triangle',660,660,.14,.3],['triangle',830,830,.14,.3,.09],['triangle',990,990,.2,.32,.18]])}
 };
})();
function dialog(title,html,kind=''){$('dialog-title').textContent=title;$('dialog-body').innerHTML=html;$('dialog').dataset.panel=kind;
 /* codexwall0918-v3：图鉴绿皮在这儿同步挂，不等 codex-ticket-20260918.js 的 MutationObserver ——
    观察者是微任务里才跑的，showModal 后的第一帧先露粉壳猫耳再换绿（玩家 9/18 抓的闪屏）。
    ht-on/ct-on 自带外壳，让位；观察者的 syncWall 留着兜底。 */
 const d=$('dialog');d.classList.toggle('cw-on',kind==='codex'&&!d.classList.contains('ht-on')&&!d.classList.contains('ct-on'));
 if(!d.open)d.showModal()}
function coord(el,x,y){el.style.left=x*scale+'px';el.style.top=y*scale+'px'}
/* ── 四季背景 seasons0918 ───────────────────────────────────────────────────
   花园/花房的底图按「引擎的季节」× 日夜切 16 张之一。
   季节不另建日历：服务端 state.season 直接给中文季名（春/夏/秋/冬，名字来自
   vendor/aifarm/content/seasons.json），这里只做中文→英文文件名的映射。
   日夜也不另建钟：沿用 host-boot.js 的 isNight + gardenNightOverride。
   手动覆盖：localStorage gardenSeasonOverride（auto/spring/summer/autumn/winter），
   URL ?season=winter 写进它 —— 跟 gardenNightOverride 一个脾气，页面上不加钮。
   回滚两条路：window.GARDEN_SEASONS=false，或把 SEASON_V 喂空串；两者都退回 v2 四张。 */


const SEASON_V='seasons0918-v3';
const SEASON_KEYS=['spring','summer','autumn','winter'];
const SEASON_CN2EN={'春':'spring','夏':'summer','秋':'autumn','冬':'winter'};
const SEASON_EN2CN={spring:'春',summer:'夏',autumn:'秋',winter:'冬'};
const SEASON_LS='gardenSeasonOverride';
try{const q=(query.get('season')||'').toLowerCase();
 if(q==='auto')localStorage.removeItem(SEASON_LS);
 else if(SEASON_KEYS.includes(q))localStorage.setItem(SEASON_LS,q);
}catch(_){}
function seasonOverride(){try{const s=localStorage.getItem(SEASON_LS);return SEASON_KEYS.includes(s)?s:''}catch(_){return''}}
/* 返回英文季名；给不出（引擎没到、季名不认识、总闸关了）就返回空串 ＝ 走现役 v2 图 */
function activeSeason(){
 if(window.GARDEN_SEASONS===false||!SEASON_V)return'';
 const ov=seasonOverride();if(ov)return ov;
 return SEASON_CN2EN[state?.season]||SEASON_CN2EN[confirmed?.season]||'';
}


const backdropOf=()=>{
 if(scene==='cathome')return`assets/cat-home-v1/cat-home-${night?'night':'day'}.png?v=cathome0913-v1`;
 const s=activeSeason();
 return s?`assets/v9/seasons-20260918/${scene}-${s}-${night?'night':'day'}.webp?v=${SEASON_V}`
         :`assets/v2/${scene}-${night?'night':'day'}.webp?v=night0913b`;
};
/* 换底图不闪白：先 new Image() 预加载，onload 之后才换 #backdrop 的 src。
   同一张不重设；加载失败保留当前画面（HANDOFF 的要求），下一拍 render 还会再试。
   首帧没有旧画面可留，直接上。 */
let bgWanted='';
function setBackdrop(src){
 const img=$('backdrop');if(!img)return;
 if(src===bgWanted)return;
 bgWanted=src;
 if(!img.getAttribute('src')){img.src=src;return}
 const pre=new Image();
 pre.onload=()=>{if(bgWanted===src)img.src=src};
 pre.onerror=()=>{if(bgWanted===src)bgWanted=img.getAttribute('src')||''};
 pre.src=src;
}
/* 未开垦盖片也跟着季节走：秋/冬底图上盖一块春景的畦会露馅。
   取不到该季的盖片就自己退回 assets/v3 那套，不开天窗。 */
const coverSrc=c=>{
 const s=activeSeason(),f=night?c.night:c.day;
 return s?`assets/v9/seasons-20260918/unopened/${s}/${f}?v=${SEASON_V}`:`assets/v3/${f}`;
};
/* 门牌：每个场景亮它该亮的那几扇。坐标是底图世界坐标（coord 乘 scale）。
   花园有两扇 —— 右上角进花房（老位置没动），左边屋门进小窝（钉在那扇拱形木门上，
   门在世界坐标 x50–133 / y468–678，钮心取 120,606 ＝ 门的下半扇，不压门上花环）。
   小窝只有一扇 —— 门垫上回花园（门垫实测 x428–645 / y750–842，钮心 536,772）。
   这两颗钮本身被 assets/v6/ui-refresh.css 藏起来了（跟 #scene-door 一个待遇），
   看得见的是 .gd-door-mark 那颗奶油箭头；坐标写在这儿是为了跟标记盒心对上，
   万一增量包没加载，这两颗原生钮就是兜底的入口。 */
const SCENE_DOORS={
 garden:[['scene-door','进花房',1170,326],['home-door','进小窝',120,606]],
 greenhouse:[['scene-door','回花园',285,790]],
 cathome:[['home-door','回花园',536,772]]
};
function background(){
 setBackdrop(backdropOf());
 $('mode-icon').src=`assets/v2/${night?'day':'night'}.png`;
 world.classList.toggle('night',night);world.dataset.scene=scene;
 $('night').setAttribute('aria-pressed',String(night));$('night').hidden=host.allowThemePreview!==true;
 for(const id of ['scene-door','home-door']){const b=$(id);if(b)b.hidden=true}
 for(const [id,text,x,y] of (SCENE_DOORS[scene]||[])){
  const b=$(id);if(!b)continue;
  b.hidden=false;b.textContent=text;coord(b,x,y);b.disabled=anyBusy()||pendings.size>0;
 }
 /* OSS 20260912：外部返回钮（#home）整颗拆掉，index.html 里已经没有它。
    花房↔花园的往返只走 #scene-door / #gdDoorMark，这里留一道空判，不再假设那颗钮存在。 */
 const homeBtn=$('home');
 if(homeBtn){homeBtn.setAttribute('aria-label','回花园');homeBtn.disabled=anyBusy()||pendings.size>0;}
}
/* catzoom-20260918：镜头推近，整个世界按场景乘一个倍数。
   玩家 9/18 13:42：「这花园花房，小白小黑的视角就是要比小屋大很多」——
   改的是镜头不是猫：host-cat.js 里 catPct/catW 一个字没动，猫的世界像素尺寸照旧，
   只是 #world 被放大，猫跟着底图一起在屏幕上变大。
   倍数怎么来的：猫在屏上的高 ＝ 1024×catPct% × (world.clientWidth/1536)。
     小窝 CH_CAT_PCT 14.65% ＝ 150 世界像素（这是基准，不动）
     花园 CAT_PCT   9.30% ＝  95.2 世界像素 → 150/95.2 ≈ 1.58
     花房 GH_CAT_PCT 15.2% ＝ 155.6 世界像素 → 已经比小窝还大 2.4%，倍数留 1
   放大只改 scale 这一个数。coord() 和所有 *scale 的宽高、host-cat.js 的 worldScale()、
   duoscenes / ui-refresh 那些按 %「挂在 #world 里」的元素全跟着走；
   fixed 的说话钮/猫爪/角钮/HUD/票签不在 #world 里，一个都不跟着放大。
   玩家晕 3D：这里只有一次性换尺寸，没有连续缩放动画 —— 切场景时 render() 里
   size() 一步到位，镜头那条线（batch4 ④）只平移。 */


const ZOOM={garden:1,greenhouse:1,cathome:1};
const zoomOf=()=>ZOOM[scene]??1;
function size(){scale=Math.max(innerWidth/1536,innerHeight/1024)*zoomOf();world.style.width=1536*scale+'px';world.style.height=1024*scale+'px'}
/* 横向落点：花园看院子中间，花房看门口，小窝看屋子中间；手机窄屏各自往「有门的那半边」挪，
   免得一进门先对着一面墙（小窝窄屏取 700 ＝ 门垫和沙发都进画）。
   catzoom-20260918：放大的场景多一条竖向落点 —— 不放大时世界只比屏高一点点，
   顶着上边看不出毛病；放大后花园高 1517px 对 900 的屏，还顶着上边就只剩天空，
   八畦全在画外。cy 取 540 ＝ 八畦（y 276–812）的中线。倍数是 1 的场景
   （小窝/花房）一行都不写 scrollTop，行为跟 9/17 完全一样。 */
function center(){
 const cx=scene==='garden'?805:scene==='cathome'?(innerWidth<=600?700:785):(innerWidth<=600?430:768);
 viewport.scrollLeft=Math.max(0,cx*scale-innerWidth/2);
 if(zoomOf()>1){
  const cy=540,maxT=Math.max(0,viewport.scrollHeight-viewport.clientHeight);
  viewport.scrollTop=Math.min(maxT,Math.max(0,cy*scale-innerHeight/2));
 }
}
function paintPlant(src,x,y,height,box){const p=document.createElement('img');p.className='plant';p.src=src;p.alt='';p.style.height=height*scale+'px';coord(p,x,y);(box??$('plants')).append(p)}


const fxLayer=Object.assign(document.createElement('div'),{id:'fx'});
world.append(fxLayer);
const reducedMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
const stageOf=p=>p.state==='ripe'?2:p.growTicks>0&&p.progress/p.growTicks>=.5?1:0;
const noticeOf=p=>p.state==='ripe'?'harvest':p.needsWater===true&&canWater(p)?'water':'';
const sigOf=(p,slot)=>p?`${p.id}|${p.state}|${stageOf(p)}|${p.seedType??''}|${p.watered}|${noticeOf(p)}`:`cover${slot}`;
let slotSigs=[],viewToken='',fxMute=false,coinRoll=null,coinRaf=0;
const killAfter=(el,ms)=>setTimeout(()=>{if(!window.__fxHold)el.remove()},ms);   /* __fxHold 仅供验收脚本冻结中景截图 */
const slotPlants=slot=>[...($('plants').children[slot]?.querySelectorAll('.plant')??[])];
function rollCoins(from,to){
 cancelAnimationFrame(coinRaf);
 if(reducedMotion()||from===to){$('coins').textContent=to;return}
 const t0=performance.now(),dur=350;
 const step=t=>{const k=Math.min(1,(t-t0)/dur),e=1-Math.pow(1-k,3);$('coins').textContent=Math.round(from+(to-from)*e);if(k<1)coinRaf=requestAnimationFrame(step)};
 coinRaf=requestAnimationFrame(step);
}

function fxSow(x,y){
 const s=document.createElement('img');s.className='fx-seed';s.src='assets/v4/seed.png';s.alt='';coord(s,x,y-6);fxLayer.append(s);killAfter(s,520);
 for(const dx of[-26,6,30]){const d=document.createElement('i');d.className='fx-soil';d.style.setProperty('--fx-dx',dx*scale+'px');d.style.setProperty('--fx-dy',(-20-Math.abs(dx)*.35)*scale+'px');coord(d,x,y-2);fxLayer.append(d);killAfter(d,460)}
}
function fxWater(slot,x,y){
 for(let i=0;i<3;i++){const d=document.createElement('i');d.className='fx-drop';d.style.animationDelay=i*70+'ms';coord(d,x+(i-1)*22*scale,y);fxLayer.append(d);killAfter(d,760)}
 slotPlants(slot).forEach(img=>{img.classList.remove('fx-sway');void img.offsetWidth;img.classList.add('fx-sway')});
}
function fxGrow(slot,x,y){
 slotPlants(slot).forEach(img=>img.classList.add('fx-grow'));
 const s=document.createElement('i');s.className='fx-sweep';s.style.width=70*scale+'px';s.style.height=150*scale+'px';coord(s,x,y+10);fxLayer.append(s);killAfter(s,600);
}
function fxFull(x,y){
 const b=document.createElement('div');b.className='fx-bubble';b.textContent='喝饱了';coord(b,x,y-(scene==='garden'?70:150));fxLayer.append(b);killAfter(b,1300);
}
function fxHarvest(x,y,oStage,oSeed){
 const src=scene==='garden'?`assets/${night?'v3':'v2'}/plant-${(oSeed==='fantasy'?3:0)+oStage}${night?'-night':''}.png`:`assets/v2/${['sprout','growing','ready-bud'][oStage]}-${night?'night':'day'}.png`;
 const img=document.createElement('img');img.className='plant fx-jump';img.src=src;img.alt='';
 img.style.height=(scene==='garden'?(oStage===0?48:72):[75,110,135][oStage])*scale+'px';
 coord(img,x,y+(scene==='garden'?12:5));fxLayer.append(img);killAfter(img,600);
 const vr=viewport.getBoundingClientRect(),sx=vr.left+x*scale-viewport.scrollLeft,sy=vr.top+(y-60)*scale-viewport.scrollTop;
 const pill=$('coins').parentElement.getBoundingClientRect(),cx=pill.left+pill.width/2,cy=pill.top+pill.height/2;
 const c=document.createElement('img');c.className='fx-coin';c.src='assets/v4/coin.png';c.alt='';
 c.style.left=sx+'px';c.style.top=sy+'px';c.style.setProperty('--fx-dx',cx-sx+'px');c.style.setProperty('--fx-dy',cy-sy+'px');
 document.body.append(c);killAfter(c,600);
}
function playSlotFx(slot,p,oldSig,x,y){
 if(!p||fxMute||reducedMotion()||oldSig.startsWith('cover'))return;
 const[,oState,oStageS,oSeed,oWaterS]=oldSig.split('|'),oStage=+oStageS,oWatered=+oWaterS;
 const stage=stageOf(p),cap=state?.rules.waterCap??Infinity;
 if(oState==='empty'&&p.state==='growing'&&p.watered===0)return fxSow(x,y);
 if(oState&&oState!=='empty'&&p.state==='empty')return fxHarvest(x,y,oStage,oSeed);
 if(p.state==='empty')return;
 if(stage>oStage)return fxGrow(slot,x,y);
 if(p.watered>oWatered){fxWater(slot,x,y);if(p.watered>=cap&&oWatered<cap)fxFull(x,y)}
}
function paintSlot(slot,p,oldSig){
 let plantsBox=$('plants').children[slot],plotsBox=$('plots').children[slot];
 if(!plantsBox){plantsBox=document.createElement('div');plantsBox.className='plant-slot';$('plants').append(plantsBox)}
 if(!plotsBox){plotsBox=document.createElement('div');plotsBox.className='plot-slot';$('plots').append(plotsBox)}
 plantsBox.replaceChildren();plotsBox.replaceChildren();
 if(!p){
  if(scene==='garden'){
   const c=unopenedCovers[slot],cover=document.createElement('img');cover.className='unopened-cover';
   cover.onerror=()=>{cover.onerror=null;cover.src=`assets/v3/${night?c.night:c.day}`};
   cover.src=coverSrc(c);cover.alt='';coord(cover,c.x,c.y);cover.style.width=c.width*scale+'px';cover.style.height=c.height*scale+'px';plantsBox.append(cover);
   const b=beds[slot],x=b.reduce((s,v)=>s+v[0],0)/4,y=b.reduce((s,v)=>s+v[1],0)/4;
   const locked=document.createElement('button');locked.className='plot-hit unopened-hit';locked.setAttribute('aria-label','未开垦，查看土地升级');coord(locked,x-90,y-40);locked.style.width=180*scale+'px';locked.style.height=80*scale+'px';locked.onclick=()=>openPanel('upgrade');plotsBox.append(locked);
  }
  return;
 }
 const hit=document.createElement('button');hit.className='plot-hit';hit.dataset.plot=p.id;hit.setAttribute('aria-label',`${p.id}号${label()}，${names[p.state]}${p.state==='empty'?'，点按选种子，长按直接挑'+(scene==='garden'?'种子':'花种'):''}`);hit.setAttribute('aria-pressed',String(p.id===selected));
 let x,y;
 if(scene==='garden'){
  const b=beds[slot];const left=Math.min(...b.map(v=>v[0])),top=Math.min(...b.map(v=>v[1])),w=Math.max(...b.map(v=>v[0]))-left,h=Math.max(...b.map(v=>v[1]))-top;
  x=b.reduce((s,v)=>s+v[0],0)/4;y=b.reduce((s,v)=>s+v[1],0)/4;coord(hit,left,top);hit.style.width=w*scale+'px';hit.style.height=h*scale+'px';hit.style.clipPath='polygon('+b.map(v=>`${(v[0]-left)/w*100}% ${(v[1]-top)/h*100}%`).join(',')+')';
 }else{[x,y]=pots[slot];coord(hit,x-50,y-65);hit.style.width=Math.max(44,100*scale)+'px';hit.style.height=Math.max(44,100*scale)+'px'}
 hit.onclick=()=>openCard(p.id);plotsBox.append(hit);
 if(p.state!=='empty'){
  const stage=stageOf(p);
  if(scene==='garden')for(let k=-1;k<=1;k++)paintPlant(`assets/${night?'v3':'v2'}/plant-${(p.seedType==='fantasy'?3:0)+stage}${night?'-night':''}.png`,x+k*53,y-k*13+12,stage===0?48:72,plantsBox);
  else paintPlant(`assets/v2/${['sprout','growing','ready-bud'][stage]}-${night?'night':'day'}.png`,x,y+5,[75,110,135][stage],plantsBox);
 }
 // No implicit drought: server opts in to a watering reminder, and an action must be available.
 const notice=noticeOf(p);
 if(notice){const m=document.createElement('button');m.className='bubble '+notice;m.dataset.notice=p.id;m.textContent=notice==='harvest'?'可收获':'!';m.setAttribute('aria-label',`${p.id}号${label()}，${notice==='harvest'?'可收获':'可以浇水'}`);coord(m,x,y-(scene==='garden'?50:p.state==='ripe'?142:86));m.onclick=()=>openCard(p.id);plotsBox.append(m)}
 if(oldSig&&oldSig!==sigOf(p,slot))playSlotFx(slot,p,oldSig,x,y);
}
function render(force=false){
 size();background();
 $('retry').hidden=!pendings.size;$('retry').disabled=anyBusy();
 /* cathome20260913：小窝没有金币/季节/生长倒计时，也没有图鉴收获篮升级 ——
    与其让它们挂着一排「—」，不如整排收走；回花园自己长回来。 */
 const solo=!hasData();
 const hud=document.querySelector('.hud');if(hud)hud.hidden=solo;
 document.querySelectorAll('#menu [data-open="codex"],#menu [data-open="history"],#menu [data-open="upgrade"]').forEach(b=>b.hidden=solo);
 if(!state){$('coins').textContent='—';$('season').textContent='—';$('tick').textContent='—';$('card').hidden=true;$('pages').hidden=true;$('plants').replaceChildren();$('plots').replaceChildren();slotSigs=[];viewToken='';return}
 if(coinRoll){const[a,b]=coinRoll;coinRoll=null;rollCoins(a,b)}else $('coins').textContent=state.coins;
 /* seasons0918：手动覆盖开着的时候 HUD 跟着覆盖走，免得季节字跟底图各说各话。
    没开覆盖就还是服务端那个字，一字不改。 */
 const sAct=activeSeason();
 $('season').textContent=(sAct&&sAct===seasonOverride()&&SEASON_EN2CN[sAct])||state.season||'—';
 const pages=Math.max(1,Math.ceil(state.plots.length/8));page=Math.max(0,Math.min(page,pages-1));$('pages').hidden=pages<=1;
 $('page-label').textContent=`${page+1} / ${pages}`;$('page-prev').disabled=page===0||blocked();$('page-next').disabled=page===pages-1||blocked();
 /* seasons0918：季节也进签名 —— 换季要重画未开垦盖片，跟换昼夜一个待遇 */
 const token=`${scene}|${page}|${night}|${state.plots.length}|${activeSeason()}`;
 const rebuildAll=force||token!==viewToken;viewToken=token;
 if(rebuildAll){$('plants').replaceChildren();$('plots').replaceChildren();slotSigs=[]}
 for(let slot=0;slot<8;slot++){
  const p=state.plots[page*8+slot],sig=sigOf(p,slot);
  if(!rebuildAll&&slotSigs[slot]===sig)continue;
  paintSlot(slot,p,rebuildAll?null:slotSigs[slot]??null);
  slotSigs[slot]=sig;
 }
 updateCard();tick();fxMute=false;
}
function updateCard(){
 const p=pcurrent();$('card').hidden=!p;if(!p)return;
 $('plot-title').textContent=`${String(p.id).padStart(2,'0')}号${label()} · ${names[p.state]}`;
 $('plot-status').textContent=p.state==='empty'?'埋下一颗种子，等一个小惊喜 · 长按地块直接挑':p.state==='ripe'?'可以收获了，揭晓这一份惊喜':`神秘幼苗 · 已浇 ${p.watered}/${state.rules.waterCap} 次`;
 document.querySelectorAll('.action').forEach(b=>b.disabled=!online||plotLock(p.id)||!(b.dataset.action==='seed'?p.state==='empty':b.dataset.action==='water'?canWater(p):p.state==='ripe'));
 $('plots').querySelectorAll('[aria-pressed]').forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.plot===selected)));placeCard();
}
function openCard(id){selected=id;updateCard()}
function closeCard(){selected=null;$('card').hidden=true;$('plots').querySelectorAll('[aria-pressed]').forEach(b=>b.setAttribute('aria-pressed','false'))}
function placeCard(){
 if($('card').hidden)return;const hit=$('plots').querySelector(`[data-plot="${selected}"]`);if(!hit){closeCard();return}const r=hit.getBoundingClientRect(),c=$('card');
 c.style.left=(innerWidth<=600?(innerWidth-c.offsetWidth)/2:Math.min(innerWidth-c.offsetWidth-20,Math.max(20,r.right+14)))+'px';
 c.style.top=(innerWidth<=600?Math.max(110,innerHeight-c.offsetHeight-93):Math.min(innerHeight-c.offsetHeight-22,Math.max(80,r.top)))+'px';
}
function tick(){
 if(!state)return;const now=Date.now()+clockOffset,ms=state.rules.tickMs;
 let next=state.nextTickAt;
 if(!Number.isFinite(next)&&ms>0){const p=state.plots.find(p=>Number.isFinite(p.readyAt));if(p)next=now+((p.readyAt-now)%ms+ms)%ms}
 if(!Number.isFinite(next)||!(ms>0)){$('tick').textContent='—';return}
 const delta=next-now;const seconds=Math.ceil((delta>0?Math.min(delta,ms):ms-((-delta)%ms))/1000);
 $('tick').textContent=`${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;
}
async function refresh(){
 if(anyBusy()||pendings.size)return;
 if(!hasData()){online=true;connection('');return}   /* cathome20260913：小窝没有 api/state，问下去只会 400；起手直开小窝时把起手横幅也收掉（与 setScene 同语义） */
 const target=scene,version=++requestVersion;controller?.abort();controller=new AbortController();const activeController=controller;const timer=setTimeout(()=>activeController.abort(),12000);
 try{const r=await fetch(`api/state?scene=${target}`,{credentials:'same-origin',cache:'no-store',signal:controller.signal});const b=await r.json();if(version!==requestVersion||target!==scene)return;if(!r.ok||!b.ok)throw Error(b.error||'暂时连接不上');accept(b.state,target);online=true;connection('');render()}
 catch(e){if(version!==requestVersion||target!==scene)return;online=false;connection(e.name==='AbortError'?'连接有点慢，请稍后刷新':e.message||'暂时连接不上');render()}
 finally{clearTimeout(timer)}
}
async function setScene(next){
 if(!allowedScenes.includes(next))return false;
 if(anyBusy()||pendings.size){notify('先确认这次操作的结果，再去另一边');return false}
 ++requestVersion;controller?.abort();scene=next;page=0;selected=null;state=null;confirmed=null;$('dialog').close();$('menu').hidden=true;
 /* cathome20260913：没有服务端数据的场景（小窝）一进门就算「连上了」——
    它不欠服务端任何东西，连接条留在那儿转只会吓人。 */
 online=!hasData();connection(hasData()?'正在打开'+sceneName[scene]+'…':'');
 render();center();window.dispatchEvent(new CustomEvent('rainholm:garden-scene',{detail:{scene}}));
 if(!hasData())return true;
 await refresh();return online;
}


function applyOptimistic(body){
 const before=state,next=project(state,body);
 if(!next)return null;
 state=next;
 return {plot:before.plots.find(p=>p.id===body.plotId),coins:next.coins};
}
function matchesOptimistic(op){
 if(!op.snap||!state)return true;
 const p=state.plots.find(p=>p.id===op.body.plotId);if(!p)return false;
 const a=op.body.action;
 /* 显示态金币现在是 confirmed+投影推出来的，并发多笔下没有可比对的绝对值，
    只看这块地本身有没有按这笔的意图落位 */
 if(a==='plant')return p.state==='growing'&&p.seedType===op.body.seedType;
 if(a==='water')return p.watered===Math.min(state.rules.waterCap,op.snap.plot.watered+1);
 if(a==='harvest')return p.state==='empty';
 return true;
}
async function sendAction(action,extra={}){
 if(!state)return;
 let op=null,isRetry=false;
 const hit=[...pendings.values()].find(o=>o.body.action===action&&(extra.plotId==null||o.body.plotId===extra.plotId));
 if(hit){op=hit;isRetry=true}   /* 重试同一笔，幂等号不变 */
 else{
  if(!online)return;
  if(action==='upgrade'){if(anyBusy()||pendings.size)return}   /* 升级照旧整页锁 */
  else if(plotLock(extra.plotId??null))return;                 /* 闸只锁同一块地，不锁整页 */
  op={key:crypto.randomUUID(),body:{scene,action,...extra,revision:confirmed.revision}};
 }
 op.snap=applyOptimistic(op.body);
 if(!op.snap&&op.body.action!=='upgrade'&&!isRetry)return;   /* 状态已不允许（钮该灰着），不多发 */
 if(op.snap){
  if(action==='plant'){sfx.plant();buzz(15)}
  else if(action==='water'){sfx.water();buzz(15)}        /* 长按浇满是一发一发的，每涨一格震一下 */
  else if(action==='harvest'){sfx.harvest();buzz(15)}
 }
 inflight.set(op.key,op);
 ++requestVersion;controller?.abort();
 render();
 let refetch=false;
 try{
  const r=await fetch('api/action',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Garden-Action':'1','Idempotency-Key':op.key},body:JSON.stringify(op.body),signal:AbortSignal.timeout(12000)});const b=await r.json();
  if(r.status>=500)throw Error(b.error||'暂时连接不上');
  const coinsBefore=state?.coins;
  inflight.delete(op.key);pendings.delete(op.key);
  /* 对账（返修 R1）：回包 revision 比已确认旧就不覆盖（fresh=false），只结这笔自己的记录；
     接受的全量状态里其余在途投影由 rebuild 保留。
     返修 R4：本笔已结清，不论回包新旧、也不论缺 state 走兜底，都要从最新 confirmed+剩余
     inflight 重算显示态——否则旧 409 会让本笔乐观投影留在页面上（accept 旧包提前返回不 rebuild） */
  const fresh=b.state?accept(b.state,op.body.scene):false;
  if(!fresh)rebuild();
  if(!b.state)refetch=true;
  online=r.status!==401;
  if(b.ok){
   connection('');
   if(!b.state)notify('状态没跟上，正在刷新');
   else{
    if(action==='harvest'&&fresh&&Number.isFinite(coinsBefore)&&state.coins!==coinsBefore)coinRoll=[coinsBefore,state.coins];
    if(b.reveal){const c=b.reveal;
     if(c.rarity==='SSR'||c.rarity==='SP'){sfx.ssr();buzz([30,40,60])}
     dialog(c.isNew?'图鉴里的新朋友':'这一回，收到了……',`<div class="reveal">${revealedArt(c)||`<div class="plant-emblem">${icon('sparkles')}</div>`}<h3>${safe(c.name)}</h3><p>${safe(c.rarity)} · ${safe(c.quality)}</p><p>收成 ${safe(c.value)} 金${c.codexReward?' · 新图鉴奖励 '+safe(c.codexReward)+' 金':''}</p><p>金币已结算，发现已留在图鉴里。</p></div>`)}
    else if(op.snap&&!matchesOptimistic(op))notify('和花园对了一下，已按实际情况摆好');
    else notify(b.capped?'好运已经攒满':'照料好啦');
    /* 返修 R3：已确认状态随事件一起发，地块组件直接消费，不再多拉一次 GET */
    window.dispatchEvent(new CustomEvent('rainholm:garden-action',{detail:{...op.body,revision:confirmed?.revision,state:confirmed}}));
   }
  }
  else{notify(b.error||'这次操作没完成');if(r.status===401)connection('没有权限，请检查服务端配置')}   /* ok:false/冲突：状态已按响应对账 */
 }catch{
  inflight.delete(op.key);pendings.set(op.key,op);
  rebuild();fxMute=true;               /* 断网/超时（返修 R2）：撤掉这笔乐观投影，从最新已确认状态重算，回滚不播动效 */
  online=false;connection('还没收到结果。重试会核对同一笔操作，不会重复扣款。');notify('没连上，这次先还原了');
 }
 finally{render();if(refetch&&!pendings.size&&online)await refresh()}
}
function openPanel(which){
 $('menu').hidden=true;$('menu-toggle').setAttribute('aria-expanded','false');
 if(which==='about')return dialog('关于这座小花园','<p>规则引擎来自初一（tutusagi）的 aifarm-oss。感谢他创造了收获时才揭晓的盲盒农场。</p><p>Required Notice: Copyright 2026 tutusagi.</p><p><a href="https://github.com/tutusagi/aifarm-oss" target="_blank" rel="noopener">原作与 PolyForm Noncommercial 1.0.0 许可</a></p><p>场景与界面：Rainholm Garden，美术 Guchen Zoran。字体：站酷快乐体（OFL）。图标：Lucide（ISC）。</p>');
 if(!state)return notify('先等这边连接好');
 if(which==='seeds'){
  const p=pcurrent();if(!p||p.state!=='empty')return;
  dialog(scene==='garden'?'挑一粒种子':'挑一粒花种','<p>种下时支付种子费，收获时才知道它是谁。</p>'+Object.entries(state.rules.seedPrice).filter(([k])=>['common','fantasy'].includes(k)).map(([k,price])=>`<div class="seed-row"><div class="seed-icon">${icon('sprout')}</div><div class="seed-copy"><strong>${k==='common'?'普通':'奇幻'}${scene==='garden'?'种子':'花种'}</strong><small>约 ${Math.round(state.rules.growTicks[k]*state.rules.tickMs/60000)} 分钟 · ${safe(price)} 金</small></div><button data-seed="${k}" ${blocked()||state.coins<price?'disabled':''}>种下</button></div>`).join(''));
 }else if(which==='history')dialog('收获篮','<p>收成已经结算，这里留着最近的收获。</p>'+(state.history.map(c=>`<div class="crop-row"><div><strong>${safe(c.name)}</strong><small>${safe(c.rarity)} · ${safe(c.quality)}</small></div><span>+${safe(c.value)} 金</span></div>`).join('')||'<div class="empty-state">篮子还空着，先种下一点期待。</div>'));
 else if(which==='codex'){
  renderCodex();
  // 索引是懒加载的：先把已收获的铺出来，123 格的墙等索引到了当场重铺
  if(scene==='garden'&&!codexIndex)loadCodexIndex().then(()=>{if($('dialog').open&&$('dialog').dataset.panel==='codex')renderCodex()});
 }
 else if(which==='upgrade'){
  const n=state.land?.next;dialog(scene==='garden'?'把土地慢慢养肥':'扩展花房',n?`<p>下一阶：${safe(n.next?.name)} · ${safe(n.next?.plots)} 个种植位</p><p>${safe(n.next?.upgradeCost||JSON.stringify(n.req??{}))}</p><p>新增地块会放在下一片，原来的进度都保留。</p><button id="confirm-upgrade" ${blocked()?'disabled':''}>确认升级</button>`:'<p>这边的种植位已经全部开放。</p>');
 }
}
$('close-dialog').onclick=()=>$('dialog').close();$('close-card').onclick=closeCard;
$('dialog-body').onclick=e=>{const b=e.target.closest('button');if(!b||b.disabled)return;if(b.dataset.seed){const id=selected;$('dialog').close();sendAction('plant',{plotId:id,seedType:b.dataset.seed})}if(b.id==='confirm-upgrade'){$('dialog').close();sendAction('upgrade')}};
document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>openPanel(b.dataset.open));
document.querySelectorAll('.action').forEach(b=>b.onclick=()=>{if(b.disabled)return;const p=pcurrent();if(!p)return;if(b.dataset.action==='seed')openPanel('seeds');else sendAction(b.dataset.action,{plotId:p.id})});
$('menu-toggle').onclick=()=>{$('menu').hidden=!$('menu').hidden;$('menu-toggle').setAttribute('aria-expanded',String(!$('menu').hidden))};
$('refresh').onclick=()=>{$('menu').hidden=true;refresh()};$('retry').onclick=()=>{const op=pendings.values().next().value;op&&sendAction(op.body.action,{plotId:op.body.plotId})};
$('scene-door').onclick=()=>setScene(scene==='garden'?'greenhouse':'garden');
$('home-door').onclick=()=>setScene(scene==='cathome'?'garden':'cathome');
/* OSS 20260912：外部返回钮已拆，场景往返只留 #scene-door。 */
function setTheme(value){night=!!value;render(true)}
$('night').onclick=()=>setTheme(!night);
$('page-prev').onclick=()=>{if(page>0&&!blocked()){page--;closeCard();render();center()}};$('page-next').onclick=()=>{if(state&&page<Math.ceil(state.plots.length/8)-1&&!blocked()){page++;closeCard();render();center()}};
viewport.addEventListener('scroll',placeCard,{passive:true});
let drag=null;
viewport.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&!e.target.closest('button'))drag=[e.clientX,e.clientY,viewport.scrollLeft,viewport.scrollTop]});
window.addEventListener('pointermove',e=>{if(drag){viewport.scrollLeft=drag[2]+drag[0]-e.clientX;viewport.scrollTop=drag[3]+drag[1]-e.clientY}});window.addEventListener('pointerup',()=>drag=null);


window.addEventListener('resize',()=>{const a=document.activeElement;if(a&&/^(INPUT|TEXTAREA)$/.test(a.tagName))return;render(true);center()});window.addEventListener('keydown',e=>{if(e.key==='Escape'){closeCard();$('menu').hidden=true}});
Object.assign(host,{setTheme,refresh,setScene,getScene:()=>scene,getState:()=>confirmed,plant:(plotId,seedType)=>sendAction('plant',{plotId,seedType}),version:'web-v2.2-oss-feel-20260916'});
window.dispatchEvent(new CustomEvent('rainholm:garden-ready',{detail:{version:host.version}}));
render();center();await refresh();setInterval(tick,1000);setInterval(()=>{if(!document.hidden)refresh()},30000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});
