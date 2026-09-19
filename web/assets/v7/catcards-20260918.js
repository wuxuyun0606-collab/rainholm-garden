


(function () {
  "use strict";

  /* 只剩「熄灯」那条线在用：夜是小窝独有的一档，换场景就把灯还回去。
     卡归哪个场景，由 CARDS[*].scene 自己说了算，不再看这个常量。 */
  var HOME_SCENE = "cathome";
  var NIGHT_BACKDROP = "assets/cat-home-v1/cat-home-night.png?v=cathome0913-v1";


  var CARDS = {
    sleep: {
      title: "床", scene: "cathome",
      options: [
        {
          key: "sleep-on", label: "熄灯睡觉", when: "off", tone: "main",
          run: function () { holdNight(); duoShow("sleep"); }
        },
        {
          key: "sleep-off", label: "起床", when: "on", tone: "sub",
          run: function () { duoHide(); releaseNight(); }
        }
      ]
    },
    sofa: {
      title: "沙发", scene: "cathome",
      options: [
        {
          key: "sofa-on", label: "一起玩耍", when: "off", tone: "main",
          run: function () { duoShow("sofa"); }
        },
        {
          key: "sofa-off", label: "起身", when: "on", tone: "sub",
          run: function () { duoHide(); }
        }
      ]
    },

    /* ── 花园樱花树下的野餐布（picniccard0918）────────────────────────────────
       玩家 9/18 19:00：「花园的野餐布上，没有互动按钮，我没法进行互动。」
       结构跟沙发那张一模一样 —— 一个 off 态主钮起幕、一个 on 态次钮落幕，
       起落全走 duoscenes 的 show/hide，这边没有第二份实现。

       title 跟 duoscenes CFG.picnic.label 对齐（都叫「野餐布」）。
       catPass：白猫在花园的家 (252,312) 就落在这块垫子上 —— 详见 catUnder。
       没有 holdNight/releaseNight：花园的昼夜是玩家自己那颗钮的事，野餐不熄灯。 */
    picnic: {
      title: "野餐布", scene: "garden", catPass: true,
      options: [
        {
          /* 「一起野餐吧」带那个「吧」是玩家 9/18 19:0x 点的名，别手抖抹掉 */
          key: "picnic-on", label: "一起野餐吧", when: "off", tone: "main",
          run: function () { duoShow("picnic"); }
        },
        {
          key: "picnic-off", label: "起身", when: "on", tone: "sub",
          run: function () { duoHide(); }
        }
      ]
    }
  };

  /* ═════════════ 2 · 小零件 ═════════════ */

  var $ = function (id) { return document.getElementById(id); };
  var root = document.documentElement;
  var dead = false;

  var card = null, ribbonEl = null, bodyEl = null;
  var openKey = null;          /* 正开着的是哪张卡 */
  var anchorEl = null;         /* 那张卡贴着的热区元素 */
  var nightHeld = false;       /* 是不是我们把灯关上的 */
  var prevNight = false;       /* 关灯之前玩家原来是哪一档 */
  var heldAt = 0;              /* 什么时候关的（开头那一小段不判还灯） */
  var nightWatch = 0;
  var preloaded = false;

  function reduced() {
    try { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
    catch (_) { return false; }
  }

  function scene() {
    try {
      var host = window.RainholmGarden || {};
      if (typeof host.getScene === "function") return host.getScene() || "garden";
      var w = $("world");
      if (w && w.dataset && w.dataset.scene) return w.dataset.scene;
      return host.initialScene || "garden";
    } catch (_) { return "garden"; }
  }

  /* picniccard0918：这张卡归不归当前场景管。
     取代原来那句 `scene() !== HOME_SCENE` —— 一个常量装不下第二个场景。
     写法照 duoscenes 自己的 hereNow()，两边同一个判法。 */
  function cardHere(key) {
    var c = CARDS[key];
    return !!c && c.scene === scene();
  }

  /* picniccard0918：野餐布上住着小白 —— 它在花园的家 (252,312) 正好在垫子上。
     duoscenes 的 buildHot 里本来有一道闸：点在猫身上就把这一下转给猫（摸一摸）。
     可那一发挂在按钮**自己**的冒泡相，本段在 document 捕获相就把它截走了，
     那道闸永远轮不到 —— 不管它，玩家点小白弹的是卡，猫身上那块就永远摸不着了。
     所以这里先问同一个问题：这个屏幕点底下压着的是不是 .rh-cat-hit？
     是就**不截**，原样放行给 duoscenes，由它那份 catHitAt 去转给猫 ——
     判定问两遍，转发只有它那一份实现。
     只有 catPass 的卡走这条：小窝那两幕的猫窝都在热区外，给它们开这道
     反而会把「猫溜达到床上时点床」从弹卡改成摸猫，那是今天没有的行为。 */
  function catUnder(ev, hot) {
    if (!ev || (!ev.clientX && !ev.clientY)) return null;   /* 键盘回车那一发没坐标，不判 */
    var prev = hot.style.pointerEvents;
    hot.style.pointerEvents = "none";
    var el = null;
    try { el = document.elementFromPoint(ev.clientX, ev.clientY); } catch (_) { }
    hot.style.pointerEvents = prev;
    if (!el || typeof el.closest !== "function") return null;
    return el.closest(".rh-cat-hit");
  }

  function duo() {
    var d = window.ndsDuo;
    return (d && typeof d.show === "function") ? d : null;
  }

  function activeStage() {
    var d = duo();
    if (!d || typeof d.state !== "function") return null;
    try { return d.state().active || null; } catch (_) { return null; }
  }

  /* 幕在「猫还在走过去」那几秒里 active 是 null、pending 才是那一幕。
     还灯的判定必须把 pending 也算上，不然刚熄的灯会在猫走路那七秒里自己亮回来
     （第一版就是这么翻车的，验收 state 里 nightHeld 直接是 false）。 */
  function stageBusy(key) {
    var d = duo();
    if (!d || typeof d.state !== "function") return false;
    try { var s = d.state(); return s.active === key || s.pending === key; }
    catch (_) { return false; }
  }

  function duoShow(key) { var d = duo(); if (d) { try { d.show(key); } catch (_) { } } }
  function duoHide() { var d = duo(); if (d) { try { d.hide(false); } catch (_) { } } }

  /* ═════════════ 3 · 熄灯 ═════════════ */

  function isNight() {
    var w = $("world");
    return !!(w && w.classList && w.classList.contains("night"));
  }

  /* 唯一的入口就是那颗钮（理由见文件头）。点之前先比一眼，已经是目标档就别瞎点 ——
     每点一下 app.js 都会 render(true) 全量重画，白点一次是白烧一帧。 */
  function setNight(v) {
    if (isNight() === !!v) return true;
    var b = $("night");
    if (!b) return false;
    try { b.click(); } catch (_) { return false; }
    return isNight() === !!v;
  }

  function syncNightClass() {
    root.classList.toggle("ncc-night", isNight());
  }

  function holdNight() {
    if (!nightHeld) { prevNight = isNight(); nightHeld = true; }
    heldAt = Date.now();
    setNight(true);
    syncNightClass();
    startNightWatch();
  }

  function releaseNight() {
    if (!nightHeld) { syncNightClass(); return; }
    nightHeld = false;
    setNight(prevNight);
    syncNightClass();
    stopNightWatch();
  }

  /* 幕不是只有【起床】那一条落法：点地板、AI 给小黑下指令、切场景，
     duoscenes 都会自己把幕落掉 —— 那几条路上没人来告诉我们一声。
     所以灯是我们关的时候就盯着：睡觉那一幕一没了（active 和 pending 都不是它），
     灯立刻还回去。开头 GRACE 毫秒不判 —— 那会儿 duoscenes 可能还没把 pending 写上。 */
  var GRACE_MS = 1200;

  function startNightWatch() {
    if (nightWatch || dead) return;
    nightWatch = setInterval(function () {
      if (dead) { stopNightWatch(); return; }
      if (!nightHeld) { stopNightWatch(); return; }
      if (Date.now() - heldAt < GRACE_MS) return;
      if (scene() !== HOME_SCENE) { releaseNight(); return; }
      if (!stageBusy("sleep")) { releaseNight(); return; }
    }, 400);
  }
  function stopNightWatch() {
    if (nightWatch) { clearInterval(nightWatch); nightWatch = 0; }
  }

  /* ═════════════ 4 · 卡片本体 ═════════════ */

  function build() {
    if (card) return card;
    card = document.createElement("div");
    card.id = "nccCard";
    card.hidden = true;

    var ears = document.createElement("i");
    ears.className = "ncc-ears";
    ears.setAttribute("aria-hidden", "true");
    var el = document.createElement("i"); el.className = "ncc-ear ncc-ear-l";
    var er = document.createElement("i"); er.className = "ncc-ear ncc-ear-r";
    ears.appendChild(el); ears.appendChild(er);

    var box = document.createElement("div");
    box.className = "ncc-card";
    box.setAttribute("role", "group");

    var x = document.createElement("button");
    x.type = "button";
    x.className = "ncc-x";
    x.setAttribute("aria-label", "关闭");
    x.textContent = "×";
    x.addEventListener("click", function (e) { e.stopPropagation(); close(); });

    ribbonEl = document.createElement("div");
    ribbonEl.className = "ncc-ribbon";

    bodyEl = document.createElement("div");
    bodyEl.className = "ncc-body";

    box.appendChild(x); box.appendChild(ribbonEl); box.appendChild(bodyEl);
    card.appendChild(ears); card.appendChild(box);
    document.body.appendChild(card);
    return card;
  }

  function paint(key) {
    var cfg = CARDS[key];
    if (!cfg) return false;
    /* 用 stageBusy 不用 activeStage：猫还在走过去那几秒（pending）也算「已经起了」，
       这时候卡上给的是【起床】/【起身】—— 按下去 duoscenes 的 hide() 会把 pending
       一起作废，正好就是「点一半反悔」那条路。 */
    var on = stageBusy(key);
    ribbonEl.textContent = cfg.title;
    card.querySelector(".ncc-card").setAttribute("aria-label", cfg.title + " 互动");
    bodyEl.innerHTML = "";
    var n = 0;
    cfg.options.forEach(function (o) {
      var want = o.when || "always";
      if (want === "on" && !on) return;
      if (want === "off" && on) return;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "ncc-pill" + (o.tone === "sub" ? " ncc-sub" : "");
      b.dataset.nccAct = o.key;
      b.textContent = o.label;
      b.setAttribute("aria-label", o.label);
      b.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation();
        close();
        try { o.run(); } catch (_) { }
      });
      bodyEl.appendChild(b);
      n++;
    });
    return n > 0;
  }


  var AVOID = [
    ".hud", "#night", "#menu-toggle", "#menu", "#pages",
    "#nb4Act", "#nb4Follow", "#nb4Cam", "#nb4Home", "#nb4ActMenu",
    "#rhSayWrap", "#rhSayBar", "#rhSayBtn",
    "#toast", "#connection", "#retry", "#card", "#gd-plot-actions"
  ];

  function visibleRect(e) {
    if (!e || e.hidden) return null;
    var st;
    try { st = getComputedStyle(e); } catch (_) { return null; }
    if (!st || st.display === "none" || st.visibility === "hidden") return null;
    if (parseFloat(st.opacity || "1") < 0.06) return null;
    var r = e.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return r;
  }

  function obstacles() {
    var out = [], pad = 6;
    AVOID.forEach(function (sel) {
      var list;
      try { list = document.querySelectorAll(sel); } catch (_) { return; }
      for (var i = 0; i < list.length; i++) {
        var r = visibleRect(list[i]);
        if (!r) continue;
        out.push({ l: r.left - pad, t: r.top - pad, r: r.right + pad, b: r.bottom + pad });
      }
    });
    return out;
  }

  function overlap(a, b) {
    var w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
    var h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
    return (w > 0 && h > 0) ? w * h : 0;
  }

  /* 两个盒子之间还剩多少空（贴上或叠上算 0） */
  function gapBetween(a, b) {
    var dx = Math.max(b.l - a.r, a.l - b.r, 0);
    var dy = Math.max(b.t - a.b, a.t - b.b, 0);
    return Math.sqrt(dx * dx + dy * dy);
  }

  /* ── 罚分表（9/18 返工：玩家判「桌面沙发卡别压书架、别贴去花园钮」）────────────
     光判「有没有压上」不够 —— 沙发卡开在右边时一个 UI 都没压到，
     可是右缘离「去花园」那颗钮只剩 17px，看着就是挤在屏幕边上。
     所以两条都从「压上才扣」改成「靠近就开始扣」：
       EDGE_*  离屏幕边缘这么近开始扣（窄屏兜底，1440 上一般不触发）
       UI_*    离四角任何一件 UI 这么近开始扣 —— 这一条是把沙发卡挤到沙发正上方的那条
     权重 600 是照着「开在正上方」那一档的候选顺序分（±3）定的：
     只要贴着 UI 就一定输给一个干干净净的落点，不用靠人手调。 */
  var EDGE_SOFT = 56, EDGE_W = 8;
  var UI_SOFT = 40, UI_W = 600;

  function edgePen(box, vw, vh, M) {
    var g = [box.l - M, (vw - M) - box.r, box.t - M, (vh - M) - box.b], p = 0;
    for (var i = 0; i < g.length; i++) {
      if (g[i] < EDGE_SOFT) p += (EDGE_SOFT - Math.max(g[i], 0)) * EDGE_W;
    }
    return p;
  }

  function uiPen(box, obs) {
    var p = 0;
    for (var i = 0; i < obs.length; i++) {
      var g = gapBetween(box, obs[i]);
      if (g < UI_SOFT) p += (UI_SOFT - g) / UI_SOFT * UI_W;
    }
    return p;
  }

  function place() {
    if (!card || !anchorEl) return;
    /* 量尺寸前先把它摆到左上角，免得上一次的位置把它挤出屏、量出来的宽高不对 */
    card.style.left = "0px"; card.style.top = "0px";
    var w = card.offsetWidth, h = card.offsetHeight;
    var vw = window.innerWidth, vh = window.innerHeight;
    var M = 8, GAP = 12;

    var ar = anchorEl.getBoundingClientRect();
    /* 家具可能有一半在屏外（390 竖屏的床就是）：拿它【露在屏内】的那块当锚，
       不然卡会被推到屏外那半边去 */
    var a = {
      l: Math.max(ar.left, M), t: Math.max(ar.top, M),
      r: Math.min(ar.right, vw - M), b: Math.min(ar.bottom, vh - M)
    };
    if (a.r <= a.l) { a.l = Math.max(M, Math.min(ar.left, vw - M - 1)); a.r = a.l + 1; }
    if (a.b <= a.t) { a.t = Math.max(M, Math.min(ar.top, vh - M - 1)); a.b = a.t + 1; }
    var acx = (a.l + a.r) / 2, acy = (a.t + a.b) / 2;

    /* 顺序 ＝ 同分时的偏好：右 → 上 → 左 → 下。
       「上」排在「左」前面是 9/18 返工定的：等距房间里家具左边往往还杵着另一件家具
       （沙发左边就是床和圆几），开在正上方压到的东西最少，也最像小屋那张卡的站位。 */
    var cands = [
      { x: a.r + GAP, y: acy - h / 2 },            /* 右 */
      { x: acx - w / 2, y: a.t - GAP - h },        /* 上 */
      { x: a.l - GAP - w, y: acy - h / 2 },        /* 左 */
      { x: acx - w / 2, y: a.b + GAP }             /* 下 */
    ];

    var obs = obstacles();
    var best = null;
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      var cx = Math.max(M, Math.min(c.x, vw - w - M));
      var cy = Math.max(M, Math.min(c.y, vh - h - M));
      var box = { l: cx, t: cy, r: cx + w, b: cy + h };
      var pen = 0;
      for (var j = 0; j < obs.length; j++) pen += overlap(box, obs[j]);   /* 真压上 UI：按面积扣 */
      pen += uiPen(box, obs);                              /* 没压上但贴得太近：也扣 */
      pen += edgePen(box, vw, vh, M);                      /* 贴屏幕边缘：也扣 */
      pen += overlap(box, a) * 0.8;                        /* 压住家具本身：扣一点，不是死罪 */
      pen += (Math.abs(cx - c.x) + Math.abs(cy - c.y)) * 30;  /* 被夹走多远 ＝ 离家具多远 */
      pen += i * 1;                                        /* 同分时按右→上→左→下的顺序 */
      if (!best || pen < best.pen) best = { x: cx, y: cy, pen: pen, which: i };
    }
    if (!best) return;
    card.style.left = Math.round(best.x) + "px";
    card.style.top = Math.round(best.y) + "px";
    card.dataset.nccPlace = ["right", "up", "left", "down"][best.which];
  }

  function open(key, el) {
    if (dead || !cardHere(key)) return false;   /* cardHere 里已经含了「有没有这张卡」 */
    build();
    anchorEl = el || document.querySelector('.nds-hot[data-nds-hot="' + key + '"]');
    if (!anchorEl) return false;
    if (!paint(key)) return false;
    openKey = key;
    card.hidden = false;
    card.classList.remove("ncc-in");
    void card.offsetWidth;                 /* 重放出场动画得先断一帧 */
    if (!reduced()) card.classList.add("ncc-in");
    place();
    syncNightClass();
    return true;
  }

  function close() {
    if (!card || card.hidden) { openKey = null; return; }
    card.hidden = true;
    card.classList.remove("ncc-in");
    openKey = null;
    anchorEl = null;
  }

  /* ═════════════ 4b · 猫爪折叠钮（pawfold 20260918）═════════════
     玩家 9/18 13:22：「还要去掉这个ui，然后把跟随和视角折叠进一个猫爪UI里」

     ── 谁干活 ────────────────────────────────────────────────────────────────
     跟随/视角的**逻辑一行都没搬**：面板上两颗药丸按下去调的是 batch4 自己的
     公开口子 `nb4.follow(v)` / `nb4.cam(v)`（就是那两颗原钮 onclick 调的
     setFollow / setCam），localStorage 记忆、跟随定时器、镜头 rAF、减动效闸
     全在 batch4 手里。本段只是**换了一张脸**。
     所以原钮不删只藏（CSS 第 1 段）——它们还活着，aria-pressed 照旧被
     batch4 的 paintToggles() 刷，本段读状态也认 nb4 的 getter，两边不会打架。

     ── 什么时候露脸 ──────────────────────────────────────────────────────────
     跟着 `#nb4Follow` 的 hidden 走。那颗是 batch4 按 hasCats() 每 800ms 写的，
     花房没猫 → 它 hidden → 猫爪跟着收。「花房里本来不显示就照旧」这一条
     不用自己判场景，跟着它就对。 */


  var PAW_ICON = "assets/v7/batch4-20260914/";
  var paw = null, pawPanel = null, pawOpen = false;

  var PAW_ITEMS = [
    {
      /* ?v= 是缓存串：ui_pair.png 9/18 被同名覆盖过一次（双猫版 → 双爪版，
         旧图留在 ui_pair.bak-duocats-20260918.png），不带串玩家手机会拿旧图。
         以后再换图，这个串跟着往上走一档。 */
      key: "follow", icon: "assets/v7/ui_pair.png?v=pair0918-v2",
      /* 小黑跟着小白：没有反义词，字不变，开关看图标亮不亮 */
      label: function () { return "结伴"; },
      aria: function (on) { return on ? "小黑跟着小白，已开" : "小黑跟着小白，已关"; },
      pressed: function (on) { return on; },
      get: function () { try { return !!window.nb4.follow(); } catch (_) { return false; } },
      set: function (v) { try { window.nb4.follow(v); } catch (_) { } },
      off: function () { return false; }
    },
    {
      key: "cam", icon: "assets/v7/ui_follow.png",
      /* 镜头：照小屋 —— 一张图，开「跟随」关「锁定」，aria-pressed 记的是「锁定」 */
      label: function (on) { return on ? "跟随" : "锁定"; },
      aria: function (on) { return on ? "镜头跟随小白" : "镜头已锁定，可拖动画面"; },
      pressed: function (on) { return !on; },
      get: function () { try { return !!window.nb4.cam(); } catch (_) { return false; } },
      set: function (v) { try { window.nb4.cam(v); } catch (_) { } },
      /* 减动效档 batch4 的 setCam 直接 return —— 点了没反应最气人，直接灰掉 */
      off: function () { return reduced(); }
    }
  ];

  function nb4Ready() { return !!(window.nb4 && typeof window.nb4.follow === "function"); }

  function buildPaw() {
    if (paw || !nb4Ready()) return;

    paw = document.createElement("button");
    paw.id = "nccPaw";
    paw.type = "button";
    paw.className = "nb4-corner";        /* 借 batch4 的皮 + uibatch2 的按下回弹 */
    paw.hidden = true;
    /* 主钮【不挂文字药丸】（玩家 9/18 点单：收起态只剩爪印）。
       药丸是 .gd-lab 那个 span —— 这里干脆不建，不是拿 CSS 藏：
       建了再藏，读屏软件仍可能读到，而且 batch4 那条
       `.nb4-corner[aria-expanded="true"] .gd-lab{filter:…}` 会白算一次。
       看得见的字没了，名字全交给 aria-label + aria-expanded：
       读屏会念「猫爪菜单，已折叠/已展开」，比写死一个「展开」更准
       （钮是可开合的，状态由 aria-expanded 播报，label 只负责报身份）。
       展开出来的「结伴」「跟随/锁定」两颗药丸照旧，说话钮那颗也一个字没动。 */
    paw.setAttribute("aria-label", "猫爪菜单");
    paw.setAttribute("aria-expanded", "false");


    paw.innerHTML = '<img src="assets/v7/ui_pose.png" alt="" aria-hidden="true" draggable="false">';
    paw.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      togglePaw();
    });
    document.body.appendChild(paw);

    pawPanel = document.createElement("div");
    pawPanel.id = "nccPawPanel";
    pawPanel.setAttribute("role", "group");
    pawPanel.setAttribute("aria-label", "猫爪");
    pawPanel.setAttribute("aria-hidden", "true");
    PAW_ITEMS.forEach(function (it) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "ncc-paw-item";
      b.dataset.nccPaw = it.key;
      /* 裸 PNG + 图标正下方一颗九切片药丸 —— 结构照小屋 mk()，
         药丸的 class 用开源版自己的 .gd-lab（同一条配方、同一张九切片，见 css） */
      b.innerHTML = '<img src="' + it.icon + '" alt="" aria-hidden="true" draggable="false">' +
        '<span class="gd-lab" aria-hidden="true"></span>';
      b.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation();
        if (it.off()) return;
        it.set(!it.get());
        paintPaw();          /* 排不收 —— 两颗开关常常要连着按 */
      });
      pawPanel.appendChild(b);
    });
    document.body.appendChild(pawPanel);
    paintPaw();
  }

  function paintPaw() {
    if (!pawPanel) return;
    PAW_ITEMS.forEach(function (it) {
      var b = pawPanel.querySelector('[data-ncc-paw="' + it.key + '"]');
      if (!b) return;
      var on = it.get();
      var lab = b.querySelector(".gd-lab");
      if (lab) lab.textContent = it.label(on);
      b.setAttribute("aria-pressed", String(it.pressed(on)));
      b.setAttribute("aria-label", it.aria(on));
      if (it.off()) b.setAttribute("aria-disabled", "true");
      else b.removeAttribute("aria-disabled");
    });
  }

  /* 摆位照小屋 #rhDockFold：从爪钮【右边】横着排开、跟爪钮同一条水平中线。
     小屋那份是 flex 一把排好的，开源版的爪钮是 fixed 单独定位的，所以这里现量。
     右边塞不下（窄屏）就往左夹进来，再不行翻到爪钮正上方 —— 不出屏。 */
  function placePaw() {
    if (!paw || !pawPanel || !pawOpen) return;
    var r = paw.getBoundingClientRect();
    var w = pawPanel.offsetWidth || 104, h = pawPanel.offsetHeight || 44;
    var M = 8, GAP = 14;                       /* GAP 抄小屋 #rhDockFold 的 gap:14 */
    var left = Math.round(r.right + GAP);
    var top = Math.round(r.top + (r.height - h) / 2);
    if (left + w > window.innerWidth - M) {
      left = Math.max(M, window.innerWidth - w - M);
      /* 真挤到跟爪钮叠上了，就翻到爪钮正上方（留出药丸那一截） */
      if (left < r.right + 4) { left = Math.max(M, Math.round(r.left)); top = Math.round(r.top - h - 24); }
    }
    if (top < M) top = M;
    if (top + h > window.innerHeight - M) top = Math.max(M, window.innerHeight - h - M);
    pawPanel.style.left = left + "px";
    pawPanel.style.top = top + "px";
  }

  function openPaw() {
    if (!pawPanel || pawOpen || paw.hidden) return;
    pawOpen = true;
    paw.setAttribute("aria-expanded", "true");
    pawPanel.setAttribute("aria-hidden", "false");
    paintPaw();
    placePaw();                                 /* 先量位再上 class，不然从 0,0 滑过来 */
    pawPanel.classList.add("ncc-paw-in");
    placePaw();
  }

  function closePaw() {
    if (!pawPanel || !pawOpen) return;
    pawOpen = false;
    pawPanel.classList.remove("ncc-paw-in");
    pawPanel.setAttribute("aria-hidden", "true");
    if (paw) paw.setAttribute("aria-expanded", "false");
  }

  function togglePaw() { if (pawOpen) closePaw(); else openPaw(); }

  /* 猫爪跟着原「跟随」钮的 hidden 走（理由见上）。batch4 每 800ms 重写它，
     所以这里也搭本段那趟 800ms 的车，不另起定时器。 */
  function syncPaw() {
    if (dead) return;
    buildPaw();
    if (!paw) return;
    var src = $("nb4Follow");
    var live = !!(src && !src.hidden);
    if (paw.hidden !== !live) paw.hidden = !live;
    if (!live && pawOpen) closePaw();
    if (pawOpen) { paintPaw(); placePaw(); }
  }


  /* ═════════════ 5 · 接线 ═════════════ */

  /* ① 截热区那一发点击（捕获相，理由见文件头） */
  document.addEventListener("click", function (ev) {
    if (dead) return;
    var t = ev.target;
    if (!t || typeof t.closest !== "function") return;
    var hot = t.closest(".nds-hot");
    if (!hot) return;
    /* picniccard0918：先认这一发归不归我管，再动 preventDefault ——
       截了却不弹卡，那一下就凭空丢了。两条放行（放行 ＝ duoscenes 照它原来那样处理）：
         · 当前场景没有这张卡（以后加了新幕还没配卡，也是走这条）
         · 点在猫身上（见 catUnder） */
    var key = hot.dataset ? hot.dataset.ndsHot : null;
    if (!key || !cardHere(key)) return;
    if (CARDS[key].catPass && catUnder(ev, hot)) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (openKey === key) { close(); return; }   /* 再点同一件家具 ＝ 收起来 */
    open(key, hot);
  }, true);

  /* ② 点卡外任意处收起。用 pointerdown 而不是 click：玩家拖地图的时候
        手一按卡就该走，不用等抬手。卡自己和热区放行（热区那发交给上面那条）。 */
  document.addEventListener("pointerdown", function (ev) {
    if (dead) return;
    var t = ev.target;
    var inside = (t && typeof t.closest === "function") ? t.closest("#nccCard,.nds-hot,#nccPaw,#nccPawPanel") : null;
    if (openKey && !(inside && (inside.id === "nccCard" || inside.classList.contains("nds-hot")))) close();
    if (pawOpen && !(inside && (inside.id === "nccPaw" || inside.id === "nccPawPanel"))) closePaw();
  }, true);

  /* ③ Esc 收起。捕获相先接 —— app.js 的 Escape 监听挂在 window 冒泡相
        （closeCard + 收菜单），我们不抢它的活，只是先把自己关了。 */
  document.addEventListener("keydown", function (ev) {
    if (dead || ev.key !== "Escape") return;
    if (openKey) close();
    if (pawOpen) closePaw();
  }, true);

  /* ④ 屏幕动了就重新贴一次：转屏、改窗口、拖地图（#viewport 滚动）。 */
  function replace() {
    if (dead) return;
    if (openKey) place();
    if (pawOpen) placePaw();
  }
  window.addEventListener("resize", replace);
  window.addEventListener("orientationchange", function () { setTimeout(replace, 120); });
  document.addEventListener("scroll", replace, true);

  /* ⑤ 场景同步 + 猫爪同步，搭同一趟 800ms 的车。
        html.ncc-cathome 从 9/18 13:22 那单起只剩记账用途（藏钮的 CSS 改成不认场景了），
        留着是因为 ndsCards.state() 和调试还看它。
        动作菜单／跟随／视角三颗原钮由 CSS 全场景藏，这里不再按场景开关。 */
  function syncScene() {
    if (dead) return;
    var here = scene() === HOME_SCENE;
    root.classList.toggle("ncc-cathome", here);
    syncNightClass();
    syncPaw();
    /* 动作菜单可能被 batch4 开着（它的 hidden 是自己管的），CSS 藏了但 aria 还挂着，收一下 */
    try { if (window.nb4 && typeof window.nb4.closeMenu === "function") window.nb4.closeMenu(); } catch (_) { }
    /* picniccard0918：换场景收卡的条件从「离开小窝」改成「开着的这张卡不在这儿了」。
       小窝那两张的账一分没变（它们都是 cathome 的卡，一离开小窝照样收）；
       多出来的是「从花园走开，野餐卡也跟着收」。 */
    if (openKey && !cardHere(openKey)) close();
    if (!here) {
      if (nightHeld) releaseNight();
      return;
    }
    if (!preloaded) {
      preloaded = true;
      try { var im = new Image(); im.src = NIGHT_BACKDROP; } catch (_) { }
    }
  }

  window.addEventListener("rainholm:garden-scene", function () { setTimeout(syncScene, 0); });
  window.addEventListener("rainholm:garden-ready", function () { setTimeout(syncScene, 0); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", syncScene);
  else syncScene();
  setInterval(syncScene, 800);

  /* ═════════════ 6 · 总闸 / 验收探针 ═════════════ */
  window.ndsCards = {
    version: "catcards-20260918+picniccard0918",
    cards: CARDS,
    open: function (key) { return open(key); },
    close: close,
    /* 验收用：直接按某一颗钮（key ＝ CARDS[*].options[*].key） */
    act: function (actKey) {
      var hit = null;
      Object.keys(CARDS).forEach(function (k) {
        CARDS[k].options.forEach(function (o) { if (o.key === actKey) hit = o; });
      });
      if (!hit) return false;
      close();
      try { hit.run(); } catch (_) { return false; }
      return true;
    },
    state: function () {
      var b = card && !card.hidden ? card.getBoundingClientRect() : null;
      return {
        scene: scene(),
        cathomeClass: root.classList.contains("ncc-cathome"),
        /* picniccard0918：这个场景手上有哪几张卡 —— 验收读这个，不靠数热区 */
        sceneCards: Object.keys(CARDS).filter(cardHere),
        open: openKey,
        place: card ? card.dataset.nccPlace || null : null,
        box: b ? { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) } : null,
        buttons: card && !card.hidden
          ? Array.prototype.map.call(card.querySelectorAll(".ncc-pill"), function (p) {
            return { key: p.dataset.nccAct, label: p.textContent, sub: p.classList.contains("ncc-sub") };
          })
          : [],
        stage: activeStage(),
        pending: (function () { try { return window.ndsDuo.state().pending || null; } catch (_) { return null; } })(),
        night: isNight(),
        nightHeld: nightHeld,
        prevNight: prevNight,
        /* 三颗原钮 + 猫爪的真实状态，验收就读这个，不靠目测 */
        corners: ["nb4Act", "nb4ActMenu", "nb4Follow", "nb4Cam", "nb4Home", "nccPaw"].map(function (id) {
          var e = $(id);
          if (!e) return { id: id, missing: true };
          var s = getComputedStyle(e), r = e.getBoundingClientRect();
          return {
            id: id, hidden: !!e.hidden, display: s.display,
            x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height)
          };
        }),
        paw: {
          open: pawOpen,
          panel: (function () {
            if (!pawPanel || !pawOpen) return null;
            var r = pawPanel.getBoundingClientRect();
            return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
          })(),
          items: pawPanel ? Array.prototype.map.call(pawPanel.querySelectorAll(".ncc-paw-item"), function (b) {
            var r = b.getBoundingClientRect();
            return {
              key: b.dataset.nccPaw, label: (b.querySelector(".gd-lab") || {}).textContent,
              icon: (b.querySelector("img") || { getAttribute: function () { return null; } }).getAttribute("src"),
              pressed: b.getAttribute("aria-pressed"), disabled: b.getAttribute("aria-disabled") || null,
              w: Math.round(r.width), h: Math.round(r.height)
            };
          }) : [],
          /* 跟 batch4 自己的账对一眼，两边不许劈叉 */
          nb4: (function () {
            try { return { follow: !!window.nb4.follow(), cam: !!window.nb4.cam() }; } catch (_) { return null; }
          })()
        }
      };
    },
    /* 验收用：直接切某一颗开关 */
    paw: function (key, v) {
      for (var i = 0; i < PAW_ITEMS.length; i++) {
        if (PAW_ITEMS[i].key !== key) continue;
        if (v !== undefined) { PAW_ITEMS[i].set(v); paintPaw(); }
        return PAW_ITEMS[i].get();
      }
      return null;
    },
    openPaw: openPaw, closePaw: closePaw,
    off: function () {
      dead = true;
      stopNightWatch();
      close(); closePaw();
      root.classList.remove("ncc-cathome");
      root.classList.remove("ncc-night");
      try { if (card && card.parentNode) card.parentNode.removeChild(card); } catch (_) { }
      try { if (paw && paw.parentNode) paw.parentNode.removeChild(paw); } catch (_) { }
      try { if (pawPanel && pawPanel.parentNode) pawPanel.parentNode.removeChild(pawPanel); } catch (_) { }
      card = null; paw = null; pawPanel = null;
    }
  };
})();
