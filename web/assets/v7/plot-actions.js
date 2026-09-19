/* ── 地块操作：三颗浮动钮 + 奇幻作物金光（开源版 oss-20260912）──────────────
   点开一块地，种 / 浇水 / 收三颗钮直接浮在植株头顶，不再弹卡片；
   奇幻种子那一档的植株底下再加一圈淡淡的金光。

   铁律：不改 app.js。老卡片 DOM 原样留着（三颗 .action 的 disabled 还是 app.js 算的），
   这里只做三件事——把卡片藏起来、照着卡片的状态画三颗浮动钮、点钮时代理点老钮。
   金光层的数据源（20260913 返修 R3，oss 移植 20260916）：成功 action 吃事件里带的已确认 state，
   首次/换场景/回前台/30 秒周期才按 app.js refresh() 那个 URL 拉一份只读的兜底。
   应急口：URL 带 ?card=1 → 不藏卡片、不建浮动钮（金光仍在，两件各自能独立回滚）。

   seedpick 20260916（玩家：「种种子的那个选择能更加优化得丝滑点吗」）：
   点「种」不再弹模态 —— 钮条原位 morph 成两颗种子 pill（普通/奇幻），同一套弹性曲线 stagger 弹出；
   点 pill 走 host.plant()（app.js 唯一新开的出口）当场种下，fold 收场。
   老 app.js 没有 host.plant 时自动退回老对话框路线。?card=1 下整段不启用。

   seedpick2 20260916（玩家：「下种 UI 再优化」——更少步骤 + 更好看）：
   · 空田/空花盆长按 ≥500ms 直接进 picker（不出钮条），suppress 吞掉合成 click 的手法照旧；
     系统长按菜单用 contextmenu 拦 + CSS callout/select none 罩 .plot-hit（都在 html.gd-plot-actions 下，legacy 不沾）。
   · app.js 侧玩家点头的两处顺手改了：空地 aria-label 补提示、plot-status 空土文案加半句。

   barepick 20260917（玩家否了三版牌牌：「不要用卡片，就直接用 UI，下面一排小字」）：
   picker 皮换成裸图标款——跟三颗浮动钮一个工艺（透明底、44px 图标、无框），
   图标下面垂名字+「约 X 分钟 · Y 金」两行小字，奶油 text-shadow 光晕压在底图上保证可读。
   皮全在 plot-actions.css；pickskin 试衣间整套已拆（玩家否了不留）。

   fxpick 20260917（玩家发官方素材：「使用这俩UI。加点特效，不要让UI太平面。」）：
   图标换 pouch-common/fantasy.png（奶油布袋，seed-pack 退役）；袋身 2.4s 待机浮动 +
   底下椭圆落地影同步呼吸、奇幻档三粒星点明灭 + 每 4s 一道极淡金光斜扫（mask 裁进袋形）、
   hover 提起 4px 放大 1.04 影跟着缩；灰态停浮动灭星，reduced-motion 全静态。

   labelpick 20260917（玩家终审：「文字不要这个版本的。跟别的UI底下的文字配套」）：
   奶油小签退役，名字签直接挂 v6 的 .gd-lab 深棕九切片药丸（跟「图鉴」「昼夜」同款皮）；
   灰态改成整颗 pick opacity .45。

   minipick 20260917（玩家：「图标弄小一点。跟种的时候出现3颗UI大小一致。字体你没换啊」）：
   袋子 72/60 → 双端 44（跟种浇收三颗钮同号），影/星/hover 等比收；place() 兜底 170×88。
   小签字体改回角钮实测串 GardenRefresh,"PingFang SC","Hiragino Sans GB","Microsoft Yahei"
   （.gd-pa-pick 上的 GardenRound 一直传给小签，这轮才配套上）。 */
