


(function () {
  "use strict";

  var ASSETS = "assets/v6/";
  var $ = function (id) { return document.getElementById(id); };
  var host = function () { return window.RainholmGarden || {}; };
  var scene = function () {
    var h = host();
    return (typeof h.getScene === "function" && h.getScene()) || "garden";
  };


  /* 2026-09-10 第五阶段：每颗加 scale 视觉等大系数（收获篮偏大 .92、升级土地偏小 1.1），
     经 CSS 独立 scale 属性施加，与 :active 的 transform 缩放叠乘互不覆盖 */
  var MENU_ITEMS = [
    { key: "codex",   label: "图鉴",     icon: "assets/v2/note.png",    target: '#menu [data-open="codex"]',    scale: 1 },
    { key: "history", label: "收获篮",   icon: "assets/v4/harvest.png", target: '#menu [data-open="history"]',  scale: 0.92 },
    { key: "upgrade", label: "升级土地", icon: ASSETS + "upgrade.png",  target: '#menu [data-open="upgrade"]',  scale: 1.1 },
    { key: "refresh", label: "刷新",     icon: ASSETS + "refresh.png",  target: "#refresh",                     scale: 1 },
    { key: "about",   label: "关于花园", icon: ASSETS + "about.png",    target: '#menu [data-open="about"]',    scale: 1 }
  ];

  function buildTray() {
    var toggle = $("menu-toggle"), menu = $("menu");
    if (!toggle || !menu || $("gdTray")) return;
    var tray = document.createElement("div");
    tray.id = "gdTray";
    tray.setAttribute("role", "group");
    tray.setAttribute("aria-label", "花园工具");
    MENU_ITEMS.forEach(function (item, i) {
      var b = document.createElement("button");
      b.className = "gd-tray-item";
      b.style.setProperty("--i", i);
      b.setAttribute("aria-label", item.label);
      b.innerHTML = '<img src="' + item.icon + '" alt="" aria-hidden="true" draggable="false">' +
                    '<span class="gd-lab" aria-hidden="true">' + item.label + "</span>";
      b.querySelector("img").style.setProperty("--isc", item.scale || 1);
      b.addEventListener("click", function () {
        var orig = document.querySelector(item.target);
        if (orig) orig.click();   /* 原按钮的 onclick 里会自己收菜单 → 观察器同步收起托盘 */
      });
      b.dataset.gdTarget = item.target;
      tray.appendChild(b);
    });
    document.body.appendChild(tray);

    /* cathome20260913：托盘只是原 nav 按钮的影子 —— 原按钮被 app.js 收起来
       （小窝没有图鉴/收获篮/升级土地），影子跟着收。不然点下去只会弹一句
       「先等这边连接好」，像坏了。 */
    var syncItems = function () {
      Array.prototype.forEach.call(tray.children, function (b) {
        var orig = document.querySelector(b.dataset.gdTarget || "");
        var want = !!(orig && orig.hidden);
        if (b.hidden !== want) b.hidden = want;   /* 同值也写会再触发一次观察器，别写 */
      });
    };
    syncItems();
    /* app.js 的 render() 才是写 hidden 的那只手，什么时候写的不好猜（起手那一帧、
       换场景、刷新都会写）—— 直接盯着 #menu 的子树，它改一次我们同步一次。 */
    new MutationObserver(syncItems).observe(menu, { subtree: true, attributes: true, attributeFilter: ["hidden"] });
    window.addEventListener("rainholm:garden-scene", function () { setTimeout(syncItems, 0); });
    window.addEventListener("rainholm:garden-ready", syncItems);

    var sync = function () {
      var open = !menu.hidden;
      tray.classList.toggle("gd-open", open);
    };
    toggle.addEventListener("click", function () { requestAnimationFrame(sync); });
    /* openPanel / Escape / 切场景都会把 menu.hidden 写回 true，统一在这同步 */
    new MutationObserver(sync).observe(menu, { attributes: true, attributeFilter: ["hidden"] });
    /* 点空白收起（照 app.js 的写法把 hidden/aria-expanded 写回去） */
    document.addEventListener("pointerdown", function (e) {
      if (menu.hidden) return;
      if (e.target.closest && e.target.closest("#gdTray,#menu-toggle,#menu")) return;
      menu.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
    });
  }

  /* ═══════════════ ③ 门口动态入口 ═══════════════
     锚点 = 96×100 标记盒中心，箭头中心在盒中心上方约 10.5px，已折进坐标。
     两颗锚点都落在门前的踏步上，不压门槛也不压花盆：
     花园→花房门：门前两级木台阶面中心，garden-day.webp 量得台阶四边形
     约 (1085,292)/(1205,300)/(1212,345)/(1052,338)，中心 (1138,319)，右缘离花盆 foliage（x≈1163 起）
     约 25px，不压门槛（门槛 y≈290 以上）不压花盆；盒心 = +10.5 → [1138,330]。
     花房→花园门：门前木板斜坡正中，greenhouse-day.webp 量得板面四边形
     约 (140,697)/(332,705)/(256,852)/(140,838)，中心 (218,773)，取 (218,770)；
     右侧雏菊盆 x≈410 起，压不到。盒心 → [218,781]。 */
  /* cathome20260913：门从「一个场景一扇」变成「一个场景一组」。
     每扇门一颗独立标记，共用同一张箭头皮；点标记 ＝ 点它背后那颗 app.js 的门钮。
     at ＝ 标记盒心的底图坐标（96×100 的盒，箭头视觉中心在盒心上方 10.5px）。
     小窝那两处的量法：
       花园侧 —— 左边那扇拱形木门（底图 x50–133 / y468–678）的下半扇，
                  箭头落在门环下方、不压门上的花环，盒心 [120,606]；
       小窝侧 —— 左下门垫（实测 x428–645 / y750–842）正上方，盒心 [536,772]，
                  药丸标签正好落在垫子上。 */
  var DOOR_MARKS = [
    { id: "gdDoorMark", door: "scene-door" },     /* 花园 ⇄ 花房 */
    { id: "gdHomeMark", door: "home-door" }       /* 花园 ⇄ 小窝 */
  ];
  var DOORS = {
    garden: { gdDoorMark: { at: [1138, 330], label: "进花房" },


              gdHomeMark: { at: [120, 525], label: "进小窝" } },
    greenhouse: { gdDoorMark: { at: [218, 781], label: "回花园" } },
    cathome: { gdHomeMark: { at: [536, 772], label: "回花园" } }
  };
  /* 可见层是立体奶油箭头 PNG（美术 Guchen Zoran）——128/256 透明图自带落影，
     图盒 40×40，srcset 1x/2x。日/夜两张同挂，靠 #world.night（app.js render 时按
     host.isNight 切换）在 CSS 里显隐；热区/点击代理/轻晃/reduced-motion/:active 全保留。 */
  var ARROW_DIR = ASSETS + "arrow/";
  var ARROW_IMG =
    '<img class="gd-arrow-day" src="' + ARROW_DIR + 'rh-entry-arrow-day@1x.png" ' +
    'srcset="' + ARROW_DIR + 'rh-entry-arrow-day@1x.png 1x, ' + ARROW_DIR + 'rh-entry-arrow-day@2x.png 2x" ' +
    'alt="" aria-hidden="true" draggable="false">' +
    '<img class="gd-arrow-night" src="' + ARROW_DIR + 'rh-entry-arrow-night@1x.png" ' +
    'srcset="' + ARROW_DIR + 'rh-entry-arrow-night@1x.png 1x, ' + ARROW_DIR + 'rh-entry-arrow-night@2x.png 2x" ' +
    'alt="" aria-hidden="true" draggable="false">';

  /* 这个场景该亮哪几扇门：亮的摆位置写标签，不该亮的整颗 hidden 收走。 */
  function placeDoorMarks() {
    var here = DOORS[scene()] || DOORS.garden;
    DOOR_MARKS.forEach(function (cfg) {
      var mark = $(cfg.id);
      if (!mark) return;
      var d = here[cfg.id];
      mark.hidden = !d;
      if (!d) return;
      mark.style.left = (d.at[0] / 1536 * 100) + "%";
      mark.style.top = (d.at[1] / 1024 * 100) + "%";
      mark.setAttribute("aria-label", d.label);
      var tip = mark.querySelector(".gd-door-tip");
      if (tip) tip.textContent = d.label;
    });
  }

  function buildDoorMark() {
    var world = $("world");
    if (!world) return;
    DOOR_MARKS.forEach(function (cfg) {
      if ($(cfg.id)) return;
      var mark = document.createElement("button");
      mark.id = cfg.id;
      mark.type = "button";
      mark.className = "gd-door-mark";
      mark.innerHTML =
        '<span class="gd-door-bob" aria-hidden="true"><span class="gd-door-arrow">' + ARROW_IMG + "</span></span>" +
        '<span class="gd-door-tip" aria-hidden="true"></span>';
      /* 点标记 = 点它背后那颗门钮，换场景的活全归 app.js */
      mark.addEventListener("click", function () {
        var door = $(cfg.door);
        if (door) door.click();
      });
      world.appendChild(mark);
    });
    placeDoorMarks();
    if (buildDoorMark.wired) return;
    buildDoorMark.wired = true;
    window.addEventListener("rainholm:garden-scene", placeDoorMarks);
    window.addEventListener("rainholm:garden-ready", placeDoorMarks);


  }

  /* ═══════════════ 启动 ═══════════════ */
  function init() {
    buildTray();
    buildDoorMark();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
  /* app.js 的 TLA 比我们晚完事的兜底：world/menu-toggle 后到的再补一次 */
  window.addEventListener("rainholm:garden-ready", init);
  setTimeout(init, 1500);
})();

/* ── 小耳朵 20260910：给对话抽屉、地块操作卡、图鉴/收获篮等 dialog 卡顶各挂一对（DOM 节点，样式见 css 同名段） ── */
(function () {
  function ears(el) {
    if (!el || el.querySelector(":scope > .gd-ears")) return;
    var band = document.createElement("div"); band.className = "gd-ears"; band.setAttribute("aria-hidden", "true");
    band.innerHTML = '<i class="gd-ear gd-ear-l"></i><i class="gd-ear gd-ear-r"></i>';
    if (getComputedStyle(el).position === "static") el.style.position = "relative";
    el.appendChild(band);
  }
  function apply() {
    ears(document.getElementById("card"));
    Array.prototype.forEach.call(document.querySelectorAll("dialog"), ears);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply); else apply();
  window.addEventListener("rainholm:garden-ready", apply);
  setTimeout(apply, 1800);
})();
