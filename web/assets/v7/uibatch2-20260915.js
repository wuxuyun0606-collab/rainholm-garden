


(function () {
  "use strict";

  var root = document.documentElement;
  var $ = function (id) { return document.getElementById(id); };
  var dead = false;

  var RM = null;
  try { RM = window.matchMedia("(prefers-reduced-motion: reduce)"); } catch (_) { }
  function reduced() { try { return !!(RM && RM.matches); } catch (_) { return false; } }

  /* 手机档跟 ui-port-20260914.js 同口径（它 mobile() 读的也是 600） */
  function mobile() {
    try { return window.innerWidth <= 600; } catch (_) { return false; }
  }

  root.classList.add("nbu2-on");
  root.classList.add("nbu2-feel");


  /* ═════════════ ① 单1：条拉开时三颗钮让位 ═════════════
     只读 class，不碰 host-cat.js 的 openSay/closeSay 一个字。
     MutationObserver 盯 class 变化；#rhSayBar 被删了重建时，tick 会重新接上。 */
  var barSeen = null, barObs = null;

  function paintSaybar() {
    var bar = $("rhSayBar");
    var open = !!(bar && bar.classList.contains("rh-say-open"));
    root.classList.toggle("nbu2-saybar", open);
  }

  function wireSaybar() {
    var bar = $("rhSayBar");
    if (bar === barSeen) { if (!bar) root.classList.remove("nbu2-saybar"); return; }
    barSeen = bar;
    if (barObs) { try { barObs.disconnect(); } catch (_) { } barObs = null; }
    if (!bar) { root.classList.remove("nbu2-saybar"); return; }
    try {
      if (window.MutationObserver) {
        barObs = new MutationObserver(paintSaybar);
        barObs.observe(bar, { attributes: true, attributeFilter: ["class", "hidden"] });
      }
    } catch (_) { }
    paintSaybar();
  }


  var fxLayer = null, fxLast = 0;
  var GLYPHS = ["✦", "✧", "✦", "❋", "✧"];   /* ✦ ✧ ✦ ❋ ✧ */

  function layer() {
    if (fxLayer && fxLayer.isConnected) return fxLayer;
    fxLayer = document.createElement("div");
    fxLayer.id = "nbu2Fx";
    fxLayer.setAttribute("aria-hidden", "true");
    document.body.appendChild(fxLayer);
    return fxLayer;
  }

  function spawnClickFx(clientX, clientY) {
    if (dead || reduced()) return;
    if (clientX == null || clientY == null) return;
    var now = Date.now();
    if (now - fxLast < 55) return;
    fxLast = now;

    var L = layer();
    if (L.childNodes.length > 60) return;

    var small = mobile();
    function spawn(tag, cls) {
      var el = document.createElement(tag);
      el.className = cls;
      el.style.left = Math.round(clientX) + "px";
      el.style.top = Math.round(clientY) + "px";
      el.addEventListener("animationend", function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      });
      L.appendChild(el);
      return el;
    }

    if (!small) spawn("i", "nbu2-glow");        /* 手机砍掉：blur + mix-blend-mode 最贵 */
    spawn("i", "nbu2-flash");
    spawn("i", "nbu2-ripple");
    if (!small) spawn("i", "nbu2-ripple nbu2-slow");

    var n = small ? 2 : 5;                      /* 桌面 10 个节点 → 手机 5 个 */
    for (var i = 0; i < n; i++) {
      var s = spawn("i", "nbu2-sparkle");
      s.textContent = GLYPHS[i % GLYPHS.length];
      /* 小屋是 9-14px；花园底色亮一档，小字会化进草里（第一轮截图实测），提到 12-19 */
      s.style.fontSize = (12 + Math.random() * 7).toFixed(0) + "px";
      s.style.setProperty("--dx", (Math.random() * 44 - 22).toFixed(0) + "px");
      s.style.animationDelay = (Math.random() * 0.14).toFixed(2) + "s";
    }

    var h = spawn("img", "nbu2-heart");
    h.src = "assets/v7/heart-pixel-20260915.svg";
    h.alt = "";
    h.setAttribute("draggable", "false");
    h.style.setProperty("--dx", (Math.random() * 24 - 12).toFixed(0) + "px");
    h.style.animationDelay = ".05s";
  }

  function onDown(e) {
    if (dead) return;
    try {
      if (e.button != null && e.button > 0) return;     /* 右键/中键不撒 */
      if (e.pointerType === "mouse" && e.buttons === 0) return;
      spawnClickFx(e.clientX, e.clientY);
    } catch (_) { }
  }

  /* 捕获相 + passive：不 preventDefault、不 stopPropagation，
     谁的点击逻辑都照旧（拖地图、点地走猫、点钮，一个都没挡）。 */
  document.addEventListener("pointerdown", onDown, { capture: true, passive: true });


  var POP_ICON = ".gd-pa-btn,.action,#menu-toggle,#night,.gd-tray-item,.nb4-corner";
  var POP_BOX = "#menu button,.pages button,#dialog-body button";
  var downEl = null, downKind = "";

  function popTarget(t) {
    if (!t || !t.closest) return null;
    var el = t.closest(POP_ICON);
    if (el) {
      if (el.disabled || el.classList.contains("is-off")) return null;
      var img = el.querySelector("img");
      return img ? { el: el, node: img, cls: "nbu2-pop" } : null;
    }
    el = t.closest(POP_BOX);
    if (el && !el.disabled) return { el: el, node: el, cls: "nbu2-pop-box" };
    return null;
  }

  function pop(hit) {
    if (!hit || reduced()) return;
    var n = hit.node;
    n.classList.remove("nbu2-pop", "nbu2-pop-box");
    void n.offsetWidth;                   /* 连点时重排一次，动画才会从头再播 */
    n.classList.add(hit.cls);
    var done = function () {
      n.classList.remove("nbu2-pop", "nbu2-pop-box");
      n.removeEventListener("animationend", done);
      n.removeEventListener("animationcancel", done);
    };
    n.addEventListener("animationend", done);
    n.addEventListener("animationcancel", done);
  }

  document.addEventListener("pointerdown", function (e) {
    if (dead) return;
    var hit = popTarget(e.target);
    downEl = hit ? hit.el : null;
    downKind = hit ? hit.cls : "";
  }, { capture: true, passive: true });

  /* 抬手要落在同一颗钮上才弹：按下去又划走＝反悔，不给反馈。 */
  window.addEventListener("pointerup", function (e) {
    if (dead || !downEl) return;
    var el = downEl; downEl = null;
    try {
      var t = document.elementFromPoint(e.clientX, e.clientY);
      if (!t || !el.contains(t)) return;
      var hit = popTarget(el);
      if (hit && hit.cls === downKind) pop(hit);
    } catch (_) { }
  }, { capture: true, passive: true });
  window.addEventListener("pointercancel", function () { downEl = null; }, { passive: true });
  /* 键盘按 Enter/空格也走 click（没有 pointerup），单独接一条 */
  document.addEventListener("keyup", function (e) {
    if (dead) return;
    if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
    pop(popTarget(document.activeElement));
  }, { capture: true, passive: true });


  /* ═════════════ 上岗 ═════════════ */
  function tick() {
    if (dead) return;
    wireSaybar();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tick);
  } else tick();
  window.addEventListener("rainholm:garden-ready", tick);
  window.addEventListener("rainholm:garden-scene", function () { setTimeout(tick, 0); });
  setInterval(tick, 800);


  /* ═════════════ 总闸 / 验收探针 ═════════════ */
  window.nbu2 = window.__nbUiBatch2_20260915 = {
    version: "uibatch2-20260915",
    fx: spawnClickFx,
    mobile: mobile,
    /* 验收用：直接给一颗钮播松手那一下（不用真按，省得发出写请求） */
    pop: function (sel) { pop(popTarget(document.querySelector(sel))); },
    /* 落点实测：三颗钮 + 爪钮 + 条，一次全给出来，断言到部位级 */
    state: function () {
      function box(el) {
        if (!el) return null;
        var r = el.getBoundingClientRect(), g = getComputedStyle(el);
        return {
          id: el.id || el.className, hidden: !!el.hidden, display: g.display,
          opacity: Number(g.opacity),
          left: Math.round(r.left), right: Math.round(r.right),
          top: Math.round(r.top), bottom: Math.round(r.bottom),
          w: Math.round(r.width), h: Math.round(r.height),
          fromBottom: Math.round(window.innerHeight - r.bottom)
        };
      }
      var lab = function (el) {
        var q = el && el.querySelector(".gd-lab");
        return q ? box(q) : null;
      };
      return {
        on: root.classList.contains("nbu2-on"),
        feel: root.classList.contains("nbu2-feel"),
        saybarOpen: root.classList.contains("nbu2-saybar"),
        vw: window.innerWidth, vh: window.innerHeight, mobile: mobile(),
        act: box($("nb4Act")), follow: box($("nb4Follow")), cam: box($("nb4Cam")),
        home: box($("nb4Home")),
        actLab: lab($("nb4Act")), followLab: lab($("nb4Follow")), camLab: lab($("nb4Cam")),
        sayWrap: box($("rhSayWrap")), sayBtn: box($("rhSayBtn")), sayBar: box($("rhSayBar")),
        menu: box($("nb4ActMenu")),
        fxNodes: fxLayer && fxLayer.isConnected ? fxLayer.childNodes.length : 0,
        fxLayer: !!(fxLayer && fxLayer.isConnected)
      };
    },
    feelOff: function () { root.classList.remove("nbu2-feel"); },
    off: function () {
      dead = true;
      root.classList.remove("nbu2-on", "nbu2-feel", "nbu2-saybar");
      Array.prototype.forEach.call(
        document.querySelectorAll(".nbu2-pop,.nbu2-pop-box"),
        function (n) { n.classList.remove("nbu2-pop", "nbu2-pop-box"); });
      if (barObs) { try { barObs.disconnect(); } catch (_) { } barObs = null; }
      if (fxLayer && fxLayer.parentNode) fxLayer.parentNode.removeChild(fxLayer);
      fxLayer = null;
      try { document.removeEventListener("pointerdown", onDown, { capture: true }); } catch (_) { }
      /* 钮的落点回右上那一列由 batch4 自己的 relayout 现算，叫它一声 */
      try { if (window.nb4 && typeof window.nb4.closeMenu === "function") window.nb4.closeMenu(); } catch (_) { }
      try { window.dispatchEvent(new Event("resize")); } catch (_) { }
    }
  };
})();