(function () {
  'use strict';

  var Q = new URLSearchParams(location.search);
  var LEGACY = Q.get('card') === '1';
  var $ = function (id) { return document.getElementById(id); };
  var card = $('card'), plots = $('plots'), world = $('world'), viewport = $('viewport');
  if (!card || !plots || !world) return;

  /* ══════════ 一、三颗浮动钮 ══════════════════════════════════════════════ */

  var ACTIONS = [['seed', '种'], ['water', '浇水'], ['harvest', '收']];
  var ICON = { seed: 'assets/v4/seed.png', water: 'assets/v4/water.png', harvest: 'assets/v4/harvest.png' };
  var bar = null, btn = {}, badge = null, shown = false, hideTimer = 0, frame = 0;

  function srcButton(action) { return document.querySelector('.action[data-action="' + action + '"]'); }

  /* ── 代理点击 ─────────────────────────────────────────────────────────────
     老卡片那三颗真钮在 display:none 的 #card 里，`.click()` 派出去的事件照样冒泡到
     document。少了下面这两道闸，「点空白 → 关卡片」那条会把自己代理出的点击当成
     点空白，于是每浇一次水卡片就自己关一次（连点六下要重开六次地块）。
     两道闸：proxying 计数（click 是同步派发，进出都在这对括号里）+ #card 进白名单。 */
  var proxying = 0;
  function proxyClick(src) {
    if (!src || src.disabled) return false;
    proxying++;
    try { src.click(); } finally { proxying--; }
    return true;
  }

  /* ── 长按「浇」= 浇满（20260911 三轮 · B）──────────────────────────────────
     按住 ≥550ms 起步，之后一发一发代理点老卡那颗 water：点一下 → app.js 把 busy 拉起来
     （钮当场 disabled）→ 服务端回来 dispatch rainholm:garden-action → finally 里 render()
     重算 disabled。所以「还能不能再浇」就看那一发落定后钮有没有恢复；一直灰着 = 到 cap 了。 */
  var RING = 2 * Math.PI * 26;
  var ring = null;
  var pour = { on: false, hold: 0, tick: 0, suppress: false, phase: '', at: 0, shots: 0, n: -1 };
  function waterCount() {
    var st = $('plot-status');
    var m = st ? /(\d+)\s*\/\s*(\d+)/.exec(st.textContent || '') : null;
    return m ? +m[1] : -1;
  }

  function waterProgress() {
    var st = $('plot-status');
    var m = st ? /(\d+)\s*\/\s*(\d+)/.exec(st.textContent || '') : null;
    if (!m || !+m[2]) return 0;
    return Math.max(0, Math.min(1, (+m[1]) / (+m[2])));
  }
  function paintRing() {
    if (ring) ring.style.strokeDashoffset = (RING * (1 - waterProgress())).toFixed(2);
  }
  function startPour() {
    if (pour.on || !bar) return;
    var s = srcButton('water');
    if (!s || card.hidden) return;
    pour.on = true; pour.shots = 0; pour.phase = 'ready'; pour.at = Date.now(); pour.n = waterCount();
    btn.water.classList.add('is-pouring');
    paintRing();
    pourTick();
  }
  function stopPour() {
    clearTimeout(pour.hold);
    if (!pour.on) return;
    pour.on = false;
    clearTimeout(pour.tick);
    if (btn.water) btn.water.classList.remove('is-pouring');
  }
  /* 一发一发的收口信号用「#plot-status 里的已浇数涨了没有」，不用 #retry 也不用
     rainholm:garden-action。踩过的坑记在这：
       · #retry 不是「出事了」——app.js 在 sendAction 开头就 pending=有值 + render()，
         retry 当场现身，整个请求在飞的过程中它都亮着。第一版拿它当失败信号，结果
         每发都被自己掐断（实测桌面只浇到 4/6、手机只浇到 2/6）。
       · app.js 的 updateCard() 第 137/138 行是同一趟里先写状态文案、再算 disabled，
         而带新数字的那一趟 render() 来自 finally 的 busy=false 之后——所以「数字涨了」
         那一瞬间读到的 disabled 就是最终值：还亮着就接着浇，灰着就是到 cap 了。
     连接出事走 #connection（app.js 失败时往里写字，正常时是空的）。 */
  function pourTick() {
    clearTimeout(pour.tick);
    if (!pour.on) return;
    var s = srcButton('water'), now = Date.now(), conn = $('connection');
    if (!s || card.hidden || !shown || pour.shots >= 24) { stopPour(); return; }
    if (conn && (conn.textContent || '').trim()) { stopPour(); return; }   /* 连接出事，别再灌了 */
    if (pour.phase === 'ready') {
      if (!s.disabled) {
        pour.n = waterCount(); pour.shots++;
        proxyClick(s);
        pour.phase = 'wait'; pour.at = now;
      } else if (now - pour.at > 3000) { stopPour(); return; } /* 一直灰着，轮不到 */
    } else {                                                   /* wait：等这一发到账 */
      var n = waterCount();
      if (n >= 0 && n > pour.n) {
        /* 手感工程 20260913（oss 移植 20260916）：乐观更新后数字在按下那一下就涨、钮要等回包才解锁，
           老判断「涨数+灰=到 cap」会在第一发就把长按掐死。改成直接看数到没到顶；
           真不能浇（灰着不走）由 ready 相的 3 秒超时兜。 */
        var mCap = /(\d+)\s*\/\s*(\d+)/.exec(($('plot-status') || {}).textContent || '');
        if (mCap && +mCap[2] && n >= +mCap[2]) { stopPour(); return; }   /* 到 cap / 不能再浇 */
        pour.phase = 'ready'; pour.at = now;
      } else if (now - pour.at > 8000) { stopPour(); return; }
    }
    paintRing();
    pour.tick = setTimeout(pourTick, 60);
  }
  function wireLongPress(b) {
    /* 手机上按住会弹系统的长按菜单（复制图片/保存图片）。不在 pointerdown 上 preventDefault——
       触摸那条链上它会把后面合成的 click 一起吃掉，短按就废了。改用 contextmenu 拦 +
       CSS 的 -webkit-touch-callout:none / user-select:none，效果一样、短按还活着。 */
    b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    b.addEventListener('pointerdown', function (e) {
      if (b.getAttribute('aria-disabled') === 'true') return;
      if (e.button !== undefined && e.button !== 0) return;
      clearTimeout(pour.hold);
      pour.suppress = false;
      try { b.setPointerCapture(e.pointerId); } catch (err) {}
      pour.hold = setTimeout(function () { pour.suppress = true; startPour(); }, 550);
    });
    ['pointerup', 'pointercancel'].forEach(function (n) {
      b.addEventListener(n, function () { clearTimeout(pour.hold); stopPour(); });
    });
    window.addEventListener('pointerup', function () { clearTimeout(pour.hold); stopPour(); });
    window.addEventListener('pointercancel', function () { clearTimeout(pour.hold); stopPour(); });
    window.addEventListener('blur', function () { clearTimeout(pour.hold); stopPour(); });
  }

  function build() {
    document.documentElement.classList.add('gd-plot-actions');
    bar = document.createElement('div');
    bar.id = 'gd-plot-actions';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', '地块操作');
    bar.hidden = true;
    ACTIONS.forEach(function (a, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'gd-pa-btn';
      b.dataset.action = a[0];
      b.setAttribute('aria-label', a[1]);
      b.style.setProperty('--i', String(i));
      b.innerHTML = '<img src="' + ICON[a[0]] + '" alt="" draggable="false">';
      if (a[0] === 'water') {
        /* 进度环先建、水徽后建：后进 DOM 的画在上面，徽才不会被环划一道。
           环挂在钮外圈（56 见方、r=26），钮本身才 46——图标 44px 几乎占满，
           环压在图案上又细又看不清（第一发截图实测，2.5px 金线在米黄地上基本没有）。 */
        var NS = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('class', 'gd-pa-ring');
        svg.setAttribute('viewBox', '0 0 56 56');
        svg.setAttribute('aria-hidden', 'true');
        ['gd-pa-track', 'gd-pa-arc'].forEach(function (cls) {
          var c = document.createElementNS(NS, 'circle');
          c.setAttribute('class', cls);
          c.setAttribute('cx', '28'); c.setAttribute('cy', '28'); c.setAttribute('r', '26');
          svg.appendChild(c);
          if (cls === 'gd-pa-arc') ring = c;   /* 进度写在 circle 上：CSS 给 circle 定了
                                                  stroke-dashoffset，写外层 <svg> 会被盖掉 */
        });
        b.appendChild(svg);
        badge = document.createElement('span');
        badge.className = 'gd-pa-badge';
        badge.hidden = true;
        b.appendChild(badge);
        b.setAttribute('aria-label', '浇水（按住浇满）');
        wireLongPress(b);
      }
      b.addEventListener('click', function (e) {
        e.stopPropagation();                      /* 灰着的也吞掉，别顺手关了卡片 */
        if (a[0] === 'water' && pour.suppress) { pour.suppress = false; return; }  /* 长按那一下不再多浇一次 */
        if (b.getAttribute('aria-disabled') === 'true') return;
        if (a[0] === 'seed') { openPicker(); return; }   /* seedpick：原位 morph 出选种 pill，不弹模态 */
        proxyClick(srcButton(a[0]));               /* 业务零重写，全走老钮 */
      });
      btn[a[0]] = b;
      bar.appendChild(b);
    });
    buildPicks();
    document.body.appendChild(bar);
  }

  /* ── 选种 picker（seedpick 20260916）──────────────────────────────────────
     两颗 pill 跟三颗钮住同一颗 #gd-plot-actions：morph 只是换 class，锚点/跟随/撞顶翻下
     全部复用 place()/follow() 那套。文案照老对话框的格式（约 X 分钟 · Y 金），
     数据吃 host.getState() 的已确认态；灰态 = 老卡片种钮灰（离线/在飞/不再是空地）或金币不够。 */
  var picks = null, picking = false, pickPlot = 0, planting = false;
  var SEED_KINDS = ['common', 'fantasy'];
  /* finalpick 20260917 终稿皮：两只手绘种子袋（玩家的参考图稿）+ 图标下各垂一枚名字小签。
     价格/时间不进视觉，只留在 aria-label 里报给读屏（seedMeta 还给它留着）。
     fxpick 20260917：换官方 pouch 素材；fig 包住图标+星点+光扫，落地影一枚独立 <i>。 */
  var PACK_ICON = { common: 'assets/v4/pouch-common.png', fantasy: 'assets/v4/pouch-fantasy.png' };

  function hostState() {
    var h = window.RainholmGarden;
    if (h && typeof h.getState === 'function') { try { return h.getState(); } catch (e) {} }
    return null;
  }
  function seedName(k) {
    return (k === 'common' ? '普通' : '奇幻') + (currentScene() === 'garden' ? '种子' : '花种');
  }
  function seedMeta(k, st) {
    var mins = Math.round((st.rules.growTicks[k] || 0) * st.rules.tickMs / 60000);
    return '约 ' + mins + ' 分钟 · ' + st.rules.seedPrice[k] + ' 金';
  }

  function buildPicks() {
    picks = document.createElement('div');
    picks.className = 'gd-pa-picks';
    picks.setAttribute('role', 'group');
    picks.setAttribute('aria-label', '选种子');
    SEED_KINDS.forEach(function (k, i) {
      var p = document.createElement('button');
      p.type = 'button';
      p.className = 'gd-pa-pick';
      p.dataset.seed = k;
      p.style.setProperty('--i', String(i));
      p.innerHTML = '<span class="gd-pa-pick-fig" aria-hidden="true"><img src="' + PACK_ICON[k] + '" alt="" draggable="false"></span>' +
        '<i class="gd-pa-pick-sh" aria-hidden="true"></i>' +
        '<span class="gd-lab gd-pa-pick-t"><strong></strong></span>';   /* labelpick：皮白嫖 v6 .gd-lab 深棕药丸 */
      if (k === 'fantasy') {                    /* 星点明灭 + 金光斜扫，纯 CSS 粒子，不引新图 */
        var fig = p.querySelector('.gd-pa-pick-fig');
        [[12, 14], [86, 9], [80, 56]].forEach(function (pos, j) {
          var s = document.createElement('i');
          s.className = 'gd-pa-pick-star';
          s.style.left = pos[0] + '%'; s.style.top = pos[1] + '%';
          s.style.animationDelay = (-(j * 0.9)).toFixed(2) + 's';
          fig.appendChild(s);
        });
        var sw = document.createElement('i');
        sw.className = 'gd-pa-pick-sweep';
        fig.appendChild(sw);
      }
      p.addEventListener('click', function (e) {
        e.stopPropagation();                      /* pill 在 #gd-plot-actions 白名单里，这里再吞一层双保险 */
        if (p.getAttribute('aria-disabled') === 'true') return;
        var h = window.RainholmGarden, hit = selectedHit();
        if (!hit || !h || typeof h.plant !== 'function') return;
        h.plant(+hit.dataset.plot, k);            /* 乐观更新+种子落下动效在 app.js 那侧当场起 */
        /* 种下一瞬 pill 自己弹性回跳一下再 fold —— 「按下去 → 弹一下 → 种子落进土里」。
           这 180ms 里 sync 别抢戏：地已不空，自动 closePicker 会把回跳剪掉（planting 挂住它）。 */
        planting = true;
        bar.classList.add('gd-pa-planted');
        setTimeout(function () {
          planting = false;
          bar.classList.remove('gd-pa-planted');
          var still = picking;                    /* 没被 sync/hide 提前收掉，才轮到我们 fold+关卡片 */
          closePicker(true);
          if (still) { var close = $('close-card'); if (close) close.click(); }
        }, 180);
      });
      picks.appendChild(p);
    });
    bar.appendChild(picks);
  }

  function openPicker() {
    if (picking || !picks) return;
    var h = window.RainholmGarden;
    /* 老 app.js 没有这个出口：回老对话框路线，picker 当没存在过 */
    if (!h || typeof h.plant !== 'function' || typeof h.getState !== 'function') { proxyClick(srcButton('seed')); return; }
    var hit = selectedHit();
    if (!hit) return;
    picking = true; pickPlot = +hit.dataset.plot;
    Array.prototype.forEach.call(picks.children, function (p) {
      p.querySelector('strong').textContent = seedName(p.dataset.seed);
    });
    syncPicks();
    bar.classList.add('gd-pa-picking');
  }
  function closePicker(silent) {
    if (!picking) return;
    picking = false; pickPlot = 0; planting = false;
    bar.classList.remove('gd-pa-picking');
    bar.classList.remove('gd-pa-planted');
    /* 回到钮条时重放一遍 pop（从 picker 挤回来那一下不能是干跳）；
       正在 fold 收场（gd-pa-out 已挂/即将挂，silent）时别碰，让 fold 播完 */
    if (!silent && shown && bar.classList.contains('gd-pa-in')) {
      bar.classList.remove('gd-pa-in'); void bar.offsetWidth; bar.classList.add('gd-pa-in');
    }
  }
  function syncPicks() {
    if (!picking) return;
    var st = hostState();
    var src = srcButton('seed'), srcOff = !src || src.disabled;   /* 离线/这块地在飞/地不再空 */
    Array.prototype.forEach.call(picks.children, function (p) {
      var k = p.dataset.seed;
      var off = srcOff || !st || st.coins < (st.rules.seedPrice[k] ?? Infinity);
      p.setAttribute('aria-disabled', String(off));
      p.classList.toggle('is-off', off);
      p.setAttribute('aria-label', '种下' + seedName(k) + (st ? '，' + seedMeta(k, st).replace(' · ', '，') : ''));
    });
  }

  function selectedHit() { return plots.querySelector('.plot-hit[aria-pressed="true"]'); }

  /* ── 长按空地直接挑种子（seedpick2 20260916）──────────────────────────────
     空田/空花盆按住 ≥500ms：不出钮条，直接进 picker；短按照旧出钮条，两个手势不打架。
     suppress 照 wireLongPress 那套：长按触发后，pointerup 合成的那一下 click 在
     #plots 捕获段吞掉，hit.onclick 的 openCard 不会再跑一遍（不然长按完又弹钮条）。
     非空地块不挂定时器——长按浇满在水钮上，这里不抢戏。 */
  var lp = { timer: 0, suppress: false, sx: 0, sy: 0 };
  function emptyPlot(id) {
    var st = hostState();
    if (st) {
      var list = currentScene() === 'garden' ? st.plots : st.flowerPlots;
      var p = list && list.find(function (q) { return q.id === id; });
      if (p) return p.state === 'empty';
    }
    var h = plots.querySelector('.plot-hit[data-plot="' + id + '"]');   /* 没 state 兜底认 aria-label */
    return !!h && (h.getAttribute('aria-label') || '').indexOf('空土') >= 0;
  }
  function longPressPick(hit) {
    if (picking) closePicker(true);          /* 正在给别的地挑：先收，直接换到这块 */
    hit.click();                             /* 走 openCard 老路：selected/卡片状态/aria-pressed 一次到位 */
    lp.suppress = true;                      /* synthetic click 已同步走完，接下来 pointerup 那下才吞 */
    sync();                                  /* 立刻摆条（不等 250ms 轮询），picker 紧跟着 morph 上去 */
    openPicker();
  }
  function wirePlotLongPress() {
    /* 手机上按住会弹系统长按菜单：contextmenu 拦 + CSS 罩 .plot-hit（callout/select none），
       不在 pointerdown 上 preventDefault——那会把短按合成的 click 一起吃掉。 */
    plots.addEventListener('contextmenu', function (e) {
      var t = e.target;
      if (t && t.closest && t.closest('.plot-hit')) e.preventDefault();
    });
    plots.addEventListener('pointerdown', function (e) {
      lp.suppress = false;                        /* 新手势开始：上次若因 pointercancel 没等到 click，别误吞下一击 */
      var t = e.target, hit = t && t.closest ? t.closest('.plot-hit') : null;
      if (!hit || !plots.contains(hit)) return;
      if (e.button !== undefined && e.button !== 0) return;
      if (hit.classList.contains('unopened-hit')) return;   /* 未开垦的地点开是升级面板，别拦 */
      if (!emptyPlot(+hit.dataset.plot)) return;
      lp.sx = e.clientX; lp.sy = e.clientY;
      clearTimeout(lp.timer);
      lp.timer = setTimeout(function () { lp.timer = 0; longPressPick(hit); }, 500);
    });
    plots.addEventListener('pointermove', function (e) {    /* 按住滑走（拖屏）不算长按 */
      if (!lp.timer) return;
      if (Math.abs(e.clientX - lp.sx) > 10 || Math.abs(e.clientY - lp.sy) > 10) { clearTimeout(lp.timer); lp.timer = 0; }
    });
    ['pointerup', 'pointercancel'].forEach(function (n) {
      window.addEventListener(n, function () { clearTimeout(lp.timer); lp.timer = 0; });
    });
    window.addEventListener('blur', function () { clearTimeout(lp.timer); lp.timer = 0; });
    plots.addEventListener('click', function (e) {
      if (!lp.suppress) return;
      lp.suppress = false;
      e.stopPropagation();
      e.preventDefault();
    }, true);
  }

  function show() {
    clearTimeout(hideTimer);
    if (shown) return;
    shown = true;
    bar.hidden = false;
    bar.classList.remove('gd-pa-out');
    void bar.offsetWidth;                          /* 重放动画 */
    bar.classList.add('gd-pa-in');
    if (!follow.on) follow();
  }

  function hide() {
    stopPour();
    if (!shown) { closePicker(); return; }
    shown = false;
    bar.classList.remove('gd-pa-in');
    bar.classList.add('gd-pa-out');
    closePicker();                              /* picker 跟着一起收（gd-pa-in 已摘，不会误重放 pop） */
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { if (!shown) { bar.hidden = true; bar.classList.remove('gd-pa-out'); } }, 130);
  }

  /* 人物避让：开源版没有走路层，这里返回空表；宿主想接自己的小人层，
     把它改成「返回那些小人精灵的 getBoundingClientRect()」就行，下面的避让逻辑照用。 */
  function walkerRects() { return []; }
  function overlaps(l, t, w, h, q) {
    return l < q.right && l + w > q.left && t < q.bottom && t + h > q.top;
  }

  function place(hit) {
    var r = hit.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) {
      bar.classList.add('gd-pa-off');              /* 地块滚出视口：淡掉且不响应 */
      return;
    }
    bar.classList.remove('gd-pa-off');
    /* 兜底尺寸分模式：钮条 158×46；minipick 后 picker ≈ 170×88（两只 44 袋 + 影 + 药丸签） */
    var w = bar.offsetWidth || (picking ? 170 : 158), h = bar.offsetHeight || (picking ? 88 : 46);
    var left = r.left + r.width / 2 - w / 2;
    left = Math.min(innerWidth - 8 - w, Math.max(8, left));
    var top = r.top - 12 - h;                      /* 植物头顶：地块顶沿再往上 12px */
    if (top < 70) top = r.bottom + 12;             /* 顶上撞 HUD 就改到地块下方 */
    var hitters = walkerRects().filter(function (q) { return overlaps(left, top, w, h, q); });
    if (hitters.length) {                          /* 撞上人物：整体抬到最高那颗的头顶上方 10px */
      var minTop = Math.min.apply(null, hitters.map(function (q) { return q.top; }));
      top = minTop - 10 - h;
      if (top < 70) top = r.bottom + 12;           /* 抬到顶了就翻到地块下方（原有逻辑） */
    }
    top = Math.min(innerHeight - 8 - h, Math.max(8, top));
    bar.style.left = left + 'px';
    bar.style.top = top + 'px';
  }

  function sync() {
    if (!bar) return;
    var hit = card.hidden ? null : selectedHit();
    if (!hit) { hide(); return; }
    if (picking) {
      /* 点别的地 / 地不再空 / 连接掉了 → picker 挤回钮条；开着就刷新灰态。
         planting 那 180ms（pill 回跳）且还是这块地时撑住别收；地换了就立刻让位 */
      if (planting && +hit.dataset.plot === pickPlot) { /* 回跳中，撑住 */ }
      else if (+hit.dataset.plot !== pickPlot || (srcButton('seed') && srcButton('seed').disabled)) closePicker();
      else syncPicks();
    }
    ACTIONS.forEach(function (a) {                 /* 灰态照抄老卡片的 disabled */
      var s = srcButton(a[0]), off = !s || s.disabled;
      btn[a[0]].setAttribute('aria-disabled', String(off));
      /* 长按浇满的过程中 busy 会把水钮反复拉灰，视觉上一明一灭很闹；aria 照实说，只压住那层灰 */
      btn[a[0]].classList.toggle('is-off', off && !(a[0] === 'water' && pour.on));
    });
    paintRing();
    var status = $('plot-status');
    var m = status ? /(\d+)\s*\/\s*(\d+)/.exec(status.textContent || '') : null;
    if (badge) { badge.hidden = !m; if (m) badge.textContent = m[1] + '/' + m[2]; }
    show();
    place(hit);
  }

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(function () { frame = 0; sync(); });
  }
  /* 显示期间挂一条 rAF：小人一步一步走过来，钮要一帧一帧让开 */
  function follow() {
    if (!bar || !shown) { follow.on = false; return; }
    follow.on = true;
    var hit = card.hidden ? null : selectedHit();
    if (!hit) sync(); else place(hit);
    requestAnimationFrame(follow);
  }

  /* ══════════ 二、奇幻作物金光 ═══════════════════════════════════════════ */

  var glow = null, byId = null, glowScene = null, lastPull = 0, pulling = false;

  function currentScene() {
    var h = window.RainholmGarden;
    if (h && typeof h.getScene === 'function') { try { return h.getScene(); } catch (e) {} }
    return Q.get('scene') === 'greenhouse' ? 'greenhouse' : 'garden';
  }

  function ensureGlow() {
    if (glow && glow.isConnected) return glow;
    glow = document.createElement('div');
    glow.id = 'gd-glow';
    glow.setAttribute('aria-hidden', 'true');
    var plantsEl = $('plants');                    /* #plants 之上、#plots 之下 */
    if (plantsEl && plantsEl.parentNode) plantsEl.parentNode.insertBefore(glow, plantsEl.nextSibling);
    else world.appendChild(glow);
    return glow;
  }

  function paintGlow() {
    var g = ensureGlow();
    if (!byId || glowScene !== currentScene()) { g.replaceChildren(); return; }
    var frag = document.createDocumentFragment(), n = 0;
    plots.querySelectorAll('.plot-hit[data-plot]').forEach(function (hit) {
      var p = byId[hit.dataset.plot];
      /* 作物身份到收获才揭晓是引擎设计；地里前端只知道 common / fantasy。
         growing 和 ripe 都发光，empty 不发。 */
      if (!p || p.state === 'empty' || p.seedType !== 'fantasy') return;
      var w = hit.offsetWidth, d = w * 0.9;        /* 直径 ≈ 地块宽的 0.9 */
      var cx = hit.offsetLeft + w / 2;
      var cy = hit.offsetTop + hit.offsetHeight * 0.3;   /* 地块中心偏上 20% */
      var spot = document.createElement('div');
      spot.className = 'gd-glow-spot';
      spot.dataset.plot = hit.dataset.plot;
      spot.style.left = (cx - d / 2) + 'px';
      spot.style.top = (cy - d / 2) + 'px';
      spot.style.width = d + 'px';
      spot.style.height = d + 'px';
      spot.style.setProperty('--ph', (-(n % 4) * 0.65).toFixed(2) + 's');
      var core = document.createElement('div');
      core.className = 'gd-glow-core';
      spot.appendChild(core);
      for (var k = 0; k < 4; k++) {                /* 3–4 粒小金点缓慢上浮，随机相位 */
        var mote = document.createElement('i');
        mote.className = 'gd-glow-mote';
        mote.style.setProperty('--mx', (20 + k * 20) + '%');
        mote.style.setProperty('--md', (-(k * 1.5 + (n % 3) * 0.5)).toFixed(2) + 's');
        spot.appendChild(mote);
      }
      frag.appendChild(spot);
      n++;
    });
    g.replaceChildren(frag);
  }

  /* cathome20260913：只有花园和花房有服务端数据。小窝（以及以后任何纯风景场景）
     问 api/state 只会拿一个 400 回来，金光本来也无处可画 —— 直接把这层清空退出。 */
  var DATA_SCENES = ['garden', 'greenhouse'];

  function consumeState(state, scene) {
    /* 统一状态来源（20260913 返修 R3，oss 移植 20260916）：成功 action 的已确认 state 由
       app.js 随 rainholm:garden-action 事件带来，直接吃；不用再为金光层多拉一次 GET。 */
    if (!state) return false;
    scene = scene || currentScene();
    if (scene !== currentScene()) return false;
    if (DATA_SCENES.indexOf(scene) < 0) return false;
    var list = scene === 'garden' ? state.plots : state.flowerPlots;
    if (!Array.isArray(list)) return false;
    var map = Object.create(null);
    list.forEach(function (p) { map[p.id] = p; });
    byId = map; glowScene = scene; lastPull = Date.now();
    paintGlow();
    return true;
  }

  function pullState(force) {
    var now = Date.now();
    if (pulling || (!force && now - lastPull < 1500)) return;
    var scene = currentScene();
    if (DATA_SCENES.indexOf(scene) < 0) {
      byId = null; glowScene = null; ensureGlow().replaceChildren();
      return;
    }
    pulling = true; lastPull = now;
    /* app.js 的 refresh() 用的就是这个 URL，同源同 cookie，只读。
       只留真正必要的几路：首次获取、事件没带 state 的兜底、30 秒周期刷新、回前台 */
    fetch('api/state?scene=' + encodeURIComponent(scene), { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (b) {
        if (!b || !b.ok || !b.state) return;
        consumeState(b.state, scene);
      })
      .catch(function () {})
      .then(function () { pulling = false; });
  }

  /* ══════════ 三、接线 ═══════════════════════════════════════════════════ */

  if (!LEGACY) {
    build();
    wirePlotLongPress();
    new MutationObserver(schedule).observe(card, { attributes: true, attributeFilter: ['hidden'] });
    if (viewport) viewport.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    setInterval(sync, 250);                        /* app.js 每次 render 都重建 #plots，兜底 */
    document.addEventListener('click', function (e) {
      if (!shown) return;
      if (proxying) return;                        /* 我自己代理出去的那一下，不是「点空白」 */
      var t = e.target;
      if (!t || !t.closest) return;
      /* 点别的地块交给 app.js 自己切；种子面板/菜单点了别把 selected 清掉；
         #card 必须在白名单里——代理点老钮时事件就是从它里面冒出来的（20260911 三轮 A） */
      if (t.closest('#gd-plot-actions') || t.closest('#plots') || t.closest('#card') || t.closest('dialog')
        || t.closest('#menu') || t.closest('#menu-toggle')) return;
      var close = $('close-card');
      if (close) close.click();
    });
  }

  /* #plots 一重建就重摆钮 + 重画光斑（位置是按 hit 的盒子算的） */
  new MutationObserver(function () { schedule(); paintGlow(); }).observe(plots, { childList: true });

  window.addEventListener('rainholm:garden-ready', function () { pullState(true); });
  /* 返修 R3（oss 移植 20260916）：成功 action 的已确认 state 随事件带来，直接消费；事件没带（旧版 app.js）才兜底拉 */
  window.addEventListener('rainholm:garden-action', function (e) {
    var d = e && e.detail;
    if (!d || !consumeState(d.state, d.scene)) pullState(true);
  });
  window.addEventListener('rainholm:garden-scene', function () {
    stopPour();
    byId = null; glowScene = null; ensureGlow().replaceChildren(); pullState(true);
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) pullState(true); });
  setInterval(function () { if (!document.hidden) pullState(false); }, 30000);

  ensureGlow();
  pullState(true);
  schedule();
})();

