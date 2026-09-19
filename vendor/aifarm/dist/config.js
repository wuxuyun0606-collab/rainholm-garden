// v1 可调参数集中地。改手感先来这里。
export const TZ = "Asia/Shanghai"; // 时辰类机制判定用的时区
// 本实例对外的公开根地址（用于生成分享链接/提示文字里的绝对 URL）。
// 通过环境变量 PUBLIC_BASE_URL 覆盖，例如 https://your-domain.example。缺省用本地地址。
export const BASE = (process.env.PUBLIC_BASE_URL ?? "http://localhost:8080").replace(/\/+$/, "");
// 注册总闸：默认开放；设 REGISTRATION_OPEN=0 即关闭建新农场（用于"正式服尚未开放"阶段）。
export const REGISTRATION_OPEN = (process.env.REGISTRATION_OPEN ?? "1") !== "0";
export const REGISTRATION_CLOSED_TEXT = "🚧 正式服尚未开放注册，敬请期待～";
// 限量注册闸（测试服灰度用）：设 REGISTRATION_CAP=10 → 真实玩家农场（不含常驻 NPC）满 10 个就自动关闭注册；默认 0 = 不限量（正式服不受影响）。
export const REGISTRATION_CAP = Math.max(0, Math.trunc(Number(process.env.REGISTRATION_CAP ?? "0")) || 0);
export const REGISTRATION_FULL_TEXT = "🈵 内测名额已满（限量开放），感谢关注～后续开放请留意通知。";
// 搬迁期提示（仅测试服开 MIGRATION_NOTICE=1）：提醒老玩家用原链接进、别重新建号。
export const SHOW_MIGRATION_NOTICE = process.env.MIGRATION_NOTICE === "1";
export const MIGRATION_NOTICE_TEXT = "⚠️ 已有账号的玩家——用你原来的 /a/<钥匙> 或 /ui/<钥匙> 链接打开（换 test. 前缀），那就是你原来的号；不要再走建农场流程。";
export const MIGRATION_NOTICE_HTML = '<div style="background:#fff3cd;border:1px solid #f0c36d;color:#7a5b00;padding:10px 14px;margin:0 0 14px;border-radius:8px;font-weight:600">⚠️ 已有账号的玩家——用你原来的 /a/&lt;钥匙&gt; 或 /ui/&lt;钥匙&gt; 链接打开（换 test. 前缀），那就是你原来的号；不要再走建农场流程。</div>';
// —— 节奏 ——
export const TICK_MS = 30 * 60 * 1000; // 1 tick = 30 分钟（挂机式）
// 笼统种子的生长时长（收获才揭晓，所以生长时间按种子类型固定）
export const GROW_TICKS = { common: 6, fantasy: 12 }; // 3h / 6h
// 限定作物用作物自带 growTicks。
export const SEASON_LENGTH_TICKS = 108; // 每个游戏季约 2.25 真实天（108×30min）——加速季节限定普通的收集长尾
// —— 开局 ——
export const STARTING_COINS = 200;
export const STARTER_POTIONS = 6; // 新农场赠送的加速药水（够开局两轮，缓解早期等待）
// —— 道具（最小消耗品系统，将来可扩展）——
export const ITEMS = {
    speed_potion: { name: "加速药水", price: 50, desc: "浇下去，作物像被催熟般立刻成熟，省去等待。" },
};
// 加速药水稀缺化（防"无限催熟、停不下来"）：官方店每天每农场限购 + 随机刷新的套装 + 浇水/收获掉落。
export const POTION_DAILY_CAP = 6; // 官方店每天每农场最多按瓶买几瓶
// 达到当日购买上限时的诗意提示（买光/静态提示共用，别只冷冰冰报"不能买"）
export const POTION_CAP_LINE = "";
export const POTION_SET_QTY = 6; // 随机刷新的「药水套装」含几瓶
export const POTION_SET_PRICE = 250; // 套装价（略低于 6×50=300；每份限购 1）
export const POTION_SET_CHANCE = 0.08; // 商店每次刷新时上架药水套装的概率（罕见，看缘分）
// 防互刷：同一访客对同一农场每天只能帮浇 1 次（每家每天天然最多掉 1 瓶；逻辑在 engine.visitorWater）。
export const WATER_REWARD_DAILY_CAP = 10; // 浇水掉的药水每个浇水者每天最多几瓶（跨所有农场的总上限）
export const STEAL_COOLDOWN_MS = 60 * 60 * 1000; // 偷菜后 1 小时冷却
export const STEAL_DAILY_CAP = 3; // 每个农场每天最多偷菜 3 次
export const STEAL_SHIELD_MS = 30 * 60 * 1000; // 一家被偷一次后 30 分钟内不能再被任何人偷（放偷冷却）
// 收获时小概率直接拾到一瓶加速药水（副产品，随机掉落）
export const POTION_DROP_CHANCE = 0.05;
// —— 牧场（人机互动 2.0：AI 图鉴解锁动物→买给伴侣→伴侣养/卖/回传）——
export const RANCH_POTION_DROP_CHANCE = 0.18; // 伴侣收获产品时，掉一瓶加速药水直接入 AI 仓库的概率
export const RANCH_POTION_DAILY_CAP = 8; // 牧场掉药水每天封顶（防伴侣狂收刷药水）
export const LEDGER_MAX = 30; // 机⇄人往来流水保留条数
// 每种动物只养 1 只，靠升级提产出。升级【不增加份数】(永远1份/周期)，只【提高每份收入】=线性涨、不成倍爆。
export const RANCH_ANIMAL_MAX_LEVEL = 5; // 动物最高等级
export const RANCH_LEVEL_INCOME_STEP = 0.25; // 每升一级，每份收入 +此比例×基础价（lv1=1.0×…lv5=2.0×；线性，非×5）
export const RANCH_UPGRADE_COST_FACTOR = 0.45; // 升级花费系数：升到下一级花 buyCost ×(当前等级+1)× 此值
// 宠物（AI 买、归伴侣养、不产出、给农场温和 buff；解锁/价格/buff 数值都在 content/pets.json 调）
export const PET_NAME_MAX = 12; // 伴侣给宠物起名的最长字数
// —— 种子价 ——
export const SEED_PRICE = { common: 8, fantasy: 40 };
// —— 抽卡 ——
// 各稀有度基础权重（越稀有越低）
export const RARITY_WEIGHT = { N: 100, R: 35, SR: 10, SSR: 2.5, SP: 0.4 };
export const RARITY_ORDER = ["N", "R", "SR", "SSR", "SP"];
export const rarityIndex = (r) => Math.max(0, RARITY_ORDER.indexOf(r));
// 土地品阶的“运气”加成（roll 时把权重往高稀有抬）。顶阶=4阶（已砍5阶），4阶给满 1.5 补回稀有概率手感。
export const LAND_LUCK = { 1: 0.15, 2: 0.45, 3: 0.9, 4: 1.5 };
// —— 浇水运气 ——
export const WATER_LUCK_PER = 0.05; // 每浇一次 +0.05
export const WATER_LUCK_CAP = 0.3; // 封顶 +0.3（主人+访客共用）
// —— 土地升级门槛（按目标品阶）——
// 核心牵制：升级要求「集齐 N 种普通作物图鉴」，让普通作物始终有用。
// commonCodex/fantasyCodex = 需集齐的不同普通/奇幻作物数量；codexPct = 总收集度%。
// 升级费用很高——这是主线目标，要长期攒。coins 是关键调参，按实测收入再平衡。
// 顶阶=4阶（已砍5阶：原5阶要40种普通但其中2种锁tier5=先有鸡先有蛋死锁）。费用按30天全收集目标下调。
export const LAND_UPGRADE_REQ = {
    2: { coins: 3500, commonCodex: 6, fantasyCodex: 0, codexPct: 0 },
    3: { coins: 20000, commonCodex: 14, fantasyCodex: 3, codexPct: 0 },
    4: { coins: 90000, commonCodex: 24, fantasyCodex: 10, codexPct: 0 },
};
// —— 金钱来源：新图鉴奖励（收获到新物种额外给钱，越稀有越多）——
export const NEW_CODEX_REWARD = { N: 30, R: 80, SR: 250, SSR: 800, SP: 2500 };
// —— 收获奖励事件（大丰收/拾遗/连锁… 日常小惊喜）——
export const HARVEST_EVENT_CHANCE = 0.15; // 收获时触发奖励事件的概率
// —— 素材掉落（收获副产物，攒来熔炼限定种子）——
export const MATERIAL_DROP_CHANCE = 0.22; // 每次收获掉素材的概率（够攒得起，稀有料也现实；调高以喂熔炼）
// 掉落按稀有度加权（已拉平：稀有料更易掉，配方更可达）：普通常掉，神话仍是终极追求
export const MATERIAL_DROP_WEIGHT = { N: 100, R: 55, SR: 28, SSR: 12, SP: 3 };
// —— 熔炼（投素材 → 出限定种子）——
export const CRAFT_COUNT = 3; // 一次熔炼投入的素材数
// 素材稀有度 → 熔炼点数（点数越高，越容易熔出稀有限定）
export const FUSION_POINTS = { N: 1, R: 3, SR: 8, SSR: 20, SP: 50 };
// 限定作物各稀有度的基础权重（熔炼随机产出用；点数高会往高稀有抬）
export const LIMITED_BASE_WEIGHT = { SR: 100, SSR: 25, SP: 3 };
export const FUSION_LUCK_DIVISOR = 30; // luck = 总点数 / 此值，越大越难出稀有
// 软保底：随机熔炼时，本农场「还没集齐」的限定权重 ×此值（留 RNG、SP 仍要追；不用硬去重=必出，因为限定种子还能去别人市场买）
export const FUSION_SOFT_PITY = 4;
// 节日/特殊限定（原本不进熔炼池）一旦本农场集齐过，以极低权重涓流进熔炼池：权重 = 普通熔炼池总权重 × 此率（≈1% 概率/个）
export const FUSION_SPECIAL_UNLOCKED_RATE = 0.01;
// —— 玩家市场（第二层）用银币结算；素材参考价（按稀有度）——
// 限定种子参考价 = 作物自身售价（每种不同，见 game.refPrice）。
export const MATERIAL_REF_PRICE = { N: 10, R: 30, SR: 80, SSR: 250, SP: 800 };
export const MARKET_FEE = 0.1; // 玩家市场成交手续费（卖家少拿这一比例，银币 sink）
// 限定种子市场参考价 = 成品售价 × 此折扣（种子比成品便宜留种植利润，3折与普通27%/奇幻34%对齐；
// 限定的"贵"靠精品成品价撑起来=种子绝对值自然高，不靠抬折扣）。
export const LIMITED_SEED_REF_DISCOUNT = 0.3;
// —— 商店第一层（官方）：刷新 + 小概率上架配方 ——
export const SHOP_REFRESH_MS = 4 * 60 * 60 * 1000; // 每 4 小时刷新一次
export const SHOP_RECIPE_CHANCE = 0.25; // 刷新时上架一张隐藏配方的概率
export const RECIPE_PRICE = 500; // 买配方（学会一个隐藏配方）的价格
// —— 永久 NPC「杂货郎阿土」：一座常驻农场，没人串门时的默认去处 ——
export const NPC_ID = "npc_atu";
export const NPC_NAME = "杂货郎阿土";
export const NPC_LIMITED_SEED_CHANCE = 0.05; // 阿土摊位每次刷新上架一颗限定种子的概率（极小，看缘分）
// —— UGC 自创作物 ——
// 自创作物不套用 N/R/SR/SSR/SP，也不按稀有度分价：统一标签 OR、统一价格——重在创意而非稀有度。
export const UGC_RARITY = "OR"; // 自创统一标签（原创 Original，独立稀有度，不参与抽卡/熔炼权重）
export const UGC_DESIGN_FEE = 200; // 设计费（统一，金币 sink + 防刷；门槛低，开局即可创作）
export const UGC_SEED_YIELD = 5; // 设计成功送几颗自己作物的种子
export const UGC_VALUE = 20; // 自创种子市场参考价（统一银币价值）
export const UGC_HARVEST_VALUE = 8; // 自创作物收获金币（象征性——自创不作金钱来源，重在收集图鉴/分享）
export const UGC_GROW_TICKS = 2; // 自创作物生长时长（统一，2 tick = 1 小时，长得快方便自创把玩）
export const UGC_NAME_MAX = 12;
export const UGC_DESC_MAX = 60;
export const UGC_PLANT_MAX = 60; // 自定义「播种文案」上限（种下时展示，没填回落通用句池）
export const UGC_HARVEST_MAX = 80; // 自定义「收获文案」上限（收获仪式里展示，存进 crop.lore）
export const REPORT_THRESHOLD = 3; // 自创作物被举报达此次数 → 自动下架（隐藏+禁止交易）
// —— 随机任务（农场主页随机刷新一条，接取后完成得金/银币）——
// 任务类型/奖励数值/权重在 tasks.ts 的 TASK_POOL 里调；这里只放节奏类钳制。
export const TASK_DAILY_CAP = 10; // 每天最多接取的任务数（按 UTC+8 日）
export const TASK_COOLDOWN_MS = 30 * 60 * 1000; // 完成一条后冷却多久，才刷新下一条
export const TASK_OFFER_TTL_MS = 30 * 60 * 1000; // 没接取的任务挂多久，自动换一条（不消耗每日额度）
// —— 季节随机事件（进农场/收获时按概率触发一个瞬发增益/减益）——
// 事件类型/数值/文案/触发条件都在 content/season-events.json；机制在 season-events.ts。
export const SEASON_EVENT_CHANCE = 0.1; // 每次「进农场」或「收获」触发季节事件的概率
export const SEASON_EVENT_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 任一季节事件触发后的冷却（保证稀罕，收获/状态共用）
// —— 偷菜 ——
// 频率限制：每次偷菜后 1 小时冷却；每个小偷每天最多 3 次（按 UTC+8 日）。被偷方返还种子费 50%。
// 放偷冷却：一家被偷一次后，30 分钟内不能再被任何人偷（STEAL_SHIELD_MS，护住被偷方）。
// 原创作物（ugc）受保护：禁止偷，只能去集市买种子自己种（enforced in engine.steal via isUgcCrop）。
// —— 品相（尺寸 → 价格系数）作为兜底；优先用 content/qualities.json ——
export const RECORD_CHANCE = 0.03; // 顶档(纪录级)额外概率
// —— 日志 ——
export const MAX_LOG = 30;
export const TRAIL_MAX = 30; // 足迹（帮浇水 / 被偷 / 被狗吓退）最多保留几条
// —— 公网防滥用上限（开放无鉴权，必须设硬上限，开源后别人跑也带这层防护）——
export const MAX_BODY_BYTES = 16 * 1024; // 单请求体上限 16KB（防超大 body 撑内存）
export const RATE_WINDOW_MS = 10_000; // 通用限流窗口
export const RATE_MAX_PER_WINDOW = 60; // 每 IP 每窗口最多请求数（≈6 req/s）
export const RATE_CREATE_WINDOW_MS = 3600_000; // 建农场限流窗口（1 小时）
export const RATE_CREATE_PER_WINDOW = 20; // 每 IP 每小时最多建农场数
export const MAX_FARMS = 2000; // 全服农场总数上限
export const MAX_UGC = 3000; // 全服自创作物总数上限
// —— 留言板 / 欢迎语 ——
export const MESSAGES_MAX = 10; // 每农场留言板保留/展示最多条数
export const MESSAGE_TEXT_MAX = 100; // 单条留言最长字数
export const WELCOME_MAX = 60; // 串门欢迎语最长字数
// —— 🗺️ 探险 ——
export const EXP_DAILY_CAP = 3; // 每天的探险「次数」池（主闸；1 次数=3 段际遇；3 次/天 → 每天最多 9 段）
export const EXP_EVENTS_PER_CHARGE = 3; // 1 次数触发几段际遇
export const EXP_MAX_CHARGES_PER_ENTRY = 3; // 单次最多一口气花几次数（=同一秘境里连触发 3×N 段，深挖一个）
export const EXP_START_HP = 3; // 每次进入秘境的初始 ❤ 状态（每次重置）
export const EXP_DC = { easy: 6, mid: 8, hard: 9 }; // 难度档→2d6 目标
export const EXP_BLESSING_MAX = 40; // 祝福语最长字数
//# sourceMappingURL=config.js.map