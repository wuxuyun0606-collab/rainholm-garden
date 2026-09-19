/* Rainholm Garden · 猫窝层（开源版 oss-20260912）
 *
 * 两只光栅小猫在花园里遛弯：白猫在野餐垫一带，黑猫在右下角栅栏前。
 * 走动是四向走路帧（正/背/左/右 × 8 帧 × 110ms），随机挑落点、停下、偶尔趴下打盹。
 * 停下就定格在并脚那一帧 —— 不原地蹬腿。
 * idle20260915：停下来又正面朝着人的时候，改播一段站立待机（呼吸 + 眨眼），
 * 不是一张死图。侧面/背面照旧定格（那两个朝向没拍待机片）。
 * 点一下 → 头顶冒一颗「喵」气泡（用的是花园现役 .bubble 那套皮，没有发明新样式），2 秒散。
 * 右下角那颗说话钮 ＝ 玩家自己的嘴：打一句 ≤30 字，白猫头顶冒出来、跟着猫走（见第 6d 段）。
 *
 * ── 谁指挥谁（catcontrol20260912）────────────────────────────────────────────
 * 白猫 ＝ 使用者：在花园里点一块空地，白猫就走过去。
 * 黑猫 ＝ 你的 AI：它往 POST /garden/api/cat/black 塞 {x,y} 或 {say}，
 *        页面每 3 秒取一次，黑猫走过去 / 头顶冒一句。详见第 6c 段。
 * 两只都还归同一套禁区管：踩不进菜地、不站到对方身上、走不过去就不走。
 *
 * ── 挂法 ──────────────────────────────────────────────────────────────────────
 * 这份文件由 host-boot.js 尾部动态插入：前端包再覆盖 index.html 也不会把猫冲掉。
 * app.js / index.html / style.css 一个字没改。
 *
 * ── 总闸 ──────────────────────────────────────────────────────────────────────
 * 任一条成立就整层不启动，页面跟没装过一样：
 *   ?cats=0  ／  localStorage rhCatsOff=1  ／  window.RAINHOLM_CATS=false
 *   ／  <html class="rh-cats-off">
 * 运行中还可以 window.RainholmCats.off() 关、.on() 开。
 *
 * ── 素材 ──────────────────────────────────────────────────────────────────────
 * 角色为本项目重绘的小白小黑。
 * 身体素材 ＝ 四向走路帧包 cats-fourway-v1（fourway20260912）：white/black ×
 * front/back/left/right × 8 帧，单帧 256²RGBA，另有 2048×256 横条。
 * 运行时只取横条（strip.png）切八块：8 个请求、8 张 baseTexture，比 64 张单帧省。
 * 站立待机 ＝ cats-idle-v1（idle20260915）：每只一张 2048² 图集，8×8 格 62 帧、12fps。
 * 格 256、挂点 (128,232)、画面顶 28 跟走路帧包同口径 —— 所以缩放、锚点、脚线一行没改。
 *
 * ── 运行时 ────────────────────────────────────────────────────────────────────
 * 只要 pixi.js 6.5.10（自托管在 vendor/live2d/），页面不挂任何外网 CDN。
 * fourway20260912 起不再需要 Live2D Cubism Core / cubism4：猫是光栅帧图，
 * 没有 Core 也照样有猫（旧版缺 Core 是整层退场）。旧 Live2D 模型的
 * moc3/贴图/motions 已整套移出本包，运行时一个字节都不读。
 * 代价：旧模型的眨眼 / 呼吸 / 耳朵尾巴物理 / Idle 动作一起没了 —— 这是换身体的明码标价，
 * HANDOFF 明令同一只猫不许同时挂 Live2D 身体和帧图，不做混挂。
 * idle20260915 把眨眼和呼吸按帧图的路子赎回来了一半：正面站着的时候有，走起来没有。
 *
 * ── 比例 ──────────────────────────────────────────────────────────────────────
 * 场景里人物基准高 ＝ 场景高的 15.5%（walk-map.json spriteHeightPct）。
 * 猫取它的 60%：15.5×0.6 = 9.3% ＝ 95 世界像素。手机档同一条公式，等比。
 * 换帧之后这 95 像素落在「一帧里真正有画的那 204 行」上（FW_ART_H）：
 * 素材实测每帧画面顶 y=28、脚底最后一行 y=231、挂点 (128,232)。
 * 跟旧 Live2D 版对过账：头宽/身高 0.706 vs 0.708，脚线同样钉在 py，肉眼一样大。
 *
 * ── 落点约束 ──────────────────────────────────────────────────────────────────
 * nogo-20260918 起判法接上了同目录的 walk-map.json：地面 ＝ walkable 多边形，
 * 脚点禁区 ＝ forbidden 全部（篱笆四段外扩 12、花房/房屋外墙外扩 8、8 块畦外扩 6）
 * ＋ 老的花房屋顶块。
 * nogo0919-v3 起：整只占位那档（HARD）空了 —— 里头只剩一块「出生点」，可这一包没有走路层，
 * 那块地上什么都没画，却把房前那条路判死了。8 块畦从脚带改回脚点判（见 1b-5 段）。
 * UI 热区（气泡 / 门牌箭头）改成开层和 #plots 一变就读一遍真 DOM，看不见的钮不算禁区。
 * 软禁区只拦脚点（野餐垫上那堆餐具）。整条路每 8 像素抽一次，不是只看两头。
 * walk-map 取不到就退回一期那套 BOUND 矩形判法，只 console.warn，不白屏不退场。
 * 两只猫挨到 120 世界像素以内序号大的改道；贴到碰撞半径（0.9×猫宽）以内两只都收住，
 * 0.6~1.2 秒后各自重挑落点，重挑时对方是一块圆形临时禁区 —— 谁也穿不过谁。
 * 画序按脚点 y 排（谁的脚更靠下谁在前），两只重叠时不会出现后面那只画在前面。
 *
 * ── 三个家 ────────────────────────────────────────────────────────────────────
 * garden（俯瞰）/ cathome（室内等距）/ greenhouse（室内近景）。
 * nogo-20260918 之前花房是不养猫的，现在养 —— 开关是 1d 段那颗 GH_CATS。
 *
 * 所有计时都记在 ticker 的 deltaMS 上，没有一个 setTimeout/setInterval 管状态机 ——
 * document.hidden 一停 ticker，走动和全部倒计时自动一起冻住。
 */
