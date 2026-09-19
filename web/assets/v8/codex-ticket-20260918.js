


(function () {
  'use strict';


  var CODEX_TICKET = false;                    /* ← 图鉴票签开关：true = 图鉴钮走票签版；false = 旧卡片墙 */
  var HARVEST_TICKET = true;                   /* ← 收获票签开关：false = 退回 app.js 自己的揭晓小窗 */
  var V = '?v=codexticket0918-v3';
  var FRAME = 'assets/v8/codex-ticket/ticket-frame.png' + V;
  var INDEX_URL = 'assets/codex/index.json';   /* app.js 也读这份，浏览器缓存里现成的 */

  /* 候选包 catalog.json 的 editorialCopy 原文，六段，一字未改也未增。 */
  var EDITORIAL = {
    strawberry: '把阳光藏进红红的果子里，\n连叶尖都带着一点甜。',
    carrot: '泥土里藏着橘色的小惊喜，\n绿叶是它悄悄留下的记号。',
    sunflower: '把小小的脸朝向光，\n也把明亮留在花园里。',
    bubble_peony: '花瓣托起一串轻盈的梦，\n像还没说出口的悄悄话。',
    coral_moon_cactus: '把一弯弯月亮挂在枝头，\n给花园留一盏温柔的灯。',
    melody_vine: '风经过卷曲的藤梢，\n仿佛留下一小段旋律。'
  };
  var CATEGORY = { common: '普通种子', fantasy: '奇幻种子', limited: '限定收藏' };
  var UNKNOWN_DESC = '留一页空白，\n等下一次收获来写。';


  var FLOWER_BY_SLUG = {
    'cream-star': 'rainholm_flower_cream_star',
    'blush-chime': 'rainholm_flower_blush_chime',
    'moon-dew': 'rainholm_flower_moon_dew',
    'amber-lantern': 'rainholm_flower_amber_lantern'
  };
  var FLOWER_ORDER = ['rainholm_flower_cream_star', 'rainholm_flower_blush_chime',
                      'rainholm_flower_moon_dew', 'rainholm_flower_amber_lantern'];

  var $ = function (id) { return document.getElementById(id); };
  var indexMap = null, indexOrder = null, indexWaiting = null, activeCancel = null;

  function loadIndex() {
    /* 同一个在飞的 promise 复用：不然 app.js 索引到手后重铺那一下会拿到还没填上的 indexMap */
    if (indexWaiting) return indexWaiting;
    indexWaiting = fetch(INDEX_URL).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      var items = j && Array.isArray(j.items) ? j.items : null;
      if (!items) return null;
      indexOrder = items.map(function (x) { return x.id; });
      indexMap = Object.create(null);
      items.forEach(function (x) { indexMap[x.id] = x; });
      return indexMap;
    }).catch(function () { return null; });
    return indexWaiting;
  }

  /* ── 读现役卡片墙：这堵墙是 app.js 按 state.codex 铺的，就是真实收获记录 ── */
  function readWall(body) {
    var cards = body.querySelectorAll('article.codex-card');
    if (!cards.length) return null;
    var order = [], found = Object.create(null), n = 0;
    for (var i = 0; i < cards.length; i++) {
      var el = cards[i];
      var img = el.querySelector('.codex-art img');
      if (!img) continue;                       /* 缺图的卡片认不出 id，跳过（不猜） */
      var m = /assets\/codex\/(?:unknown\/)?([^/?#]+)\.png/.exec(img.getAttribute('src') || '');
      if (!m) continue;
      var id = decodeURIComponent(m[1]);
      if (order.indexOf(id) < 0) order.push(id);
      if (el.classList.contains('found')) {
        var name = el.querySelector('.codex-name');
        var rarity = el.querySelector('.codex-meta .rarity');
        var meta = el.querySelectorAll('.codex-meta span');
        var count = 0;
        for (var k = 0; k < meta.length; k++) {
          var c = /收获\s*(\d+)\s*次/.exec(meta[k].textContent || '');
          if (c) { count = Number(c[1]); break; }
        }
        found[id] = {
          name: name ? name.textContent : id,
          rarity: rarity ? rarity.textContent : '',
          latin: (el.querySelector('.codex-latin') || {}).textContent || '',
          count: count
        };
        n++;
      }
    }
    if (!order.length) return null;
    return { order: order, found: found, foundCount: n, total: order.length };
  }

  function buildCatalog(wall) {
    /* 目录顺序优先用引擎那份 index.json（app.js 读的同一份），墙上没有的一律不铺 */
    var ids = wall.order;
    if (indexOrder) {
      var inWall = Object.create(null);
      ids.forEach(function (id) { inWall[id] = 1; });
      var ordered = indexOrder.filter(function (id) { return inWall[id]; });
      ids.forEach(function (id) { if (ordered.indexOf(id) < 0) ordered.push(id); });
      ids = ordered;
    }
    return ids.map(function (id) {
      var meta = (indexMap && indexMap[id]) || {};
      var f = wall.found[id];
      return {
        id: id, found: !!f,
        name: f ? f.name : (meta.name || ''),
        latin: (f && f.latin) || meta.latin || '',
        rarity: f ? (f.rarity || meta.rarity || '') : (meta.rarity || ''),
        category: meta.category || '',
        count: f ? f.count : 0
      };
    });
  }

  /* ── 组件 ─────────────────────────────────────────────────────────────── */
  function mount(body, wall) {
    var catalog = buildCatalog(wall);
    var byId = Object.create(null);
    catalog.forEach(function (x, i) { byId[x.id] = i; });
    var foundIds = catalog.filter(function (x) { return x.found; }).map(function (x) { return x.id; });
    var selected = foundIds.length ? foundIds[0] : (catalog[0] && catalog[0].id);
    var filter = 'all', query = '', drawerOpen = false;

    var root = document.createElement('div');
    root.className = 'ct-root';
    root.innerHTML =
      '<div class="ct-bar">'
      + '<p class="ct-progress"></p>'
      + '<button type="button" class="ct-index-open" aria-haspopup="dialog">查看目录 <span aria-hidden="true">☷</span></button>'
      + '</div>'
      + '<div class="ct-spread">'
      + ' <aside class="ct-aside" aria-label="植物目录">'
      + '  <div class="ct-index-intro"><p class="ct-eyebrow">一页一份小小的发现</p><h3>在花园里相遇</h3>'
      + '  <p>收获过的植物，留在纸页之间。</p></div><div class="ct-index-ui"></div></aside>'
      + ' <section class="ct-reader" aria-label="植物详情">'
      + '  <article class="ct-ticket" aria-labelledby="ct-name">'
      + '   <img class="ct-frame" src="' + FRAME + '" alt="" draggable="false">'
      + '   <div class="ct-heading"><p class="ct-number"></p><h2 id="ct-name"></h2><p class="ct-latin"></p></div>'
      + '   <div class="ct-specimen"><img class="ct-art" alt=""><p class="ct-art-missing" hidden>这张插画暂时没有载入</p></div>'
      /* 收获次数并进稀有度那一行，不另起一行：票签右下角那丛枝叶从 75% 高度压下来，
         正文再往下挪半行就会被叶子盖住（候选稿自己也是把尾行 collection-note 整条藏掉的）。 */
      + '   <div class="ct-copy"><p class="ct-rarity"><span class="ct-r"></span><span class="ct-leaf" aria-hidden="true">❧</span>'
      + '   <span class="ct-cat"></span><span class="ct-leaf ct-leaf2" aria-hidden="true">❧</span>'
      + '   <span class="ct-count"></span></p><p class="ct-desc"></p>'
      + '   <div class="ct-rule" aria-hidden="true"></div></div>'
      + '  </article>'
      + '  <nav class="ct-pager" aria-label="翻阅植物"><button type="button" class="ct-prev" aria-label="上一种植物">←</button>'
      + '  <span class="ct-page-number" aria-live="polite"></span>'
      + '  <button type="button" class="ct-next" aria-label="下一种植物">→</button></nav>'
      + '  <p class="ct-status" role="status"></p>'
      + ' </section>'
      + '</div>'
      + '<button type="button" class="ct-scrim" aria-label="关闭目录" hidden></button>'
      + '<div class="ct-drawer" role="dialog" aria-modal="true" aria-label="植物目录" hidden>'
      + ' <div class="ct-drawer-head"><div><p class="ct-owner">每一页，都是相遇</p><h3>植物目录</h3></div>'
      + ' <button type="button" class="ct-drawer-close" aria-label="关闭目录">×</button></div>'
      + ' <div class="ct-index-ui"></div></div>';

    var q = function (sel) { return root.querySelector(sel); };
    var ticket = q('.ct-ticket');

    function known(x) { return !!(x && x.found); }
    function visible() {
      return catalog.filter(function (x) {
        if (filter === 'found' && !x.found) return false;
        if (!query) return true;
        /* 未发现的一律不参与搜索：名字和拉丁名在收获前不许露 */
        if (!x.found) return false;
        return (x.name || '').toLowerCase().indexOf(query) >= 0
          || (x.latin || '').toLowerCase().indexOf(query) >= 0;
      });
    }

    function paintIndex() {
      var uis = root.querySelectorAll('.ct-index-ui');
      for (var i = 0; i < uis.length; i++) {
        var host = uis[i];
        if (!host.firstChild) {
          host.innerHTML =
            '<label class="ct-search-label">寻找已点亮的植物</label>'
            + '<input class="ct-search" type="search" placeholder="输入植物名字或拉丁名">'
            + '<div class="ct-filters">'
            + '<button type="button" data-ct-filter="all" aria-pressed="true">全部图鉴</button>'
            + '<button type="button" data-ct-filter="found" aria-pressed="false">已点亮</button>'
            + '</div><div class="ct-grid"></div>';
          var label = host.querySelector('.ct-search-label');
          var input = host.querySelector('.ct-search');
          var uid = 'ct-search-' + i;
          input.id = uid; label.htmlFor = uid;
        }
      }
      paintGrids();
    }

    function paintGrids() {
      var items = visible();
      var grids = root.querySelectorAll('.ct-grid');
      for (var i = 0; i < grids.length; i++) {
        var grid = grids[i];
        grid.replaceChildren();
        if (!items.length) {
          var p = document.createElement('p');
          p.className = 'ct-empty';
          p.textContent = '这页还没有找到它。试试其他名字，或清空搜索。';
          grid.append(p);
          continue;
        }
        items.forEach(function (x) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'ct-choice' + (x.found ? '' : ' unknown');
          b.setAttribute('aria-current', String(x.id === selected));
          b.setAttribute('aria-label', x.found ? x.name : '未发现的植物');
          b.title = x.found ? x.name : '未发现';
          var im = document.createElement('img');
          im.src = (x.found ? 'assets/codex/' : 'assets/codex/unknown/') + encodeURIComponent(x.id) + '.png';
          im.alt = ''; im.loading = 'lazy'; im.decoding = 'async';
          var sp = document.createElement('span');
          sp.textContent = x.found ? x.name : '未发现';
          b.append(im, sp);
          b.onclick = function () { select(x.id); closeDrawer(); };
          grid.append(b);
        });
      }
    }

    function readingList() {
      var x = catalog[byId[selected]];
      return known(x) && foundIds.length ? foundIds : catalog.map(function (c) { return c.id; });
    }

    function select(id) {
      if (byId[id] === undefined) return;
      selected = id;
      var x = catalog[byId[id]];
      var k = known(x);
      q('.ct-number').textContent = '花园标本 · ' + String(byId[id] + 1).padStart(3, '0');
      q('#ct-name').textContent = k ? (x.name || '') : '尚未相遇';
      q('.ct-latin').textContent = k ? (x.latin || '') : '';
      q('.ct-r').textContent = k ? (x.rarity || '') : '待发现';
      var cat = k ? (CATEGORY[x.category] || '') : '神秘植物';
      q('.ct-cat').textContent = cat;
      q('.ct-leaf').hidden = !cat;          /* 分类取不到就连那片叶子分隔符一起收掉，不编词 */
      q('.ct-desc').textContent = k ? (EDITORIAL[x.id] || '') : UNKNOWN_DESC;
      q('.ct-count').textContent = k ? ('已收获 ' + x.count + ' 次') : '';
      q('.ct-count').hidden = !k;
      q('.ct-leaf2').hidden = !k || !cat;
      var im = q('.ct-art'), miss = q('.ct-art-missing');
      im.hidden = false; miss.hidden = true;
      im.alt = k ? (x.name + '插画') : '未发现植物的灰色剪影';
      im.onerror = function () { im.hidden = true; miss.hidden = false; };
      im.onload = function () { im.hidden = false; miss.hidden = true; };
      im.src = (k ? 'assets/codex/' : 'assets/codex/unknown/') + encodeURIComponent(x.id) + '.png';
      paintPager();
      paintGrids();
      ticket.classList.remove('is-changing');
      void ticket.offsetWidth;
      ticket.classList.add('is-changing');
    }

    function paintPager() {
      var list = readingList(), i = list.indexOf(selected);
      q('.ct-page-number').textContent = (i + 1) + ' / ' + list.length;
      q('.ct-prev').disabled = i <= 0;
      q('.ct-next').disabled = i < 0 || i === list.length - 1;
      q('.ct-status').textContent = known(catalog[byId[selected]])
        ? '亲手收获过的发现，都留在这里。'
        : '还没遇见它，这一页留着。';
    }

    function step(n) {
      var list = readingList(), i = list.indexOf(selected);
      if (i < 0) return;
      var id = list[i + n];
      if (id) select(id);
    }

    function openDrawer() {
      drawerOpen = true;
      q('.ct-drawer').hidden = false; q('.ct-scrim').hidden = false;
      var input = q('.ct-drawer .ct-search');
      if (input) input.focus();
    }
    function closeDrawer() {
      if (!drawerOpen) return;
      drawerOpen = false;
      q('.ct-drawer').hidden = true; q('.ct-scrim').hidden = true;
    }

    root.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || b.disabled) return;
      if (b.classList.contains('ct-index-open')) return openDrawer();
      if (b.classList.contains('ct-drawer-close') || b.classList.contains('ct-scrim')) return closeDrawer();
      if (b.classList.contains('ct-prev')) return step(-1);
      if (b.classList.contains('ct-next')) return step(1);
      var f = b.dataset.ctFilter;
      if (f) {
        filter = f;
        root.querySelectorAll('[data-ct-filter]').forEach(function (el) {
          el.setAttribute('aria-pressed', String(el.dataset.ctFilter === filter));
        });
        paintGrids();
      }
    });
    root.addEventListener('input', function (e) {
      if (!e.target.classList.contains('ct-search')) return;
      query = e.target.value.trim().toLowerCase();
      root.querySelectorAll('.ct-search').forEach(function (el) { if (el !== e.target) el.value = e.target.value; });
      paintGrids();
    });
    /* 目录抽屉开着时 Esc 只关抽屉，不把整个图鉴弹窗一起关掉。
       重铺时先摘掉上一版的监听，别在 #dialog 上越挂越多。 */
    if (activeCancel) $('dialog').removeEventListener('cancel', activeCancel);
    activeCancel = function (e) {
      if (!drawerOpen) return;
      e.preventDefault();
      closeDrawer();
    };
    $('dialog').addEventListener('cancel', activeCancel);

    q('.ct-progress').textContent = '已发现 ' + wall.foundCount + ' / ' + wall.total;
    paintIndex();
    select(selected);
    body.replaceChildren(root);
    $('dialog').classList.add('ct-on');
    /* 留一份给验收脚本取真值，不落任何存档 */
    window.__codexTicket = {
      version: 'codexticket0918-v3',
      foundCount: wall.foundCount,
      total: wall.total,
      foundIds: foundIds.slice(),
      source: 'app.js codexWall() → article.codex-card（state.codex 来自 /garden/api/state）'
    };
  }

  function takeOver() {
    if (!CODEX_TICKET) return;
    var dlg = $('dialog'), body = $('dialog-body');
    if (!dlg || !body) return;
    if (dlg.dataset.panel !== 'codex') { dlg.classList.remove('ct-on'); return; }
    if (body.querySelector('.ct-root')) return;              /* 已经是票签版，别再套一层 */
    var title = ($('dialog-title') || {}).textContent || '';
    var garden = title === '花园图鉴' || /assets\/codex\//.test(body.innerHTML);
    if (!garden) { dlg.classList.remove('ct-on'); return; }  /* 花房那四种花不走票签，留旧卡片墙 */
    var wall = readWall(body);
    if (!wall) { dlg.classList.remove('ct-on'); return; }    /* 墙是空的（还没收获过）＝ 留 app.js 的空态 */
    loadIndex().then(function () {
      if (dlg.dataset.panel !== 'codex' || body.querySelector('.ct-root')) return;
      var fresh = readWall(body);
      if (fresh) mount(body, fresh);
    });
  }

  /* ── 收获票签 ─────────────────────────────────────────────────────────
   * app.js 收获成功时 dialog('图鉴里的新朋友' | '这一回，收到了……', '<div class="reveal">…')，
   * 紧接着 dispatch 'rainholm:garden-action'（detail.state = 它 accept 过的同一份已确认状态）。
   * 这里盯 #dialog-body：揭晓小窗一铺出来就原地换成票签；数据全从那个小窗和事件里读：
   *   id       ← .reveal img.codex-reveal-art 的 assets/codex/<id>.png（花房走 flowerArt 没有这张图 → 不接管）
   *   名字     ← .reveal h3
   *   稀有度   ← .reveal 第一行「N · 上品」的前半
   *   新发现   ← 标题是「图鉴里的新朋友」，或正文带「新图鉴奖励」（app.js 只在 isNew 时写这两处）
   *   收获次数 ← 事件里 state.codex[id].count；事件没来就不写这一段，不猜
   *   拉丁名/分类 ← assets/codex/index.json（app.js 也读的那份）
   * 关：点 × 或票签外任意处；不自动消失。连续收获时 app.js 每次都重铺 body，这里跟着重铺，不叠。 */
  var lastCodex = null, lastFlowerCodex = null, harvestSeq = 0;
  window.addEventListener('rainholm:garden-action', function (e) {
    var st = e && e.detail && e.detail.state;
    if (!st) return;
    if (Array.isArray(st.codex)) lastCodex = st.codex;
    /* flower0919-v7：花房的收获次数在 state.flowerCodex（app.js normalize 也把它映到
       .codex，但两边都留一手，别赌某一次的形状）。结构跟 codex 一样：{id,count,...}。 */
    if (Array.isArray(st.flowerCodex)) lastFlowerCodex = st.flowerCodex;
  });

  function readReveal(body) {
    var box = body.querySelector('.reveal');
    if (!box) return null;
    var h3 = box.querySelector('h3'), ps = box.querySelectorAll('p');
    var meta = ps[0] ? (ps[0].textContent || '').split('·').map(function (s) { return s.trim(); }) : [];
    var title = ($('dialog-title') || {}).textContent || '';
    var base = {
      name: h3 ? (h3.textContent || '') : '',
      rarity: meta[0] || '', quality: meta[1] || '',
      isNew: title === '图鉴里的新朋友' || (box.textContent || '').indexOf('新图鉴奖励') >= 0,
      title: title
    };
    /* 花园：assets/codex/<id>.png */
    var img = box.querySelector('img.codex-reveal-art');
    var m = img && /assets\/codex\/([^/?#]+)\.png/.exec(img.getAttribute('src') || '');
    if (m) { base.id = decodeURIComponent(m[1]); base.scene = 'garden'; return base; }
    /* flower0919-v7 花房：assets/v2/<slug>-day|night.png → 反查 id。
       插画就用揭晓小窗里那张（日夜版跟着当时的天色），不去 assets/codex 找同名图（没有）。 */
    var fimg = box.querySelector('img.codex-flower');
    var fm = fimg && /assets\/v2\/([a-z-]+)-(day|night)\.png/.exec(fimg.getAttribute('src') || '');
    if (fm && FLOWER_BY_SLUG[fm[1]]) {
      base.id = FLOWER_BY_SLUG[fm[1]];
      base.scene = 'greenhouse';
      base.art = fimg.getAttribute('src');
      return base;
    }
    return null;
  }

  function mountHarvest(body, r) {
    var flower = r.scene === 'greenhouse';
    /* 花房那四朵不在 assets/codex/index.json 里，meta 一定是空的 —— 拉丁名和分类留空，
       ❧ 分隔符照原逻辑自动藏（cat 为空就 hidden），不硬塞占位字。 */
    var meta = (indexMap && indexMap[r.id]) || {};
    var count = null;
    var pool = flower ? (lastFlowerCodex || lastCodex) : lastCodex;
    if (pool) for (var i = 0; i < pool.length; i++) {
      if (pool[i] && pool[i].id === r.id && Number.isFinite(Number(pool[i].count))) { count = Number(pool[i].count); break; }
    }
    var cat = CATEGORY[meta.category] || '';
    var root = document.createElement('div');
    root.className = 'ct-root ht-root';
    root.innerHTML =
      '<p class="ht-tag">' + (r.isNew ? '新发现' : '本次收获') + '</p>'
      + '<article class="ct-ticket" aria-labelledby="ht-name">'
      + ' <img class="ct-frame" src="' + FRAME + '" alt="" draggable="false">'
      + ' <div class="ct-heading"><p class="ct-number"></p><h2 id="ht-name"></h2><p class="ct-latin"></p></div>'
      + ' <div class="ct-specimen"><img class="ct-art" alt=""><p class="ct-art-missing" hidden>这张插画暂时没有载入</p></div>'
      + ' <div class="ct-copy"><p class="ct-rarity"><span class="ct-r"></span><span class="ct-leaf" aria-hidden="true">❧</span>'
      + ' <span class="ct-cat"></span><span class="ct-leaf ct-leaf2" aria-hidden="true">❧</span>'
      + ' <span class="ct-count"></span></p><p class="ct-desc"></p><div class="ct-rule" aria-hidden="true"></div></div>'
      + '</article>';
    var q = function (sel) { return root.querySelector(sel); };
    if (flower) {
      var fn = FLOWER_ORDER.indexOf(r.id);
      q('.ct-number').textContent = fn >= 0 ? ('花房标本 · ' + String(fn + 1).padStart(3, '0')) : '花房标本';
    } else {
      var n = indexOrder ? indexOrder.indexOf(r.id) : -1;
      q('.ct-number').textContent = n >= 0 ? ('花园标本 · ' + String(n + 1).padStart(3, '0')) : '花园标本';
    }
    q('#ht-name').textContent = r.name || meta.name || r.id;
    q('.ct-latin').textContent = meta.latin || '';
    q('.ct-r').textContent = r.rarity || meta.rarity || '';
    q('.ct-cat').textContent = cat;
    q('.ct-leaf').hidden = !cat;
    q('.ct-count').textContent = count === null ? '' : ('已收获 ' + count + ' 次');
    q('.ct-count').hidden = count === null;
    q('.ct-leaf2').hidden = count === null || !cat;
    q('.ct-desc').textContent = EDITORIAL[r.id] || '';
    var im = q('.ct-art'), miss = q('.ct-art-missing');
    im.alt = (r.name || r.id) + '插画';
    im.onerror = function () { im.hidden = true; miss.hidden = false; };
    im.src = flower ? r.art : ('assets/codex/' + encodeURIComponent(r.id) + '.png');
    body.replaceChildren(root);
    $('dialog').classList.add('ht-on');
    $('dialog').classList.remove('ht-pending');   /* htflash0919-v5：票签铺好了，等待期的遮挡撤掉 */
    window.__harvestTicket = {
      version: 'codexticket0919-v7', id: r.id, name: r.name, rarity: r.rarity, quality: r.quality,
      scene: r.scene || 'garden', art: im.src,
      isNew: r.isNew, title: r.title, count: count, latin: meta.latin || '', category: meta.category || '',
      source: flower
        ? 'app.js dialog(reveal) 的 .reveal DOM（img.codex-flower → assets/v2 slug 反查 id）'
          + ' + rainholm:garden-action 事件里的 state.flowerCodex；花房不进 assets/codex/index.json'
        : 'app.js dialog(reveal) 的 .reveal DOM + rainholm:garden-action 事件里的 state.codex + assets/codex/index.json'
    };
  }

  function takeOverHarvest() {
    if (!HARVEST_TICKET) return;
    var dlg = $('dialog'), body = $('dialog-body');
    if (!dlg || !body) return;
    if (body.querySelector('.ht-root')) return;                /* 已经是票签版 */
    var r = readReveal(body);
    if (!r) { dlg.classList.remove('ht-on'); dlg.classList.remove('ht-pending'); return; }
    /* htflash0919-v5（玩家 9/19 抓的「先闪粉卡再跳票签」）：ht-on 同步就挂，不等 loadIndex()。
       .then 至少晚一个微任务，首次还要等 assets/codex/index.json 的网络往返 —— 那一段里
       #dialog 上没有 ht-on，app.js 原生的粉壳 .reveal 先被画出来，mount 完才换成票签。
       ht-pending 只在等待期挂着，配 css 一行 `#dialog.ht-pending .reveal{visibility:hidden}`，
       等待期画面上只剩票签外壳那层底，看不见粉卡；mount 完 / 早退 / close 都摘。 */
    dlg.classList.add('ht-on');
    dlg.classList.add('ht-pending');
    var stamp = ++harvestSeq;
    /* 摘 ht-pending 只由当前这一轮负责：连着收两次时后一轮已经重新挂上，
       前一轮的过期 .then 不许把它摘掉（摘了就是又露一帧粉卡）。 */
    var dropPending = function () { if (stamp === harvestSeq) dlg.classList.remove('ht-pending'); };
    loadIndex().then(function () {
      if (stamp !== harvestSeq || !dlg.open || body.querySelector('.ht-root')) { dropPending(); return; }
      var fresh = readReveal(body);
      if (fresh) mountHarvest(body, fresh);
      else dropPending();
    });
  }

  /* ── 卡片墙换皮的钩子（2026-09-18 codexwall0918-v1）────────────────────────
   * 只挂一个类，不碰任何 DOM 和数据：app.js 的 dialog(title, html, kind) 把
   * kind 写进 #dialog.dataset.panel，图鉴是 'codex'（花房「花的图鉴」同一个
   * codexWall，也是 'codex'，同皮）。票签版接管时 #dialog 上会有 .ct-on / .ht-on，
   * 那两套自带外壳，卡片墙皮让位。皮在 assets/v8/codex-wall-20260918.css。 */
  function syncWall() {
    var dlg = $('dialog');
    if (!dlg) return;
    var on = dlg.dataset.panel === 'codex'
      && !dlg.classList.contains('ht-on')
      && !dlg.classList.contains('ct-on');
    dlg.classList.toggle('cw-on', on);
  }

  function boot() {
    var body = $('dialog-body'), dlg = $('dialog');
    if (!body || !dlg) return;
    new MutationObserver(function () { takeOver(); takeOverHarvest(); syncWall(); }).observe(body, { childList: true });
    dlg.addEventListener('close', function () { dlg.classList.remove('ct-on'); dlg.classList.remove('ht-on'); dlg.classList.remove('ht-pending'); dlg.classList.remove('cw-on'); });
    /* 收获票签：点票签外任意处关掉（::backdrop 的 click 目标就是 dialog 本身，也走这条） */
    dlg.addEventListener('click', function (e) {
      if (!dlg.classList.contains('ht-on') || !dlg.open) return;
      if (e.target.closest && e.target.closest('.ct-ticket')) return;
      dlg.close();
    });
    /* htflash0919-v5：开机预热一次索引（不等结果），首次收获时 index.json 已在缓存里，
       takeOverHarvest 的 .then 只剩一个微任务，等待期短到看不见。 */
    loadIndex();
    takeOver(); takeOverHarvest(); syncWall();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
