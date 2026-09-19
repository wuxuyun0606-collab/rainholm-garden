


(function () {
  'use strict';

  /* 文案一字不改 —— 三行，顺序照玩家给的 */
  /* v2（9/19 05:12 玩家定稿）：第三行换成「rainholm小屋制作：BlueBlue（小红书）」。
     中途有一版带 🍀（05:11），05:12 玩家又去掉了 —— 现在三行全是中西文，
     不依赖任何 emoji 字体回退。面板和加载页共用这一份常量，改这一处两边同时生效。 */
  var LINES = [
    '小屋方案原作：59（小红书）',
    '种植方案原作：初一（小红书）',
    'rainholm小屋制作：BlueBlue（小红书）'
  ];

  var BTN_ID = 'rhCreditsBtn';
  var DLG_ID = 'rhCreditsDlg';
  var TITLE_ID = 'rhCreditsTitle';

  var $ = function (id) { return document.getElementById(id); };

  /* 钮的图标：一片草木绿小叶 + 一条丝带，画法照 codex-wall 那套花饰
     （叶子 fill #9cb083 / stroke #5f7350 + 中脉一条浅金线；丝带用同族的绿描边）。
     先出稿，玩家要过 —— 换图标只改这一个函数。 */
  function iconSVG() {
    /* 视觉等大：corner-stack.css 第 92 段量过，这一列的基准是「46/44 的盒子里可见高约 33.8px」
       （图鉴那张 note.png 的 0.7539）。所以图形的 bbox 要占到 viewBox 的 ~77%：
       下面这套叶+丝带占 x 6.5~40、y 5~40.4（35.4/46 = 77%），44 盒子里可见高 ≈ 33.9px，
       跟旁边四颗一家人。描边 2~2.2 才在 44px 下立得住（第一版 1.6~1.7 的细线看着又小又飘）。 */
    return '<svg class="rc-ico" viewBox="0 0 46 46" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">'
      /* 枝 */
      /* 一片草木绿大叶，占上面三分之二 */
      + '<path d="M37.5 5.5 C23 7.5 12.5 16.5 8.5 30 C22.5 28 33.5 19 37.5 5.5 Z" fill="#9cb083" stroke="#5f7350" stroke-width="2" stroke-linejoin="round"/>'
      + '<path d="M8.5 30 C17.5 24 28 15.5 37.5 5.5" fill="none" stroke="#d6c06a" stroke-width="1.6" stroke-linecap="round"/>'
      /* 一颗橙果，跟票签框那套花饰同色 */
      + '<circle cx="14.6" cy="22.6" r="2.4" fill="#e2952f" stroke="#c87c25" stroke-width="1.2"/>'
      /* 一条丝带：燕尾缺口的绶带。44px 下比蝴蝶结那版立得住得多 ——
         结环缩到 44px 会糊成两颗圆点（第一稿实测就是这样），绶带的外轮廓一眼认得出。 */
      + '<path d="M5 30.6 L41 30.6 L36.6 35.6 L41 40.6 L5 40.6 L9.4 35.6 Z" fill="#f2e6c6" stroke="#5f7350" stroke-width="2" stroke-linejoin="round"/>'
      + '</svg>';
  }

  function sprigSVG() {
    /* 面板顶上那颗小花饰：两片叶子打个结，跟 codex-wall 分组标题那颗同源 */
    return '<svg viewBox="0 0 52 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">'
      + '<g fill="#b9c6a0" stroke="#74855d" stroke-width="1.3" stroke-linejoin="round">'
      + '<path d="M23.6 12 C17.8 4.4 9.6 3.8 5 7.8 C9.6 16.6 19 18 23.6 12 Z"/>'
      + '<path d="M28.4 12 C34.2 4.4 42.4 3.8 47 7.8 C42.4 16.6 33 18 28.4 12 Z"/>'
      + '</g>'
      + '<g fill="none" stroke="#74855d" stroke-width="1.1" stroke-linecap="round">'
      + '<path d="M9 8.6 C13.8 9.4 19 10.6 23 12"/><path d="M43 8.6 C38.2 9.4 33 10.6 29 12"/>'
      + '</g>'
      + '<circle cx="26" cy="12" r="1.8" fill="#74855d"/>'
      + '</svg>';
  }

  /* ── 钮 ──────────────────────────────────────────────────────────────── */
  function makeButton() {
    if ($(BTN_ID)) return $(BTN_ID);
    var b = document.createElement('button');
    b.id = BTN_ID;
    b.type = 'button';
    b.setAttribute('aria-label', '鸣谢');
    b.setAttribute('aria-haspopup', 'dialog');
    b.innerHTML = iconSVG();
    var lab = document.createElement('span');
    /* 药丸皮一个字不重写：v6 的 .gd-lab + corner-stack 的 .gd-corner-label 直接拿来用 */
    lab.className = 'gd-lab gd-corner-label';
    lab.textContent = '鸣谢';
    b.appendChild(lab);
    b.addEventListener('click', open);
    document.body.appendChild(b);
    return b;
  }

  /* 落点：恒在整列最下面一格。
     上头占几格 = 图鉴(#menu-toggle，恒在) + 昼夜(#night，allowThemePreview 关就没有)
                + batch4 那几颗 .nb4-corner 里当下可见的。
     算法照 batch4 relayout() 的同一套数法，但只读不写 —— 它的 --nb4-i 一个都不碰。 */
  function slotIndex() {
    var n = 1;                                   /* #menu-toggle 图鉴 */
    var night = $('night');
    if (night && !night.hidden && getComputedStyle(night).display !== 'none') n++;
    /* 这一列的右缘：拿图鉴那颗当基准（corner-stack.css 里它 right:var(--cs-right)） */
    var mt = $('menu-toggle');
    var colRight = mt ? Math.round(window.innerWidth - mt.getBoundingClientRect().right) : null;
    var list = document.querySelectorAll('.nb4-corner');
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (b.id === BTN_ID || b.hidden) continue;
      if (getComputedStyle(b).display === 'none') continue;
      /* ⚠️ .nb4-corner 不都在右上这一列：host-cat.js 的猫爪面板钮 #nccPaw 也挂这个类，
         但它蹲在屏幕下方中间（实测 m390 top 758 / right 262）。照单全收会把这颗鸣谢钮
         白白往下推一格，中间空出一个洞（第一版就是这么空的）。两道闸一起用：
         1) 只认 batch4 relayout() 亲手写过 inline --nb4-i 的（它只给自己那几颗列钮写）；
         2) 再核一遍右缘跟图鉴那颗对得上（±6px）。 */
      if (!b.style.getPropertyValue('--nb4-i')) continue;
      if (colRight !== null) {
        var r = Math.round(window.innerWidth - b.getBoundingClientRect().right);
        if (Math.abs(r - colRight) > 6) continue;
      }
      n++;
    }
    return n;
  }

  function relayout() {
    var b = $(BTN_ID);
    if (!b) return;
    var n = slotIndex();
    b.style.setProperty('--rc-i', n);
    b.style.setProperty('--rc-col', Math.floor(n / 3));   /* 横屏矮屏两列三行那档 */
    b.style.setProperty('--rc-row', n % 3);
  }

  /* ── 面板 ────────────────────────────────────────────────────────────── */
  function makeDialog() {
    if ($(DLG_ID)) return $(DLG_ID);
    var d = document.createElement('dialog');
    d.id = DLG_ID;
    d.setAttribute('aria-labelledby', TITLE_ID);
    var html = '<div class="rc-inner">'
      + '<button type="button" class="rc-close" aria-label="关闭">×</button>'
      + '<div class="rc-sprig" aria-hidden="true">' + sprigSVG() + '</div>'
      + '<h2 id="' + TITLE_ID + '">鸣谢</h2>'
      + '<div class="rc-rule" aria-hidden="true"></div>'
      + '<div class="rc-body"></div>'
      + '</div>';
    d.innerHTML = html;
    var body = d.querySelector('.rc-body');
    /* 文案走 textContent，不拼进 innerHTML —— 一个字都不会被 HTML 解析吃掉 */
    LINES.forEach(function (t) {
      var p = document.createElement('p');
      p.textContent = t;
      body.appendChild(p);
    });
    d.querySelector('.rc-close').addEventListener('click', function () { d.close(); });
    /* 点纸外关闭：::backdrop 的 click 目标就是 <dialog> 本体，纸面上的点击落在 .rc-inner 里 */
    d.addEventListener('click', function (e) {
      if (e.target === d) d.close();
    });
    document.body.appendChild(d);
    return d;
  }

  function open() {
    var d = makeDialog();
    if (!d.open) d.showModal();
  }

  /* ── 加载页底部三行（皮见 css 末尾那段）─────────────────────────────────
     开源版目前没有 #rhLoading，这段等它出现；出现了就把节点 append 进去，
     遮罩淡出/移除时它跟着一起走（它是遮罩的子节点，不用自己管生命周期）。 */
  function mountLoading(host) {
    if (!host || host.querySelector('.rc-loading')) return false;
    var box = document.createElement('div');
    box.className = 'rc-loading';
    LINES.forEach(function (t) {
      var p = document.createElement('p');
      p.textContent = t;
      box.appendChild(p);
    });
    host.appendChild(box);
    return true;
  }

  function watchLoading() {
    if (mountLoading(document.getElementById('rhLoading'))) return;
    var mo = new MutationObserver(function () {
      var el = document.getElementById('rhLoading');
      if (el && mountLoading(el)) { /* 挂上就够了，观察者留着：遮罩可能被重建 */ }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  /* ── 启动 ────────────────────────────────────────────────────────────── */
  function boot() {
    makeButton();
    relayout();
    watchLoading();

    /* 换场景后钮还在：app.js 换场景会 dispatch rainholm:garden-scene，
       而且它会 $('dialog').close() + 重铺 #world —— 我们这颗钮挂在 body 上，
       本来就不在被重铺的范围里，这里只是重算一次落点（昼夜钮可能刚被收起来）。 */
    window.addEventListener('rainholm:garden-scene', function () {
      makeButton(); relayout();
    });
    window.addEventListener('rainholm:garden-action', relayout);
    window.addEventListener('resize', relayout);
    window.addEventListener('orientationchange', relayout);

    /* #night 的 hidden 由 app.js 每帧 render 写；batch4 那几颗也会随场景显隐。
       盯这两处的属性变化，整列一动这颗钮跟着重新落点。 */
    var mo = new MutationObserver(relayout);
    var night = $('night');
    if (night) mo.observe(night, { attributes: true, attributeFilter: ['hidden', 'style', 'class'] });
    mo.observe(document.body, { childList: true });

    window.__rhCredits = {
      version: 'credits0919-v1',
      lines: LINES.slice(),
      open: open,
      slotIndex: slotIndex,
      relayout: relayout,
      mountLoading: mountLoading
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