(function () {
  "use strict";

  /* ═════════════════════ 0. 总闸 ═════════════════════ */

  function switchedOff() {
    try { if (new URLSearchParams(location.search).get("cats") === "0") return true; } catch (_) { }
    try { if (localStorage.getItem("rhCatsOff") === "1") return true; } catch (_) { }
    if (window.RAINHOLM_CATS === false) return true;
    if (document.documentElement.classList.contains("rh-cats-off")) return true;
    return false;
  }
  if (switchedOff()) return;
  if (window.RainholmCats && window.RainholmCats.mounted) return;   /* 防重复插入 */

  /* ═════════════════════ 1. 常量 ═════════════════════ */

  var VEND = "vendor/live2d/";                 /* 这目录里现在只用得着 pixi.min.js */
  /* fourway20260912：四向走路帧包。改这儿的图要同步动 host-boot.js 的缓存串。 */
  var FW = "assets/cats-fourway-v1/";
  var FW_V = "?v=stopframe0915-v1";
  var WORLD_W = 1536, WORLD_H = 1024;          /* 世界坐标（app.js 的底图坐标系） */
  var PERSON_PCT = 15.5;                       /* 花园里走路小人的高＝场景高的 15.5% */
  var CAT_RATIO = 0.60;                        /* 猫 ≈ 人物基准高的 60% */
  var CAT_PCT = PERSON_PCT * CAT_RATIO;        /* ＝9.3% 场景高 ＝95 世界像素 */
  /* fourway20260912 帧包标定（实测 64 帧全一致，不是照 manifest 抄的）：
     一帧 256²，画面顶 y=28、脚底最后一行 y=231、挂点 (128,232)。
     FW_ART_H ＝ 232-28 ＝ 204 ＝ 一帧里真正有画的高度，猫的视觉高按它算。 */
  var FW_CELL = 256, FW_ANCHOR_X = 128, FW_ANCHOR_Y = 232, FW_ART_TOP = 28;
  var FW_ART_H = FW_ANCHOR_Y - FW_ART_TOP;     /* ＝204 */
  var FW_FRAMES = 8;                           /* walktune20260917：换帧改跟步幅走（见 6b 段），不再按 110ms 的钟 */
  var FW_DIRS = ["front", "back", "left", "right"];

  /* idle20260915：站立待机图集。每只一张 2048²，8×8 格、62 帧、12fps（源片 24fps 抽二取一），
     一轮 5.17 秒，首尾接得上。格/挂点/画面顶跟走路帧包同口径，所以共用 FW_CELL 那套换算。
     改这儿的图要动 IDLE_V，别去动 FW_V —— 走路那八张横条没改，犯不上让人重下。 */
  var IDLE = "assets/cats-idle-v1/";
  var IDLE_V = "?v=idle0915-v1";
  var IDLE_COLS = 8, IDLE_FRAMES = 62;
  var IDLE_MS = 1000 / 12;                     /* ＝83.33ms。源片 24fps，隔一帧取一帧 */
  /* 打盹时定在闭眼那一格（各自眨眼段里挑的，逐格目检）。
     fourway20260912 换身体的时候闭眼帧全丢了，猫趴着还瞪着眼；这儿顺手赎回来。 */
  var IDLE_SLEEP = { white: 13, black: 25 };
  var HIT_MIN = 44;                            /* 触控热区下限 */
  var BUBBLE_MS = 2000;                        /* 「喵」活 2 秒 */
  var BUBBLE_FADE = 280;
  var SAY_MAX = 30;                            /* catcontrol20260912：AI 那句话最多 30 字 */

  /* 两只猫的落脚点（世界像素，脚线）。选点理由：
       白猫 —— 野餐垫上（人走不进去的那块），挨着藤篮；
       黑猫 —— 右下角栅栏前的草地，在可走椭圆的下沿之外。
     两个点都避开：8 块畦的多边形、地块钮（±90×40）、气泡（田心上方 50）、
     未开垦钮、#scene-door（1170,326）。 */
  /* nogo-20260918：起手位跟着 TURF.*.home 一起搬（见 1b 段 ROAM 那条注记）。
     这里的 x/y 只是 turf.home 缺这只猫时的兜底，两处保持一致省得对不上账。 */
  var CATS = [
    { id: "white", name: "白猫", x: 252, y: 312, flip: false },
    { id: "black", name: "黑猫", x: 1348, y: 694, flip: false }
  ];

  /* userwhite20260918：谁会自己遛弯。
       black ＝ AI 的猫 —— 没事就自己挑个落点慢慢晃，跟以前一模一样；
       white ＝ 使用者的猫 —— 一步都不自己挪。只听三种指挥：点地（onWorldClick）、
               双猫幕 duoscenes 的 command()、还有代码里直接调的 RainholmCats.command()。
     「不自己挪」拦的是自主遛弯这条线（挑目标 / 待机到点起步 / 撞车后重挑落点 /
     roofguard 那条脱困式自动移动），原地的动作一个不少：待机呼吸眨眼、打盹、喵、
     被戳抬头都照旧。三个家（花园/花房/小窝）同一套规矩，跟场景无关。
     回滚：把 white 改回 true（或整张表删掉，selfWalks 缺省就是会走）。 */
  var SELF_WALK = { white: false, black: true };
  function selfWalks(c) { return c && SELF_WALK[c.id] !== false; }

  /* ══════════════ 1b. 遛弯参数与禁区 catwalk20260912 ══════════════
     两只在各自的活动区里慢悠悠遛弯。
     fourway20260912：走路交给帧包自己演，位移还是这里给 —— 两套不叠加，
     整只上下颠簸的 bob 全套退役（HANDOFF：不叠加整只上下颠簸）。 */

  var CAT_W = 74;                              /* 猫在世界坐标下的宽（95.2 × 323/419，跟 ART 标定同源） */
  var CAT_H = WORLD_H * (CAT_PCT / 100);       /* ＝95.2 世界像素 */

  var WALK = {
    SPEED: 45,            /* 世界像素/秒。walktune20260917：34→45（玩家嫌慢）。走路小人横向地速 115px/s，猫是它的四成 */
    SPEED_JIT: .22,
    IDLE_MIN: 8000, IDLE_MAX: 30000,
    NAP_CHANCE: .30, NAP_MIN: 30000, NAP_MAX: 90000,
    NAP_FADE: 1200,       /* 趴下/起身渐变，别啪一下（fourway20260912 起只剩压扁，没有闭眼帧） */
    TURN_EPS: 4,          /* 横move 超过这么多才记 face，免得原地抖 */
    CORNER: 30,           /* walksilk20260918：绕路弯角剩这么多就接下一腿（世界像素），不在中转点刹停 */
    FADE: 90,             /* walksilk20260918：换帧旧图淡出没的时长（ms） */
    TURN_MS: 160,         /* walksilk20260918 v4：行进中转向的过场时长。插一拍正面/背面走帧当转身，不压扁（v3 的纸片翻转玩家否了） */
    NEAR: 120,            /* 两只猫离得比这近，序号大的那只改道 */
    VISIT: .12, VISIT_PAD: 70,   /* 偶尔串门＝往自家活动区外多探 70px，仍要过全部禁区 */
    SAY_MIN: 120000, SAY_MAX: 300000,   /* 自发喵：全局 2~5 分钟一颗，不是每只各一颗 */
    POKE_LAG: 520,        /* 打盹时被戳，慢半拍才抬头 */
    TRIES: 40
  };

  /* 各自的活动区（脚点可落的矩形，世界坐标）。
     nogo-20260918 搬过家：接上 walk-map 的地面多边形之后，老的两个框基本全废 ——
     实测老 white[170,300,370,386] 只剩 29/400 合法（野餐垫整块是 forbidden，
     而且压根不在 garden_ground 里），老 black[1150,836,1410,934] 只剩 107/1650 ＝6%
     （篱笆·右下外扩 12 之后把那一角吃掉了）。两个框都按「窗内抠最大全合法矩形」重开：
       white —— 房子和 3/5 号畦之间那条左侧草坪（250,440)-(400,740)，合法率 88%。
       black —— 8 号畦右缘（x=1266）到右灯柱/篱笆之间那条右侧走廊，合法率 55%。
                往下就顶到 fence_br 扩后的线，往左就进 8 号畦的整只占位。
     nogo0918-v2 玩家判卷翻案：野餐垫是白猫的家，不是禁区（见 1b-4 段）。
     白猫的活动区因此变成**两块**：垫子下半张 + 上面那条左侧草坪。 */
  var ROAM = {
    /* nogo0918-v2：白猫两块候选，挑落点时随机二选一（见 roamBox）。实测合法率：
         A ＝ 野餐垫下半张 [240,290,460,340]，91%。上沿 290 压着餐具软禁区的下沿
              （SOFT 到 y=292），所以这一块整个在藤篮/茶壶/点心碟那一堆之下；
         B ＝ 左侧草坪那条 [250,440,400,740]，88%（v1 抠出来的那块，留着）。
       两块隔着 20px 的缝，靠 PICNIC_MAT_SEAM 缝上了，来回都走得通（实测见报告）。 */
    white: [[240, 290, 460, 340], [250, 440, 400, 740]],
    black: [1260, 630, 1400, 790]
  };

  /* 世界边界（脚点），兜底用 */
  var BOUND = [60, 130, 1480, 950];

  /* 8 块畦的多边形 —— 与 app.js 里那份 beds 同源（底图上定好的）。
     nogo0919-v3 起这份只剩「跟 app.js 对账」的用处，判定不读它了：
     禁区一律走 walk-map 里那份 bed_*（描得更贴、还带 expand 6）。
     改畦的形状要同步这里和 walk-map 两处。 */
  var BEDS = [
    [[410, 390], [620, 339], [681, 415], [461, 464]], [[686, 324], [878, 276], [950, 352], [733, 397]],
    [[480, 489], [702, 433], [759, 524], [522, 570]], [[767, 421], [976, 368], [1055, 456], [821, 506]],
    [[547, 593], [779, 539], [845, 634], [593, 686]], [[852, 530], [1069, 475], [1160, 563], [909, 615]],
    [[617, 714], [859, 654], [938, 755], [674, 812]], [[939, 644], [1161, 588], [1266, 683], [996, 741]]
  ];


  var FEET_H = 30;
  /* 兜底表：DOM 还没建好（或以后有人把 ui-refresh 拆了）时用这份。
     只有两颗门牌箭头 —— 按 ui-refresh.css 量：.gd-door-mark 盒心 at、96×100，
     箭头 40×40 挂在盒内 top:19.5、left:50%，再加 6px 上下浮动。
     换算成世界坐标（CSS 像素 ÷ 0.9375）：宽高 43×43，上沿再留 7 给浮动。 */
  var UI_FEET_FALLBACK = [
    [1117, 291, 43, 50],                      /* #gdDoorMark 的箭头（盒心 1138,330） */
    [99, 486, 43, 50]                         /* #gdHomeMark 的箭头（盒心 120,525） */
  ];
  var HARD_FEET = UI_FEET_FALLBACK.slice();
  var HARD_FEET_POLY = [];
  var HARD = [];

  /* 软禁区：只拦脚点，不拦整个身子。就一块 —— 野餐垫上的藤篮/茶壶/点心碟/花垫，
     实测占世界 (298,178)-(452,292)。为什么不用占位矩形拦：猫身高 95、这块高 114，
     按占位算等于把整张野餐垫判死，白猫一期就没地方站了；而俯视图里猫在前、篮子在后，
     猫的脑袋挡住一点藤篮本来就是对的。爪子不踩进餐具堆就够了。 */
  var SOFT = [[298, 178, 154, 114]];

  /* ══════════════ 1b-2. 花房建筑体 roofguard20260915 ══════════════
     9/15 玩家真机截图：黑猫站在花房的玻璃屋顶正中。一期的禁区表里只有「进花房门牌」
     那颗 112×68 的药丸（下面 HARD 里那行 1114,292），花房建筑本身一块都没圈 ——
     跟随引擎（assets/v7/batch4-20260914.js 的 followTick 十二个角度候选）和 AI 的
     command 都拿 spotOk 判落点，屋顶在它们眼里就是一块空地。

     判法用**脚点多边形**，不是 HARD 那种整只占位矩形：等距图里猫站在建筑前面、
     脑袋挡住一点墙根，本来就是对的（跟 1c 段小窝改判脚点是同一个理由）；
     不对的是脚踩在屋顶上。拿占位矩形去拦，会把花房正前方一整条草地一起判死，
     猫只能远远绕着走。

     多边形量自 assets/v2/garden-day.webp（1536×1024），顺时针从屋脊那颗球起：
     球顶 → 远山墙顶 → 远檐右角 → 右墙根 → 底边(右/中) → 台阶左下 → 左墙根 → 左檐尖。
     刻意让开两处：左下角那排石板路（猫要能走到门口）和正前方的草地。
     BOUND 上沿是 y=130，屋顶再往上本来就出界，这块补的是 y≥130 那一截。 */
  var GREENHOUSE = [
    [1130, 12], [1292, 2], [1434, 104], [1418, 300],
    [1292, 346], [1160, 354], [1050, 348], [1058, 160], [996, 150]
  ];
  var BLOCK = [GREENHOUSE];

  /* ══════════════ 1b-3. 走路层接线 nogo-20260918 ══════════════
     9/18 玩家真机：猫还能站到篱笆上、房顶上。一期只圈了花房一块，剩下的建筑全裸着。
     现成的账其实早就量好了 —— 同目录的 walk-map.json 里 scenes.garden 有 walkable
     两块（garden_ground 25 点 + house_porch_path 6 点）和 forbidden 25 块（8 畦、
     花房壳、房屋壳、3 根樱花树干、秋千、野餐垫、长凳、3 根灯柱、稻草人、篱笆四段），
     scenes.greenhouse 另有一套。文件里那句「本包没有走路层，这两组数据当前无消费方」
     从这一版起作废：消费方就是下面这段。

     判法从「矩形兜底 + 几块禁区」换成跟小窝同口径的「地面多边形 + 脚点禁区」：
       floor  —— walkable 全部多边形，点落在任一块里就算在地面上；真正的边界由它决定，
                 BOUND 矩形只在 walk-map 没取到时当兜底（离线/换服务端也不至于白屏）。
       block  —— forbidden 全部，按各自的 expand 沿外法线外扩，再并上老的 GREENHOUSE
                 屋顶多边形（谁大用谁 —— 两块都在表里，点在任一块内即拒）。
       hard/soft —— 8 畦的整只占位、地块钮、气泡位、门牌、出生点照旧（9/13 的理由没变：
                 俯瞰图里身子压土就是踩土），野餐垫餐具那块 SOFT 也照旧。

     expand 是写在 walk-map.json 里的（只加字段没动坐标）：篱笆四段 12、花房/房屋外墙 8、
     菜畦 0。做法是 miter offset —— 每条边沿外法线平移 d，相邻两条求交，尖角按
     miter limit 3 夹住。不是「顶点朝质心反方向外推」那种近似：矩形上那种近似在长边
     方向只能推出 d·cosθ，篱笆这种细长块会明显推不够。 */


  var PICNIC_MAT_FLOOR = [[183, 285], [393, 200], [500, 272], [290, 358]];

  /* 接缝 PICNIC_MAT_SEAM：只补垫子这块地面，白猫会被关在垫子上出不来。
     实测（review/nogo-20260918/tools/connect.py，4px 网格对真 spotOk 做连通域）：
     收 6 之后的垫子自成一个孤岛，跟大草坪那个域最近的一对合法点是
     垫子侧 (352,332) ↔ 草坪侧 (364,348)，只隔 **20 世界像素** ——
     那 20 像素就是垫子的流苏牙加一点草，walk-map 的 garden_ground 边界正好贴着流苏走，
     没把这条缝圈进去。所以沿垫子右下那条外边（S→E）铺一条 20px 宽的带把两块缝上。
     底图上这条带底下是草和石板路，不是禁区物件（图证 tools/crop-gap.png）。
     补上之后连通域从「垫子 711 格、草坪 9432 格，两个岛」变成「同一个 10297 格」。
     这是我自己加的地面，不在 walk-map 里 —— 要改改这儿。 */
  /* feetband0918：外沿再往草坪那边推 12px（33px 宽）—— 多出来的那截本来就在 garden_ground 里，
     叠着无害；宽一点是给 detourGrid 24px 的网格留落脚的地方，别让接缝只在 4px 网格上连通。 */
  var PICNIC_MAT_SEAM = [[288, 354], [498, 268], [529, 301], [305, 393]];

  var GARDEN_FLOOR_EXTRA = [PICNIC_MAT_FLOOR, PICNIC_MAT_SEAM];
  var GARDEN_BLOCK_SKIP = { picnic_mat: 1 };

  var WALKMAP_URL = "walk-map.json?v=nogo0919-v3";
  var MITER_LIMIT = 3;
  /* 探针账本：真机上 RainholmCats.turf() 能看见这几项 */
  var mapState = { tried: false, loaded: false, err: null, garden: 0, greenhouse: 0 };

  function polyArea(p) {
    var s = 0, i, n = p.length;
    for (i = 0; i < n; i++) { var a = p[i], b = p[(i + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; }
    return s / 2;
  }

  /* 沿外法线外扩 d 像素。先把环绕方向归一到 signed area > 0，外法线取 (dy,-dx)。 */
  function expandPoly(p, d) {
    var i, n, pts = [], out = [];
    for (i = 0; i < p.length; i++) pts.push([p[i][0], p[i][1]]);
    if (!d) return pts;
    var flipped = false;
    if (polyArea(pts) < 0) { pts.reverse(); flipped = true; }
    n = pts.length;
    for (i = 0; i < n; i++) {
      var prev = pts[(i - 1 + n) % n], cur = pts[i], nxt = pts[(i + 1) % n];
      var e1x = cur[0] - prev[0], e1y = cur[1] - prev[1];
      var e2x = nxt[0] - cur[0], e2y = nxt[1] - cur[1];
      var l1 = Math.sqrt(e1x * e1x + e1y * e1y) || 1e-9;
      var l2 = Math.sqrt(e2x * e2x + e2y * e2y) || 1e-9;
      var n1x = e1y / l1, n1y = -e1x / l1;
      var n2x = e2y / l2, n2y = -e2x / l2;
      var bx = n1x + n2x, by = n1y + n2y;
      var bl = Math.sqrt(bx * bx + by * by);
      if (bl < 1e-9) { out.push([cur[0] + n1x * d, cur[1] + n1y * d]); continue; }
      bx /= bl; by /= bl;
      var k = 1 / Math.max(bx * n1x + by * n1y, 1e-6);
      if (k > MITER_LIMIT) k = MITER_LIMIT;
      out.push([cur[0] + bx * d * k, cur[1] + by * d * k]);
    }
    if (flipped) out.reverse();
    return out;
  }

  function bboxOf(polys) {
    var l = Infinity, t = Infinity, r = -Infinity, b = -Infinity, i, j;
    for (i = 0; i < polys.length; i++) for (j = 0; j < polys[i].length; j++) {
      var q = polys[i][j];
      if (q[0] < l) l = q[0];
      if (q[0] > r) r = q[0];
      if (q[1] < t) t = q[1];
      if (q[1] > b) b = q[1];
    }
    return [Math.floor(l), Math.floor(t), Math.ceil(r), Math.ceil(b)];
  }

  /* 把一个场景的 walkable/forbidden 铺进它的地盘表。
       extra      ＝ 要并进 block 的、walk-map 里没有的禁区多边形（花房屋顶 / 花房门边花盆）
       extraFloor ＝ 要并进 floor 的、walk-map 里没有的地面多边形（野餐垫）
       skip       ＝ 按 id 跳过不收的 forbidden 块（野餐垫，见 1b-4 段） */
  function applyScene(name, sc, extra, extraFloor, skip) {
    var t = TURF[name];
    if (!t || !sc || !sc.walkable || !sc.walkable.length) return 0;
    var floor = [], block = [], i;
    for (i = 0; i < sc.walkable.length; i++) {
      if (sc.walkable[i] && sc.walkable[i].points && sc.walkable[i].points.length > 2) {
        floor.push(sc.walkable[i].points);
      }
    }
    if (!floor.length) return 0;
    for (i = 0; extraFloor && i < extraFloor.length; i++) floor.push(extraFloor[i]);
    var fb = sc.forbidden || [];
    for (i = 0; i < fb.length; i++) {
      if (fb[i] && skip && skip[fb[i].id]) continue;
      if (fb[i] && fb[i].points && fb[i].points.length > 2) {
        block.push(expandPoly(fb[i].points, Number(fb[i].expand) || 0));
      }
    }
    for (i = 0; extra && i < extra.length; i++) block.push(extra[i]);
    /* nogo0919-v3：畦不再进脚带表。feetband0918 那一版拿 74×30 的脚带去撞 bed_* 多边形，
       等于把每块畦左右各胖 37、往下胖 30；畦间过道净宽实测 45~85px，胖完只剩 5~15px
       能站，玩家点过道基本点不着。现在畦只在 block 里按脚点判，walk-map 那边给了 expand 6
       （贴畦四边形往外让 6px，够猫不把爪子搭在木框上了）。 */
    t.hardFeetPoly = [];
    t.floor = floor;
    t.block = block;
    t.bound = bboxOf(floor);        /* detourVia 铺中转点的网格范围跟着地面走 */
    t.mode = "poly";
    return block.length;
  }

  /* 取 walk-map。取不到就 console.warn 一句、留在内置表上继续跑 —— 不白屏、不退场。 */
  function loadWalkMap() {
    mapState.tried = true;
    if (typeof fetch !== "function") {
      mapState.err = "no fetch";
      try { console.warn("[rhCat] 这个浏览器没有 fetch，禁区退回内置表"); } catch (_) { }
      return Promise.resolve(false);
    }
    return fetch(WALKMAP_URL, { credentials: "same-origin" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) {
        var sc = (j && j.scenes) || {};
        mapState.garden = applyScene("garden", sc.garden, [GREENHOUSE],
          GARDEN_FLOOR_EXTRA, GARDEN_BLOCK_SKIP);
        mapState.greenhouse = applyScene("greenhouse", sc.greenhouse, GH_EXTRA, null, null);
        mapState.loaded = !!(mapState.garden || mapState.greenhouse);
        if (!mapState.loaded) throw new Error("scenes 里没有能用的 walkable");
        try {
          console.info("[rhCat] walk-map 到货：花园禁区 " + mapState.garden +
            " 块、花房禁区 " + mapState.greenhouse + " 块");
        } catch (_) { }
        return true;
      })
      .catch(function (e) {
        mapState.err = String((e && e.message) || e);
        try { console.warn("[rhCat] walk-map.json 没取到（" + mapState.err + "），禁区退回内置表", e); } catch (_) { }
        return false;
      });
  }

  /* ══════════════ 1b-5. UI 热区读真 DOM nogo0919-v3 ══════════════
     玩家 9/19：「小白很多地方不能去」。查下来最肥的一刀在这儿 —— 老 HARD_FEET 是开机时
     按 8 块畦的形心现算出来的 16 个框，常驻一辈子，不问那颗钮此刻在不在页面上。实测：
       · 已开垦的 6 块地没有 .unopened-hit（那颗钮只给 p==null 的空位建），6 个框纯属幽灵；
       · 气泡 .bubble 真盒 47×47，表里写的是 96×52，宽了一倍，而且只在可收获/可浇水时才有；
       · 门牌看得见的是 .gd-door-arrow 那颗 40×40 箭头，.gd-door-mark 96×100 是触控热区，
         四周是透明 padding —— 拿热区当禁区，花房门口那几级踏步整片站不住，
         连 walk-map 自己写的 doors.greenhouse.approach (1105,374) 都判死。
     脚带判定还会把每个框左右各胖 37、往下胖 30，叠起来就是过道全红。

     现在改成开层/换场景/#plots 一变就重读一遍真 DOM，只收两样：
       .bubble           —— 可收获/浇水那颗，玩家要点的，别让猫坐上去；
       .gd-door-arrow    —— 两颗门牌的箭头本体（上沿多留 7px 给它上下浮动）。
     .unopened-hit 不收：它整颗盖在畦上，畦本身已经是 block（expand 6），再收一遍是重复。
     读不到（DOM 还没建 / 以后有人拆了 ui-refresh）就退回 UI_FEET_FALLBACK 那两颗箭头。
     只管花园这一家 —— 小窝/花房的门牌在各自的 block/家具表里，没走这条。 */
  var UI_FEET_SEL = "#plots .bubble, .gd-door-arrow";
  var uiFeetState = { ran: 0, n: 0, from: "fallback" };

  function readUiFeet() {
    /* 只管花园这一张表。在花房/小窝里 .gd-door-arrow 和 #plots .bubble 是那一家的坐标，
       读进 TURF.garden.hardFeet 就成了错账 —— 换回花园之前那张表会一直是花房的数。
       换场景时 rainholm:garden-scene 会再叫一次，那时候 sceneNow 已经是花园了。 */
    if (sceneNow !== "garden") return false;
    if (!world || typeof world.getBoundingClientRect !== "function") return false;
    var r = world.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    var k = r.width / WORLD_W, list = [], i, el, b, els;
    try { els = document.querySelectorAll(UI_FEET_SEL); } catch (_) { return false; }
    for (i = 0; i < els.length; i++) {
      el = els[i];
      if (el.hidden || !el.offsetParent) continue;          /* display:none / 整层收起来的不算 */
      b = el.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      var pad = /gd-door-arrow/.test(String(el.className)) ? 7 : 0;   /* 箭头上下浮 6px */
      list.push([(b.left - r.left) / k, (b.top - r.top) / k - pad,
      b.width / k, b.height / k + pad]);
    }
    uiFeetState.ran++;
    if (!list.length) {
      /* 一颗都没读着：可能是页面还没渲染，退回兜底表，别把禁区清空了让猫踩门牌 */
      TURF.garden.hardFeet = UI_FEET_FALLBACK.slice();
      uiFeetState.n = TURF.garden.hardFeet.length; uiFeetState.from = "fallback";
      return false;
    }
    TURF.garden.hardFeet = list;
    uiFeetState.n = list.length; uiFeetState.from = "dom";
    return true;
  }

  var uiFeetTimer = 0;
  function scheduleUiFeet() {
    if (uiFeetTimer) return;
    uiFeetTimer = setTimeout(function () { uiFeetTimer = 0; readUiFeet(); }, 120);
  }

  function watchUiFeet() {
    if (watchUiFeet.wired) return;
    watchUiFeet.wired = true;
    try {
      var box = document.getElementById("plots");
      if (box && typeof MutationObserver === "function") {
        new MutationObserver(scheduleUiFeet).observe(box, { childList: true, subtree: true });
      }
    } catch (_) { }
    try {
      window.addEventListener("rainholm:garden-ready", scheduleUiFeet);
      window.addEventListener("rainholm:garden-scene", scheduleUiFeet);
      window.addEventListener("resize", scheduleUiFeet);
    } catch (_) { }
  }

  /* ══════════════ 1c. 地盘 cathome20260913 ══════════════
     猫有两个家：花园（户外俯瞰）和小窝（室内等距剖面）。花房照旧不养猫 —— 进去整层收起来。
     两个家的判法不一样，所以各写一张地盘表：

       garden  —— 沿用一期那套「按猫的整个占位矩形判硬禁区」。俯瞰图里菜畦是摊在地上的一块布，
                  身子压上去就是踩进土里，所以要拿整只去撞。
       cathome —— 室内的家具落地面全是 45° 菱形，用 AABB 去拦会把半间屋判死。改判脚点：
                  脚点落在地板多边形里、且不在任何家具的落地面里，就算数。
                  身子越过家具是对的 —— 等距图里谁的脚更靠下谁就在前面，猫站在沙发前面
                  本来就该挡住沙发一角；反过来「站到家具后面」被落地面挡住了，不会发生。

     小窝的坐标都量自 assets-staging/cat-home-v3-20260912/cat-home-day.png（1536×1024）：
       地板菱形四角实测 W(196,652) N(795,358) E(1375,645) S(776,937)，
       下面这份朝心收了 6%（≈35px）—— 留一圈不让猫贴着墙根站，正面矮墙也不会被猫压住。 */

  var CH_FLOOR = [[231, 652], [794, 375], [1339, 645], [777, 920]];

  /* 家具落地面（脚点禁区）。顺序无所谓，判定是逐个点内测试。 */
  var CH_BLOCK = [
    [[40, 395], [315, 362], [376, 512], [62, 635]],                             /* 厨房台：水槽+吊柜+冰箱一整条 */
    [[356, 448], [414, 398], [470, 450], [424, 514]],                           /* 台边那盆绿植 */
    [[482, 414], [688, 312], [905, 420], [700, 526]],                           /* 床（落地面；猫耳床头板贴在墙上不占地） */
    [[872, 400], [930, 368], [992, 402], [936, 442]],                           /* 床头柜 */
    [[940, 455], [1105, 388], [1302, 472], [1288, 556], [1182, 646], [962, 552]], /* 沙发（整条轮廓，含两侧扶手） */
    [[926, 600], [1022, 552], [1122, 600], [1030, 668]],                        /* 圆几（含四条腿） */
    [[1296, 572], [1356, 538], [1430, 574], [1368, 612]],                       /* 书架 */
    [[484, 718], [592, 718], [592, 828], [484, 828]]                            /* 回花园门牌（.gd-door-mark 盒心 536,772，96×100，含药丸标签） */
  ];

  /* 各自的活动区（脚点可落的矩形）。故意开得比可走地面大一圈 —— 挑点时本来就要过
     spotOk，开小了猫只会在巴掌大的地方来回蹭。white 在门垫到床脚这半边，black 在沙发前。 */
  var CH_ROAM = { white: [430, 540, 830, 800], black: [880, 600, 1260, 850] };
  /* 起手位：白猫在屋子正中偏门口，黑猫在沙发前的地毯边。相距 490，远超防叠罗汉的 150。 */
  var CH_HOME = { white: [640, 690], black: [1130, 720] };
  var CH_BOUND = [231, 375, 1339, 920];      /* detourVia 铺中转点的网格范围 */

  /* 小窝里的猫多大：门垫（60×40cm 的常规尺寸）实测长边 118 屏幕像素，折算地面比例
     ≈1.7px/cm；沙发靠背高（85cm）实测 ≈147px，两把尺对得上。按这把尺，花园那只
     95 世界像素的猫搬进来该是 171 —— 目测偏大（比圆几还高一截），收到 150：
     床面离地实测 73px、沙发靠背 147px，150 的猫头顶正好齐着沙发背，站在床边不喧宾夺主。
     宽度按花园同一条身材比例 74/95.2 折算 ＝ 117。 */
  var CH_CAT_PCT = 14.65;                    /* ＝150 世界像素 */
  var CH_CAT_W = 117;


  var GH_FLOOR = [[640, 400], [955, 392], [1320, 610], [1250, 690], [1150, 800],
    [900, 950], [700, 930], [500, 865], [395, 800], [330, 690], [300, 600], [380, 520], [500, 455]];

  var GH_BLOCK = [
    [[104, 344], [572, 238], [664, 268], [658, 406], [212, 528], [122, 470]],   /* 左台面 */
    [[956, 282], [1414, 528], [1332, 628], [968, 452]],                          /* 右台面 */
    [[634, 216], [966, 214], [966, 398], [634, 402]],                            /* 后墙育苗台 */
    [[924, 684], [1188, 656], [1220, 762], [1092, 852], [928, 884], [872, 788]], /* 右前小桌 */
    [[500, 786], [544, 758], [594, 782], [592, 828], [544, 850], [502, 824]],    /* 凳子 */
    [[856, 872], [960, 872], [960, 952], [856, 952]],                            /* 右前盆栽 */
    [[0, 0], [200, 0], [120, 560], [0, 620]],                                    /* 左侧玻璃墙 */
    [[560, 0], [1010, 0], [1010, 240], [560, 240]],                              /* 后墙 */
    [[1330, 0], [1536, 0], [1536, 700], [1360, 660]],                            /* 右侧玻璃墙 */
    [[380, 846], [900, 952], [1420, 780], [1470, 900], [900, 1024], [360, 930]]  /* 前沿矮墙 */
  ];

  /* walk-map 那份漏圈的：门边那盆白花。实测 (440,810) 原本 spotOk 通过 —— 猫能站进花盆里。
     量自 assets/v2/greenhouse-day.webp：盆口落地一圈约 x415–470、y795–828。
     单独拎出来当 extra 传给 applyScene，这样 walk-map 到货覆盖 GH_BLOCK 时它不会被冲掉
     （跟花园那块老 GREENHOUSE 屋顶多边形是同一个待遇）。要改坐标改这儿，别动 walk-map。 */
  var GH_EXTRA = [
    [[412, 800], [440, 786], [472, 800], [470, 826], [440, 840], [414, 826]]
  ];

  /* 起手位：两点都过 spotOk，相距 264 ＞ near(170) ＞ 碰撞半径(109)。
     为什么不摆在地砖正中（724,768 / 996,570 —— 那两点也合法，我先试过）：
     手机档（390×844）花房的镜头中心钉在世界 x=430（app.js 第 220 行），可见世界只有
     x∈[193,666]（playwright 实测，不是算的）。摆在正中，手机上两只全在画外，
     开局一只猫都看不见。现在这两点＋两个 ROAM 框整个落在 x∈[370,660] 里 ——
     手机能看见，桌面（可见全宽）也还在地砖上、离台面一个身位。
     白猫又往左挪了一手：先前落在 (520,760)，脚点合法（在凳子落地面之上）但身子正好压着
     那张圆凳 —— 等距图里脚更靠上＝该在后面，可猫层永远画在底图之上，看着就成了「骑凳子」。
     现在 (440,730)，离凳子中心 129，身子不再压上去。黑猫从 640 收到 600，
     免得贴着手机可见边（666）半只出画。 */
  var GH_HOME = { white: [440, 730], black: [600, 520] };
  var GH_ROAM = { white: [370, 640, 620, 790], black: [430, 440, 660, 610] };
  var GH_BOUND = [300, 392, 1320, 950];
  var GH_CAT_PCT = 15.2;                     /* ＝155.6 世界像素 */
  var GH_CAT_W = 121;

  var TURF = {
    garden: {
      /* roofguard20260915：block ＝ 脚点多边形禁区（花房建筑体）。名字跟小窝那套同口径。
         nogo-20260918：walk-map 到货后 floor/block/bound/mode 会被 applyScene 原地换掉；
         这里留的是取不到时的兜底（＝一期那套矩形判法，行为跟 9/15 完全一样）。 */
      mode: "box", hard: HARD, hardFeet: HARD_FEET, hardFeetPoly: HARD_FEET_POLY, soft: SOFT, block: BLOCK, bound: BOUND, roam: ROAM,
      floor: null,
      /* nogo0918-v2：白猫搬回野餐垫。(252,312) 在垫布左下那半张上，
         离餐具软禁区 51、离藤篮 123 —— 不压茶壶点心，也不蹲在流苏牙上。 */
      home: { white: [252, 312], black: [1348, 694] },
      /* nogo0918-v2：绕路网格从 96 收到 48。垫子和草坪之间那条接缝只有 20px 宽，
         96 的格子跨得过去、落不进去 —— 玩家点一下让白猫从垫子走到草坪，detourVia
         找不到中转点就当没点过（实测 96 时两个方向都 false，48 时都 true、耗时 10~12ms）。 */
      catPct: CAT_PCT, catW: CAT_W, speed: WALK.SPEED, near: WALK.NEAR, grid: 48,
      stride: 62          /* walktune20260917：一轮（8 帧）踩的世界像素 ≈ 猫高×0.65。换帧跟它不跟钟 */
    },
    cathome: {
      mode: "poly", floor: [CH_FLOOR], block: CH_BLOCK, bound: CH_BOUND, roam: CH_ROAM,
      home: CH_HOME,
      /* 猫大了一圈，速度和步幅跟着放大（150/95.2 ≈ 1.58），
         不然一屋子大猫用花园的地速走，看着像慢动作。
         walktune20260917：52→66，步幅 97。 */
      catPct: CH_CAT_PCT, catW: CH_CAT_W, speed: 66, near: 150, grid: 64, stride: 97
    },
    greenhouse: {
      mode: "poly", floor: [GH_FLOOR], block: GH_BLOCK.concat(GH_EXTRA), bound: GH_BOUND, roam: GH_ROAM,
      home: GH_HOME,
      catPct: GH_CAT_PCT, catW: GH_CAT_W, speed: 70, near: 170, grid: 64, stride: 101
    }
  };
  var turf = TURF.garden;

  /* 这个场景养不养猫。
     nogo-20260918：花房从「不养」翻成「养」。这颗开关留着 —— 改回 false，
     hasCats("greenhouse") 立刻回到 false，花房那一层、说话钮、ticker 一起收起来，
     跟 9/17 的行为一模一样（TURF.greenhouse 留在表里不碍事，没人读）。 */
  var GH_CATS = true;
  function hasCats(s) {
    if (s === "greenhouse") return !!GH_CATS;
    return Object.prototype.hasOwnProperty.call(TURF, s);
  }

  /* ═════════════════════ 2. 样式 ═════════════════════ */

  var CSS = [
    /* 层：铺满 world，自己不吃事件；z-index 1 ＝ 压在底图/植株之上、地块钮之下。
       canvas 也不吃事件，只有每只猫脚下那颗 hit 钮吃。 */
    "#rhCatLayer{position:absolute;inset:0;z-index:1;pointer-events:none}",
    "#rhCatLayer[hidden]{display:none!important}",
    "#rhCatLayer canvas{position:absolute;left:0;top:0;pointer-events:none}",
    /* 影子：closest-side 径向渐变，够深才不显得虚浮。
       猫是圆的，只把宽高比按猫身改了一档；--rh-cat-shadow-a 是唯一旋钮。 */
    "#rhCatLayer{--rh-cat-shadow-a:.62}",
    "#rhCatLayer .rh-cat-shadow{position:absolute;pointer-events:none;border-radius:50%;",
    "background:radial-gradient(closest-side,rgba(78,50,38,var(--rh-cat-shadow-a)) 0%,",
    "rgba(78,50,38,calc(var(--rh-cat-shadow-a)*.69)) 55%,rgba(78,50,38,calc(var(--rh-cat-shadow-a)*.27)) 85%,rgba(78,50,38,0) 100%);",
    "filter:blur(2px);mix-blend-mode:multiply}",
    /* 热区：透明钮，≥44px。focus 环照 style.css 那套（button:focus-visible 已经全局给了）。 */
    "#rhCatLayer .rh-cat-hit{position:absolute;border:0;background:transparent;padding:0;",
    "pointer-events:auto;min-width:" + HIT_MIN + "px;min-height:" + HIT_MIN + "px;",
    "border-radius:14px;-webkit-tap-highlight-color:transparent}",
    /* 气泡：.bubble 的皮来自 style.css，这里只加「怎么散」 */
    "#rhCatLayer .rh-cat-bubble{pointer-events:none;opacity:1;transition:opacity " + BUBBLE_FADE + "ms ease}",
    "#rhCatLayer .rh-cat-bubble.rh-cat-out{opacity:0}",
    "@media(prefers-reduced-motion:reduce){#rhCatLayer .rh-cat-bubble{transition:none}}",


    "#rhSayWrap{position:fixed;z-index:26;display:flex;align-items:center;gap:10px;pointer-events:none;",
    "right:max(18px,env(safe-area-inset-right));bottom:max(20px,env(safe-area-inset-bottom))}",
    "#rhSayWrap[hidden]{display:none!important}",
    /* 圆钮 */
    "#rhSayBtn{position:relative;pointer-events:auto;width:54px;height:54px;padding:9px;",
    "border:1.5px solid #795158;border-radius:50%;background:#f4d8ca;",
    "box-shadow:inset 0 2px 0 #fff1df,inset 0 -2px 0 #d6aa9f,2px 2px 0 #5a343b45;",
    "display:grid;place-items:center;-webkit-tap-highlight-color:transparent;touch-action:manipulation}",
    "#rhSayBtn svg{width:100%;height:100%;display:block;filter:drop-shadow(0 1px 1px #9f626b25)}",
    "#rhSayBtn:active{box-shadow:inset 0 2px 0 #d6aa9f;transform:translateY(1px)}",
    /* 药丸标签：钉在钮正上方（角钮那一列是钉在正下方，这颗在屏幕底边，只能往上） */
    "#rhSayBtn .rh-say-lab{position:absolute;left:50%;bottom:calc(100% + 6px);transform:translateX(-50%);",
    "display:block;white-space:nowrap;pointer-events:none;font-size:12px;font-weight:700;line-height:15px;",
    "letter-spacing:.02em;color:#fff5e5;text-shadow:0 1px 0 #5a343b59;border-style:solid;border-color:transparent;",
    "border-width:3px 8px;border-image:url(assets/v2/label_pill_9slice.png) 32 fill / 8px / 0 stretch}",
    /* 输入条：从钮那头往左展开 */
    "#rhSayBar{pointer-events:auto;display:flex;align-items:center;gap:4px;height:48px;padding:0 2px 0 14px;",
    "width:min(66vw,320px);border:1.5px solid #795158;border-radius:24px;background:#fff1d8;",
    "box-shadow:inset 0 2px 0 #fff1df,inset 0 -2px 0 #d6aa9f,2px 2px 0 #5a343b30;",
    "opacity:0;transform:scale(.92);transform-origin:100% 50%;",
    "transition:opacity .14s ease,transform .17s cubic-bezier(.34,1.56,.64,1)}",
    "#rhSayBar[hidden]{display:none!important}",
    "#rhSayBar.rh-say-open{opacity:1;transform:none}",
    "#rhSayInput{flex:1 1 auto;min-width:0;border:0;background:transparent;outline:none;padding:0;",
    "font-family:GardenRound,\"PingFang SC\",sans-serif;font-weight:400;color:#5d3e42;",
    /* 16px 是硬线：比它小 iOS 聚焦时会自己放大整页 */
    "font-size:16px;line-height:1.2}",
    "#rhSayInput::placeholder{color:#b98f88;opacity:1}",
    "#rhSayCount{flex:0 0 auto;padding-left:5px;font-size:11px;font-weight:400;color:#a4827c;pointer-events:none}",
    "#rhSayCount[hidden]{display:none!important}",
    "#rhSayCount.rh-say-over{color:#aa5363}",
    "#rhSaySend{flex:0 0 44px;width:44px;height:44px;padding:11px;border:1.5px solid #795158;border-radius:50%;",
    "background:#f4d8ca;display:grid;place-items:center;-webkit-tap-highlight-color:transparent;touch-action:manipulation;",
    "box-shadow:inset 0 1px 0 #fff1df,inset 0 -1px 0 #d6aa9f}",
    "#rhSaySend svg{width:100%;height:100%;display:block}",
    "#rhSaySend:active{box-shadow:inset 0 1px 0 #d6aa9f;transform:translateY(1px)}",
    "@media(max-width:600px){#rhSayBtn{width:50px;height:50px;padding:8px}",
    "#rhSayBar{height:46px;width:min(64vw,300px)}#rhSaySend{flex:0 0 42px;width:42px;height:42px;padding:10px}}",
    "@media(prefers-reduced-motion:reduce){#rhSayBar{transition:none}}"
  ].join("");

  /* ═════════════════════ 3. 小工具 ═════════════════════ */

  function loadScript(src) {
    return new Promise(function (ok, no) {
      var s = document.createElement("script");
      s.src = src; s.async = false;
      s.onload = function () { ok(); };
      s.onerror = function () { no(new Error("load fail " + src)); };
      document.head.appendChild(s);
    });
  }

  var reduced = false;
  try { reduced = window.matchMedia("(prefers-reduced-motion:reduce)").matches; } catch (_) { }

  /* ═════════════════════ 4. 状态 ═════════════════════ */

  var layer = null, world = null, app = null, models = [], hits = [], shadows = [], style = null;
  var mounted = false, sceneNow = "garden", ro = null, dead = false;
  /* fourway20260912：贴图仓库 "white/front" → [8 张 Texture]（共用一张 baseTexture 切片） */
  var TEX = {};

  /* 取某只猫某个朝向第 f 帧。朝向认不出来就退回 front —— 少一张图也不让它空手画。 */
  function texOf(id, dir, f) {
    var a = TEX[id + "/" + (dir || "front")] || TEX[id + "/front"];
    return a ? a[((f | 0) % FW_FRAMES + FW_FRAMES) % FW_FRAMES] : null;
  }

  /* idle20260915：取某只猫待机第 f 格。图集没到（没装素材／下载失败）就返回 null，
     调用方自己退回走路定格 —— 少一张图不至于让猫没得画。 */
  function idleTex(id, f) {
    var a = TEX[id + "/idle"];
    return a ? a[((f | 0) % IDLE_FRAMES + IDLE_FRAMES) % IDLE_FRAMES] : null;
  }

  /* 这一拍该不该播待机：正面 + 没在走 + 这只猫的图集确实到了。
     侧面/背面维持 stopframe20260915 的定格（那两个朝向没有待机片，这一单不编）。 */
  function idleOn(c) {
    return c.dir === "front" && c.st !== "walk" && !!TEX[c.id + "/idle"];
  }

  /* 位移向量 → 朝哪边。|dy| 占优就是上下（front ＝ 朝屏幕下方、back ＝ 朝上），
     否则左右。持平算左右：这张底图是斜俯视，横着走的时候侧面比正面好看。 */
  function dirOf(dx, dy) {
    if (Math.abs(dy) > Math.abs(dx)) return dy > 0 ? "front" : "back";
    return dx > 0 ? "right" : "left";
  }

  /* 八张横条各切八块。一张条 2048×256，共用一张 baseTexture，切片不占额外显存。
     任何一张取不到就整体 reject → mount 的 .catch → teardown（猫层退场，花园照常）。 */
  function loadStrips() {
    var PIXI = window.PIXI, jobs = [];
    CATS.forEach(function (cfg) {
      FW_DIRS.forEach(function (d) {
        var key = cfg.id + "/" + d;
        jobs.push(new Promise(function (ok, no) {
          var base = PIXI.BaseTexture.from(FW + key + "/strip.png" + FW_V);
          var cut = function () {
            var arr = [], f;
            for (f = 0; f < FW_FRAMES; f++) {
              arr.push(new PIXI.Texture(base, new PIXI.Rectangle(f * FW_CELL, 0, FW_CELL, FW_CELL)));
            }
            TEX[key] = arr; ok();
          };
          if (base.valid) { cut(); return; }
          base.once("loaded", cut);
          base.once("error", function () { no(new Error("走路帧取不到：" + key + "/strip.png")); });
        }));
      });
    });
    return Promise.all(jobs);
  }

  /* idle20260915：两张待机图集，每只一张，8×8 切 62 格。
     这一步失败**不拖累整层** —— 走路帧是猫的命根子（取不到就退场），
     待机只是锦上添花：取不到就没有呼吸眨眼，猫照走照停，退回定格那一张。
     所以这里的 Promise 只 resolve 不 reject。 */
  function loadIdle() {
    var PIXI = window.PIXI;
    return Promise.all(CATS.map(function (cfg) {
      return new Promise(function (ok) {
        var base = PIXI.BaseTexture.from(IDLE + cfg.id + "/idle.png" + IDLE_V);
        var cut = function () {
          if (dead) { ok(false); return; }      /* 猫层已经拆了就别再往 TEX 里塞货 */
          var arr = [], f, r, c;
          for (f = 0; f < IDLE_FRAMES; f++) {
            r = (f / IDLE_COLS) | 0; c = f % IDLE_COLS;
            arr.push(new PIXI.Texture(base, new PIXI.Rectangle(c * FW_CELL, r * FW_CELL, FW_CELL, FW_CELL)));
          }
          TEX[cfg.id + "/idle"] = arr; ok(true);
        };
        if (base.valid) { cut(); return; }
        base.once("loaded", cut);
        base.once("error", function () {
          try { console.warn("[rhCat] 待机图集取不到，" + cfg.name + "退回定格：" + cfg.id); } catch (_) { }
          ok(false);
        });
      });
    }));
  }

  function worldScale() {
    if (!world || !world.clientWidth) return 1;
    return world.clientWidth / WORLD_W;
  }

  function teardown(why) {
    dead = true;
    try { if (app) { app.ticker.stop(); app.destroy(true, { children: true, texture: true, baseTexture: true }); } } catch (_) { }
    app = null; models = []; hits = []; shadows = []; TEX = {};
    try { if (layer && layer.parentNode) layer.parentNode.removeChild(layer); } catch (_) { }
    layer = null;
    try { if (ro) ro.disconnect(); } catch (_) { }
    ro = null; mounted = false;
    try { if (blackTimer) { clearInterval(blackTimer); blackTimer = 0; } } catch (_) { }   /* catcontrol20260912 */
    try { removeSayUI(); } catch (_) { }                                                  /* playersay20260912 */
    if (why) { try { console.warn("[rhCat] 猫没能上岗：", why); } catch (_) { } }
  }

  /* ═════════════════════ 5. 摆位 ═════════════════════ */

  /* 二期起分两件事：layout() 只在 resize 时量尺寸，poseCat() 每帧只摆位置。
     猫遛弯时每秒 60 次的是后者 —— 它一个 clientWidth 都不读，不触发布局。
     位置的真源从 cfg.x/y（那是「家」）换成 cfg.px/py（当下站哪儿），见 1b 段。 */
  var viewK = 1, viewCatH = 0;

  function layout() {
    if (!app || !world) return;
    viewK = worldScale();
    var wpx = world.clientWidth, hpx = world.clientHeight;
    if (!wpx || !hpx) return;
    if (app.renderer.width !== wpx || app.renderer.height !== hpx) app.renderer.resize(wpx, hpx);

    viewCatH = WORLD_H * (turf.catPct / 100) * viewK;   /* 猫在屏上的可见高度（各家一把尺） */
    for (var i = 0; i < models.length; i++) {
      var m = models[i];
      /* fourway20260912：一帧里有画的那 204 行 → viewCatH。旧版是 ART_H×模型盒高，
         换算对象变了，算出来的猫一样大（实测 94.9 世界像素对 95.2，头宽比 .706 对 .708）。 */
      m.__s = viewCatH / FW_ART_H;
      /* 热区/影子改挂占位宽 CAT_W（＝74 世界像素）。旧版是 ART_W×模型盒宽×s ＝ 73.4×viewK，
         差 0.8%，肉眼一样；好处是热区和禁区判定从此同一个宽度，不再两套账。
         侧面帧的尾巴甩得比身子宽，热区不跟着尾巴长 —— 摸的是猫不是尾巴尖。 */
      m.__hw = Math.max(HIT_MIN, turf.catW * viewK);
      m.__hh = Math.max(HIT_MIN, viewCatH);
      /* 猫身上宽下窄，影子要比爪子摊开一点才露得出来（.58 那一档整颗躲在肚子底下，看不见） */
      m.__sw = turf.catW * viewK * .74;
      m.__sh = m.__sw * .26;
      hits[i].style.width = m.__hw.toFixed(1) + "px";
      hits[i].style.height = m.__hh.toFixed(1) + "px";
      shadows[i].style.width = m.__sw.toFixed(1) + "px";
      shadows[i].style.height = m.__sh.toFixed(1) + "px";
      poseCat(i);
    }
    if (!app.ticker.started) app.render();               /* 停着的时候也要重画一帧 */
  }

  /* 摆一只猫。fourway20260912：位置＝导航给的脚点，一个像素的额外颠簸都不加；
     哪一帧由状态机给（走路时 110ms 一换，停下定格第 1 帧）。
     锚点钉在帧内 (128,232) ＝ 脚底挂点，所以 position 直接就是脚点，不用再减 FOOT。
     左右是分开画的两套帧，不镜像 —— 旧版那句 scale.x 取负从这里退休。 */
  function poseCat(i) {
    var m = models[i]; if (!m || !m.__s) return;
    var cfg = m.__cfg, s = m.__s;
    var nap = cfg.napEye || 0;
    var sy = s * (1 - .05 * nap);                        /* 打盹时略压扁，像趴下去 */
    var px = cfg.px * viewK, py = cfg.py * viewK;
    /* idle20260915：正面站着播待机格，其余一律走路帧。两套格子同口径，
       换过去不用另算缩放，也不用挪锚点 —— 换的只是这一格贴图。 */
    var fam = (idleOn(cfg) ? "idle" : cfg.dir);
    var tex = (idleOn(cfg) ? idleTex(cfg.id, cfg.iframe) : null) || texOf(cfg.id, cfg.dir, cfg.frame);
    /* walksilk20260918 v4：行进中转向 ＝ 过场帧转身。转向那一小段画正面/背面的
       走路帧（步子照翻，像边迈步边拧头），到点切去新朝向 —— 不压扁、不淡出、不叠影。
       __fam 在 startWalk 换向那拍就已经记成新朝向，所以过场→新朝向这刀不触发幽灵淡出。 */
    var turning = false;
    if (cfg.turnT > 0 && cfg.turnPivot && fam !== "idle") {
      turning = true;
      tex = texOf(cfg.id, cfg.turnPivot, cfg.frame);
    }
    if (tex && m.texture !== tex) {


      if (m.__ghost && m.texture && !turning && m.__fam && m.__fam !== fam) {
        m.__ghost.texture = m.texture;
        m.__ghost.alpha = 1;
        m.__ghost.renderable = true;
        m.__fade = WALK.FADE;
      }
      m.texture = tex;
    }
    m.__fam = fam;
    m.scale.set(s, sy);
    m.position.set(px, py);                              /* 锚点在脚底，y 就是脚线 */

    var hit = hits[i], sd = shadows[i];
    hit.style.left = (px - m.__hw / 2).toFixed(1) + "px";
    hit.style.top = (py - m.__hh).toFixed(1) + "px";
    hit.__top = py - viewCatH * (1 - .05 * nap);         /* 气泡挂真猫顶，不用热区顶 */
    hit.__cx = px;
    /* nogo-20260918：热区也照脚线排前后，跟画序同口径 —— 两只叠着时摸到的是前面那只。 */
    hit.style.zIndex = String(Math.round(cfg.py));
    sd.style.left = (px - m.__sw / 2).toFixed(1) + "px";
    sd.style.top = (py - m.__sh * .5).toFixed(1) + "px";  /* 椭圆心正落在脚线上 */


    if (hit.__bub && hit.__bubFollow) {
      hit.__bub.style.left = hit.__cx.toFixed(1) + "px";
      hit.__bub.style.top = (hit.__top - 4).toFixed(1) + "px";
    }
  }

  /* ═════════════════════ 6. 喵 ═════════════════════ */

  /* text 不给就是「喵」；catcontrol20260912 起黑猫可以由 AI 塞一句话进来，
     长句留得久一点（life），但用的还是同一颗气泡、同一张皮。 */
  function meow(i, text, life, follow) {
    var hit = hits[i]; if (!hit || !layer) return;
    var ms = life > 0 ? life : BUBBLE_MS;
    if (hit.__bub) { clearTimeout(hit.__t1); clearTimeout(hit.__t2); try { hit.__bub.remove(); } catch (_) { } hit.__bub = null; }
    var b = document.createElement("div");
    b.className = "bubble rh-cat-bubble";                /* .bubble ＝ style.css 里现役那颗 */
    b.textContent = clipSay(text) || "喵";
    b.setAttribute("role", "status");
    b.style.left = hit.__cx.toFixed(1) + "px";
    b.style.top = (hit.__top - 4).toFixed(1) + "px";
    layer.appendChild(b);
    hit.__bub = b;


    hit.__bubFollow = !!follow;
    hit.__t1 = setTimeout(function () { b.classList.add("rh-cat-out"); }, ms - BUBBLE_FADE);
    hit.__t2 = setTimeout(function () { try { b.remove(); } catch (_) { } if (hit.__bub === b) { hit.__bub = null; hit.__bubFollow = false; } }, ms);
  }

  /* 换场景时把还挂着的气泡一起摘掉：坐标是上一家的，跟过去就是飘在半空。 */
  function dropBubbles() {
    for (var i = 0; i < hits.length; i++) {
      var hit = hits[i]; if (!hit || !hit.__bub) continue;
      clearTimeout(hit.__t1); clearTimeout(hit.__t2);
      try { hit.__bub.remove(); } catch (_) { }
      hit.__bub = null; hit.__bubFollow = false;
    }
  }

  /* ≤30 字截断。按码点数不按 UTF-16 长度：表情占两格，别把人家一张脸劈一半。
     服务端也截了一刀，这里是第二道 —— 气泡是前端的事，宽度由前端兜底。 */
  function clipSay(text) {
    if (text == null) return "";
    var s = String(text).trim();
    if (!s) return "";
    var a = [];
    try { a = Array.from(s); } catch (_) { a = s.split(""); }
    return a.length > SAY_MAX ? a.slice(0, SAY_MAX).join("") : s;
  }

  /* ═════════════════════ 6b. 遛弯引擎 catwalk20260912 ═════════════════════
     状态机三态：walk（缓动走过去）→ idle（停 8~30 秒）→ 三成概率 nap（趴 30~90 秒）。
     所有计时都记在 ticker 的 deltaMS 上，不用 setTimeout/setInterval ——
     这样 document.hidden 一停 ticker，走动和所有倒计时自动一起冻住，
     不需要另写一套「暂停计时器」的账（一期那条 pace() 顺手把二期也管了）。 */

  var sayTimer = 0;

  function rnd(a, b) { return a + Math.random() * (b - a); }

  function boxHit(a, b) {
    return a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
  }
  /* 猫的占位（世界坐标）：脚点在下沿正中 */
  function catBox(x, y) { return [x - CAT_W / 2, y - CAT_H, CAT_W, CAT_H]; }
  /* feetband0918：脚带 ＝ 占位矩形的底部 FEET_H 那一截，宽还是猫宽 */
  function feetBox(x, y) { return [x - CAT_W / 2, y - FEET_H, CAT_W, FEET_H]; }
  /* feetband0918：矩形 [l,t,w,h] 跟凸多边形碰没碰 —— 分离轴：两边的边法线都投一遍，
     有一条轴能把两个投影分开就是没碰。畦是凸四边形，够用。 */
  function sepAxis(a, b) {
    for (var i = 0, j = a.length - 1; i < a.length; j = i++) {
      var nx = a[i][1] - a[j][1], ny = a[j][0] - a[i][0];
      var amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity, k, d;
      for (k = 0; k < a.length; k++) { d = a[k][0] * nx + a[k][1] * ny; if (d < amin) amin = d; if (d > amax) amax = d; }
      for (k = 0; k < b.length; k++) { d = b[k][0] * nx + b[k][1] * ny; if (d < bmin) bmin = d; if (d > bmax) bmax = d; }
      if (amax <= bmin || bmax <= amin) return true;
    }
    return false;
  }
  function rectHitPoly(r, p) {
    var rp = [[r[0], r[1]], [r[0] + r[2], r[1]], [r[0] + r[2], r[1] + r[3]], [r[0], r[1] + r[3]]];
    return !sepAxis(rp, p) && !sepAxis(p, rp);
  }

  /* 射线法：点在多边形里没有。边界上算里面算外面无所谓 —— 差一个像素不影响猫往哪站。 */
  function inPoly(p, x, y) {
    var inside = false, i, j, a, b;
    for (i = 0, j = p.length - 1; i < p.length; j = i++) {
      a = p[i]; b = p[j];
      if (((a[1] > y) !== (b[1] > y)) &&
        (x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0])) inside = !inside;
    }
    return inside;
  }

  function inAnyPoly(list, x, y) {
    for (var i = 0; i < list.length; i++) if (inPoly(list[i], x, y)) return true;
    return false;
  }

  /* nogo-20260918：一套判法管三个家。顺序 ＝ 先地面、再脚点禁区、再整只占位、再软禁区
     （便宜的先判，最贵的 catBox 放后面）。
       floor 有 ——（小窝 / 花房 / walk-map 到货后的花园）地面多边形说了算，不再吃 BOUND；
       floor 无 —— 花园兜底档：BOUND 矩形当边界，其余照旧。 */
  function spotOk(x, y) {
    var i;
    if (turf.floor && turf.floor.length) {
      if (!inAnyPoly(turf.floor, x, y)) return false;
    } else {
      var B = turf.bound;
      if (x < B[0] || x > B[2] || y < B[1] || y > B[3]) return false;
    }
    /* 脚点禁区：建筑体 / 家具落地面 / walk-map 的 forbidden（篱笆已按 expand 外扩） */
    if (turf.block) for (i = 0; i < turf.block.length; i++) if (inPoly(turf.block[i], x, y)) return false;
    /* 硬禁区按整只占位（feetband0918 起花园里只剩出生点那一块） */
    if (turf.hard && turf.hard.length) {
      var box = catBox(x, y);
      for (i = 0; i < turf.hard.length; i++) if (boxHit(box, turf.hard[i])) return false;
    }
    /* feetband0918：UI 热区（畦四边形 / 地块钮 / 气泡 / 门牌）只看脚带 —— 猫宽 × 底部 FEET_H */
    if ((turf.hardFeet && turf.hardFeet.length) || (turf.hardFeetPoly && turf.hardFeetPoly.length)) {
      var feet = feetBox(x, y);
      if (turf.hardFeet) for (i = 0; i < turf.hardFeet.length; i++) if (boxHit(feet, turf.hardFeet[i])) return false;
      if (turf.hardFeetPoly) for (i = 0; i < turf.hardFeetPoly.length; i++) if (rectHitPoly(feet, turf.hardFeetPoly[i])) return false;
    }
    if (turf.soft) for (i = 0; i < turf.soft.length; i++) {   /* 软禁区只拦脚点 */
      var z = turf.soft[i];
      if (x >= z[0] && x <= z[0] + z[2] && y >= z[1] && y <= z[1] + z[3]) return false;
    }
    return true;
  }

  /* ── 防穿 nogo-20260918 ──────────────────────────────────────────────────
     碰撞半径 ＝ 0.9 × 这一家的猫宽：花园 66.6、小窝 105.3、花房 108.9 世界像素。
     取猫宽而不是猫高 —— 俯瞰/等距图里两只挨着看的是横向那条缝。
     挑落点、铺中转点、路线采样统统把「另一只猫」当一块圆形临时禁区：
     它此刻站的地方，和它正走向的那个点（不然两只会各自走进对方的终点）。 */
  var COLLIDE_K = 0.9;
  function collideR() { return (turf.catW || CAT_W) * COLLIDE_K; }

  function catClear(x, y, self) {
    if (self == null) return true;
    var R = collideR(), R2 = R * R, j, o, dx, dy;
    for (j = 0; j < CATS.length; j++) {
      if (j === self) continue;
      o = CATS[j];
      if (o.px == null) continue;
      dx = o.px - x; dy = o.py - y;
      if (dx * dx + dy * dy < R2) return false;
      if (o.st === "walk" && o.tx != null) {
        dx = o.tx - x; dy = o.ty - y;
        if (dx * dx + dy * dy < R2) return false;
      }
    }
    return true;
  }

  /* 站得住 ＋ 不占别人的身位。self ＝ null 就是纯地形判（探针/画图用的那条）。 */
  function freeAt(x, y, self) { return spotOk(x, y) && catClear(x, y, self); }

  /* 整条路都要干净，不是只看两头 —— 每 8 世界像素抽一次。
     roofguard20260915：多了一条「脱困」规矩 —— 起点自己就在禁区里的时候
     （旧版本把猫放上了屋顶，或者以后又补了新禁区），先允许它往外挪，
     从走出禁区的第一个采样点起才开始判。不加这条，站在屋顶上的猫会**永远卡死**：
     pathOk 第一个采样点就在禁区里 → command 返回 false，detourVia 的两段也一样，
     自主遛弯的 pickTarget 同理，谁也叫不动它。
     起点合法时行为跟以前一模一样（stuck=false → left 一开始就是 true）。 */
  function pathOk(x0, y0, x1, y1, self) {
    var n = Math.max(1, Math.ceil(Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0)) / 8));
    var left = freeAt(x0, y0, self);    /* 已经在合法地面上了没有（另一只猫也算禁区） */
    for (var i = 1; i <= n; i++) {
      var t = i / n;
      var ok = freeAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, self);
      if (!left) { if (ok) left = true; continue; }     /* 还在往外挪，这一段不判 */
      if (!ok) return false;
    }
    return left;                        /* 一路都没走出禁区 ＝ 这条路不算数 */
  }

  function farFromOthers(i, x, y) {
    for (var j = 0; j < CATS.length; j++) {
      if (j === i) continue;
      var o = CATS[j];
      if (o.px == null) continue;
      var dx = o.px - x, dy = o.py - y;
      if (dx * dx + dy * dy < turf.near * turf.near) return false;
    }
    return true;
  }

  /* 自主遛弯的活动区。catcontrol20260912：被人/AI 指到老活动区之外以后，
     就以当下站的地方为圆心就地遛弯（±CTRL.LOCAL）—— 硬往回挤的话，一旦中间
     横着菜地，它会一直原地干等，看着像卡死了。 */
  /* nogo0918-v2：一只猫可以有**好几块**活动区（白猫＝野餐垫 + 左侧草坪，两块隔着一段
     不算地面的草，只在垫子右下角那一小片跟大草坪搭上）。写法：roam[id] 既可以是
     一个 [l,t,r,b]，也可以是一串 [[l,t,r,b], …]。挑落点时随机二选一 ——
     这样两块都会去，而不是永远在同一块里打转；去不了的那一块 pickTarget 自己会
     因为 pathOk 不过而放弃，那一拍就当没挑着，下一拍再摇一次。 */
  function roamList(id) {
    var r = turf.roam[id];
    if (!r) return [];
    return (r.length && typeof r[0] === "object") ? r : [r];
  }

  function roamBox(i) {
    var c = CATS[i], list = roamList(c.id), pad = WALK.VISIT_PAD, k, r;
    var inAny = false;
    for (k = 0; k < list.length; k++) {
      r = list[k];
      if (c.px >= r[0] - pad && c.px <= r[2] + pad && c.py >= r[1] - pad && c.py <= r[3] + pad) { inAny = true; break; }
    }
    if (inAny) return list[(Math.random() * list.length) | 0];
    var L = CTRL.LOCAL;
    return [c.px - L, c.py - L, c.px + L, c.py + L];
  }

  /* 挑下一个落点：自家活动区里随机点，一成多的概率往外多探一点（串门）。
     挑不着就原地再等一会儿 —— 宁可不走，不要走进菜地。 */
  function pickTarget(i) {
    var c = CATS[i], r = roamBox(i);
    for (var n = 0; n < WALK.TRIES; n++) {
      var pad = Math.random() < WALK.VISIT ? WALK.VISIT_PAD : 0;
      var x = rnd(r[0] - pad, r[2] + pad);
      var y = rnd(r[1] - pad, r[3] + pad);
      if (!spotOk(x, y)) continue;
      if (!farFromOthers(i, x, y)) continue;
      if (!pathOk(c.px, c.py, x, y, i)) continue;        /* nogo-20260918：绕开另一只猫 */
      var d = Math.sqrt((x - c.px) * (x - c.px) + (y - c.py) * (y - c.py));
      if (d < 26) continue;                              /* 挪一丁点不叫遛弯 */
      return [x, y];
    }
    return null;
  }

  /* 不给 tx/ty ＝ 自己挑（自主遛弯）；给了 ＝ 照着走（catcontrol20260912 的操控）。
     给进来的点已经在 command() 里过完禁区和路线校验了，这里不重复判。 */
  var STOP_FRAME = { left: 4, right: 4, front: 0, back: 0 };  /* stopframe20260915 */

  function startWalk(i, tx, ty) {
    var c = CATS[i];
    /* userwhite20260918：不给落点 ＝ 自主遛弯。白猫在这儿就被挡下，连 pickTarget 都不进 ——
       它不挑目标，也就不会因为「离得远/被顶了一下」自己挪。
       给了落点的照旧放行：点地、双猫幕、AI 接口走的都是给了落点那一条。 */
    if (tx == null && !selfWalks(c)) { c.st = "idle"; c.t = rnd(WALK.IDLE_MIN, WALK.IDLE_MAX); return; }
    var t = (tx == null) ? pickTarget(i) : [tx, ty];
    if (!t) { c.st = "idle"; c.t = rnd(3000, 7000); return; }
    /* walksilk20260918：已经在走的改道/过弯不踩刹车。当下地速折算成新腿缓动的
       相位（瞬时速度 ＝ 峰值×sin(πp)，反解 p0），再把虚拟起点往身后推 ——
       位置和速度都连续接上，不再从 0 重新爬。只接加速段（p<0.5 一侧）。 */
    var v0 = (c.st === "walk" && c.dur > 0) ? (c.v || 0) : 0;
    c.sx = c.px; c.sy = c.py; c.tx = t[0]; c.ty = t[1];
    var d = Math.sqrt((c.tx - c.sx) * (c.tx - c.sx) + (c.ty - c.sy) * (c.ty - c.sy));
    c.dur = d / (turf.speed * rnd(1 - WALK.SPEED_JIT, 1 + WALK.SPEED_JIT)) * 1000;
    c.dist = d;                                          /* 瞬时速度要用（探针里读得到） */
    c.p = 0;
    if (v0 > 4 && d > 1) {
      var vPeak = d / c.dur * 1000 * (Math.PI / 2);
      var p0 = Math.asin(Math.min(.92, v0 / vPeak)) / Math.PI;
      var e0 = .5 - .5 * Math.cos(Math.PI * p0);
      if (e0 > 1e-4 && e0 < .9) {
        c.sx = (c.px - c.tx * e0) / (1 - e0);            /* c.p=p0 时位置正好落在当下脚点 */
        c.sy = (c.py - c.ty * e0) / (1 - e0);
        c.p = p0;
      }
    }
    c.st = "walk";
    /* fourway20260912：这一程的朝向。每段路都是直线，所以一程一个朝向；
       catcontrol 的改道／绕畦中转点都是重新 startWalk，换向就在那一拍生效，跟得上。
       walksilk20260918：走动着换向不再把步态拍回第 1 帧 —— 四向条同相位，接着跑才顺；
       只有从站立起步的换向才从第 1 帧起（别半路接一条别人的腿）。 */
    if (Math.abs(c.tx - c.px) > 1e-6 || Math.abs(c.ty - c.py) > 1e-6) {
      var nd = dirOf(c.tx - c.px, c.ty - c.py);
      if (nd !== c.dir) {
        /* walksilk20260918 v4：行进中换向＝过场帧转身。记一拍过场皮：目标是往上走就
           露背影，其余（含左右互转）都给正面 —— 读起来是拧头换向，不是镜像翻转。
           站立起步的换向照旧瞬切＋从第 1 帧起（速度为零，转身戏演不出来也没必要）。 */
        if (v0 > 4) { c.turnPivot = (nd === "back") ? "back" : "front"; c.turnT = WALK.TURN_MS; }
        else { c.frame = 0; c.frameT = 0; c.strideAcc = 0; }
        c.dir = nd;
      }
    }
    if (Math.abs(c.tx - c.px) > WALK.TURN_EPS) c.face = c.tx > c.px ? 1 : -1;
  }

  function endWalk(i) {
    var c = CATS[i];
    c.v = 0;
    /* stopframe20260915：停下定格在"双脚落地"那一帧。侧面卷第1帧是迈步中，
       定格像单脚罚站（玩家 9/15 凌晨抓的），逐帧目检选并脚帧：left/right 用第5帧。 */
    c.frame = (STOP_FRAME[c.dir] || 0); c.frameT = 0;
    c.iframe = 0; c.iframeT = 0;                         /* idle20260915：待机从第 1 格起（睁着眼的那张） */
    /* catcontrol20260912：这一程是被操控的 —— 还有下一段（绕畦的中转点）就接着走；
       走完了就交还自主节奏，但先按住 CTRL.HOLD_MS，这段时间里不自己起步、也不打盹。
       玩家刚把猫放到这儿，猫立刻自己溜达走，等于白点。 */
    if (c.cmd) {
      /* feetband0918：c.leg 是队列，一站一站掏；掏空了才算走完 */
      if (c.leg && c.leg.length) { var leg = c.leg.shift(); if (!c.leg.length) c.leg = null; startWalk(i, leg[0], leg[1]); return; }
      c.cmd = false; c.detour = false;
      c.st = "idle"; c.t = CTRL.HOLD_MS;
      return;
    }
    if (!c.detour && Math.random() < WALK.NAP_CHANCE) { c.st = "nap"; c.t = rnd(WALK.NAP_MIN, WALK.NAP_MAX); }
    else { c.st = "idle"; c.t = rnd(WALK.IDLE_MIN, WALK.IDLE_MAX); }
    c.detour = false;
  }

  function wake(i, why) {
    var c = CATS[i];
    if (c.st !== "nap") return;
    c.st = "idle";
    c.t = why === "poke" ? rnd(6000, 12000) : rnd(2000, 6000);
  }

  function stepCat(i, dt) {
    var c = CATS[i];

    /* walksilk20260918：重影衰减跟着 dt 走，不管这只猫此刻动不动（站着那拍也在淡） */
    var gm = models[i];
    if (gm && gm.__fade > 0) {
      gm.__fade -= dt;
      if (gm.__fade <= 0) { gm.__fade = 0; gm.__ghost.renderable = false; }
      else gm.__ghost.alpha = gm.__fade / WALK.FADE;
    }
    /* walksilk20260918 v4：转身计时也在这儿走 —— 万一转向中途被收住（撞车让道），
       过场不能卡住，到点揭掉过场皮并重画一拍 */
    if (c.turnT > 0) {
      c.turnT = Math.max(0, c.turnT - dt);
      if (!c.turnT) { c.turnPivot = null; poseCat(i); }
    }

    /* 闭眼/睁眼渐变：nap 时往 1 爬，其余时候往 0 退 */
    var want = c.st === "nap" ? 1 : 0;
    if (c.napEye !== want) {
      var step = dt / WALK.NAP_FADE;
      c.napEye = want > c.napEye ? Math.min(want, c.napEye + step) : Math.max(want, c.napEye - step);
    }

    if (c.st === "walk") {
      c.p += dt / c.dur;
      var done = c.p >= 1;
      var e = done ? 1 : (.5 - .5 * Math.cos(Math.PI * c.p));   /* easeInOutSine：起步和停下都软 */
      var ox = c.px, oy = c.py;
      c.px = c.sx + (c.tx - c.sx) * e;
      c.py = c.sy + (c.ty - c.sy) * e;
      /* easeInOutSine 的瞬时速度 = 平均速度 × (π/2)sin(πp)，留着给探针看「走得多快」 */
      var v = Math.sin(Math.PI * Math.min(1, c.p));
      c.v = done ? 0 : (c.dist || 0) / c.dur * 1000 * (Math.PI / 2) * v;
      /* walktune20260917：换帧跟脚不跟钟。按这一拍真实挪了多少世界像素累步幅，
         攒够 1/8 轮（stride/8）才翻下一帧 —— 缓动起步/收步地速慢，帧就跟着慢，
         脚底不打滑；匀速段一轮 ≈0.88 秒，跟原来 110ms/帧一个感觉。
         位移还是上面那两行给的，帧图自己不带任何位移，两套不打架。 */
      var stridePer = (turf.stride || 62) / FW_FRAMES;
      /* walksilk20260918 v4：过场转身期间步幅照走 —— 过场皮是正面/背面的走路帧，
         腿接着倒腾才像边走边转；冻结步态是 v3 压扁时代的事，那会儿翻帧会穿帮。 */
      c.strideAcc = (c.strideAcc || 0) + Math.sqrt((c.px - ox) * (c.px - ox) + (c.py - oy) * (c.py - oy));
      while (c.strideAcc >= stridePer) { c.strideAcc -= stridePer; c.frame = (c.frame + 1) % FW_FRAMES; }
      /* walksilk20260918：绕路弯角不刹停 —— 剩 CORNER 以内直接把下一腿接进来
         （位置不 snap 到中转点，速度由 startWalk 的 v0 接力），弯是抹圆的不是拐的。 */
      if (c.leg && !done) {
        var rx = c.tx - c.px, ry = c.ty - c.py;
        if (rx * rx + ry * ry < WALK.CORNER * WALK.CORNER) {
          var nx2 = c.leg.shift(); if (!c.leg.length) c.leg = null;   /* feetband0918：队列掏一站 */
          startWalk(i, nx2[0], nx2[1]);
          poseCat(i);
          return;
        }
      }
      if (done) { c.px = c.tx; c.py = c.ty; endWalk(i); }
      poseCat(i);
      return;
    }

    /* idle20260915：正面站着 ＝ 播呼吸眨眼。打盹不走帧，定在那一格闭眼的
       （这才像睡着了；换身体那会儿丢的闭眼帧，从这儿赎回来一张）。 */
    if (idleOn(c)) {
      if (c.st === "nap") {
        var sf = IDLE_SLEEP[c.id] || 0;
        if (c.iframe !== sf) { c.iframe = sf; c.iframeT = 0; poseCat(i); }
      } else {
        c.iframeT += dt;
        if (c.iframeT >= IDLE_MS) {
          while (c.iframeT >= IDLE_MS) { c.iframeT -= IDLE_MS; c.iframe = (c.iframe + 1) % IDLE_FRAMES; }
          poseCat(i);
        }
      }
    }

    if (c.napEye > 0 && c.napEye < 1) poseCat(i);        /* 闭眼那一秒身子在压扁，得跟着重画 */
    c.t -= dt;
    if (c.t > 0) return;
    if (c.st === "nap") { wake(i); return; }
    /* userwhite20260918：待机到点，会自己遛弯的才起步。白猫就地续一段待机 ——
       三成概率原地打个盹（跟 endWalk 里同一个 NAP_CHANCE，打盹这件事没被砍掉），
       否则再站 IDLE_MIN~IDLE_MAX。站着的这段时间眨眼呼吸照播。 */
    if (!selfWalks(c)) {
      if (Math.random() < WALK.NAP_CHANCE) { c.st = "nap"; c.t = rnd(WALK.NAP_MIN, WALK.NAP_MAX); }
      else { c.st = "idle"; c.t = rnd(WALK.IDLE_MIN, WALK.IDLE_MAX); }
      return;
    }
    startWalk(i);
  }

  /* nogo-20260918：收住一只猫，把它推进「等 0.6~1.2 秒再重挑」那一档。
     返回有没有真收 —— 已经在等着重挑的不重复压计时，不然两只贴着时计时被每拍刷新，
     谁也起不了步（那就成了另一种卡死）。 */
  function yieldCat(k) {
    var c = CATS[k];
    if (c.st === "walk") {
      c.v = 0; c.detour = true;
      /* catcontrol20260912：被操控的那一程撞上另一只猫，这趟指令就作废 ——
         收在半路总比叠在一起强，人/AI 再点一次就是。 */
      c.cmd = false; c.leg = null;
      c.frame = 0; c.frameT = 0;                         /* fourway20260912：急刹也要定格第 1 帧 */
      c.iframe = 0; c.iframeT = 0;                       /* idle20260915 */
      c.st = "idle"; c.t = rnd(600, 1200);
      poseCat(k);
      return true;
    }
    if (c.st === "nap") { c.st = "idle"; c.t = rnd(600, 1200); return true; }
    if (c.t > 1400) { c.t = rnd(600, 1200); return true; }
    return false;
  }

  /* 正在往外挪的别拦 —— 目标比当下离对方更远 ＝ 它在escape。
     少了这一条会死锁：两只一旦贴到碰撞半径以内，每一拍刚起步就被收住，
     谁也走不掉（9/18 实测就踩到了：硬摆 40 像素，12 秒都没分开）。 */
  function movingAway(a, b) {
    if (a.st !== "walk" || a.tx == null) return false;
    var d0 = (a.px - b.px) * (a.px - b.px) + (a.py - b.py) * (a.py - b.py);
    var d1 = (a.tx - b.px) * (a.tx - b.px) + (a.ty - b.py) * (a.ty - b.py);
    return d1 > d0;
  }

  /* 防穿画面 nogo-20260918：脚点 y 大的画在前面（俯瞰/等距同口径 —— 谁的脚更靠下谁在前）。
     只动 stage 里的画序，不动 models 数组本身 —— models[i]/hits[i]/shadows[i] 要跟 CATS[i] 对齐。 */
  function sortDepth() {
    if (!app || !app.stage || models.length < 2) return;
    var order = models.slice().sort(function (p, q) {
      return ((p.__cfg && p.__cfg.py) || 0) - ((q.__cfg && q.__cfg.py) || 0);
    });
    for (var i = 0; i < order.length; i++) {
      try { if (app.stage.getChildIndex(order[i]) !== i) app.stage.setChildIndex(order[i], i); } catch (_) { }
    }
  }

  function catwalkStep(dt) {
    var i, j;
    /* ── 碰撞 nogo-20260918 ───────────────────────────────────────────────
       以前只在挑目标那一下判一次（farFromOthers），走的过程中两只是可以对穿的。
       现在每一拍量一次真实距离：
         · 贴到碰撞半径以内（0.9×猫宽：花园 66.6 / 小窝 105.3 / 花房 108.9）→
           序号大的（黑猫）当场收住；它已经停着还挨着，前面那只（白猫）也收住。
           两只都会在 0.6~1.2 秒后重挑，重挑时对方是一块圆形禁区（见 catClear）。
         · 老规矩留着：走动中挨到 near（花园 120）以内，序号大的先收住改道。 */
    var R = collideR(), R2 = R * R, nr2 = turf.near * turf.near;
    for (i = 1; i < CATS.length; i++) {
      var a = CATS[i];
      if (a.px == null) continue;
      for (j = 0; j < i; j++) {
        var b = CATS[j];
        if (b.px == null) continue;
        var dx = a.px - b.px, dy = a.py - b.py, d2 = dx * dx + dy * dy;
        if (d2 < R2) {
          if (!movingAway(a, b)) yieldCat(i);
          if (b.st === "walk" && !movingAway(b, a)) yieldCat(j);   /* 硬穿是两只的事，不能只罚一只 */
          break;
        }
        if (a.st === "walk" && d2 < nr2 && !movingAway(a, b)) { yieldCat(i); break; }
      }
    }
    for (i = 0; i < CATS.length; i++) { try { stepCat(i, dt); } catch (_) { } }
    sortDepth();

    /* 自发喵：全局 2~5 分钟一颗，随机挑一只醒着的。每只各自计时会吵，别刷屏。 */
    sayTimer -= dt;
    if (sayTimer <= 0) {
      sayTimer = rnd(WALK.SAY_MIN, WALK.SAY_MAX);
      var awake = [];
      for (i = 0; i < CATS.length; i++) if (CATS[i].st !== "nap") awake.push(i);
      if (awake.length) meow(awake[(Math.random() * awake.length) | 0]);
    }
  }

  /* 戳猫：醒着的立刻喵；打盹的慢半拍抬头再喵 */
  function catwalkPoke(i) {
    var c = CATS[i];
    if (c.st === "nap") {
      wake(i, "poke");
      setTimeout(function () { meow(i); }, WALK.POKE_LAG);
      return;
    }
    meow(i);
  }

  /* 起手：每只从这一家的「家」出发，状态、朝向、计时归零。
     cathome20260913：串门要记路 —— 走之前把上一家的落脚点存进 c.mem[上一家]，
     回来的时候还站在原处（那点现在还合法才认，家具坐标改过就退回起手位）。 */
  /* nogo-20260918：从 (x,y) 起一圈圈往外找一个站得住的点。禁区表改过之后
     起手位/存档位万一落进新禁区，有这条兜底就不会有一只猫钉死在墙里。 */
  /* nogo0919-v3：环距 12 → 8。玩家点地是对着底图点的，点偏一点就该落在「最近的」那格上；
     12 的环最坏会把落点推远 11px，8 的最坏 7px。搜索半径照旧到 480（起手位脱困要用），
     点地那条另有 CTRL.SNAP 卡着，见 command()。 */
  function nearestSpot(x, y, self) {
    if (freeAt(x, y, self)) return [x, y];
    for (var r = 8; r <= 480; r += 8) {
      for (var a = 0; a < 360; a += 8) {
        var t = a * Math.PI / 180;
        var nx = x + r * Math.cos(t), ny = y + r * Math.sin(t);
        if (freeAt(nx, ny, self)) return [Math.round(nx), Math.round(ny)];
      }
    }
    return null;
  }

  function catwalkInit(prev) {
    for (var i = 0; i < CATS.length; i++) {
      var c = CATS[i];
      if (prev && c.px != null) { c.mem = c.mem || {}; c.mem[prev] = [c.px, c.py]; }
      var back = c.mem && c.mem[sceneNow], home = turf.home[c.id] || [c.x, c.y];
      /* 存档位（c.mem，只活在这一次页面会话里 —— 本包不往 localStorage 写猫的位置，
         那儿只有 rhCatsOff 一颗总闸）落进禁区 ＝ 直接放回家；家也进了禁区就就近找一个。 */
      if (back && spotOk(back[0], back[1])) { c.px = back[0]; c.py = back[1]; }
      else { c.px = home[0]; c.py = home[1]; }
      if (!spotOk(c.px, c.py)) {
        var fix = nearestSpot(home[0], home[1], null);
        if (fix) { c.px = fix[0]; c.py = fix[1]; }
        try { console.warn("[rhCat] " + c.name + "的起手位在禁区里，已就近挪到 " + c.px + "," + c.py); } catch (_) { }
      }
      c.face = c.flip ? -1 : 1;
      c.napEye = 0; c.detour = false;
      c.dir = "front"; c.frame = 0; c.frameT = 0;        /* fourway20260912：起手正面、第 1 帧 */
      c.iframe = 0; c.iframeT = 0;                       /* idle20260915：待机也从第 1 格起 */
      c.cmd = false; c.leg = null;                       /* catcontrol20260912 */
      c.st = "idle";
      c.t = rnd(1500, 9000);                             /* 错开，别两只同时起步 */
    }
    /* nogo-20260918：起手就别叠在一起。duoscenes 落幕回来、或者 .on() 重新开层的时候，
       两只可能正好挨在碰撞半径以内 —— 先把序号大的挪开一个身位再遛。 */
    unstack();
    sayTimer = rnd(WALK.SAY_MIN, WALK.SAY_MAX);
  }

  function unstack() {
    var R = collideR(), R2 = R * R, i, j;
    for (i = 1; i < CATS.length; i++) {
      var a = CATS[i];
      if (a.px == null) continue;
      for (j = 0; j < i; j++) {
        var b = CATS[j];
        if (b.px == null) continue;
        var dx = a.px - b.px, dy = a.py - b.py;
        if (dx * dx + dy * dy >= R2) continue;
        /* userwhite20260918：让路的永远是会自己走的那只（黑猫）。白猫是使用者摆在
           那儿的，哪怕序号排在后面也不许被顶开 —— 真轮到它，改挪对方。
           今天的序是 [white, black]，a 就是黑猫，跟改之前一模一样。 */
        var mv = selfWalks(a) ? i : (selfWalks(b) ? j : i);
        var m = CATS[mv];
        var to = nearestSpot(m.px, m.py, mv);
        if (to) { m.px = to[0]; m.py = to[1]; }
        break;
      }
    }
  }

  /* ═════════════════════ 6c. 操控 catcontrol20260912 ═════════════════════
     产品设定：白猫 ＝ 使用者，黑猫 ＝ AI。
       · 白猫：在花园里点一块空地，它就走过去（下面的 onWorldClick）。
       · 黑猫：每 3 秒问一次 /garden/api/cat/black/pending，AI 给坐标就走、
               给 say 就在头顶冒一句（pollBlack）。
     两条线最后都汇到同一个 command()：同一套禁区校验、同一套绕路、同一套按住
     自主节奏的规矩 —— 谁在指挥不重要，猫该不该踩进菜地是同一件事。 */

  var CTRL = {
    HOLD_MS: 60000,      /* 落定之后按住自主遛弯 60 秒，再没人管就恢复自己溜达 */
    SAY_MS: 4200,        /* AI 那句话比「喵」多活一会儿，够看完 */
    LOCAL: 150,          /* 被指到老活动区之外以后，就地遛弯的半径 */
    GRID: 96,            /* 绕路中转点的采样步长（世界像素） */
    DRAG: 6,             /* 鼠标拖地图超过这么多屏幕像素，就不算「点地」 */
    SNAP: 160,           /* walktune20260917b：点进禁区时就近找站得住的点的最大吸附距离（世界像素） */
    POLL_MS: 3000        /* 黑猫问信的间隔 */
  };

  function catIndex(id) {
    for (var i = 0; i < CATS.length; i++) if (CATS[i].id === id) return i;
    return -1;
  }

  /* 直线过不去（中间横着一块畦）就找一个中转点：在可走网格里挑两段都干净的点，
     按总路程从近到远试，第一个成的就用。找不着就不走 —— 宁可不动，不要穿墙。 */
  function detourVia(x0, y0, x1, y1, self) {
    var cand = [], gx, gy, i, B = turf.bound, G = turf.grid || CTRL.GRID;
    for (gx = B[0]; gx <= B[2]; gx += G) {
      for (gy = B[1]; gy <= B[3]; gy += G) {
        if (!freeAt(gx, gy, self)) continue;             /* nogo-20260918：中转点也别踩另一只猫 */
        var a = Math.sqrt((gx - x0) * (gx - x0) + (gy - y0) * (gy - y0));
        var b = Math.sqrt((x1 - gx) * (x1 - gx) + (y1 - gy) * (y1 - gy));
        cand.push([gx, gy, a + b]);
      }
    }
    cand.sort(function (p, q) { return p[2] - q[2]; });
    for (i = 0; i < cand.length; i++) {
      if (!pathOk(x0, y0, cand[i][0], cand[i][1], self)) continue;
      if (!pathOk(cand[i][0], cand[i][1], x1, y1, self)) continue;
      return [[cand[i][0], cand[i][1]]];
    }
    return detourGrid(x0, y0, x1, y1, self);
  }

  /* feetband0918：单个中转点跨不过整片畦（草坪 → 花房门口要拐三四个弯，四个起点实测全 false），
     退一步在同一张网格上做广搜：起点直线能到的格子当种子，八邻接、每条边都过 pathOk，
     搜到第一个能直线到终点的格子就停；再把格路按视线贪心抽稀（能直走的段合成一段），
     返回中转点列表（不含终点）。花园 48 格 ≈ 30×17 个节点，最坏一次几十毫秒，只在点地/AI
     指挥时跑一次，自主遛弯的 pickTarget 不走这条。找不到照旧返回 null —— 宁可不动，不要穿墙。 */
  function detourGrid(x0, y0, x1, y1, self) {
    /* 网格取 turf.grid 的一半（花园 24）：畦与门牌之间那条道实测只有 28~40px 宽，48 的格子
       落不进去。节点合法性按需算（free 缓存），起点/终点各只认最近的几个能直线到的节点当
       种子/目标（按距离排序，最多试 96 个、各收 4 个），别对全图 2000 个节点逐个连线。 */
    var B = turf.bound, G = Math.max(16, (turf.grid || CTRL.GRID) / 2);
    var cols = Math.floor((B[2] - B[0]) / G) + 1, rows = Math.floor((B[3] - B[1]) / G) + 1;
    var N = cols * rows, free = new Array(N), prev = new Array(N), goal = new Array(N), q = [], head = 0, k, gx, gy;
    function X(k) { return B[0] + (k % cols) * G; }
    function Y(k) { return B[1] + Math.floor(k / cols) * G; }
    function isFree(k) { if (free[k] === undefined) free[k] = freeAt(X(k), Y(k), self); return free[k]; }
    function nearest(px, py, cb) {                          /* 离 (px,py) 最近的节点起，逐个交给 cb，收够 4 个或试满 96 个就停 */
      var order = [], got = 0, tried = 0;
      for (k = 0; k < N; k++) order.push([k, (X(k) - px) * (X(k) - px) + (Y(k) - py) * (Y(k) - py)]);
      order.sort(function (a, b) { return a[1] - b[1]; });
      for (k = 0; k < order.length && got < 4 && tried < 96; k++) {
        if (!isFree(order[k][0])) continue;
        tried++;
        if (cb(order[k][0])) got++;
      }
      return got;
    }
    for (k = 0; k < N; k++) prev[k] = -2;                  /* -2 没到过，-1 种子 */
    if (!nearest(x1, y1, function (n) { if (!pathOk(X(n), Y(n), x1, y1, self)) return false; goal[n] = true; return true; })) return null;
    if (!nearest(x0, y0, function (n) { if (!pathOk(x0, y0, X(n), Y(n), self)) return false; prev[n] = -1; q.push(n); return true; })) return null;
    var found = -1, d, dx, dy, c, r, n;
    while (head < q.length) {
      k = q[head++];
      if (goal[k]) { found = k; break; }
      gx = X(k); gy = Y(k);
      c = k % cols; r = Math.floor(k / cols);
      for (d = 0; d < 8; d++) {
        dx = [1, -1, 0, 0, 1, 1, -1, -1][d]; dy = [0, 0, 1, -1, 1, -1, 1, -1][d];
        if (c + dx < 0 || c + dx >= cols || r + dy < 0 || r + dy >= rows) continue;
        n = k + dx + dy * cols;
        if (prev[n] !== -2 || !isFree(n)) continue;
        if (!pathOk(gx, gy, X(n), Y(n), self)) continue;
        prev[n] = k; q.push(n);
      }
    }
    if (found < 0) return null;
    var nodes = [];
    for (k = found; k >= 0; k = prev[k]) nodes.unshift([X(k), Y(k)]);
    /* 视线抽稀：从当前点起找最远一个能直走到的节点 */
    var out = [], cx = x0, cy = y0, i, j;
    for (i = 0; i < nodes.length;) {
      for (j = nodes.length - 1; j > i; j--) if (pathOk(cx, cy, nodes[j][0], nodes[j][1], self)) break;
      out.push(nodes[j]); cx = nodes[j][0]; cy = nodes[j][1]; i = j + 1;
    }
    return out;
  }

  /* 指一只猫去 (x,y)。
     walktune20260917b 起改了「安静地不动」的老脾气 —— 玩家点地遛猫，点在禁区边上
     猫毫无反应，看着像坏了。现在：落点站不住（禁区/压着另一只猫）就往 SNAP 以内
     最近的合法点吸附，吸得到就走过去；直线过不去照旧绕中转点；绕也绕不过去
     （隔着篱笆那种）才真的不动，由调用方决定要不要吱一声。
     正在走的被再指一次 ＝ 改道（重新 startWalk）；打盹的先醒再走。 */
  function command(i, x, y) {
    var c = CATS[i];
    if (!c || c.px == null || dead || !mounted) return false;
    if (!(x > -Infinity) || !(y > -Infinity)) return false;
    if (!spotOk(x, y) || !farFromOthers(i, x, y)) {
      var n = nearestSpot(x, y, i);
      if (!n) return false;
      var dx = n[0] - x, dy = n[1] - y;
      if (Math.sqrt(dx * dx + dy * dy) > CTRL.SNAP) return false;   /* 野点太偏，照旧不理 */
      x = n[0]; y = n[1];
    }
    var via = null;
    /* nogo-20260918：被操控的这一程同样不许硬穿另一只猫 —— 直线过不去就绕，
       绕不过去就返回 false（点地那头会喵一声当回话）。 */
    if (!pathOk(c.px, c.py, x, y, i)) {
      via = detourVia(c.px, c.py, x, y, i);
      if (!via) return false;
    }
    if (c.st === "nap") wake(i, "poke");                 /* 打盹的先醒 */
    c.cmd = true; c.detour = false;
    /* feetband0918：via 现在是中转点列表（一个或多个），c.leg 成了「还没走的点」队列，
       终点排在最后；endWalk / 过弯（walksilk CORNER）每到一站掏下一站。 */
    if (via) { c.leg = via.slice(1); c.leg.push([x, y]); startWalk(i, via[0][0], via[0][1]); }
    else { c.leg = null; startWalk(i, x, y); }
    return c.st === "walk";
  }

  /* ── 白猫：点地面 ──────────────────────────────────────────────────────────
     挂在 #world 的捕获层，但一个 preventDefault / stopPropagation 都不做：
     先判命中畦/按钮/卡片就直接放行，地块卡该弹照弹。猫只捡「谁都没接住」的那些点。 */
  var UI_SEL = "button,a,input,select,textarea,label,dialog,.card,.hud,nav,.pages,.connection,.retry,.toast,.plot-hit";
  var dragFrom = null;

  function onUi(t) {
    if (!t || typeof t.closest !== "function") return true;   /* 认不出来就当是 UI，宁可不接 */
    return !!t.closest(UI_SEL);
  }

  function onWorldClick(ev) {
    if (!world || !layer || layer.hidden || dead) return;
    if (!hasCats(sceneNow) || reduced) return;
    if (ev.button != null && ev.button !== 0) return;         /* 只认左键 */
    /* 拖地图拖完也会补一发 click，位移超过 DRAG 就不是「点地」 */
    if (dragFrom && (Math.abs(ev.clientX - dragFrom[0]) > CTRL.DRAG || Math.abs(ev.clientY - dragFrom[1]) > CTRL.DRAG)) return;
    if (onUi(ev.target)) return;                              /* 畦/钮/UI —— 放行，不处理 */
    var r = world.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var k = r.width / WORLD_W;
    var i = catIndex("white");
    if (i < 0) return;
    /* walktune20260917b：真过不去（隔篱笆/野点太偏）也喵一声当回话 ——
       点地遛猫最怕点了没反应，看着像坏了。 */
    if (!command(i, (ev.clientX - r.left) / k, (ev.clientY - r.top) / k)) meow(i);
  }

  function bindTapToWalk() {
    if (!world || world.__rhCatCtl) return;
    world.__rhCatCtl = true;
    world.addEventListener("pointerdown", function (e) { dragFrom = [e.clientX, e.clientY]; }, true);
    world.addEventListener("click", onWorldClick, true);
  }

  /* ── 黑猫：AI 的口子 ───────────────────────────────────────────────────────
     开源语义：这是留给使用者把自己的 AI 接进来控制黑猫的入口。
       POST /garden/api/cat/black          {x, y, say}   —— 下一条指令（新的盖旧的）
       GET  /garden/api/cat/black/pending                —— 前端取走即清
     网页使用玩家会话，AI 指令使用独立的 AI 钥匙。
     每 3 秒问一次；document.hidden / 不在花园 一律不问 —— 跟 ticker 一个规矩，
     别在没人看的时候空转。 */
  var blackBusy = false, blackTimer = 0;

  function pollBlack() {
    if (dead || !mounted || blackBusy) return;
    if (document.hidden || !hasCats(sceneNow)) return;
    blackBusy = true;
    fetch("api/cat/black/pending?scene=" + encodeURIComponent(sceneNow), { cache: "no-store", credentials: "same-origin" })
      .then(function (r) {
        /* 服务端还没有这条路由（旧版 serve.mjs）：问下去只会每 3 秒往控制台扔一条 404。
           认出来就把这只耳朵关掉，留一句人话 —— 猫照样遛弯，只是没人指挥它。 */
        if (r.status === 404) {
          if (blackTimer) { clearInterval(blackTimer); blackTimer = 0; }
          try { console.info("[rhCat] 服务端没有 /garden/api/cat/black，黑猫这条 AI 线先歇着（换新版 serve.mjs 就有了）"); } catch (_) { }
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then(function (j) {
        var p = j && j.pending;
        if (!p || dead) return;
        var i = catIndex("black");
        if (i < 0) return;
        if (p.x != null && p.y != null) command(i, Number(p.x), Number(p.y));
        if (p.say) meow(i, p.say, CTRL.SAY_MS);
      })
      .catch(function (_) { })                     /* 服务没起来/断网：安静跳过，下一拍再问 */
      .then(function () { blackBusy = false; });
  }

  function startBlackPoll() {
    if (blackTimer) return;
    blackTimer = setInterval(pollBlack, CTRL.POLL_MS);
  }


  var PLAYER = {
    CAT: "white",
    MS: 4200,         /* 跟 AI 那句一个时长：30 字读得完，又不至于赖着不走 */
    ANIM: 180,        /* 输入条收起的等待，比 CSS 那条 .17s 多一口气 */
    KB: 80            /* 视口被吃掉超过这么多才当成「键盘弹起来了」——
                         iOS 的地址栏伸缩也会改 visualViewport，别把那也当键盘 */
  };

  /* 图标：一颗小气泡（配色照 style.css 的 .bubble：奶油 #fff9e6 / 边 #ac844e / 字 #946736）
     和一支发送箭头（线条照 lucide 那套，花园的 codex 图标本来就是它）。 */
  var SVG_BUBBLE = '<svg viewBox="0 0 40 40" aria-hidden="true" focusable="false">' +
    '<path d="M8 5h24a5 5 0 0 1 5 5v13a5 5 0 0 1-5 5H21l-7.5 6.5V28H8a5 5 0 0 1-5-5V10a5 5 0 0 1 5-5Z" ' +
    'fill="#fff9e6" stroke="#ac844e" stroke-width="2.4" stroke-linejoin="round"/>' +
    '<circle cx="13" cy="16.5" r="2.1" fill="#946736"/><circle cx="20" cy="16.5" r="2.1" fill="#946736"/>' +
    '<circle cx="27" cy="16.5" r="2.1" fill="#946736"/></svg>';
  var SVG_SEND = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="#7e3e4b" ' +
    'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M4.5 12h13"/><path d="m12 6 6 6-6 6"/></svg>';

  var sayWrap = null, sayBar = null, sayInput = null, sayCount = null, sayBtn = null, saySend = null, sayShutT = 0;

  function sayOpened() { return !!(sayBar && !sayBar.hidden); }

  function paintCount() {
    if (!sayInput || !sayCount) return;
    var n = 0;
    try { n = Array.from(sayInput.value).length; } catch (_) { n = sayInput.value.length; }
    /* 平时不显示，快到头了才冒出来 —— 一条计数器常驻会把「随口说一句」变成填表 */
    sayCount.hidden = n < SAY_MAX - 8;
    sayCount.textContent = n + "/" + SAY_MAX;
    sayCount.classList.toggle("rh-say-over", n > SAY_MAX);
  }

  /* 键盘让位：只在输入框真的有焦点时才挪，别让地址栏伸缩也把整组顶上去 */
  function fitKeyboard() {
    if (!sayWrap) return;
    var vv = window.visualViewport;
    if (!vv || !sayInput || document.activeElement !== sayInput) { sayWrap.style.transform = ""; return; }
    var eaten = Math.max(0, (window.innerHeight || 0) - (vv.height + vv.offsetTop));
    sayWrap.style.transform = eaten > PLAYER.KB ? "translateY(-" + Math.round(eaten) + "px)" : "";
  }

  function openSay() {
    if (!sayBar || !sayWrap || sayWrap.hidden) return;
    if (sayShutT) { clearTimeout(sayShutT); sayShutT = 0; }
    sayBar.hidden = false;
    sayBtn.setAttribute("aria-expanded", "true");
    if (reduced) sayBar.classList.add("rh-say-open");
    else {
      /* 隔一帧再加类，transition 才有起点（同一帧里加＝直接就位，没有动画） */
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { if (sayBar && !sayBar.hidden) sayBar.classList.add("rh-say-open"); });
      });
    }
    /* 必须在这一拍（用户手势里）聚焦，手机键盘才肯弹 */
    try { sayInput.focus({ preventScroll: true }); } catch (_) { try { sayInput.focus(); } catch (_) { } }
  }

  function closeSay(collapseKeyboard) {
    if (!sayBar) return;
    sayBar.classList.remove("rh-say-open");
    if (sayBtn) sayBtn.setAttribute("aria-expanded", "false");
    if (collapseKeyboard) { try { sayInput.blur(); } catch (_) { } }   /* 收键盘 */
    if (sayWrap) sayWrap.style.transform = "";
    if (sayShutT) clearTimeout(sayShutT);
    sayShutT = setTimeout(function () { sayShutT = 0; if (sayBar) sayBar.hidden = true; }, reduced ? 0 : PLAYER.ANIM);
  }

  function sendSay() {
    if (!sayInput) return;
    var text = clipSay(sayInput.value);      /* ≤30 字，按码点截 */
    sayInput.value = "";
    paintCount();
    if (text) {
      fetch("api/messages", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: text }) }).catch(function () {});
      var i = catIndex(PLAYER.CAT);
      if (i >= 0 && hits[i]) {
        if (CATS[i].st === "nap") wake(i, "poke");   /* 睡着的先睁眼，别说梦话 */
        meow(i, text, PLAYER.MS, true);              /* 第四个参数 ＝ 这颗跟着猫走 */
      }
    }
    closeSay(true);
  }

  /* 点别处收起来。不 preventDefault —— 点花园空地照样把白猫指过去，
     不给「必须先关掉这条才能玩」的憋屈感。 */
  function onDocDown(ev) {
    if (!sayOpened() || !sayWrap) return;
    var t = ev.target;
    if (t && typeof t.closest === "function" && t.closest("#rhSayWrap")) return;
    closeSay(true);
  }

  function buildSayUI() {
    if (sayWrap || dead || !document.body) return;
    sayWrap = document.createElement("div");
    sayWrap.id = "rhSayWrap";
    sayWrap.hidden = !hasCats(sceneNow);          /* 说话钮跟着猫走：花园和小窝都有，花房没有 */
    sayWrap.innerHTML =
      '<div id="rhSayBar" hidden>' +
        '<input id="rhSayInput" type="text" maxlength="60" autocomplete="off" autocorrect="off" ' +
          'autocapitalize="off" spellcheck="false" enterkeyhint="send" ' +
          'aria-label="跟白猫说一句话，最多 30 字" placeholder="说点什么…">' +
        '<span id="rhSayCount" hidden aria-hidden="true"></span>' +
        '<button id="rhSaySend" type="button" aria-label="说出去">' + SVG_SEND + '</button>' +
      '</div>' +
      '<button id="rhSayBtn" type="button" aria-expanded="false" aria-label="跟白猫说句话">' +
        SVG_BUBBLE + '<span class="rh-say-lab" aria-hidden="true">说话</span></button>';
    document.body.appendChild(sayWrap);

    sayBar = sayWrap.querySelector("#rhSayBar");
    sayInput = sayWrap.querySelector("#rhSayInput");
    sayCount = sayWrap.querySelector("#rhSayCount");
    sayBtn = sayWrap.querySelector("#rhSayBtn");
    saySend = sayWrap.querySelector("#rhSaySend");

    sayBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (sayOpened()) closeSay(true); else openSay();
    });
    saySend.addEventListener("click", function (e) { e.stopPropagation(); sendSay(); });
    sayInput.addEventListener("input", paintCount);
    sayInput.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); closeSay(true); return; }
      if (e.key !== "Enter") return;
      /* 中文输入法选词的那一下回车 keyCode 是 229，不是发送 */
      if (e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      sendSay();
    });
    sayInput.addEventListener("focus", fitKeyboard);
    sayInput.addEventListener("blur", function () { if (sayWrap) sayWrap.style.transform = ""; });
    document.addEventListener("pointerdown", onDocDown, true);
    try {
      if (window.visualViewport) {
        window.visualViewport.addEventListener("resize", fitKeyboard);
        window.visualViewport.addEventListener("scroll", fitKeyboard);
      }
    } catch (_) { }
  }

  function removeSayUI() {
    try { document.removeEventListener("pointerdown", onDocDown, true); } catch (_) { }
    try {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", fitKeyboard);
        window.visualViewport.removeEventListener("scroll", fitKeyboard);
      }
    } catch (_) { }
    if (sayShutT) { clearTimeout(sayShutT); sayShutT = 0; }
    try { if (sayWrap && sayWrap.parentNode) sayWrap.parentNode.removeChild(sayWrap); } catch (_) { }
    sayWrap = sayBar = sayInput = sayCount = sayBtn = saySend = null;
  }

  /* ═════════════════════ 7. （已撤）═════════════════════
     nocredit20260915：角色改为本项目重绘的小白小黑，原来往「关于这座小花园」面板里补的
     那行第三方署名、以及跟着 #rhCatLayer 走的那行兜底 HTML 注释，一起撤掉。
     段号留着不重排，免得别处的行号引用全废。 */

  /* ═════════════════════ 8. 上岗 ═════════════════════ */

  function mount() {
    if (mounted || dead) return;
    world = document.getElementById("world");
    if (!world) return;
    mounted = true;

    style = document.createElement("style");
    style.id = "rhCatStyle";
    style.textContent = CSS;
    document.head.appendChild(style);

    layer = document.createElement("div");
    layer.id = "rhCatLayer";
    turf = TURF[sceneNow] || TURF.garden;          /* cathome20260913：?scene=cathome 直接开在小窝 */
    layer.hidden = !hasCats(sceneNow);             /* 直接开在花房（?scene=greenhouse）时先藏着 */
    /* 插在 #plots 之前：猫在植株之上、在地块钮/气泡之下 */
    var plots = document.getElementById("plots");
    if (plots && plots.parentNode === world) world.insertBefore(layer, plots);
    else world.appendChild(layer);

    /* fourway20260912：猫换成光栅帧图之后，这条链上只剩 pixi 一支。
       Live2D Cubism Core / cubism4 一概不再加载 —— 缺 Core 也有猫，那条文明降级
       从「整层退场」升级成「压根不需要」。真取不到 pixi 或帧图，才走下面的
       .catch → teardown：猫层自己拆干净，花园/花房/种浇收一律照常。 */
    /* nogo-20260918：先等走路层到货（脚本一加载就发出去了，跟 app.js 铺世界是并行的），
       再挂猫 —— 这样 catwalkInit 用的已经是新禁区表，不会先在老表里摆一下再跳。
       walkMapReady 自己不会 reject：取不到只 console.warn，禁区退回内置表继续跑。 */
    Promise.resolve()
      .then(function () { return walkMapReady; })
      .then(function () { return (window.PIXI && window.PIXI.Application) ? null : loadScript(VEND + "pixi.min.js"); })
      .then(boot)
      .catch(function (e) { teardown(e); });
  }

  function boot() {
    if (dead) return;
    var PIXI = window.PIXI;
    if (!PIXI || !PIXI.Application || !PIXI.Sprite) throw new Error("pixi 没到齐");

    var k = worldScale();
    app = new PIXI.Application({
      width: Math.max(1, world.clientWidth),
      height: Math.max(1, world.clientHeight),
      backgroundAlpha: 0,
      antialias: true,
      autoStart: false,
      autoDensity: true,
      /* 分辨率闸在 2：两只猫合起来的画布内存按最坏情况（桌面 1440×960@2x）约 21MB，
         加八张 2048×256 横条 16MB，离 150MB 的线还远。 */
      resolution: Math.min(window.devicePixelRatio || 1, 2)
    });
    for (var si = 0; si < CATS.length; si++) {
      var sd = document.createElement("i");
      sd.className = "rh-cat-shadow";
      sd.setAttribute("aria-hidden", "true");
      layer.appendChild(sd);                 /* 先插影子，再插 canvas —— 影子永远压在猫身下 */
      shadows.push(sd);
    }
    app.view.setAttribute("aria-hidden", "true");
    layer.appendChild(app.view);

    /* nogo0919-v3：先把 UI 热区按真 DOM 读一遍，再摆猫 —— 起手位要按新表判。
       之后 #plots 一变（种/浇/收/升级土地）自己重读，见 1b-5 段。 */
    readUiFeet();
    watchUiFeet();

    catwalkInit();                 /* 先把两只的起手位置/状态铺好 */

    /* idle20260915：待机图集跟走路横条并行开下，但**不当门槛** —— 两张 2048² 各 0.6MB，
       让它卡着猫上岗不值当。晚到就晚到，到了 TEX 里一有货，下一拍 idleOn 自己接上。 */
    loadIdle();

    /* fourway20260912：先把八张横条切好，再一只一只挂 Sprite。
       图没到齐就不摆猫 —— 宁可整层退场，也不给玩家看半只透明的猫。 */
    return loadStrips().then(function () {
      if (dead) return;
      CATS.forEach(function (cfg, i) {
        var m = new PIXI.Sprite(texOf(cfg.id, "front", 0));
        m.__cfg = cfg;
        /* 锚点 ＝ 帧内脚底挂点 (128,232)，比例 (0.5, 0.90625)。
           摆位那一步 position 直接给脚点，缩放也绕着脚底做 —— 打盹压扁不会让猫浮起来。 */
        m.anchor.set(FW_ANCHOR_X / FW_CELL, FW_ANCHOR_Y / FW_CELL);
        m.interactive = false;
        m.interactiveChildren = false;
        /* walksilk20260918：重影小鬼。换帧那一下旧贴图当子节点淡出没（WALK.FADE ms），
           翻页感变成淡入淡出。挂在主 Sprite 底下，位置/缩放/打盹压扁全自动跟着走。 */
        var ghost = new PIXI.Sprite();
        ghost.anchor.set(FW_ANCHOR_X / FW_CELL, FW_ANCHOR_Y / FW_CELL);
        ghost.renderable = false;
        m.addChild(ghost);
        m.__ghost = ghost; m.__fade = 0;
        app.stage.addChild(m);
        models.push(m);

        var hit = document.createElement("button");
        hit.type = "button";
        hit.className = "rh-cat-hit";
        hit.dataset.cat = cfg.id;
        hit.setAttribute("aria-label", cfg.name + "，摸一摸");
        hit.addEventListener("click", function (e) {
          /* 不冒泡去开地块卡 —— 猫不在任何地块热区上，纯属保险。 */
          e.stopPropagation();
          catwalkPoke(i);            /* 醒着立刻喵，打盹的慢半拍抬头 */
        });
        layer.appendChild(hit);
        hits.push(hit);
      });

      layout();

      /* 驱动：自己踩 ticker（autoStart:false），页面切后台就整层停。
         fourway20260912：这里只剩状态机一件事 —— 换帧在 poseCat 里跟着位置一起做完了，
         Sprite 没有自己的 update 要喂（旧版那圈 models[i].update + 迈腿驱动一起退休）。 */
      app.ticker.add(function () {
        var dt = app.ticker.deltaMS;
        /* 从后台切回来那一拍 deltaMS 会很大，钳住，别让猫瞬移过去 */
        if (!(dt > 0)) dt = 16; else if (dt > 250) dt = 250;
        try { catwalkStep(dt); } catch (_) { }          /* catwalk20260912 */
      });
      if (reduced) { app.render(); }            /* 减动效：只画一帧，猫安安静静趴着 */
      else if (!document.hidden && hasCats(sceneNow)) app.start();

      document.addEventListener("visibilitychange", pace);
      window.addEventListener("resize", layout);
      window.addEventListener("pageshow", pace);
      try {
        if (window.ResizeObserver) { ro = new ResizeObserver(layout); ro.observe(world); }
      } catch (_) { }

      bindTapToWalk();               /* catcontrol20260912：点空地指挥白猫 */
      startBlackPoll();              /* catcontrol20260912：黑猫每 3 秒问一次 AI 的指令 */
      buildSayUI();                  /* playersay20260912：右下角那颗说话钮 —— 猫真上岗了才挂，
                                        走 teardown 的那条路上（pixi/帧图取不到）一颗钮都不留 */

      window.RainholmCats = {
        version: "host-cat-20260913+cathome0913-v1+idle0915-v1+roofguard0915+walktune0917-v2+walksilk0918-v4+nogo0919-v3-groundfill-bedfoot-uidom+userwhite0918",
        mounted: true,
        cats: CATS,
        meow: meow,
        relayout: layout,
        /* 验收探针：ticker 到底在不在转（切后台/进花房/减动效都该是 false） */
        ticking: function () { return !!(app && app.ticker.started); },
        /* catwalk20260912 验收探针：每只猫此刻站在哪、在干嘛 */
        poses: function () {
          return CATS.map(function (c) {
            /* fourway20260912：dir/frame ＝ 此刻在画哪一张，v ＝ 导航给的瞬时地速 */
            return {
              id: c.id, x: c.px, y: c.py, st: c.st, face: c.face, nap: c.napEye, cmd: !!c.cmd,
              dir: c.dir, frame: c.frame, v: c.v || 0,
              /* idle20260915：待机图集到了没、此刻在播哪一格、这一拍画的是不是待机 */
              idleReady: !!TEX[c.id + "/idle"], idle: idleOn(c), iframe: c.iframe | 0
            };
          });
        },
        /* idle20260915 验收探针：把某只猫钉在待机第 n 格（截图要的睁眼/闭眼就靠它定死）。
           钉完它还会接着往下走 —— 要停就先 ticking() 停了再钉，或者截完立刻拍照。 */
        idleSeek: function (id, n) {
          var i = catIndex(id);
          if (i < 0 || !TEX[CATS[i].id + "/idle"]) return false;
          var c = CATS[i];
          c.st = "idle"; c.dir = "front"; c.t = 60000;
          c.iframe = ((n | 0) % IDLE_FRAMES + IDLE_FRAMES) % IDLE_FRAMES; c.iframeT = 0;
          poseCat(i);
          return c.iframe;
        },
        /* catcontrol20260912：代码里指一只猫去哪儿（白猫的点地、黑猫的 AI 指令
           走的都是这一条）。校验没过返回 false。 */
        command: function (id, x, y) {
          var i = catIndex(id);
          return i < 0 ? false : command(i, Number(x), Number(y));
        },
        /* 让某只猫说一句（≤30 字）。AI 的 say 走的也是这条。 */
        say: function (id, text) {
          var i = catIndex(id);
          if (i < 0) return false;
          meow(i, text, CTRL.SAY_MS);
          return true;
        },
        /* 验收探针：立刻去取一次黑猫的 pending，不等那 3 秒 */
        pollBlack: pollBlack,
        /* cathome20260913 验收探针：这会儿在哪个家、用的哪套尺和哪套禁区 */
        turf: function () {
          return {
            scene: sceneNow, mode: turf.mode, catPct: turf.catPct, catW: turf.catW,
            block: (turf.block || []).length,   /* roofguard20260915：脚点多边形禁区块数 */
            catH: WORLD_H * turf.catPct / 100, speed: turf.speed, near: turf.near,
            stride: turf.stride,                /* walktune20260917：一轮步幅（换帧跟它不跟钟） */
            /* nogo-20260918：真机上一眼看出走路层到没到货、这一家用的哪套地面 */
            floor: (turf.floor || []).length,           /* 地面多边形块数，0 ＝ 还在 BOUND 兜底 */
            bound: (turf.bound || []).slice(),
            hard: (turf.hard || []).length,
            hardFeet: (turf.hardFeet || []).length + (turf.hardFeetPoly || []).length, feetH: FEET_H,   /* feetband0918：脚带判的 UI 热区块数（矩形＋畦四边形） */
            collideR: Math.round(collideR() * 10) / 10, /* 碰撞半径（世界像素） */
            ghCats: !!GH_CATS,
            /* nogo0919-v3 验收探针：UI 热区这一版从哪儿来的、读了几回、收了几块。
               from ＝ "dom" 才是读到真钮了；"fallback" ＝ DOM 没读着，退回两颗门牌箭头。 */
            uiFeet: { from: uiFeetState.from, ran: uiFeetState.ran, n: uiFeetState.n, boxes: (turf.hardFeet || []).map(function (b) { return b.map(function (v) { return Math.round(v); }); }) },
            map: {
              url: WALKMAP_URL, tried: mapState.tried, loaded: mapState.loaded,
              err: mapState.err, garden: mapState.garden, greenhouse: mapState.greenhouse
            }
          };
        },
        /* nogo-20260918 验收探针：两只此刻站哪、什么状态、离多远。
           注意名字不能叫 cats —— 上面那个 cats 是公开的 CATS 数组，不许换类型。 */
        catState: function () {
          var out = [], i;
          for (i = 0; i < CATS.length; i++) {
            var c = CATS[i];
            /* userwhite20260918：selfWalk ＝ 这只会不会自己遛弯（白猫 false） */
            out.push({ id: c.id, x: c.px, y: c.py, st: c.st, dir: c.dir, cmd: !!c.cmd, tx: c.tx, ty: c.ty, v: Math.round((c.v || 0) * 10) / 10, turnT: Math.round(c.turnT || 0), turnPivot: c.turnPivot || null, selfWalk: selfWalks(c) });
          }
          if (CATS.length > 1 && CATS[0].px != null && CATS[1].px != null) {
            var dx = CATS[0].px - CATS[1].px, dy = CATS[0].py - CATS[1].py;
            out.dist = Math.round(Math.sqrt(dx * dx + dy * dy) * 10) / 10;
          }
          return { list: out, dist: out.dist, collideR: Math.round(collideR() * 10) / 10 };
        },
        /* nogo-20260918 验收探针：把某个场景的地面/禁区多边形原样倒出来（画标注图用） */
        polys: function (scene) {
          var t = TURF[scene || sceneNow];
          if (!t) return null;
          return { scene: scene || sceneNow, floor: t.floor || [], block: t.block || [], bound: t.bound };
        },
        /* cathome20260913 验收探针：这个脚点站得住吗（禁行区标注图就是照它铺的） */
        spotOk: function (x, y) { return spotOk(Number(x), Number(y)); },
        /* playersay20260912 验收探针：玩家那颗气泡此刻写的什么、挂在哪、跟不跟猫 */
        sayBubble: function () {
          var i = catIndex(PLAYER.CAT), hit = hits[i];
          if (i < 0 || !hit || !hit.__bub) return null;
          return {
            text: hit.__bub.textContent,
            left: parseFloat(hit.__bub.style.left),
            top: parseFloat(hit.__bub.style.top),
            follow: !!hit.__bubFollow,
            catX: CATS[i].px, catY: CATS[i].py, st: CATS[i].st
          };
        },
        /* playersay20260912 验收探针：输入条开着没有 */
        sayOpen: sayOpened,
        /* 验收用：把某只猫直接摆到指定世界坐标（只给截图/造状态用，生产没人调） */
        debugSet: function (id, x, y, st, dir, frame) {
          for (var i = 0; i < CATS.length; i++) {
            if (CATS[i].id !== id) continue;
            var c = CATS[i];
            if (x != null) c.px = x;
            if (y != null) c.py = y;
            if (st) { c.st = st; c.t = st === "nap" ? WALK.NAP_MAX : WALK.IDLE_MAX; }
            if (dir) c.dir = dir;                        /* fourway20260912：截图时摆朝向 */
            if (frame != null) { c.frame = frame | 0; c.frameT = 0; }
            poseCat(i);
            return true;
          }
          return false;
        },
        /* fourway20260912 验收探针：贴图仓库到齐没有、一轮多少帧
           walktune20260917：ms 字段退役（换帧跟步幅不跟钟），改报每家的步幅。 */
        frames: function () {
          var o = { stride: turf.stride, count: FW_FRAMES, dirs: FW_DIRS.slice(), keys: [] };
          for (var k in TEX) if (TEX.hasOwnProperty(k)) o.keys.push(k + ":" + TEX[k].length);
          o.keys.sort();
          return o;
        },
        on: function () { if (layer) { layer.hidden = false; pace(); } },
        off: function () { if (layer) { layer.hidden = true; if (app) app.ticker.stop(); } },
        remove: function () { teardown(null); }
      };
    });
  }

  /* 该不该动：后台 / 不在花园 / 整层藏起来 / 减动效 —— 一律停 ticker */
  function pace() {
    if (!app) return;
    var should = !document.hidden && hasCats(sceneNow) && layer && !layer.hidden && !reduced;
    if (should) { if (!app.ticker.started) app.start(); }
    else if (app.ticker.started) app.ticker.stop();
  }

  /* 场景 cathome20260913：猫有两个家（花园 / 小窝），进花房整层藏起来（省一个 ticker）。
     换家＝换地盘表 + 重新起手（落脚点存在 c.mem 里，见 catwalkInit）。 */
  window.addEventListener("rainholm:garden-scene", function (ev) {
    var next = ev && ev.detail && ev.detail.scene;
    if (!next || next === sceneNow) return;
    var prev = sceneNow;
    sceneNow = next;
    /* playersay20260912：进花房把说话钮一起收走，猫都不在了没人听 */
    if (sayWrap) { sayWrap.hidden = !hasCats(next); if (sayWrap.hidden) closeSay(true); }
    if (!layer) return;
    dropBubbles();                                 /* 上一家的气泡别跟着搬过来 */
    layer.hidden = !hasCats(next);
    if (!layer.hidden) {
      turf = TURF[next];
      if (models.length) catwalkInit(hasCats(prev) ? prev : null);
      layout();
    }
    pace();
  });

  /* 起手场景：从 host-boot 的 initialScene / app.js 的 getScene 问一句 */
  try {
    var host = window.RainholmGarden || {};
    sceneNow = (typeof host.getScene === "function" ? host.getScene() : host.initialScene) || "garden";
  } catch (_) { }

  /* nogo-20260918：走路层这就发请求，不等 #world 铺好 —— 跟 app.js 的启动并行，
     mount 里再 await 它一次。 */
  var walkMapReady = loadWalkMap();

  /* 等 app.js 把世界铺好（#world 有尺寸了）再上岗；ready 事件没赶上就 1.4 秒兜底。 */
  window.addEventListener("rainholm:garden-ready", function () { setTimeout(mount, 0); });
  setTimeout(function () { if (!mounted && !dead) mount(); }, 1400);
})();
