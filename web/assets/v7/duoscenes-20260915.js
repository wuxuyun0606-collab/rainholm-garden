


(function () {
  "use strict";

  var WORLD_W = 1536, WORLD_H = 1024;

  /* ── 可调的那一份 ──────────────────────────────────────────────────────────
     scene ＝ 这一幕挂在哪个场景（picnic0918：从「整支只认小窝」改成按场景取幕）
     rect  ＝ 视频帧铺在世界坐标的 [左, 上, 边长]（方的）或 [左, 上, 宽, 高]（不方的）
     hot   ＝ 热区：box 是外接矩形 [左,上,宽,高]，poly 是切形状用的百分比顶点
             （数值抄自 host-cat.js 1c 段那份家具落地面，同一套坐标）
     spots ＝ 幕起幕落时两只猫站的位置，都过了 spotOk（地板内、不在家具落地面里）
             且彼此 ≥ turf.near（小窝 150、花园 120），不然 command() 会被 farFromOthers 拦掉。
             sofafix0918 补的第二条上限：**也要 ≤ turf.near × 1.8**（小窝 270、花园 216）——
             那是【结伴】开始拽黑猫的距离（batch4-20260914.js 第 307 行 STOP）。
             越了线，幕布底下每秒挨一发 command，哨兵当场落幕（文件头 ① 段）。
             现况：睡觉 240 ✓、沙发 233 ✓（改前 362 ✗）、野餐 148 ✓。
             `ndsDuo.state().gap` 随时读这三个数，改站位以后先看它再截图
     loop  ＝ 循环不循环。false ＝ 一次性动作，播完停末帧（picnic）
     arriveMs ＝ 单只走到的上限。不填走 TIMING.ARRIVE_MS（花园地大，picnic 自己加长） */
  var CFG = {
    sleep: {
      name: "sleep", label: "床", scene: "cathome",
      ariaOn: "床，一起睡觉", ariaOff: "起床",
      video: "assets/cats-duo-20260915/sleep-duo-alpha-v1.webm?v=alphaclean0918",
      poster: "assets/cats-duo-20260915/sleep-duo-poster.png?v=alphaclean0918",
      rect: [470, 127, 434.88],
      hot: { box: [482, 312, 423, 215], poly: [[0, 47.91], [48.70, 0], [100, 50.23], [51.54, 100]] },
      spots: { white: [560, 585], black: [800, 590] }
    },
    sofa: {
      name: "sofa", label: "沙发", scene: "cathome",
      ariaOn: "沙发，一起坐下", ariaOff: "起身",
      video: "assets/cats-duo-20260915/sofa-duo-alpha-v1.webm?v=alphaclean0918",
      poster: "assets/cats-duo-20260915/sofa-duo-poster.png?v=alphaclean0918",
      rect: [992.5, 332, 217.44],
      hot: {
        box: [940, 388, 362, 258],
        poly: [[0, 25.97], [45.58, 0], [100, 32.56], [96.13, 65.12], [66.85, 100], [6.08, 63.57]]
      },
      /* sofafix0918：黑猫从 (1250,650) 挪到 (1130,700)。白猫一个像素没动。
         为什么挪黑猫不挪白猫：白猫那个点是 9/15 解出来的（圆几和地板下沿之间就那一道口子，
         挪了它黑猫就没路走）；黑猫原来蹲在书架跟前，离白猫 362 —— 越过【结伴】的 270 线，
         幕布底下每秒挨一发指令（文件头 ① 段）。
         新点是真机搜出来的，不是摆的：对 RainholmCats.spotOk 跑 10px 网格，
         筛「两点都站得住 + 彼此 195~235 + 黑猫仍在白猫右边」，再按「离原站位最近」排序，
         头名就是它。实测 spotOk(1130,700)=true、离白猫 232.6（150 ＜ 232.6 ＜ 270 ✓）。
         画面上还更顺：黑猫从书架边挪到沙发正前方，脚线 y=700 压过沙发落地面下沿(646)
         和圆几下沿(668)，等距图里该在它们前面，遮挡关系没变。
         A/B 实测（结伴开着，两只钉在站位上 reveal 沙发幕）：
           老站位 362 → 约 1 秒幕布自己弹掉；新站位 233 → 连盯 12 秒 active 一直是 sofa。 */
      spots: { white: [920, 800], black: [1130, 700] }
    },


    picnic: {
      name: "picnic", label: "野餐布", scene: "garden",
      ariaOn: "野餐布，一起吃饼干", ariaOff: "起身",
      video: "assets/cats-duo-20260915/picnic-duo-alpha-v1.webm?v=picnic0918-v1",
      poster: "assets/cats-duo-20260915/picnic-duo-poster.png?v=picnic0918-v1",
      rect: [214, 206, 213.32, 121.89],
      /* 热区 ＝ PICNIC_MAT_FLOOR 那四个点（host-cat.js 294 行，跟猫的脚点判法同一套坐标）：
         W(183,285) N(393,200) E(500,272) S(290,358)。box 取它们的外接矩形，
         poly 是这四点在 box 里的百分比 —— 切成垫子那块菱形，不往草坪上糊。 */
      hot: {
        box: [183, 200, 317, 158],
        poly: [[0, 53.80], [66.25, 0], [100, 45.57], [33.75, 100]]
      },
      spots: { white: [252, 312], black: [400, 310] },
      loop: false,
      arriveMs: 26000
    }
  };

  /* 两只是**一前一后**走的，不是一起出发 —— 先白后黑，这个顺序不能反。
     host-cat.js 的 catwalkStep 有一条防叠罗汉：两只挨到 turf.near（小窝 150）以内，
     **序号大的那只**（黑猫）当场收住、这趟指令作废。白猫序号 0，从来不会被收 ——
     所以让白猫先走先停，黑猫再绕开它走，才不会互相把对方的指令撞掉。
     spots 里那四个点是照着这条规矩解出来的：白猫停好之后，黑猫从「家/床边/沙发边」
     任一处走到自己那个点，全程离白猫都 ≥150，两个终点也彼此 ≥150。
     （小窝就一条过道 —— 圆几和地板下沿之间那道口子，两只挤不下；
     所以沙发那一幕白猫的位置压得比较低，在地毯前沿而不是沙发正前。） */
  var WALK_ORDER = ["white", "black"];

  var TIMING = {
    ARRIVE_MS: 12000,   /* 单只走到的上限：最远那程（黑猫绕过圆几）约 8 秒，留一半余量 */
    ARRIVE_TICK: 160,   /* 等它走的时候多久看一眼 */
    WATCH_TICK: 200,    /* 幕布放着的时候多久校准一次（ghostfix20260915：这一拍同时管「猫收没收」和「有没有人下指令」） */
    NEAR_OK: 70,        /* 站定点离我们指的点这么近就算到位 */
    RETRY: 2,           /* 万一还是被逼停了，再指几次（引擎自己的注释就写着「再点一次就是」） */
    FADE_MS: 300,       /* 跟 CSS 里 .nds-stage 的 .26s 对齐，留一点余量再 pause */
    WAIT_CATS_MS: 4000  /* ghostfix20260915：猫还没挂好就点了幕，先等它挂上再走位，最多等这么久 */
  };

  var $ = function (id) { return document.getElementById(id); };

  var RM = null;
  try { RM = window.matchMedia("(prefers-reduced-motion: reduce)"); } catch (_) { }
  function reduced() { try { return !!(RM && RM.matches); } catch (_) { return false; } }

  var world = null, layer = null, hots = null, stages = {}, hotEls = {}, dead = false, booted = false;
  var scene = "garden";
  var active = null;        /* 正在放的那一幕 */
  var pending = null;       /* 猫还在走过去的那一幕 */
  var arriveT = 0, watchT = 0, fadeT = 0;
  var dragFrom = null;

  function cats() {
    var c = window.RainholmCats;
    return (c && c.mounted && typeof c.poses === "function") ? c : null;
  }

  /* ── 按住猫 ghostfix20260915 ────────────────────────────────────────────────
     v1 是「落幕那一拍调一次 api.off()」，有个洞：猫层是异步挂的（host-cat.js 要先拉
     pixi、再切八张走路横条），玩家在猫挂好之前点沙发，那一拍 cats() 还是 null，
     off() 压根没执行 —— 幕布上了，猫层还露着、ticker 还在转，两只猫在幕布底下
     继续溜达，走到沙发附近就从叠层后面透出来一层。玩家 9/15 真机截图里那层
     「小白重影」就是这么来的。

     不是漏藏了哪一层：sprite / 待机帧 / 影子 / 热区 / 气泡全都是 #rhCatLayer 的孩子，
     off() 一藏全藏（DOM 全量扫描实测过，正常路径下幕上时 #world 里没有任何猫元素）。
     病根是那一句根本没跑到。

     所以「藏猫」从一次性动作改成**幂等的、每一拍重新校准**：只要幕布还在，
     每 WATCH_TICK 毫秒确认一次猫层是不是真收起来了，没收就再收一次。
     猫晚到多久都接得上，最多漏一拍（200ms）。 */
  function catLayer() { return document.getElementById("rhCatLayer"); }

  function catsHidden() {
    var l = catLayer();
    return !l || !!l.hidden;
  }

  function holdCats() {
    var api = cats();
    if (!api || typeof api.off !== "function") return false;
    if (!catsHidden()) { try { api.off(); } catch (_) { } }
    return catsHidden();
  }

  /* ═════════════ 1. 铺层 ═════════════ */

  /* picnic0918：rect 支持两种写法 —— [左,上,边长]（方的，小窝那两幕）
     和 [左,上,宽,高]（不方的，野餐素材 1344×768）。少写一位就当方的，老幕一字没改。 */
  function rectWH(r) { return [r[2], (r.length > 3 ? r[3] : r[2])]; }

  function pctRect(r) {
    var wh = rectWH(r);
    return {
      left: (r[0] / WORLD_W * 100).toFixed(4) + "%",
      top: (r[1] / WORLD_H * 100).toFixed(4) + "%",
      width: (wh[0] / WORLD_W * 100).toFixed(4) + "%",
      height: (wh[1] / WORLD_H * 100).toFixed(4) + "%"
    };
  }

  function buildStage(cfg) {
    var el = document.createElement("div");
    el.className = "nds-stage";
    el.id = "nds" + cfg.name.charAt(0).toUpperCase() + cfg.name.slice(1);
    el.hidden = true;
    el.setAttribute("aria-hidden", "true");
    var p = pctRect(cfg.rect);
    el.style.left = p.left; el.style.top = p.top;
    el.style.width = p.width; el.style.height = p.height;

    var img = document.createElement("img");
    img.src = cfg.poster; img.alt = ""; img.decoding = "async";
    el.appendChild(img);

    /* preload="none"：不进这一幕就一个字节都不下。真按下去才 load()，
       素材 1.3MB / 2.9MB，别让它们跟花园首屏抢带宽。 */
    var v = document.createElement("video");
    v.muted = true; v.defaultMuted = true;
    /* picnic0918：循环不循环由这一幕自己说了算。野餐是一次性动作（递饼干→咬一口→笑），
       循环放会变成机械重复的鬼畜，所以 loop:false，播完停在末帧。 */
    v.loop = cfg.loop !== false;
    v.playsInline = true;
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");
    v.setAttribute("muted", "");
    v.preload = "none";
    /* postercover0918：玩家 9/18 18:52 真机截图「小白两只」—— 视频本身每帧只有一只（拆 8 帧核过），
       多出来那只是底下那张静帧 <img> 从视频后面露出来的：玩家手机上两层没对齐，白猫错开一圈。
       两刀：① video 自己的 poster 属性不再设（和 <img> 是同一张图，安卓上多一层多一次错位）；
       ② 视频真的在放（nds-play）时给舞台挂 nds-live，CSS 把 <img> 收掉 —— 视频盖住了就没它的事，
       它想露也没得露。暂停（非播完）摘掉 nds-live，静帧回来兜底。 */
    v.addEventListener("playing", function () { v.classList.add("nds-play"); el.classList.add("nds-live"); });
    /* picnic0918：播完那一下也会把 paused 置 true。这时候**不能**摘 nds-play ——
       摘了视频就淡出、露出底下的 <img>。海报正好是末帧，画面其实一样，
       但中间隔着 .18s 的 opacity 过渡，会闪一下。所以播完的不摘，只有真被 pause() 的才摘。 */
    v.addEventListener("pause", function () { if (!v.ended) { v.classList.remove("nds-play"); el.classList.remove("nds-live"); } });
    v.addEventListener("ended", function () { v.classList.add("nds-play"); el.classList.add("nds-live"); });
    el.appendChild(v);

    el.__cfg = cfg; el.__video = v; el.__img = img;
    return el;
  }

  function buildHot(cfg) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "nds-hot";
    b.dataset.ndsHot = cfg.name;
    b.setAttribute("aria-label", cfg.ariaOn);
    var x = cfg.hot.box;
    b.style.left = (x[0] / WORLD_W * 100).toFixed(4) + "%";
    b.style.top = (x[1] / WORLD_H * 100).toFixed(4) + "%";
    b.style.width = (x[2] / WORLD_W * 100).toFixed(4) + "%";
    b.style.height = (x[3] / WORLD_H * 100).toFixed(4) + "%";
    b.style.clipPath = "polygon(" + cfg.hot.poly.map(function (p) {
      return p[0] + "% " + p[1] + "%";
    }).join(",") + ")";
    b.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      /* picnic0918：热区压在猫层上头（#ndsHots z-index 3 ＞ #rhCatLayer 1），
         而白猫在花园的家 (252,312) 正好在野餐垫上 —— 不管这一下，玩家点小白就不是
         「摸一摸」而是起幕，猫身上那块永远摸不着了。小窝那两幕没这毛病（两只的家
         都在热区外），所以这一道只在真有猫挡着的时候才走：把自己临时变透明，
         问一句这个点下面是不是 .rh-cat-hit，是就把这一下原样转给猫。 */
      var cat = catHitAt(e.clientX, e.clientY, b);
      if (cat) { try { cat.click(); } catch (_) { } return; }
      toggle(cfg.name);
    });
    return b;
  }

  /* 把 self 临时摘出命中链，看看这个屏幕点底下压着的是不是某只猫的热区。
     幕布放着的时候猫层是 hidden 的，elementFromPoint 自然什么也找不到 —— 不用另外判。 */
  function catHitAt(cx, cy, self) {
    if (cx == null || cy == null) return null;
    var prev = self.style.pointerEvents;
    self.style.pointerEvents = "none";
    var el = null;
    try { el = document.elementFromPoint(cx, cy); } catch (_) { }
    self.style.pointerEvents = prev;
    if (!el || typeof el.closest !== "function") return null;
    return el.closest(".rh-cat-hit");
  }

  /* 夜色滤镜本体：逐通道缩放的 feColorMatrix。数值＝夜图÷日图在那块家具上的通道均值比
     （床 .775/.642/.567、沙发 .611/.550/.501，量法见 css 里那段）。
     必须 color-interpolation-filters="sRGB"：默认的 linearRGB 会把暗部提亮一大截，
     跟我们量的 sRGB 均值对不上。CSS 那两个变量指向这两个 id，换口味只改 CSS。 */
  var NIGHT_MX = { ndsNightSleep: [0.775, 0.642, 0.567], ndsNightSofa: [0.611, 0.550, 0.501] };

  function buildNightFilters() {
    if ($("ndsFilters")) return;
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.id = "ndsFilters";
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("width", "0"); svg.setAttribute("height", "0");
    svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
    Object.keys(NIGHT_MX).forEach(function (id) {
      var m = NIGHT_MX[id];
      var f = document.createElementNS(NS, "filter");
      f.setAttribute("id", id);
      f.setAttribute("color-interpolation-filters", "sRGB");
      var cm = document.createElementNS(NS, "feColorMatrix");
      cm.setAttribute("type", "matrix");
      cm.setAttribute("values", [
        m[0], 0, 0, 0, 0,
        0, m[1], 0, 0, 0,
        0, 0, m[2], 0, 0,
        0, 0, 0, 1, 0
      ].join(" "));
      f.appendChild(cm);
      svg.appendChild(f);
    });
    document.body.appendChild(svg);
  }

  function mount() {
    if (booted || dead) return;
    world = $("world");
    if (!world) return;
    booted = true;

    buildNightFilters();

    layer = document.createElement("div");
    layer.id = "ndsLayer";
    hots = document.createElement("div");
    hots.id = "ndsHots";

    Object.keys(CFG).forEach(function (k) {
      var st = buildStage(CFG[k]);
      stages[k] = st;
      layer.appendChild(st);
      var h = buildHot(CFG[k]);
      hotEls[k] = h;
      hots.appendChild(h);
    });

    /* 跟 host-cat.js 一个位置：插在 #plots 之前 —— 压在底图/猫之上、地块钮之下 */
    var plots = $("plots");
    if (plots && plots.parentNode === world) { world.insertBefore(layer, plots); world.insertBefore(hots, plots); }
    else { world.appendChild(layer); world.appendChild(hots); }

    syncScene(currentScene());

    /* 幕布放着的时候，点地板 ＝ 起来 + 把白猫支使过去。
       为什么要自己接这一发：host-cat.js 的 onWorldClick 开头就 `if (layer.hidden) return`，
       猫层被我们收起来的时候它是不接活的。捕获层、不 preventDefault，跟它一个规矩。 */
    world.addEventListener("pointerdown", function (e) { dragFrom = [e.clientX, e.clientY]; }, true);
    world.addEventListener("click", onWorldClick, true);

    /* 切后台回来视频常常是暂停的（WebView 尤其）：回前台补一发 play */
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) kick();
    });
    /* 手机 WebView 的规矩：拒绝无手势 play()。进这一幕本来就是用户点出来的，
       手势有；这条是补第二道 —— 万一被挡了，页面上任何一次触摸都再试一次。 */
    document.addEventListener("touchstart", kick, { passive: true, capture: true });
    document.addEventListener("pointerdown", kick, { passive: true, capture: true });
  }

  function currentScene() {
    try {
      var host = window.RainholmGarden || {};
      if (typeof host.getScene === "function") return host.getScene() || "garden";
      if (world && world.dataset && world.dataset.scene) return world.dataset.scene;
      return host.initialScene || "garden";
    } catch (_) { return "garden"; }
  }

  /* picnic0918：这一幕归不归当前场景管 */
  function hereNow(key) {
    var c = CFG[key];
    return !!c && c.scene === scene;
  }

  /* picnic0918：从「整支只认小窝」改成「当前场景有幕才活」。
     v1 是一个 HOME_SCENE 常量 + 整层 hidden，多一个场景就塞不下了。
     现在层永远在，逐幕按 cfg.scene 决定露不露 —— 小窝那两幕的行为一字没变：
     scene==="cathome" 时它俩的热区亮着、picnic 的收着，反过来也一样。 */
  function syncScene(next) {
    scene = next || "garden";
    if (active && !hereNow(active)) hide(true);
    var any = false;
    Object.keys(CFG).forEach(function (k) {
      var here = hereNow(k);
      if (here) any = true;
      if (hotEls[k]) hotEls[k].hidden = !here;
      if (!here && stages[k] && !stages[k].hidden) {
        stages[k].hidden = true;
        stages[k].setAttribute("aria-hidden", "true");
        stages[k].classList.remove("nds-in");
        try { if (stages[k].__video) stages[k].__video.pause(); } catch (_) { }
      }
    });
    if (layer) layer.hidden = !any;
    if (hots) hots.hidden = !any;
  }

  /* ═════════════ 2. 幕起幕落 ═════════════ */

  function stopTimers() {
    if (arriveT) { clearInterval(arriveT); arriveT = 0; }
    if (watchT) { clearInterval(watchT); watchT = 0; }
  }

  function paintHots() {
    if (!hots) return;
    var list = hots.querySelectorAll(".nds-hot");
    for (var i = 0; i < list.length; i++) {
      var k = list[i].dataset.ndsHot, c = CFG[k];
      list[i].setAttribute("aria-label", active === k ? c.ariaOff : c.ariaOn);
      list[i].setAttribute("aria-pressed", String(active === k));
    }
  }

  function toggle(key) {
    if (dead || !hereNow(key)) return;
    if (active === key) { hide(false); return; }
    if (pending === key) { pending = null; stopTimers(); return; }   /* 走一半又点了一次 ＝ 算了 */
    show(key);
  }

  /* 指两只猫去床边/沙发边，都站定了再落幕布。
     减动效档下猫的 ticker 本来就不转（host-cat.js: reduced → 只画一帧），
     指了也不会走 —— 那一档直接给静帧，不等。 */
  function show(key) {
    var cfg = CFG[key];
    if (!cfg) return;
    if (active) hide(true);
    stopTimers();

    if (reduced()) { pending = null; reveal(key); return; }

    pending = key;
    settled = [];                 /* sofafix0918：这一幕的牵绳名单从空开始 */
    /* ghostfix20260915：猫还没挂好就别急着落幕 —— v1 在这儿直接 reveal，
       结果 reveal 里 api 还是 null，off() 没执行，猫就漏在幕布底下了。
       现在先等它挂上（最多 WAIT_CATS_MS），等不到也照落 —— 但 reveal 那边
       改成了每一拍重新校准，晚到的猫一样会被收走。 */
    if (cats()) { leg(key, 0); return; }
    var waited = 0;
    stopTimers();
    arriveT = setInterval(function () {
      waited += TIMING.ARRIVE_TICK;
      if (pending !== key || dead) { stopTimers(); return; }
      if (cats()) { stopTimers(); leg(key, 0); return; }
      if (waited >= TIMING.WAIT_CATS_MS) { stopTimers(); pending = null; reveal(key); }
    }, TIMING.ARRIVE_TICK);
  }

  function poseOf(api, id) {
    var ps = [];
    try { ps = api.poses() || []; } catch (_) { }
    for (var i = 0; i < ps.length; i++) if (ps[i].id === id) return ps[i];
    return null;
  }

  /* ── 牵绳 sofafix0918 ───────────────────────────────────────────────────────
     先到的那只不许自己溜达走。

     两只是一前一后走的：白猫先到，然后**还要等黑猫走完一整程**（小窝 2~4 秒，
     花园能到 22 秒）。这段时间 ticker 还在转，host-cat 的自主遛弯照常挑新目标 ——
     白猫站定没多久就自己踱开了，等黑猫到位、幕布落下的时候，白猫早不在沙发边了。
     9/18 桌面档实测（1440×900，点沙发→【一起玩耍】）：
       t=3.6s 白猫到位 (895,801)
       t=4.4s 白猫 cmd=0 自己起步往左走   ← 没人拽着它
       t=6.8s 黑猫到位 (1130,700)，白猫已经漂到 (760,725)
       t=6.9s 幕布落下，两只相隔 377      ← 又越过【结伴】那条 270 线
       t=7.2s 结伴发指令，幕布当场弹掉
     ——所以光把站位改近没用，漂移会把距离重新拉开。手机档那一跑侥幸没漂，
     说明这是个看运气的病，不是没有。

     牵绳＝每一拍看一眼已经到位的那几只，三种情况三种待遇（cmd 这一位就是分界线：
     true ＝ 正在执行谁下的指令，false ＝ 自主遛弯）：
       · st==="walk" 且 cmd  → 正听着话走（多半就是上一拍被我们拽回去的那程），不插嘴
       · st==="walk" 且 !cmd → **自主遛弯，立刻拽回去，不看偏了多少**
                               第一版这里跟 idle 一起被 `st === "walk"` 一刀跳过了，
                               结果白猫一口气往外遛了 170 像素（4.4s→6.5s 一直是 walk），
                               牵绳一次都没响 —— 幕布落下时还是 399。这一位是这次的关键
       · idle / nap          → 偏出 NEAR_OK 才拽；就地打盹在自己位子上的不吵它 */
  var settled = null;

  function leash(key) {
    var api = cats();
    if (!api || !settled || !settled.length || typeof api.command !== "function") return;
    var R = TIMING.NEAR_OK;
    for (var i = 0; i < settled.length; i++) {
      var id = settled[i], s = CFG[key].spots[id];
      if (!s) continue;
      var p = poseOf(api, id);
      if (!p) continue;
      if (p.st === "walk" && p.cmd) continue;
      if (p.st !== "walk") {
        var dx = p.x - s[0], dy = p.y - s[1];
        if (dx * dx + dy * dy <= R * R) continue;
      }
      try { api.command(id, s[0], s[1]); } catch (_) { }
    }
  }

  /* 一只一只送过去：第 n 只到位（或者指不动/等超时）再送第 n+1 只。顺序见 WALK_ORDER。 */
  function leg(key, idx) {
    if (pending !== key || dead) return;
    if (idx >= WALK_ORDER.length) { pending = null; reveal(key); return; }
    var api = cats();
    if (!api) { pending = null; reveal(key); return; }
    var id = WALK_ORDER[idx], s = CFG[key].spots[id];
    /* picnic0918：花园地大 —— 黑猫从右下角那头绕接缝过来实测 22 秒，
       小窝那 12 秒的上限在这儿会中途放弃。所以上限跟着幕走。 */
    var budget = CFG[key].arriveMs || TIMING.ARRIVE_MS;
    /* sofafix0918：交棒之前把这一只记进牵绳名单，下一程走着的时候就有人拽着它了 */
    var next = function () {
      stopTimers();
      if (settled && settled.indexOf(id) < 0) settled.push(id);
      leg(key, idx + 1);
    };

    var moved = false;
    try { moved = api.command(id, s[0], s[1]); } catch (_) { }
    /* 指不动：要么它已经站在那儿了（command 里 farFromOthers/路线判死），要么真过不去。
       都不用等 —— 接着送下一只。 */
    if (!moved) { next(); return; }

    var waited = 0, tries = 0;
    stopTimers();
    arriveT = setInterval(function () {
      waited += TIMING.ARRIVE_TICK;
      if (pending !== key || dead) { stopTimers(); return; }
      leash(key);                                   /* sofafix0918：先到的那几只别跑 */
      var p = poseOf(api, id);
      if (!p) { next(); return; }
      if (p.st === "walk") { if (waited < budget) return; next(); return; }
      var dx = p.x - s[0], dy = p.y - s[1];
      if (Math.sqrt(dx * dx + dy * dy) <= TIMING.NEAR_OK) { next(); return; }   /* 到位 */
      /* 没到位又不走了 ＝ 半路被逼停（引擎那条防叠罗汉会顺手把 cmd 作废）。
         照它自己的话「再点一次就是」，指够 RETRY 次还不到位就不硬拽了 ——
         幕布照落，两只真猫这会儿本来就藏着，差几十像素不影响画面。 */
      if (tries < TIMING.RETRY && waited < budget) {
        tries++;
        try { api.command(id, s[0], s[1]); } catch (_) { }
        return;
      }
      next();
    }, TIMING.ARRIVE_TICK);
  }

  /* 真正把幕布放下来：收猫 → 淡入 → 盯着有没有人下指令 */
  function reveal(key) {
    var st = stages[key];
    if (!st) return;
    active = key;
    settled = null;               /* sofafix0918：幕起了，ticker 一停就没人会漂，牵绳收工 */
    paintHots();

    /* ghostfix20260915：收猫是幂等的，这里只是「第一次尝试」，成不成都不影响 ——
       底下那个 tick 每 200ms 会再确认一次，猫晚到也跑不掉。 */
    var held = holdCats();

    st.hidden = false;
    st.setAttribute("aria-hidden", "false");
    /* 强制回流一次，不然 hidden→false 和加 class 在同一帧，transition 不触发 */
    void st.offsetWidth;
    st.classList.add("nds-in");

    if (!reduced()) {
      var v = st.__video;
      if (v) {
        if (!v.getAttribute("src")) { v.setAttribute("src", st.__cfg.video); v.load(); }
        /* picnic0918：不循环那一幕播完停在末帧，再点一次得**从头**放，
           不然第二次进来只看见一张定格。循环那两幕本来就一直在转，不碰。 */
        else if (st.__cfg.loop === false) { try { v.currentTime = 0; } catch (_) { } }
        play(v);
      }
    }

    /* 这个 tick 无条件起（v1 是 `if (api)` 才起 —— 猫晚到就永远没人管了）。
       它管两件事，顺序不能反：
         1. 先把猫按住（幂等，见 holdCats）。
         2. 猫**真的按住之后**再判打断。为什么要等：抢跑那条路上猫可能正走着，
            刚按住那一拍 st 还是 "walk"，直接判会把幕布自己弹掉。所以按住的
            头一拍只记账不判，从下一拍起才算数。 */
    /* 这个 tick 无条件起（v1 是 `if (api)` 才起 —— 猫晚到就永远没人管了）。
       它管两件事，顺序不能反：先把猫按住，按住之后再判有没有人下指令。 */
    stopTimers();
    var snap = held ? poseSnap() : null;
    watchT = setInterval(function () {
      if (active !== key || dead) { stopTimers(); return; }
      if (!holdCats()) { snap = null; return; }      /* 还没按住 / 被谁重新显示了：先按住，快照作废 */
      if (snap === null) { snap = poseSnap(); return; }   /* 刚按住这一拍只记账，不判 */
      var now = poseSnap();
      if (now !== null && now !== snap) { hide(false); }
    }, TIMING.WATCH_TICK);
  }

  /* ghostfix20260915：打断判定改成「跟冻住那一刻比对」，不是「看见 walk 就算」。
     为什么：off() 只停 ticker，不改状态机 —— 一只在半路被冻住的猫，st 会永远停在
     "walk"，拿 st==='walk' 当信号会让幕布刚放下就自己弹掉。
     ticker 停着的时候猫自己一个字段都不会变，所以**任何字段变了 = 有人调了 command()**
     （startWalk 会动 st/dir/frame，command 会把 cmd 置 true）。拼成一个串比对，
     比盯单个字段稳。 */
  function poseSnap() {
    var api = cats();
    if (!api) return null;
    var ps = [];
    try { ps = api.poses() || []; } catch (_) { return null; }
    var out = [];
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      out.push([p.id, p.st, p.cmd ? 1 : 0, Math.round(p.x), Math.round(p.y), p.dir, p.frame].join(":"));
    }
    return out.join("|");
  }

  /* sofafix0918：真猫回场。只在「这会儿没有别的幕在放」的时候才放 ——
     落幕淡出那 300ms 里玩家要是又点了一幕，新幕的 reveal() 已经把猫按住了，
     这边再 on() 一下就是把猫放到新幕布底下（哨兵 200ms 后才收得回来，中间会闪）。 */
  function showCats() {
    if (active) return false;
    var api = cats();
    if (!api || typeof api.on !== "function") return false;
    try { api.on(); } catch (_) { return false; }
    return true;
  }

  function hide(instant) {
    stopTimers();
    pending = null;
    settled = null;               /* sofafix0918：幕落了，牵绳解开 */
    var key = active;
    if (!key) return;
    active = null;
    paintHots();
    var st = stages[key];


    if (!st) { showCats(); return; }
    st.classList.remove("nds-in");
    if (fadeT) { clearTimeout(fadeT); fadeT = 0; }
    var done = function () {
      fadeT = 0;
      st.hidden = true;
      st.setAttribute("aria-hidden", "true");
      var v = st.__video;
      if (v) { try { v.pause(); } catch (_) { } }
      showCats();                      /* 幕布收干净了，这才轮到真猫 */
    };
    if (instant || reduced()) done();
    else fadeT = setTimeout(done, TIMING.FADE_MS);
  }

  function play(v) {
    try {
      var p = v.play();
      if (p && typeof p.catch === "function") p.catch(function () { /* 没手势就算了，静帧还在，下一次触摸再试 */ });
    } catch (_) { }
  }

  /* 任何一次触摸/按下都补一发 play —— 只对正在放的那一幕，别把没开的也叫醒。
     picnic0918：**播完的不补**。野餐是一次性动作，末帧定格之后 paused 也是 true，
     不加 !ended 这一道，玩家在定格上随便碰一下屏幕，两只猫就会从头再递一次饼干。 */
  function kick() {
    if (!active || reduced()) return;
    var st = stages[active];
    if (!st || !st.__video) return;
    if (st.__video.paused && !st.__video.ended) play(st.__video);
  }

  /* ═════════════ 3. 点地板 ═════════════ */

  var UI_SEL = "button,a,input,select,textarea,label,dialog,.card,.hud,nav,.pages,.connection,.retry,.toast,.plot-hit";

  function onWorldClick(ev) {
    if (!active || dead || !hereNow(active)) return;
    if (ev.button != null && ev.button !== 0) return;
    if (dragFrom && (Math.abs(ev.clientX - dragFrom[0]) > 6 || Math.abs(ev.clientY - dragFrom[1]) > 6)) return;
    var t = ev.target;
    if (t && typeof t.closest === "function" && t.closest(UI_SEL)) return;   /* 钮/卡片/热区 —— 放行 */
    var r = world.getBoundingClientRect();
    if (!r.width) return;
    var k = r.width / WORLD_W;
    var x = (ev.clientX - r.left) / k, y = (ev.clientY - r.top) / k;
    hide(false);                              /* 先起来 */
    /* sofafix0918：猫层这会儿还藏着（要等淡完那 300ms），但 command() 不看猫层 ——
       host-cat.js 的 command 只校地形和另一只猫，照样受理。
       指令先记下，ticker 在 on() 那一刻开转，猫接着就走。 */
    var api = cats();
    if (api && typeof api.command === "function") { try { api.command("white", x, y); } catch (_) { } }
  }

  /* ═════════════ 4. 接线 ═════════════ */

  window.addEventListener("rainholm:garden-scene", function (ev) {
    var next = ev && ev.detail && ev.detail.scene;
    if (next) syncScene(next);
  });

  window.addEventListener("rainholm:garden-ready", function () { setTimeout(function () { mount(); syncScene(currentScene()); }, 0); });
  setTimeout(function () { if (!booted && !dead) { mount(); } }, 1500);

  /* sofafix0918 验收探针：每幕两只猫的站位隔多远，两条线各过不过。
       lo ＝ turf.near（farFromOthers 的下限，低了 command() 直接不受理）
       hi ＝ turf.near × 1.8（【结伴】开始拽猫的距离，高了幕布会被它弹掉）
     站位一改就读一眼这个，别靠目测。当前场景的 turf 取不到就只报距离。 */
  function spotGaps() {
    var near = null;
    try { var a = cats(); if (a && typeof a.turf === "function") near = a.turf().near; } catch (_) { }
    var out = {};
    Object.keys(CFG).forEach(function (k) {
      var s = CFG[k].spots, dx = s.black[0] - s.white[0], dy = s.black[1] - s.white[1];
      var d = Math.round(Math.sqrt(dx * dx + dy * dy) * 10) / 10;
      var here = hereNow(k);
      out[k] = {
        d: d, here: here,
        lo: (here && near) ? near : null,
        hi: (here && near) ? Math.round(near * 1.8) : null,
        ok: (here && near) ? (d >= near && d <= near * 1.8) : null
      };
    });
    return out;
  }

  /* ═════════════ 5. 旋钮 + 验收探针 ═════════════
     玩家要的「可调」都在这儿：改完 apply() 立刻生效，不用改文件、不用刷新。
       ndsDuo.set('sleep', {rect:[470,127,435]})   挪幕布（方的）
       ndsDuo.set('picnic',{rect:[214,206,213.32,121.89]})  挪幕布（不方的：左上宽高）
       ndsDuo.set('sofa',  {spots:{white:[1150,700]}})  改猫站的位置
       ndsDuo.show('sleep') / ndsDuo.hide() / ndsDuo.state() / ndsDuo.off() */
  window.ndsDuo = {
    version: "duoscenes-20260915-v3+picnic0918+sofafix0918",
    cfg: CFG,
    timing: TIMING,
    set: function (key, patch) {
      var c = CFG[key];
      if (!c || !patch) return false;
      if (patch.rect) c.rect = patch.rect;
      if (patch.spots) { c.spots.white = patch.spots.white || c.spots.white; c.spots.black = patch.spots.black || c.spots.black; }
      var st = stages[key];
      if (st && patch.rect) {
        var p = pctRect(c.rect);
        st.style.left = p.left; st.style.top = p.top; st.style.width = p.width; st.style.height = p.height;
      }
      return true;
    },
    /* 验收用：跳过走路直接落幕（截图不用等猫走完那 7 秒） */
    reveal: function (key) { stopTimers(); pending = null; reveal(key); return active; },
    show: function (key) { show(key); return pending || active; },
    hide: function (instant) { hide(!!instant); return active; },
    state: function () {
      var st = active ? stages[active] : null;
      var v = st ? st.__video : null;
      return {
        scene: scene, active: active, pending: pending, reduced: reduced(),
        catsMounted: !!cats(),
        catsHidden: catsHidden(),        /* ghostfix20260915：幕上的时候这里必须是 true */
        catsTicking: (function () { var a = cats(); try { return a ? a.ticking() : null; } catch (_) { return null; } })(),
        video: v ? { paused: v.paused, t: +v.currentTime.toFixed(2), w: v.videoWidth, h: v.videoHeight, src: v.getAttribute("src") || null } : null,
        rect: active ? CFG[active].rect.slice() : null,
        gap: spotGaps()                  /* sofafix0918：每幕两个站位隔多远、过不过那两条线 */
      };
    },
    /* 幕布在屏幕上的实际盒子（验收对位就读这个，不靠目测） */
    box: function (key) {
      var st = stages[key || active];
      if (!st) return null;
      var a = st.getBoundingClientRect(), b = world.getBoundingClientRect(), k = b.width / WORLD_W;
      return { screen: { x: a.left, y: a.top, w: a.width, h: a.height }, world: { x: (a.left - b.left) / k, y: (a.top - b.top) / k, w: a.width / k, h: a.height / k }, k: k };
    },
    off: function () {
      dead = true; stopTimers(); hide(true);
      try { if (layer && layer.parentNode) layer.parentNode.removeChild(layer); } catch (_) { }
      try { if (hots && hots.parentNode) hots.parentNode.removeChild(hots); } catch (_) { }
      layer = null; hots = null; stages = {};
    }
  };
})();