/* ── 角钮的药丸标签（开源版 oss-20260912）───────────────────────────────────
   右上那一列是裸图标 + 图标正下方深棕九切片药丸中文字。皮全在
   assets/v7/corner-stack.css，这一段只负责把 <span> 挂上去。

   两条路（伪元素 ::after 写 content / append 一个 span）里选后者：
   药丸是 border-image 九切片撑出来的，伪元素里宽度和换行不好控，append 的真节点
   跟 v6 工具条那批 .gd-lab 走的是同一条渲染路径，长什么样一眼可比。

   #night 由 app.js 按 host.allowThemePreview 决定显不显示，所以这里轮询等它出现。 */
(function () {
  'use strict';
  /* toolsicon0918：角钮换成竹篮工具箱（玩家 9/18 18:00「展开有 2 个图鉴一样的」），字也跟着改成「工具」，
     展开托盘里那颗才叫「图鉴」。 */
  var OWN = [['menu-toggle', '工具'], ['night', '昼夜']];
  function paint() {
    var done = 0;
    OWN.forEach(function (w) {
      var b = document.getElementById(w[0]);
      if (!b) return;
      done++;
      if (b.querySelector('.gd-corner-label')) return;
      var s = document.createElement('span');
      s.className = 'gd-lab gd-corner-label';
      s.setAttribute('aria-hidden', 'true');   /* 钮自己的 aria-label 才是给读屏的，别念两遍 */
      s.textContent = w[1];
      b.appendChild(s);
    });
    return done >= OWN.length;
  }
  if (!paint()) {
    var n = 0;
    var timer = setInterval(function () { if (paint() || ++n > 60) clearInterval(timer); }, 100);
  }
  window.addEventListener('rainholm:garden-ready', paint);
})();
