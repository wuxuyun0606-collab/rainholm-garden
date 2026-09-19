


(function () {
  "use strict";

  if (window.__rhLoading) return;

  var MIN_MS = 1200, MAX_MS = 8000, FADE_MS = 400, HOLD_MS = 250;
  var start = Date.now();
  var total = 0, done = 0, shown = 0, finished = false, removed = false, booted = false;
  var raf = 0, hardTimer = 0, preTimer = 0, preT = 0, preD = 0, bgTimer = 0;
  var stats = { imgs: 0, videos: 0, bg: 0, fonts: 0, total: 0, done: 0, ms: 0, timeout: false, preboot_ms: 0 };

  var ov = document.createElement("div");
  ov.id = "rhLoading";
  ov.setAttribute("role", "status");
  ov.setAttribute("aria-live", "polite");
  ov.setAttribute("aria-label", "花园加载中");
  ov.innerHTML =
    '<div class="rh-col">'
    + '<img class="rh-logo" src="assets/v8/loading/rainholm_logo.png?v=loading0919-v2" alt="Rainholm" decoding="async">'
    + '<div class="rh-title">花园加载中……</div>'
    + '<div class="rh-bar">'
    + '<img class="rh-track" src="assets/v8/loading/progress_track.png" alt="" aria-hidden="true" decoding="async">'
    + '<div class="rh-fillbox"><i class="rh-fill"></i></div>'
    + '<img class="rh-cat" src="assets/v8/loading/progress_cat.png" alt="" aria-hidden="true" decoding="async">'
    + '</div>'
    + '<div class="rh-welcome">欢迎回家</div>'
    + '</div>'
    + '<div class="rh-foot">松花酿酒，春水煎茶；云烟作伴，风月为家。</div>';
  (document.body || document.documentElement).appendChild(ov);

  window.__rhLoadingStats = stats;
  window.__rhLoading = {
    version: "loading0919-v2",
    bornAt: start,
    node: function () { return removed ? null : ov; },
    removed: false, fadingAt: null, reason: null, stats: stats
  };

  function setP(v) { ov.style.setProperty("--p", (Math.round(v * 100) / 100).toString()); }
  function targetP() {
    if (finished) return 100;
    if (booted) return total ? Math.min(100, done / total * 100) : 100;
    /* DOMContentLoaded 之前的估算：慢网下解析被图片流量挤住，光给个 6% 会让条僵在那儿。
       按「当前已解析出的 <img> 里有几张 complete」先估，封顶 85%，等 boot() 接手再走真账。 */
    if (!preT) return 6;
    return Math.max(6, Math.min(85, preD / preT * 85));
  }
  function tick() {
    var t = targetP();
    if (t > shown) shown = Math.min(t, shown + Math.max(0.4, (t - shown) * 0.14));   /* 单调不倒退 */
    setP(shown);
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);

  preTimer = setInterval(function () {
    if (booted) { clearInterval(preTimer); return; }
    try {
      var l = document.images, n = 0;
      for (var i = 0; i < l.length; i++) if (l[i].complete) n++;
      preT = l.length; preD = n;
    } catch (e) {}
  }, 200);

  function markDone() {
    done++;
    stats.done = done;
    if (booted && total && done >= total) finish(false);
  }
  function once(fn) { var d = false; return function () { if (d) return; d = true; fn(); }; }

  function teardown() {
    if (removed) return;
    removed = true;
    try { cancelAnimationFrame(raf); } catch (e) {}
    try { clearInterval(preTimer); } catch (e) {}
    try { clearInterval(bgTimer); } catch (e) {}
    try { if (ov.parentNode) ov.parentNode.removeChild(ov); } catch (e) {}
    try { document.body.classList.remove("rh-loading"); } catch (e) {}
    try { document.documentElement.classList.add("rh-loaded"); } catch (e) {}
    stats.ms = Date.now() - start;
    stats.total = total; stats.done = done;
    window.__rhLoading.removed = true;
    try { window.dispatchEvent(new Event("rh-loading-done")); } catch (e) {}
  }
  function finish(byTimeout) {
    if (finished) return;
    finished = true;
    stats.timeout = !!byTimeout;
    window.__rhLoading.reason = byTimeout ? "timeout-8s" : "all-ready";
    clearTimeout(hardTimer);
    setTimeout(function () {
      var t0 = Date.now();
      (function waitFull() {
        if (shown >= 99.9 || Date.now() - t0 > 800) {
          shown = 100; setP(100);
          setTimeout(function () {
            ov.classList.add("rh-out");
            window.__rhLoading.fadingAt = Date.now();
            setTimeout(teardown, FADE_MS + 40);
          }, HOLD_MS);
          return;
        }
        requestAnimationFrame(waitFull);
      })();
    }, Math.max(0, MIN_MS - (Date.now() - start)));
  }
  hardTimer = setTimeout(function () { finish(true); }, MAX_MS);

  function boot() {
    var i, list;
    stats.preboot_ms = Date.now() - start;
    clearInterval(preTimer);
    try { document.body.classList.add("rh-loading"); } catch (e) {}
    /* 遮罩是在 <html> 上造的（那会儿还没 body），这会儿挪进 body，DOM 位置跟小屋那版一致 */
    try { if (document.body && ov.parentNode !== document.body) document.body.appendChild(ov); } catch (e) {}

    /* ① 全部 <img>（遮罩自己那三张也算：牌子没到位就不该说加载完了） */
    list = Array.prototype.slice.call(document.images);
    stats.imgs = list.length;
    for (i = 0; i < list.length; i++) {
      (function (img) {
        total++;
        if (img.complete && img.naturalWidth > 0) { done++; return; }
        /* #backdrop 开机时是没有 src 的空 img（app.js 之后才写），complete 天然为 true ——
           这种不能当"已完成"混过去，交给下面 ③ 那条专门盯。 */
        if (img.id === "backdrop") { total--; return; }
        var f = once(markDone);
        img.addEventListener("load", f);
        img.addEventListener("error", f);
      })(list[i]);
    }
    /* ② 每个 <video> 的 loadeddata（error/abort 同样算完成） */
    list = document.querySelectorAll("video");
    stats.videos = list.length;
    for (i = 0; i < list.length; i++) {
      (function (v) {
        total++;
        if (v.readyState >= 2) { done++; return; }
        var f = once(markDone);
        v.addEventListener("loadeddata", f);
        v.addEventListener("error", f);
        v.addEventListener("abort", f);
      })(list[i]);
    }
    /* ③ 底图：oss 的底图 URL 是 app.js 按场景/季节/昼夜现算的，外面拿不到，
          所以盯 #backdrop 本体 —— src 写上了、complete 且 naturalWidth>0 才算数。 */
    total++;
    (function () {
      var f = once(function () { stats.bg = 1; markDone(); });
      bgTimer = setInterval(function () {
        var im = document.getElementById("backdrop");
        if (!im) return;
        if (im.getAttribute("src") && im.complete && im.naturalWidth > 0) { clearInterval(bgTimer); f(); }
      }, 80);
      setTimeout(function () { try { clearInterval(bgTimer); } catch (e) {} f(); }, MAX_MS - 200);
    })();
    /* ④ 字体 */
    total++;
    (function () {
      var f = once(function () { stats.fonts = 1; markDone(); });
      if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
        document.fonts.ready.then(f, f);
        setTimeout(f, 6000);
      } else { f(); }
    })();
    booted = true;
    stats.total = total; stats.done = done;
    if (!total || done >= total) finish(false);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else { boot(); }
})();
