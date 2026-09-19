


(function () {
  "use strict";

  var ICON = "assets/v7/batch4-20260914/";
  var LS = "npb4.";
  var $ = function (id) { return document.getElementById(id); };
  var root = document.documentElement;

  var RM = null;
  try { RM = window.matchMedia("(prefers-reduced-motion: reduce)"); } catch (_) { }
  function reduced() { try { return !!(RM && RM.matches); } catch (_) { return false; } }

  function lsGet(k, dflt) { try { var v = localStorage.getItem(LS + k); return v == null ? dflt : v; } catch (_) { return dflt; } }
  function lsSet(k, v) { try { localStorage.setItem(LS + k, v); } catch (_) { } }

  function cats() { return window.RainholmCats || null; }
  function host() { return window.RainholmGarden || null; }
  function scene() {
    var h = host();
    try { if (h && typeof h.getScene === "function") return h.getScene(); } catch (_) { }
    try { if (h && h.initialScene) return h.initialScene; } catch (_) { }
    return "garden";
  }
  /* 有猫的场景。
     catzoom-20260918：花房从 9/18 起也养猫了（host-cat.js 的 GH_CATS ＝ true，
     TURF 里多了 greenhouse 那条），这里跟着翻 —— 不翻的话花房里
     #nb4Follow 一直 hidden，猫爪面板（catcards 盯的就是这颗的 hidden）整颗不出来，
     玩家在花房里没处关「跟随」。GH_CATS 万一被改回 false，turf().ghCats 会说实话，
     读得到就认它，读不到（host-cat 还没上岗）按「养」算，跟 TURF 表一致。 */
  function hasCats() {
    var s = scene();
    if (s === "greenhouse") {
      try { var C = cats(); if (C && typeof C.turf === "function") return C.turf().ghCats !== false; } catch (_) { }
      return true;
    }
    return s === "garden" || s === "cathome";
  }

  function poseOf(id) {
    var C = cats();
    if (!C || typeof C.poses !== "function") return null;
    var ps;
    try { ps = C.poses(); } catch (_) { return null; }
    for (var i = 0; i < ps.length; i++) if (ps[i].id === id) return ps[i];
    return null;
  }


  /* ═════════════ ② 动作菜单：可扩展数组 ═════════════
     往这个数组里加一条就多一个动作。每条 run(catId) 自己负责走公开口子。
     ⚠️ 只放【现有素材做得出来】的动作 —— 没帧的姿势留空位，不硬造。
        现在猫只有四向 8 帧走路 + 打盹压扁（napEye）这两套表现，所以首发两条。 */
  var ACTIONS = [
    {
      key: "nap", label: "打盹", tip: "趴下压扁，眯一会儿",
      run: function (id) {
        var C = cats();
        /* host-cat.js 里「趴下」就是状态机的 nap 态（stepCat 会把 napEye 渐变到 1，
           poseCat 按它把身子压扁 5%）。公开口子里能把状态摆过去的只有 debugSet，
           坐标一律传 null ＝ 就地趴下，不挪窝。醒来照旧交还给它自己的节奏。 */
        if (!C || typeof C.debugSet !== "function") return false;
        try { return !!C.debugSet(id, null, null, "nap"); } catch (_) { return false; }
      }
    },
    {
      key: "meow", label: "喵", tip: "头顶冒一颗气泡",
      run: function (id) {
        var C = cats();
        if (!C || typeof C.say !== "function") return false;
        /* 走的就是 meow() 那条管道，跟摸一摸/AI 的 say 同一颗气泡同一张皮；
           ui-port 那班盯着 #rhCatLayer 冒出来的气泡记账，所以这一句也会进聊天记录。 */
        try { return !!C.say(id, "喵"); } catch (_) { return false; }
      }
    }
  ];

  var CAT_CHIPS = [
    { id: "white", label: "小白" },
    { id: "black", label: "小黑" }
  ];


  /* ═════════════ 钮 ═════════════ */
  var btnAct = null, btnFollow = null, btnCam = null, btnHome = null, menu = null;
  var whoNow = lsGet("who", "white");
  var followOn = lsGet("follow", "0") === "1";


  /* camoff0918：玩家 9/18 17:43「花园视角就很不稳定，晃得我头大」—— 玩家晕 3D，镜头运动一律不默认开。
     三个场景默认都关；玩家要看猫自己点「视角」钮。上面那段 catzoom 的按场景默认作废。
     之前放大班默认开过的那几个小时里，玩家要是点过一次钮把 cam=1 钉进 localStorage，
     这里一次性解开（只做一次，凭 npb4.camoff0918 这个标记），之后再点还是听玩家的。 */
  function camDefault() { return false; }
  function camPinned() { return lsGet("cam", null) != null; }
  function camWanted() { return camPinned() ? lsGet("cam", "0") === "1" : camDefault(); }
  if (lsGet("cam", null) === "1" && lsGet("camoff0918", null) == null) { lsSet("cam", "0"); lsSet("camoff0918", "1"); }
  var camOn = camWanted();
  var dead = false;

  function mkCorner(id, label, icon, aria) {
    var b = document.createElement("button");
    b.id = id;
    b.type = "button";
    b.className = "nb4-corner";
    b.setAttribute("aria-label", aria || label);
    b.innerHTML = '<img src="" alt="" aria-hidden="true" draggable="false">' +
      '<span class="gd-lab gd-corner-label" aria-hidden="true"></span>';
    setFace(b, label, icon);
    document.body.appendChild(b);
    return b;
  }
  function setFace(b, label, icon) {
    var img = b.querySelector("img"), lab = b.querySelector(".gd-lab");
    if (img && img.getAttribute("src") !== icon) img.setAttribute("src", icon);
    if (lab && lab.textContent !== label) lab.textContent = label;
  }

  function buildButtons() {
    if (btnAct) return;
    btnAct = mkCorner("nb4Act", "动作", ICON + "act-paw.png", "动作");
    btnAct.setAttribute("aria-expanded", "false");
    btnAct.addEventListener("click", function (e) { e.stopPropagation(); toggleMenu(); });

    btnFollow = mkCorner("nb4Follow", "跟随", ICON + "act-follow.png", "小黑跟着小白");
    btnFollow.addEventListener("click", function (e) { e.stopPropagation(); setFollow(!followOn); });

    btnCam = mkCorner("nb4Cam", "视角", ICON + "act-eye.png", "镜头跟着小白");
    btnCam.addEventListener("click", function (e) { e.stopPropagation(); setCam(!camOn); });

    /* ③ 回小窝：不新造路由 —— 点的就是 app.js 那颗 #home-door
       （garden→cathome / greenhouse→cathome / cathome→garden，
        它的 onclick 是 `setScene(scene==='cathome'?'garden':'cathome')`，三种场景都对）。
       门垫上那颗 .gd-door-mark 热区照旧，两条路汇到同一个 setScene。 */
    btnHome = mkCorner("nb4Home", "回小窝", "assets/v2/home.png", "回小窝");
    btnHome.addEventListener("click", function (e) {
      e.stopPropagation();
      var d = $("home-door");
      if (d) d.click();
    });

    buildMenu();
    paintToggles();
  }

  /* ── 动作菜单本体 ── */
  function buildMenu() {
    if (menu) return;
    menu = document.createElement("div");
    menu.id = "nb4ActMenu";
    menu.hidden = true;
    menu.setAttribute("role", "group");
    menu.setAttribute("aria-label", "动作");

    var who = document.createElement("div");
    who.className = "nb4-am-who";
    CAT_CHIPS.forEach(function (c) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "nb4-am-chip";
      chip.dataset.cat = c.id;
      chip.textContent = c.label;
      chip.addEventListener("click", function (e) {
        e.stopPropagation();
        whoNow = c.id; lsSet("who", whoNow); paintChips();
      });
      who.appendChild(chip);
    });
    menu.appendChild(who);

    ACTIONS.forEach(function (a) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "nb4-am-item";
      b.dataset.act = a.key;
      b.innerHTML = "";
      b.appendChild(document.createTextNode(a.label));
      if (a.tip) {
        var s = document.createElement("small");
        s.textContent = a.tip;
        b.appendChild(s);
      }
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        try { a.run(whoNow); } catch (_) { }
        closeMenu();
      });
      menu.appendChild(b);
    });

    var note = document.createElement("p");
    note.className = "nb4-am-note";
    note.textContent = "再多的动作等新帧图到了再加。";
    menu.appendChild(note);

    document.body.appendChild(menu);
    paintChips();

    /* 点别处收起（照 ui-refresh.js 收工具条那条的写法） */
    document.addEventListener("pointerdown", function (e) {
      if (menu.hidden) return;
      if (e.target && e.target.closest && e.target.closest("#nb4ActMenu,#nb4Act")) return;
      closeMenu();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !menu.hidden) closeMenu();
    });
  }

  function paintChips() {
    if (!menu) return;
    Array.prototype.forEach.call(menu.querySelectorAll(".nb4-am-chip"), function (c) {
      c.setAttribute("aria-pressed", String(c.dataset.cat === whoNow));
    });
  }

  /* uibatch2-20260915：动作钮被挪到了【屏幕左下角】（玩家 9/15 06:11 点的单），
     原来那一句「菜单钉在钮的左边、顶边跟钮齐」在左下角会把菜单推出屏幕左沿、
     底边也掉到屏幕外。改成按钮自己在哪边现判：
       钮在左半边 → 菜单左沿跟钮对齐、开在钮【正上方】（左下角那一套）
       钮在右半边 → 原样（右上那一列那一套，一个数没动）
     摘掉 uibatch2 那两行引用、钮回到右上角以后，走的还是原来那条分支。 */
  function placeMenu() {
    if (!menu || menu.hidden || !btnAct) return;
    var r = btnAct.getBoundingClientRect();
    var w = menu.offsetWidth || 150;
    var h = menu.offsetHeight || 180;

    if (r.left + r.width / 2 < window.innerWidth / 2) {
      var left = Math.max(8, Math.round(r.left));
      if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - w - 8);
      menu.style.right = "auto";
      menu.style.left = left + "px";
      var up = Math.round(r.top - h - 10);          /* 开在钮正上方，留 10 */
      if (up < 8) up = Math.round(r.bottom + 10);   /* 上面塞不下就翻到钮下面 */
      if (up + h > window.innerHeight - 8) up = Math.max(8, window.innerHeight - h - 8);
      menu.style.top = up + "px";
      return;
    }

    menu.style.left = "auto";
    var right = Math.max(8, Math.round(window.innerWidth - r.left + 10));
    if (right + w > window.innerWidth - 8) right = Math.max(8, window.innerWidth - w - 8);
    menu.style.right = right + "px";
    var top = Math.round(r.top);
    if (top + h > window.innerHeight - 10) top = Math.max(8, window.innerHeight - h - 10);
    menu.style.top = top + "px";
  }
  function openMenu() {
    if (!menu || !menu.hidden) return;
    menu.hidden = false;
    btnAct.setAttribute("aria-expanded", "true");
    placeMenu();
  }
  function closeMenu() {
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    if (btnAct) btnAct.setAttribute("aria-expanded", "false");
  }
  function toggleMenu() { if (menu && menu.hidden) openMenu(); else closeMenu(); }


  /* ═════════════ ② 跟随：小黑跟着小白 ═════════════
     attach 语义：白猫走到哪，黑猫延迟约 1 秒跟过去。
     走的是 RainholmCats.command('black', x, y) —— 跟点地/AI 指令同一条管道，
     禁区、绕路、「别叠罗汉」的 near 距离全由 host-cat.js 自己说了算。
     目标点钉在白猫【身边】而不是白猫脚下：command 里的 farFromOthers 要求两只至少
     隔 turf.near，钉在脚下每次都会被否掉。 */
  var followTimer = 0;

  function followTick() {
    if (dead || !followOn || !hasCats()) return;
    if (document.hidden) return;
    var C = cats();
    if (!C || typeof C.command !== "function") return;
    var w = poseOf("white"), b = poseOf("black");
    if (!w || !b || w.x == null || b.x == null) return;

    var near = 120;
    try { var t = C.turf(); if (t && t.near) near = t.near; } catch (_) { }
    var L = near * 1.3;          /* 停在白猫身边这么远 */
    var STOP = near * 1.8;       /* 已经够近了就别再改道，省得一直原地蹭 */

    var dx = b.x - w.x, dy = b.y - w.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d <= STOP) return;
    if (b.st === "walk" && b.cmd) return;   /* 上一条跟随指令还在走 */

    var a0 = Math.atan2(dy, dx);            /* 从白猫看过去、黑猫来的那个方向 */
    for (var k = 0; k < 12; k++) {
      var a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.42;
      var tx = w.x + Math.cos(a) * L, ty = w.y + Math.sin(a) * L;
      try { if (typeof C.spotOk === "function" && !C.spotOk(tx, ty)) continue; } catch (_) { }
      try { if (C.command("black", tx, ty)) return; } catch (_) { }
    }
  }

  function setFollow(v) {
    followOn = !!v;
    lsSet("follow", followOn ? "1" : "0");
    paintToggles();
    if (followOn) {
      followTick();
      if (!followTimer) followTimer = setInterval(followTick, 1000);
    } else if (followTimer) {
      clearInterval(followTimer); followTimer = 0;
    }
  }


  /* ═════════════ ④ 角色中心视角 ═════════════
     镜头 ＝ #viewport 的滚动位置，每帧往「白猫居中」那个落点插值一小步。
     为什么不给 #world 加 transform：#world 是滚动容器里的内容，平移它会跟拖地图
     互相抵消、边缘还会露出 body 底色；滚动天然被 scrollWidth 夹住，两个毛病都没有。
     玩家晕3D：只平移、不缩放；EASE 很小（每帧补 4.5% 的差），再加 40px 死区防抖；
     手一碰地图就让位 1.2 秒，人拖到哪算哪。 */
  var EASE = 0.045, DEAD = 64, camRaf = 0, camYield = 0;   /* camslow0919：DEAD 40→64 */


  var kbLock = null;
  function kbFocused() {
    var a = document.activeElement;
    return !!(a && /^(INPUT|TEXTAREA)$/.test(a.tagName));
  }
  function kbHold() {
    var vp = $("viewport");
    if (!vp || !kbLock) return;
    if (vp.scrollLeft !== kbLock.l) vp.scrollLeft = kbLock.l;
    if (vp.scrollTop !== kbLock.t) vp.scrollTop = kbLock.t;
  }
  document.addEventListener("focusin", function () {
    if (!kbFocused()) return;
    var vp = $("viewport");
    if (!vp) return;
    kbLock = { l: vp.scrollLeft, t: vp.scrollTop };
    vp.addEventListener("scroll", kbHold, { passive: true });
  });
  document.addEventListener("focusout", function () {
    var vp = $("viewport");
    if (vp) vp.removeEventListener("scroll", kbHold);
    if (vp && kbLock) { vp.scrollLeft = kbLock.l; vp.scrollTop = kbLock.t; }
    kbLock = null;
    camYield = Math.max(camYield, Date.now() + 800);
  });

  function camStep() {
    camRaf = 0;
    if (dead || !camOn) return;
    camRaf = requestAnimationFrame(camStep);
    if (!hasCats() || document.hidden) return;
    if (kbLock || kbFocused()) return;      /* kbcam0919：打字期间镜头不动 */
    if (Date.now() < camYield) return;
    var vp = $("viewport"), world = $("world");
    if (!vp || !world || !world.clientWidth) return;
    var w = poseOf("white");
    if (!w || w.x == null) return;

    var k = world.clientWidth / 1536;                 /* 世界坐标 → 屏幕像素 */
    var maxL = Math.max(0, vp.scrollWidth - vp.clientWidth);
    var maxT = Math.max(0, vp.scrollHeight - vp.clientHeight);
    /* 落点往上抬半个猫身：脚点居中会把猫压在屏幕正中偏下 */
    var tgtL = Math.min(maxL, Math.max(0, w.x * k - vp.clientWidth / 2));
    var tgtT = Math.min(maxT, Math.max(0, (w.y - 48) * k - vp.clientHeight / 2));

    var dl = tgtL - vp.scrollLeft, dt = tgtT - vp.scrollTop;


    var MAXV = 3.5, MAXVY = 2.5;
    if (Math.abs(dl) > DEAD) { var sl = dl * EASE; if (sl > MAXV) sl = MAXV; if (sl < -MAXV) sl = -MAXV; vp.scrollLeft = vp.scrollLeft + sl; }
    if (Math.abs(dt) > DEAD) { var st = dt * EASE; if (st > MAXVY) st = MAXVY; if (st < -MAXVY) st = -MAXVY; vp.scrollTop = vp.scrollTop + st; }
  }

  /* catzoom-20260918：拆成两半 ——
     applyCam() 只管开关这条线（不落盘），给「场景默认」用；
     setCam() 是玩家按钮那条路，照旧落盘。 */
  function applyCam(v) {
    if (v && reduced()) v = false;         /* 减动效：整条线不启动 */
    camOn = !!v;
    root.classList.toggle("nb4-cam", camOn);
    paintToggles();
    if (camOn && !camRaf) camRaf = requestAnimationFrame(camStep);
  }

  function setCam(v) {
    if (v && reduced()) return;            /* 减动效：整条线不启动 */
    lsSet("cam", v ? "1" : "0");
    applyCam(v);
  }

  function wireCamYield() {
    var vp = $("viewport");
    if (!vp || vp.__nb4Yield) return;
    vp.__nb4Yield = 1;
    /* 人在拖地图／滚轮／触摸的时候镜头让位，抬手 1.2 秒后再慢慢接管 */
    ["pointerdown", "wheel", "touchstart", "touchmove"].forEach(function (e) {
      vp.addEventListener(e, function () { camYield = Date.now() + 1200; }, { passive: true });
    });
  }


  /* ═════════════ 落点 / 场景同步 ═════════════ */
  function paintToggles() {
    if (btnFollow) btnFollow.setAttribute("aria-pressed", String(followOn));
    if (btnCam) {
      btnCam.setAttribute("aria-pressed", String(camOn));
      if (reduced()) btnCam.setAttribute("aria-disabled", "true");
    }
  }

  /* 四颗钮接在 #menu-toggle / #night 下面续排。#night 被 host.allowThemePreview
     收起来的时候（app.js background() 每次 render 都会写这个 hidden），整列往上顶一格。
     矮屏（横屏手机）另有一套两列三行，col/row 一起算好，CSS 的 @media 自己挑。 */
  function relayout() {
    if (!btnAct) return;
    var night = $("night");
    /* scenefirst-20260918：场景钮（回小窝／去花园）占最上一格（i=0），
       昼夜/图鉴由 corner-stack.css 的 html.nb4-scene-first 各下移一格，其余三颗接在图鉴下面续排。
       nightswap-20260918：昼夜和图鉴对调（图鉴沉到最底，托盘才不压钮）。
       下面这个 n 只数「上头占了几格」，跟那两颗谁上谁下无关，所以一个字没改：
       场景钮 1 格 + 昼夜 1 格（收起来就 0）+ 图鉴 1 格。昼夜收起来时图鉴由 CSS 的
       :has(#night[hidden]) 顶上去补洞，格数照样对得上。 */
    var homeOn = !!(btnHome && !btnHome.hidden);
    document.documentElement.classList.toggle("nb4-scene-first", homeOn);
    var n = ((night && !night.hidden) ? 2 : 1) + (homeOn ? 1 : 0);
    if (homeOn) {
      btnHome.style.setProperty("--nb4-i", 0);
      btnHome.style.setProperty("--nb4-col", 0);
      btnHome.style.setProperty("--nb4-row", 0);
    }
    [btnAct, btnFollow, btnCam].forEach(function (b) {
      if (!b || b.hidden) return;
      b.style.setProperty("--nb4-i", n);
      b.style.setProperty("--nb4-col", Math.floor(n / 3));
      b.style.setProperty("--nb4-row", n % 3);
      n++;
    });
    placeMenu();
  }

  /* catzoom-20260918：玩家还没表过态的时候，每次换场景重算一次默认
     （花园/花房 开、小窝 关）。表过态就一个字不改，认玩家那次选择。 */
  var camSceneSeen = "";
  function syncCamDefault() {
    var s = scene();
    if (s === camSceneSeen) return;
    camSceneSeen = s;
    if (camPinned()) return;
    var want = camDefault();
    if (want !== camOn) applyCam(want);
  }

  function syncScene() {
    if (!btnAct) return;
    syncCamDefault();
    var live = hasCats();
    [btnAct, btnFollow, btnCam].forEach(function (b) { if (b && b.hidden !== !live) b.hidden = !live; });
    if (!live) closeMenu();
    /* ③ 钮面按场景换：花园/花房 → 回小窝；小窝 → 去花园 */
    if (btnHome) {
      if (scene() === "cathome") {
        setFace(btnHome, "去花园", "assets/v2/sprout-day.png");
        btnHome.setAttribute("aria-label", "去花园");
      } else {
        setFace(btnHome, "回小窝", "assets/v2/home.png");
        btnHome.setAttribute("aria-label", "回小窝");
      }
    }
    relayout();
  }


  /* ═════════════ ④ iOS Safari 兜底 ═════════════
     这一页【没有 <video>】—— 猫是 PIXI 的 WebGL canvas + PNG 横条，
     所以「poster + 首触恢复」那个老方子在这儿落成两件对应的事：
       · 底图 <img id="backdrop"> 取不到就带缓存串重试一次（白屏比丢猫更致命）
       · 首次触摸 / 从后台回来 / bfcache 回退：重算落点、把 ticker 叫醒
         （iOS 切后台常把 ticker 停在那儿不还，回来就是一屏静止的猫）
     另有 WebGL 掉上下文的一道：canvas 掉 context 时 preventDefault 留住恢复机会，
     恢复后重排一次。真恢复不了 host-cat 自己有 teardown，猫层整层退场、花园照常。 */
  function wakeGuard() {
    var C = cats();
    if (!C) return;
    try { if (typeof C.relayout === "function") C.relayout(); } catch (_) { }
    /* on() ＝ 猫层露出来 + pace()。只在【本来就该有猫】的场景叫，
       不然会把花房里本该藏着的猫层掀出来。 */
    try { if (hasCats() && typeof C.on === "function") C.on(); } catch (_) { }
  }

  function wireIos() {
    var bd = $("backdrop");
    if (bd && !bd.__nb4Retry) {
      bd.__nb4Retry = 1;
      bd.addEventListener("error", function () {
        if (bd.__nb4Retried) return;
        bd.__nb4Retried = 1;
        var src = bd.getAttribute("src") || "";
        if (!src) return;
        bd.setAttribute("src", src + (src.indexOf("?") < 0 ? "?" : "&") + "nb4=" + Date.now());
      });
    }
    window.addEventListener("pageshow", wakeGuard);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) wakeGuard(); });
    window.addEventListener("touchstart", function once() {
      window.removeEventListener("touchstart", once);
      wakeGuard();
    }, { passive: true });

    /* iOS 上双指捏合会把整页缩放（viewport 里写了 initial-scale 但没写 maximum-scale，
       iOS 10 起也不认 user-scalable=no）。这里只掐【多指】的 gesture 事件，
       单指拖地图、双击、滚动一律不碰 —— 不做无障碍上的减法。 */
    ["gesturestart", "gesturechange", "gestureend"].forEach(function (e) {
      document.addEventListener(e, function (ev) { try { ev.preventDefault(); } catch (_) { } });
    });

    var layer = $("rhCatLayer");
    var cv = layer ? layer.querySelector("canvas") : null;
    if (cv && !cv.__nb4Ctx) {
      cv.__nb4Ctx = 1;
      cv.addEventListener("webglcontextlost", function (ev) { try { ev.preventDefault(); } catch (_) { } }, false);
      cv.addEventListener("webglcontextrestored", function () { setTimeout(wakeGuard, 0); }, false);
    }
  }


  /* ═════════════ 上岗 ═════════════ */
  function tick() {
    if (dead) return;
    buildButtons();
    syncScene();
    wireIos();
    wireCamYield();
  }

  function init() {
    if (dead) return;
    tick();
    if (followOn) setFollow(true);
    /* catzoom-20260918：开机按「玩家表过态没有」算一次，不落盘（理由见 camDefault 那段） */
    camSceneSeen = scene();
    applyCam(camWanted());
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
  window.addEventListener("rainholm:garden-ready", tick);
  window.addEventListener("rainholm:garden-scene", function () { setTimeout(tick, 0); });
  window.addEventListener("resize", function () { relayout(); });
  window.addEventListener("orientationchange", function () { setTimeout(function () { relayout(); }, 120); });
  /* #night 的 hidden 是 app.js 每次 render 写的，什么时候写不好猜 —— 盯着它 */
  try {
    if (window.MutationObserver) {
      var nb = $("night");
      if (nb) new MutationObserver(relayout).observe(nb, { attributes: true, attributeFilter: ["hidden"] });
    }
  } catch (_) { }
  setInterval(tick, 800);


  /* ═════════════ 总闸 / 验收探针 ═════════════ */
  window.nb4 = window.__nb4Batch20260914 = {
    version: "batch4-20260914",
    actions: function () { return ACTIONS.map(function (a) { return a.key; }); },
    who: function (id) { if (id) { whoNow = id; lsSet("who", id); paintChips(); } return whoNow; },
    act: function (key, id) {
      for (var i = 0; i < ACTIONS.length; i++) if (ACTIONS[i].key === key) return ACTIONS[i].run(id || whoNow);
      return false;
    },
    follow: function (v) { if (v !== undefined) setFollow(v); return followOn; },
    followTick: followTick,
    cam: function (v) { if (v !== undefined) setCam(v); return camOn; },
    openMenu: openMenu, closeMenu: closeMenu,
    state: function () {
      var vp = $("viewport");
      function one(b) {
        if (!b) return null;
        var r = b.getBoundingClientRect(), g = getComputedStyle(b);
        return {
          id: b.id, hidden: !!b.hidden,
          label: (b.querySelector(".gd-lab") || {}).textContent,
          icon: (b.querySelector("img") || {}).getAttribute ? b.querySelector("img").getAttribute("src") : null,
          top: Math.round(r.top), right: Math.round(window.innerWidth - r.right),
          w: Math.round(r.width), h: Math.round(r.height),
          pressed: b.getAttribute("aria-pressed"), expanded: b.getAttribute("aria-expanded"),
          display: g.display
        };
      }
      return {
        scene: scene(), hasCats: hasCats(), reduced: reduced(),
        follow: followOn, cam: camOn, who: whoNow,
        /* catzoom-20260918 验收探针：这会儿的 cam 是玩家钉的还是场景默认给的 */
        camPinned: camPinned(), camDefault: camDefault(),
        menuOpen: !!(menu && !menu.hidden),
        scroll: vp ? { left: Math.round(vp.scrollLeft), top: Math.round(vp.scrollTop) } : null,
        white: poseOf("white"), black: poseOf("black"),
        buttons: [one(btnAct), one(btnFollow), one(btnCam), one(btnHome)]
      };
    },
    off: function () {
      dead = true;
      setFollow(false); setCam(false); closeMenu();
      [btnAct, btnFollow, btnCam, btnHome, menu].forEach(function (b) { if (b) b.hidden = true; });
      document.documentElement.classList.remove("nb4-scene-first");   /* 场景钮收走，昼夜回最上、图鉴跟着往上顶一格 */
    }
  };
})();
