


(function () {
  "use strict";

  var LS_KEY = "gardenNightOverride";            /* auto / night / day，只此一页自己写自己读 */
  var NIGHT_FROM = 22 * 60;                      /* 22:00 起是夜（含） */
  var NIGHT_TO = 6 * 60 + 30;                    /* 06:30 起是白天 */

  /* ── 1. 昼夜 ───────────────────────────────────────────────────────────────
     用浏览器本地时区的钟。想钉死一个时区，把 TZ 改成 IANA 名（例如 "Asia/Shanghai"），
     下面那个 Intl 就会按它换算；留空 ＝ 跟随访客自己的时区。 */
  var TZ = "";
  var fmt = null;
  if (TZ) {
    try {
      fmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    } catch (_) { fmt = null; }
  }

  function localMinutes() {
    if (fmt) {
      try {
        var h = -1, m = -1;
        fmt.formatToParts(new Date()).forEach(function (p) {
          if (p.type === "hour") h = parseInt(p.value, 10);
          if (p.type === "minute") m = parseInt(p.value, 10);
        });
        if (h === 24) h = 0;
        if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return h * 60 + m;
      } catch (_) { }
    }
    var d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }

  function autoIsNight() {
    var t = localMinutes();
    return (t >= NIGHT_FROM) || (t < NIGHT_TO);
  }

  function readOverride() {
    try {
      var saved = localStorage.getItem(LS_KEY);
      return (saved === "night" || saved === "day") ? saved : "auto";
    } catch (_) { return "auto"; }
  }

  function isNight() {
    var ov = readOverride();
    if (ov === "night") return true;
    if (ov === "day") return false;
    return autoIsNight();
  }

  /* ── 2. 起手参数：必须在 app.js 之前挂上 ───────────────────────────────────
     allowThemePreview:true → app.js 把右上那颗昼夜钮显示出来。开源版没有第二个
     昼夜开关跟它打架，所以这颗钮就是唯一的手动档。 */
  var initialScene = "garden";
  /* cathome20260913：小窝跟花房一样可以直接开在那儿。名单写在这儿而不是判等，
     省得以后再加一个场景又来改一次 if。 */
  var SCENES = ["garden", "greenhouse", "cathome"];
  try {
    var want = new URLSearchParams(location.search).get("scene");
    if (SCENES.indexOf(want) >= 0) initialScene = want;
  } catch (_) { }

  window.RainholmGarden = Object.assign({}, window.RainholmGarden, {
    isNight: isNight(),
    initialScene: initialScene,
    allowThemePreview: true
  });

  /* ── 3. 昼夜订阅：等 app.js 发 rainholm:garden-ready 再喊 setTheme ──────────
     别在 app.js 接管前去调还不存在的 setTheme。先设 isNight（上面那一段），
     ready 之后才订阅。轮询那条只当 ready 事件没赶上（脚本被缓存乱序）的兜底，最多 4 秒。

     手动档：#night 钮的 click 由 app.js 自己处理（setTheme(!night)），我们在这儿顺手把
     翻完的结果写进 localStorage，刷新之后还认得住；自动翻只在 auto 档生效。 */
  var last = null;
  var subscribed = false;

  function apply() {
    var n = isNight();
    var set = window.RainholmGarden && window.RainholmGarden.setTheme;
    if (typeof set !== "function") return false;   /* app.js 还没挂上 setTheme，下一拍再试 */
    if (n !== last) { last = n; set(n); }
    return true;
  }

  function watchButton() {
    var btn = document.getElementById("night");
    if (!btn) return;
    btn.addEventListener("click", function () {
      /* app.js 已经先翻过一次了，这里只把翻完的结果记下来 */
      setTimeout(function () {
        var now = btn.getAttribute("aria-pressed") === "true";
        try { localStorage.setItem(LS_KEY, now ? "night" : "day"); } catch (_) { }
        last = now;
      }, 0);
    });
  }

  function subscribe() {
    if (subscribed) return;
    subscribed = true;
    last = window.RainholmGarden.isNight;           /* 起手帧已经是这个颜色了，不必再喊一次 */
    watchButton();
    apply();
    setInterval(function () {                       /* 跨 22:00 / 06:30 自己翻，只在 auto 档 */
      if (readOverride() !== "auto") return;
      last = null; apply();
    }, 60 * 1000);
    window.addEventListener("pageshow", function () { last = null; apply(); });
  }

  window.addEventListener("rainholm:garden-ready", subscribe);

  var tries = 0;
  (function waitReady() {
    if (subscribed) return;
    if (window.RainholmGarden && typeof window.RainholmGarden.setTheme === "function") { subscribe(); return; }
    if (++tries > 20) return;
    setTimeout(waitReady, 200);
  })();

  /* ── 4. 猫窝层 ─────────────────────────────────────────────────────────────
     两只小猫（白 / 黑）在花园里遛弯，点一下冒一颗「喵」。
     从宿主脚本动态插而不是写进 index.html：换前端包也不掉线。
     总闸在 host-cat.js 里（?cats=0 / localStorage rhCatsOff=1 / window.RAINHOLM_CATS=false）。
     fourway20260912：猫的身体换成四向走路帧图，只要 pixi 就跑得起来 ——
     Live2D Cubism Core 从此不是必需品，没有它照样有猫。
     cathome20260913：猫多了第二个家（小窝），进花房仍旧整层收起来。
     nogo-20260918：禁区表接上 walk-map.json 走路层；花房也开始养猫（第三个家）。
     nogo0918-v2：野餐垫翻回给白猫（垫子进 floor、picnic_mat 不再当禁区）。
     nogo0919-v3：玩家报「小白很多地方走不到」—— 地面多边形按底图补全、8 块畦改判脚点、
     UI 热区读真 DOM、看不见的出生点块撤掉。walk-map.json 的缓存串同步升到 nogo0919-v3。
     回滚：删掉这一段 + web/host-cat.js + web/assets/cats-fourway-v1/。 */
  try {
    var cat = document.createElement("script");
    cat.src = "host-cat.js?v=nogo0919-v3-walkturn0918-v4-walktune0917-userwhite0918";   /* 改了这支就动缓存串（fourway20260912 起的规矩）。串里几段都留着：walktune 班 9/17 改了步速/换帧，nogo 班 9/19 重画了禁区（地面补全＋畦判脚点＋UI 读真 DOM），userwhite 班 9/18 停了白猫的自主遛弯 —— 都是同一支文件，谁也别把谁的标记盖掉 */
    document.head.appendChild(cat);
  } catch (_) { }
})();
