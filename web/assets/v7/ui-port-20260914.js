


(function () {
  "use strict";

  /* ── 常数：跟 CSS 里那两条时间对齐，别各写各的 ── */
  var OPEN_MS = 200, CLOSE_MS = 120;
  var PRE = "npp-pre", OPEN = "npp-open", CLOSING = "npp-closing";
  var TOAST_MS = 4200, TOAST_FADE = 600;   /* 小屋屏外 toast：出场 .6s 淡出 */
  var LOG_MAX = 200;

  var RM = null;
  try { RM = window.matchMedia("(prefers-reduced-motion: reduce)"); } catch (_) { }
  function reduced() { try { return !!(RM && RM.matches); } catch (_) { return false; } }
  function $(id) { return document.getElementById(id); }
  function mobile() { return window.innerWidth <= 600; }

  var root = document.documentElement;
  var dead = false;

  /* ═════════════ ② P0：面板开合动效 ═════════════
     逐字抄小屋 script#npFeelP0P2Js20260914（clearAnim/animIn/animOut 三个函数、
     双 rAF、token 作废、transitionend 为主定时器兜底）。
     为什么要双 rAF：刚从 display:none 出来那一拍，`void el.offsetWidth` 在无头
     Chromium 上建不起过渡（小屋那班实测），得让第一帧把起点真画出去。 */
  function clearAnim(el) {
    try {
      el.classList.remove(PRE, OPEN, CLOSING);
      el.__nppTok = (el.__nppTok || 0) + 1;
      if (el.__nppT) { clearTimeout(el.__nppT); el.__nppT = 0; }
      if (el.__nppEnd) { el.removeEventListener("transitionend", el.__nppEnd); el.__nppEnd = null; }
    } catch (_) { }
  }
  function animIn(el) {
    clearAnim(el);
    if (reduced()) return;
    el.classList.add(PRE);
    var tok = (el.__nppTok = (el.__nppTok || 0) + 1);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (el.__nppTok !== tok) return;                 /* 这两帧里又被关了：不抢 */
        if (!el.classList.contains(PRE)) return;
        el.classList.remove(PRE);
        el.classList.add(OPEN);
        el.__nppT = setTimeout(function () { el.classList.remove(OPEN); el.__nppT = 0; }, OPEN_MS + 50);
      });
    });
  }
  function animOut(el, done) {
    clearAnim(el);
    if (reduced()) { done(); return; }
    el.classList.add(CLOSING);
    var fired = 0;
    function fin() {
      if (fired) return;
      fired = 1;
      clearAnim(el);
      try { done(); } catch (_) { }
    }
    el.__nppEnd = function (ev) { if (ev.target === el && ev.propertyName === "opacity") fin(); };
    el.addEventListener("transitionend", el.__nppEnd);
    el.__nppT = setTimeout(fin, CLOSE_MS + 50);
    return fin;                                          /* 给"关到一半又被打开"那条路用 */
  }

  /* ── ②a <dialog id="dialog">：图鉴／收获篮／升级土地／关于花园 ───────────────
     app.js 91 行：dialog(title,html,kind) 先写内容，再 `if(!open) showModal()`；
     205/245/246 行三处 `.close()`。所以在这个【实例】上把这两个方法接管掉，
     跟小屋接管 hidden 属性是同一个路数（不碰原型、不碰别的 dialog）。

     坑：关那 120 ms 里 `open` 还是 true，这期间若又调 dialog()，app.js 看见
     open=true 就不会再 showModal，而我的定时器随后会把它真关掉 —— 内容换了、窗没了。
     所以再盯一条 #dialog-body 的 childList：关闭动画期间内容一变 ＝ 有人在重开，
     当场把关撤掉、补一发 animIn。（正常路径上 sendAction 是异步的，撞不进这 120ms，
     这条是保险不是主路。） */
  function hookDialog() {
    var dlg = $("dialog"), body = $("dialog-body");
    if (!dlg || dlg.__nppHooked) return !!dlg;
    dlg.__nppHooked = 1;
    var rawShow = dlg.showModal.bind(dlg);
    var rawClose = dlg.close.bind(dlg);
    var closing = 0;
    dlg.showModal = function () {
      closing = 0;
      clearAnim(dlg);
      var r = rawShow.apply(null, arguments);
      animIn(dlg);
      return r;
    };
    dlg.close = function () {
      if (!dlg.open || reduced()) { closing = 0; clearAnim(dlg); return rawClose.apply(null, arguments); }
      if (closing) return;                               /* 已经在关了，别排第二发 */
      closing = 1;
      var args = arguments;
      animOut(dlg, function () {
        if (!closing) return;                            /* 这 120ms 里被重开了：不关 */
        closing = 0;
        try { rawClose.apply(null, args); } catch (_) { }
      });
    };
    if (body && window.MutationObserver) {
      new MutationObserver(function () {
        if (!closing) return;
        closing = 0;                                     /* 撤销这一发关闭 */
        clearAnim(dlg);
        animIn(dlg);
      }).observe(body, { childList: true });
    }
    return true;
  }

  /* ── ②b #card 地块操作卡 ─────────────────────────────────────────────────
     app.js 用 `card.hidden = true/false` 开关它，跟小屋那五张面板一模一样，
     所以照抄小屋的做法：在这个实例上接管 hidden 属性 ——
     getter 返回"打算是开还是关"，关的时候属性延后 CLOSE_MS 才真落，
     别处所有 `if(card.hidden)` 读到的值跟改前逐字一致。
     ⚠️ 只在【?card=1 老档】才挂。平时 plot-actions.css 第 6 行
     `html.gd-plot-actions .card{display:none!important}` 把卡片整个收了，
     屏幕上看得见的是三颗浮动钮 —— 而 plot-actions.js 355 行拿
     MutationObserver 盯着 card 的 hidden【属性】排三颗钮的进退场。
     接管 hidden 会让属性晚 120ms 才落，三颗钮就跟着晚 120ms 收 ——
     卡片自己又看不见，白赔一个延迟。所以那一档不挂。 */
  function hookCard() {
    if (root.classList.contains("gd-plot-actions")) return true;   /* 浮动钮档：不挂 */
    var el = $("card");
    if (!el || el.__nppHooked) return !!el;
    el.__nppHooked = 1;
    var intended = el.hasAttribute("hidden");
    try {
      Object.defineProperty(el, "hidden", {
        configurable: true, enumerable: true,
        get: function () { return intended; },
        set: function (v) {
          v = !!v;
          if (v === intended) return;
          intended = v;
          if (!v) { el.removeAttribute("hidden"); animIn(el); }
          else if (!el.isConnected || reduced()) { clearAnim(el); el.setAttribute("hidden", ""); }
          else animOut(el, function () { if (intended) el.setAttribute("hidden", ""); });
        }
      });
    } catch (_) { el.__nppHooked = 0; }
    return true;
  }

  /* ═════════════ ③ P2 安卓兜底类 ═════════════
     照小屋 npFeelP0P2 末段（源头是 6087-6090 行 .qq-send-down）：
     捕获相、passive、只读不拦 —— 不 preventDefault、不 stopPropagation。
     安卓 WebView / 微信内置浏览器常常不触发 :active，所以补一个类走同一条规则。 */
  var DOWN_SEL = [
    "#menu-toggle", "#night", ".gd-tray-item", ".gd-pa-btn", ".action", ".gd-door-mark",
    ".corner", "#rhSayBtn", "#rhSaySend", "#nppRecBtn",
    "#dialog-body button", "#menu button", ".pages button", "#retry",
    ".close", ".dialog-head button", "#nppRecDrawer .npp-rcd-close",
    /* batch4-20260914：新加的四颗角钮和动作菜单也吃这条安卓兜底（只读不拦，同上） */
    ".nb4-corner", "#nb4ActMenu .nb4-am-item", "#nb4ActMenu .nb4-am-chip"
  ].join(",");
  var downEl = null;
  function nppUp() { try { if (downEl) { downEl.classList.remove("npp-down"); downEl = null; } } catch (_) { } }
  function wireDown() {
    try {
      document.addEventListener("pointerdown", function (ev) {
        if (!root.classList.contains("npp-press")) return;
        try {
          var t = (ev.target && ev.target.closest) ? ev.target.closest(DOWN_SEL) : null;
          if (!t) return;
          nppUp();
          downEl = t;
          t.classList.add("npp-down");
        } catch (_) { }
      }, { capture: true, passive: true });
      ["pointerup", "pointercancel", "pointerleave", "dragstart"].forEach(function (e) {
        document.addEventListener(e, nppUp, { capture: true, passive: true });
      });
      window.addEventListener("blur", nppUp);
    } catch (_) { }
  }

  /* ═════════════ ④ 爪印输入条 ═════════════
     位置和皮全在 CSS 里，这里只做三件 CSS 做不到的：
       · 往 #rhSayBar 最前面插一颗记录钮（不改 host-cat.js 的 innerHTML 模板）
       · 算条展开后的宽 --npp-w（钮右边到屏幕右边还剩多少，手机上不顶出屏）
       · 算整组的停机高度 --npp-saybot（翻页条露出来就往上让一档）和抽屉底边 --npp-recbot
     host-cat.js 换场景时会 removeSayUI() 整组删掉再 buildSayUI() 重建，
     所以记录钮得能被反复补上 —— 每次 tick 检查一次，没有就再插。 */
  var recBtn = null;

  function ensureRecBtn() {
    var bar = $("rhSayBar");
    if (!bar) { recBtn = null; return; }
    if (recBtn && recBtn.isConnected && recBtn.parentNode === bar) return;
    var b = document.createElement("button");
    b.id = "nppRecBtn";
    b.type = "button";
    b.setAttribute("aria-label", "聊天记录");
    b.setAttribute("aria-expanded", "false");
    b.addEventListener("click", function (e) { e.stopPropagation(); toggleDrawer(); });
    bar.insertBefore(b, bar.firstChild);
    recBtn = b;
  }

  var lastVars = {};
  function setVar(name, val) {
    if (lastVars[name] === val) return;
    lastVars[name] = val;
    root.style.setProperty(name, val);
  }

  function measure() {
    var wrap = $("rhSayWrap"), btn = $("rhSayBtn"), bar = $("rhSayBar");
    if (!wrap || wrap.hidden || !btn) { closeDrawer(); return; }

    /* 停机高度：翻页条 #pages（>8 块地才有，example 存档 6/8 块所以默认看不见）
       露出来的时候，爪钮就在它头上，往上让一档。读 computed display，
       不读 hidden 属性 —— 那个属性 app.js 会翻来翻去。 */
    var bot = 34;
    var pages = $("pages");
    if (pages) {
      var pv = false;
      try { pv = getComputedStyle(pages).display !== "none"; } catch (_) { }
      if (pv) {
        var pr = pages.getBoundingClientRect();
        if (pr.height > 0) bot = Math.round(window.innerHeight - pr.top + 10);
      }
    }
    setVar("--npp-saybot", bot + "px");

    /* 条宽：钮右边 + gap 到屏幕右边留 14，再跟小屋那两档上限取小 */
    if (bar) {
      var wr = wrap.getBoundingClientRect();
      var barLeft = wr.left + btn.offsetWidth + 10;
      var avail = Math.round(window.innerWidth - barLeft - 14);
      var cap = mobile()
        ? Math.min(Math.round(window.innerWidth * 0.84), 340)
        : Math.min(Math.round(window.innerWidth * 0.66), 360);
      var w = Math.max(180, Math.min(avail, cap));
      setVar("--npp-w", w + "px");
    }

    /* 抽屉底边 ＝ 输入条那一排的顶边 − 32（桌面）／−16（手机）。
       DIMENSIONS.md：不遮挡输入条与爪印；软键盘把条顶到半空时底边跟着抬、
       面板缩、列表滚（CSS 里 min-height:140px 防缩成负数）。 */
    var wr2 = wrap.getBoundingClientRect();
    var gap = mobile() ? 16 : 32;
    var recbot = Math.round(window.innerHeight - wr2.top + gap);
    if (!(recbot > 0)) recbot = mobile() ? 96 : 114;
    setVar("--npp-recbot", recbot + "px");
  }


  var LOG = [];
  var pendMine = null;   /* {text, t} */

  function clip30(s) {
    s = String(s == null ? "" : s).trim();
    if (!s) return "";
    var a;
    try { a = Array.from(s); } catch (_) { a = s.split(""); }
    return a.length > 30 ? a.slice(0, 30).join("") : s;
  }
  function hhmm(d) {
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return p(d.getHours()) + ":" + p(d.getMinutes());
  }
  function catNameOf(id) { return id === "black" ? "黑猫" : id === "white" ? "白猫" : "猫"; }

  function whoOfBubble(bub) {
    var layer = $("rhCatLayer");
    if (!layer) return "";
    var bx = parseFloat(bub.style.left);
    if (!isFinite(bx)) return "";
    var hits = layer.querySelectorAll(".rh-cat-hit[data-cat]");
    var best = "", bd = 1e9;
    for (var i = 0; i < hits.length; i++) {
      var h = hits[i];
      var cx = parseFloat(h.style.left) + (h.offsetWidth || 0) / 2;
      if (!isFinite(cx)) continue;
      var d = Math.abs(cx - bx);
      if (d < bd) { bd = d; best = h.dataset.cat || ""; }
    }
    return best;
  }
  function hitOf(catId) {
    var layer = $("rhCatLayer");
    return layer ? layer.querySelector('.rh-cat-hit[data-cat="' + catId + '"]') : null;
  }

  function pushLog(who, name, text) {
    if (!text) return;
    LOG.push({ who: who, name: name, text: text, t: new Date() });
    if (LOG.length > LOG_MAX) LOG.splice(0, LOG.length - LOG_MAX);
    if (drawerOpen()) renderLog();
  }

  /* 屏外 toast：猫在视口外说话，那一句现在谁也看不见 —— 补一条居中 toast。
     点它把猫滚回视野里（#viewport 是滚动的那一层）。 */
  function toastWrap() {
    var w = $("nppToastWrap");
    if (w) return w;
    w = document.createElement("div");
    w.id = "nppToastWrap";
    w.setAttribute("aria-live", "polite");
    document.body.appendChild(w);
    return w;
  }
  function showToast(name, text, catId) {
    var item = document.createElement("div");
    item.className = "npp-oft-item";
    var who = document.createElement("span");
    who.className = "npp-oft-who";
    who.textContent = name + "：";
    var tx = document.createElement("span");
    tx.className = "npp-oft-text";
    tx.textContent = text;
    item.appendChild(who); item.appendChild(tx);
    item.addEventListener("click", function () {
      var h = hitOf(catId);
      try { if (h) h.scrollIntoView({ block: "center", inline: "center", behavior: reduced() ? "auto" : "smooth" }); } catch (_) { }
      drop();
    });
    var wrap = toastWrap();
    /* 最多叠三条 —— 黑猫那条 AI 轮询 3 秒问一次，真撞上连发会把半屏铺满
       （第一轮实测 8 条并排，m390 上盖掉大半个花园）。这条闸是我自己加的，
       小屋那边没有；不要就把下面这三行删掉。 */
    while (wrap.children.length >= 3) { try { wrap.removeChild(wrap.firstChild); } catch (_) { break; } }
    wrap.appendChild(item);
    if (reduced()) item.classList.add("oft-in");
    else requestAnimationFrame(function () { requestAnimationFrame(function () { item.classList.add("oft-in"); }); });
    var t1 = setTimeout(function () { item.classList.remove("oft-in"); item.classList.add("oft-out"); }, TOAST_MS);
    var t2 = setTimeout(drop, TOAST_MS + TOAST_FADE + 60);
    function drop() {
      clearTimeout(t1); clearTimeout(t2);
      try { if (item.parentNode) item.parentNode.removeChild(item); } catch (_) { }
    }
  }
  function offscreen(catId) {
    var h = hitOf(catId);
    if (!h) return false;
    var r = h.getBoundingClientRect();
    if (!(r.width || r.height)) return false;
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    return cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight;
  }

  function onBubble(bub) {
    var text = (bub.textContent || "").trim();
    if (!text) return;
    var catId = whoOfBubble(bub);
    var mine = pendMine && pendMine.text === text && (Date.now() - pendMine.t) < 2500;
    if (mine) pendMine = null;
    if (mine) {
      pushLog("me", "我", text);
    } else {
      pushLog("cat", catNameOf(catId), text);


      if (catId && !drawerOpen() && offscreen(catId)) showToast(catNameOf(catId), text, catId);
    }
  }

  function watchBubbles() {
    var layer = $("rhCatLayer");
    if (!layer || layer.__nppWatched) return !!layer;
    layer.__nppWatched = 1;
    try {
      new MutationObserver(function (recs) {
        for (var i = 0; i < recs.length; i++) {
          var a = recs[i].addedNodes;
          for (var j = 0; j < a.length; j++) {
            var n = a[j];
            if (n.nodeType === 1 && n.classList && n.classList.contains("rh-cat-bubble")) {
              try { onBubble(n); } catch (_) { }
            }
          }
        }
      }).observe(layer, { childList: true });
    } catch (_) { layer.__nppWatched = 0; }
    return true;
  }

  /* 玩家自己打的那句：window 捕获相比元素上的监听器早一拍，这会儿 value 还在 */
  function wireMine() {
    try {
      window.addEventListener("click", function (ev) {
        var t = ev.target;
        if (!t || !t.closest || !t.closest("#rhSaySend")) return;
        var inp = $("rhSayInput");
        var v = inp ? clip30(inp.value) : "";
        if (v) pendMine = { text: v, t: Date.now() };
      }, true);
      window.addEventListener("keydown", function (ev) {
        var t = ev.target;
        if (!t || t.id !== "rhSayInput") return;
        if (ev.key !== "Enter" || ev.isComposing || ev.keyCode === 229) return;
        var v = clip30(t.value);
        if (v) pendMine = { text: v, t: Date.now() };
      }, true);


      window.addEventListener("pointerdown", function (ev) {
        var t = ev.target;
        if (t && t.closest && t.closest("#nppRecDrawer")) ev.stopPropagation();
      }, true);
    } catch (_) { }
  }

  /* ═════════════ ⑥ 记录抽屉 ═════════════ */
  var drawer = null, listEl = null, emptyEl = null;

  function drawerOpen() { return !!(drawer && !drawer.hidden); }

  function buildDrawer() {
    if (drawer && drawer.isConnected) return drawer;
    drawer = document.createElement("section");
    drawer.id = "nppRecDrawer";
    drawer.hidden = true;
    drawer.setAttribute("aria-label", "聊天记录");
    var head = document.createElement("div");
    head.className = "npp-rcd-head";
    var h = document.createElement("span");
    h.textContent = "聊天记录";
    var x = document.createElement("button");
    x.type = "button";
    x.className = "npp-rcd-close";
    x.setAttribute("aria-label", "关闭");
    x.textContent = "✕";
    x.addEventListener("click", function (e) { e.stopPropagation(); closeDrawer(); });
    head.appendChild(h); head.appendChild(x);
    listEl = document.createElement("div");
    listEl.className = "npp-rcd-list";
    emptyEl = document.createElement("p");
    emptyEl.className = "npp-rcd-empty";
    emptyEl.textContent = "还没有说过话。点左下角那颗爪印，跟小白说一句。";
    drawer.appendChild(head);
    drawer.appendChild(listEl);
    document.body.appendChild(drawer);
    return drawer;
  }

  function renderLog() {
    if (!listEl) return;
    listEl.textContent = "";
    if (!LOG.length) { listEl.appendChild(emptyEl); return; }
    for (var i = 0; i < LOG.length; i++) {
      var e = LOG[i];
      var row = document.createElement("div");
      row.className = "npp-rcd-row";
      row.dataset.who = e.who === "me" ? "me" : "cat";
      var bub = document.createElement("div");
      bub.className = "npp-rcd-bub";
      bub.textContent = e.text;
      var tm = document.createElement("div");
      tm.className = "npp-rcd-time";
      /* batch4-20260914：换成小屋/花园那版气泡皮以后，名字时间行搬到气泡【上方】
         （CSS 里 order:0），两侧都写全名 —— 玩家要的就是「玩家 14:41」「AI 06:41」
         那种一整行。改前是「猫带名、我只有时间」，那是旧皮把这行放在气泡下面时的写法。
         记账管道（LOG/pushLog/MutationObserver）一个字没动，这里只改这一行的文案。 */
      tm.textContent = e.name + " " + hhmm(e.t);
      row.appendChild(bub); row.appendChild(tm);
      listEl.appendChild(row);
    }
    listEl.scrollTop = listEl.scrollHeight;
  }

  function openDrawer() {
    buildDrawer();
    if (drawerOpen()) return;
    /* 开抽屉先把还挂着的 toast 收掉，同上：同一句不在屏幕上出现两遍 */
    var tw = $("nppToastWrap");
    if (tw) while (tw.firstChild) { try { tw.removeChild(tw.firstChild); } catch (_) { break; } }
    measure();
    renderLog();
    drawer.hidden = false;
    if (recBtn) recBtn.setAttribute("aria-expanded", "true");
    animIn(drawer);
    listEl.scrollTop = listEl.scrollHeight;
  }
  function closeDrawer() {
    if (!drawerOpen()) return;
    if (recBtn) recBtn.setAttribute("aria-expanded", "false");
    if (reduced()) { clearAnim(drawer); drawer.hidden = true; return; }
    animOut(drawer, function () { drawer.hidden = true; });
  }
  function toggleDrawer() { if (drawerOpen()) closeDrawer(); else openDrawer(); }

  /* Esc 关抽屉。app.js 自己那条 Escape 收菜单的逻辑不碰（不 preventDefault）。 */
  function wireEsc() {
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && drawerOpen()) closeDrawer();
    });
  }

  /* ═════════════ 上岗 ═════════════ */
  function tick() {
    if (dead) return;
    hookDialog();
    hookCard();
    watchBubbles();
    ensureRecBtn();
    measure();
  }

  function init() {
    if (dead) return;
    root.classList.add("npp-on");
    root.classList.add("npp-press");
    buildDrawer();
    tick();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
  window.addEventListener("rainholm:garden-ready", tick);
  window.addEventListener("rainholm:garden-scene", function () { closeDrawer(); setTimeout(tick, 0); });
  window.addEventListener("resize", measure);
  try {
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", measure);
      window.visualViewport.addEventListener("scroll", measure);
    }
  } catch (_) { }
  wireDown();
  wireMine();
  wireEsc();
  /* 面板/猫层都是后建的，400ms 一拍补钩子和重算落点（照 host-cat/chatPill 那套
     300ms pin 的路数）。改动都走 setVar，值没变就一个字不写，不抖版。 */
  setInterval(tick, 400);

  /* ═════════════ 总闸 / 验收探针 ═════════════ */
  window.nppUiPort = window.__nppUiPort20260914 = {
    on: function () { root.classList.add("npp-on", "npp-press"); tick(); },
    off: function () {
      closeDrawer();
      root.classList.remove("npp-on", "npp-press");
      nppUp();
    },
    press: function (v) { root.classList.toggle("npp-press", v !== false); },
    openDrawer: openDrawer, closeDrawer: closeDrawer,
    log: function () { return LOG.map(function (e) { return { who: e.who, name: e.name, text: e.text, t: hhmm(e.t) }; }); },
    say: function (t) { pendMine = { text: clip30(t), t: Date.now() }; },   /* 验收用 */
    state: function () {
      function one(sel) {
        var e = document.querySelector(sel);
        if (!e) return { sel: sel, built: false };
        var g = getComputedStyle(e);
        return {
          sel: sel, built: true,
          hidden: !!e.hidden, attrHidden: e.hasAttribute("hidden"),
          cls: { pre: e.classList.contains(PRE), open: e.classList.contains(OPEN), closing: e.classList.contains(CLOSING) },
          display: g.display, opacity: g.opacity, translate: g.translate, transform: g.transform
        };
      }
      return {
        on: root.classList.contains("npp-on"),
        press: root.classList.contains("npp-press"),
        reduced: reduced(),
        vars: { w: lastVars["--npp-w"], saybot: lastVars["--npp-saybot"], recbot: lastVars["--npp-recbot"] },
        down: downEl ? (downEl.id || downEl.className || "?") : null,
        logN: LOG.length,
        nodes: ["#dialog", "#card", "#nppRecDrawer", "#rhSayWrap", "#rhSayBar", "#nppRecBtn", "#rhCatLayer"].map(one)
      };
    }
  };
})();
