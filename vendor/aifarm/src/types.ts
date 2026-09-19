// 领域模型（农场状态，会被序列化进存档）。
export interface PlantedCrop {
  /** 种子类型：笼统的普通/奇幻，或特定限定 */
  seedType: "common" | "fantasy" | "limited";
  /** 限定种子种下时已知作物 id；普通/奇幻收获才揭晓 */
  limitedId?: string;
  /** 需要长够的 tick 数（普通/奇幻按种子类型，限定按作物） */
  growTicks: number;
  /** 已生长 tick */
  progress: number;
  ripe: boolean;
  /** 累计浇水次数（主人+访客），决定收获 roll 的浇水运气 */
  waterCount: number;
}

export interface Plot {
  id: number;
  crop: PlantedCrop | null;
}

export interface AnimalInst {
  kindId: string;
  ticksSinceProduce: number;
  pending: number;
  /** 伴侣在人类前端给起的独特名字（缺省回落种类名，如"鸡"）*/
  name?: string;
  /** 等级（每种只养 1 只，靠升级提产出；每级每周期多产 1 份。缺省=1）*/
  level?: number;
  /** 伴侣给这只买的衣服/配饰（accessory id 列表；改写 AI 开场看到的动物描述）*/
  acc?: string[];
}

/** 宠物：AI 买、归伴侣养（和动物一样进牧场、能穿衣服），但不产出、可被伴侣改名，且给农场一份温和 buff。 */
export interface PetInst {
  kindId: string;
  /** 伴侣在人类前端给起的独特名字（缺省回落种类名，如"小猫"）*/
  name?: string;
  /** 伴侣给这只买的衣服/配饰（accessory id 列表；和动物共用机制，改写 roam 描述）*/
  acc?: string[];
}

/** 人类牧场（伴侣经营；AI 看不到内部，只通过 ledger 看金币往来 + 药水入库）。 */
export interface Ranch {
  /** 牧场钱包：卖产品赚的金币，伴侣自己决定要不要回传给 AI */
  coins: number;
  /** 伴侣在养的动物（AI 买了送进来的）*/
  animals: AnimalInst[];
  /** 伴侣在养的宠物（AI 买了送进来的；不产出，给农场 buff，伴侣可改名/穿衣）*/
  pets?: PetInst[];
  /** 伴侣 pin 选的动物/宠物 kindId 列表：非空时，农场氛围句只从被 pin 的里随机出现（只 pin 一只=固定只出现它）；空=维持原样全部随机 */
  pinned?: string[];
  /** 已摆出展示的农场装饰物（decoration id 列表；别人 visit 时展示）。买/秘境掉落先进 decorStore，「摆上」才进这里 */
  decor?: string[];
  /** 仓库：已买/已捡、但还没摆出来的装饰（decoration id 列表）*/
  decorStore?: string[];
  /** 仓库：已买、但还没给动物/宠物穿戴的配饰（accessory id 列表，可重复=拥有多件）*/
  wardrobe?: string[];
  /** 牧场商店：每天随机刷新的可买配饰/装饰（各 2 个，按 UTC+8 日序号刷新）*/
  shop?: { day: number; acc: string[]; decor: string[] };
  /** 收获掉药水入 AI 仓库的当日计数（封顶防刷；day=UTC+8 日序号）*/
  potionDrop?: { day: number; n: number };
}

/** 机⇄人往来流水的一条（AI 唯一能看到的牧场信息）。 */
export interface LedgerEntry {
  at: number;
  /** buy-animal=AI 买动物送人 / buy-pet=AI 买宠物送人 / remit=人回传金币 / potion=人收获掉药水入库 */
  type: "buy-animal" | "buy-pet" | "remit" | "potion";
  /** 金币数（buy-animal/buy-pet/remit）或瓶数（potion）*/
  amount: number;
  note: string;
}

/** 图鉴一条：收集次数 + 最佳品相档 + 首次收录时间（解锁日期；旧存档可能没有）*/
export interface CodexEntry {
  count: number;
  bestQuality: number;
  firstAt?: number;
}

/** 随机任务槽：农场主页随机刷新一条，接取后才计数，完成自动发奖，冷却后刷新下一条。 */
export interface TaskSlot {
  /** 第几条 offer（递增；做确定性随机选择 + 完成后换新）*/
  seq: number;
  /** 任务类型 id（见 tasks.TASK_POOL）*/
  kind: string;
  /** 需要完成的次数 */
  target: number;
  /** 已完成次数（接取后才累加）*/
  progress: number;
  /** 奖励数额 */
  reward: number;
  /** 奖励货币：金币 / 银币 */
  currency: "coin" | "silver";
  /** 是否已接取（接取后才计数）*/
  accepted: boolean;
  /** 这条 offer 出现的时间（未接取超时换新用）*/
  offeredAt: number;
  /** 完成时间（进入冷却，到点刷下一条）*/
  completedAt?: number;
  /** 「任务完成」庆祝行是否已展示过（只展示一次，之后冷却期只显示「约 xx 分钟后刷新」）*/
  completedShown?: boolean;
  /** 串门类任务：已串过的农场 id（按家去重，防刷同一家）*/
  visited?: string[];
}

export interface Farm {
  id: string;
  /** 农场名（地方名，不是昵称）*/
  name: string;
  /** AI 自己的昵称（建农场时注册；原创作物署名、人类前端称呼都用它。缺省回落农场名）*/
  aiName?: string;
  /** 人类伴侣的昵称（建农场时注册；回传消息署名用它。缺省回落"伴侣"）*/
  humanName?: string;
  /** AI 收件箱：伴侣回传金币等会留一条，AI 下次打开农场(status)时看到并清空 */
  inbox?: { at: number; text: string }[];
  /** 累计收获作物数（勤劳榜）*/
  harvested?: number;
  /** 累计帮别人浇水次数（热心榜；只算帮别家、不算浇自己的）*/
  watered?: number;
  /** 累计偷菜得手次数（大盗榜）*/
  stolen?: number;
  /** 称号系统：已解锁的称号 id 列表（达成阈值自动补登，见 titles.ts/checkTitles）。 */
  titles?: string[];
  /** 当前佩戴的称号 id（必须在 titles 里；展示为串门页/排行榜的名字前缀）。 */
  titleEquipped?: string;
  /** 累计熔炼次数（匠人称号）*/
  crafted?: number;
  /** 累计设计原创作物数（创作称号）*/
  designCount?: number;
  /** 累计进入秘境探险趟数（探险称号）*/
  expRuns?: number;
  /** 累计被偷次数（倒霉称号）*/
  gotStolen?: number;
  /** 累计完成随机任务数（任务称号）*/
  tasksDone?: number;
  /** 串过门的不同农场 id（去重；串门称号按 length 计）*/
  visitedIds?: string[];
  coins: number;
  /** 银币：只在玩家市场流通（卖素材/种子赚，买素材/种子花）*/
  silver: number;
  landTier: number;
  plots: Plot[];
  /** 人类牧场（人机互动 2.0；AI 买动物送进来，伴侣养、卖、回传。AI 接口不暴露其内部）*/
  ranch?: Ranch;
  /** 机⇄人往来流水（AI 唯一能看到的牧场信息：买动物支出 / 人回传 / 药水入库）*/
  ledger?: LedgerEntry[];
  /** 确定性随机状态 */
  rngState: number;
  /** 图鉴：cropId → 记录 */
  codex: Record<string, CodexEntry>;
  /** 图鉴星标：伴侣在前端图鉴页收藏喜欢的作物 id（含官方/原创/自创；额外汇总到「我的收藏」栏，插入顺序=收藏顺序）*/
  starred?: string[];
  /** 素材库：素材 id → 数量（收获掉落，攒来熔炼）*/
  materials: Record<string, number>;
  /** 限定种子库存：限定作物 id → 数量（熔炼产出，可种）*/
  seeds: Record<string, number>;
  /** 第一层商店状态：上次刷新时间 + 当前上架的配方(output id 或 null) + 随机刷出的药水套装(null=没刷出) */
  shop: { refreshAt: number; recipe: string | null; potionSet?: { price: number; qty: number; buyers: string[] } | null;
    /** 仅常驻 NPC 阿土用：当前随机刷出的限定种子（金币结算，按官方 seedPrice；null=没刷出）*/
    npcSeed?: { id: string; price: number } | null };
  /** 官方店当日买药水计数（防超过每日上限；day=UTC+8 日序号）*/
  potionBuy?: { day: number; n: number };
  /** 当日已从市场买过的限定种子（每种每天限购 1 颗；day=UTC+8 日序号，ids=今天买过的限定作物 id）*/
  limitedSeedBuys?: { day: number; ids: string[] };
  /** 当日靠帮别人浇水掉到的药水计数（每天封顶；day=UTC+8 日序号）*/
  waterReward?: { day: number; n: number };
  /** 今天已帮本农场浇过水的访客：浇水者农场id → 浇水当天日序号（每家每天 1 次，防互刷）*/
  waterVisits?: Record<string, number>;
  /** 已提示过"上架商店"的动物/宠物 id（首次解锁播一次提示；老存档首次访问时按当前已解锁静默播种，不补发）*/
  announcedUnlocks?: string[];
  /** 已学会的隐藏配方（output 作物 id 列表）*/
  knownRecipes: string[];
  /** 玩家市场摊位：上架待售的素材 / 限定种子（2.0 跨农场交易）*/
  market: { kind: "material" | "seed"; id: string; qty: number; price: number }[];
  /** 背包：道具 id → 数量（如 speed_potion 加速药水）*/
  items: Record<string, number>;
  /** 旧版偷菜冷却：小偷标识 → 上次偷本农场的时间戳（保留兼容老存档） */
  stealCooldowns: Record<string, number>;
  /** 本农场作为小偷的偷菜频率：day=UTC+8 日序号，n=当天已偷次数，lastAt=上次偷菜时间戳 */
  stealQuota?: { day: number; n: number; lastAt?: number };
  /** 放偷冷却：本农场被偷一次后，此时间戳前不能再被任何人偷（缺省=没有保护） */
  stealShieldUntil?: number;
  /** 当前随机任务槽（农场主页随机刷新；缺省=还没 roll 过）*/
  task?: TaskSlot;
  /** 随机任务每日接取计数（day=UTC+8 日序号，taken=今天已接取数；上限 TASK_DAILY_CAP）*/
  taskDaily?: { day: number; taken: number };
  /** 每日榜单计数（跨日归零；day=UTC+8 日序号）：logins=开自己农场主页次数、tasks=完成随机任务数、messages=给别人留言数、events=触发季节随机事件数。见 daily.ts */
  daily?: { day: number; logins: number; tasks: number; messages: number; events: number };
  /** 上次触发季节随机事件的时间戳（冷却用；缺省=从没触发过）*/
  seasonEventAt?: number;
  /** 私密 token：建农场时生成并返回一次，之后所有写操作 / 以本农场身份的动作都要带它鉴权 */
  token: string;
  /** 人类前端专用钥匙：只够「看农场 + 经营人类牧场 + 改昵称」，不能当 API token 用（不能种地/偷菜/卖货）。
   *  可安全展示给 AI 让其转发给伴侣；/ui 页面认它，且页面内部链接只用它、绝不暴露主 token。*/
  humanKey?: string;
  /** 伴侣是否已打开过人类前端（任意 /ui 访问即置 true）。*/
  humanFrontendSeen?: boolean;
  /** Agent 页是否已经展示过「把伴侣前端发给人类」的新手横幅；只展示一次。 */
  agentOnboardSeen?: boolean;
  /** Agent 控制页的 playKey（开通后才有；页面用它代替 token 操作本农场，可撤销）*/
  agentKey?: string;
  /** 主人自设的串门欢迎语（visit 展示；没设用默认句）*/
  welcome?: string;
  /** 留言板：访客留下的最近若干条（环形，最多 MESSAGES_MAX 条）*/
  messages: { id: string; by: string; name: string; text: string; at: number }[];
  /** 留言板开关（主人可关；缺省/true=开，false=关）*/
  guestbook?: boolean;
  /** 双向社交开关（缺省全开；只有显式 false=关闭）。关某项=别人不能对我做 + 我也不能对别人做。
   *  visit=来访总闸（关=别人搜不到我/不能访问我，我也不能出门逛，且偷菜/浇水/留言一并封闭）；
   *  steal=偷菜、water=帮浇水、message=留言（访问开着时各自独立双向）。*/
  social?: { visit?: boolean; steal?: boolean; water?: boolean; message?: boolean };
  /** 被主人拉黑、不能留言的农场 id 列表 */
  blocked?: string[];
  /** 进行中的探险（缺省/null=没在探险）。详见 Expedition。 */
  expedition?: Expedition | null;
  /** 探险节奏：当日趟数 + 上次出门时间（趟间冷却 1 小时、日上限）。day=UTC+8 日序号。 */
  expDaily?: { day: number; n: number; lastAt?: number };
  /** 探险见闻录：已解锁（遇到过）的际遇事件 id 集，跨趟累积；秘境图鉴用。 */
  expCodex?: string[];
  /** 旅程簿：过往每趟探险的小结归档。 */
  expJourneys?: ExpJourney[];
  /** 出门前祈福预存：伴侣在没出门时设好的护身符+祝福语，下次进秘境时焊进这趟。 */
  expCharm?: ExpCharm | null;
  /** 默契度：AI 与伴侣并肩闯秘境攒下的羁绊；每赢一场战斗 +1，封顶 100。缺省=0。 */
  expConcord?: number;
  lastTickAt: number;
  createdAt: number;
  log: string[];
  /** 足迹：别人对本农场做的社交动作历史（帮浇水 / 偷菜得手 / 被看家狗吓退），人类前端展示，最新在前 */
  trail?: { t: number; kind: "watered" | "stolen" | "foiled"; by: string; plotId?: number; crop?: string }[];
}

// ——————————————————————————————————————————————————————————————
// 🗺️ 探险（Expedition）
// ——————————————————————————————————————————————————————————————
export type ExpEventType = "story" | "drop" | "choice" | "encounter" | "combat";
export type ExpLayer = "shallow" | "deep" | "finale";
export type ExpDifficulty = "easy" | "mid" | "hard";

/** 一份掉落 / 行囊里的一项。金币/银币/药水用 n 计数；装饰用 id。 */
export interface ExpDrop { t: "coins" | "silver" | "potion" | "decor"; n?: number; id?: string }

/** 选项后果（分支/奇遇）。 */
export type ExpOutcome =
  | { t: "coins" | "silver" | "potion"; n: number; text?: string }
  | { t: "decor"; id: string; text?: string }
  | { t: "status"; n: number; text?: string }
  | { t: "buff"; mod: number; text?: string }
  | { t: "jump"; to: string; text?: string }
  | { t: "combat"; foe: string; difficulty: ExpDifficulty; text?: string }
  | { t: "none"; text?: string };

export interface ExpOption { key: string; label: string; outcomes: ExpOutcome[] }
export interface ExpCombatResult { text: string; drops?: ExpDrop[]; critDrops?: ExpDrop[] }

/** 内容定义：一个际遇事件。 */
export interface ExpEvent {
  id: string; map: string; title: string; type: ExpEventType; layer: ExpLayer; weight: number;
  story: string; hint?: string;
  drops?: ExpDrop[];
  options?: ExpOption[];
  foe?: string; difficulty?: ExpDifficulty; record?: string;
  win?: ExpCombatResult; lose?: { text: string };
}

/** 内容定义：一个秘境（地图）。 */
export interface ExpMap {
  id: string; name: string; theme: string; intro: string;
  unlock?: unknown; events: string[]; finale?: string;
}

/** 内容定义：探险专属装饰（探险授予，不进可买商店）。 */
export interface ExpDecoration { id: string; name: string; from: string; visitLine: string }

/** 际遇日志一条（故事书）。 */
export interface ExpRunLogEntry { eventId: string; title: string; text: string }

/** 出门前祈福：护身符（二选一，消耗后 kind 清空）+ 可选祝福语。 */
export interface ExpCharm { kind?: "check" | "hp"; blessing?: string }

/** 进行中的探险（挂在 Farm 上，持久化、可 resume）。 */
export interface Expedition {
  mapId: string;
  status: "exploring" | "awaiting-choice" | "awaiting-roll" | "finished";
  /** 已推进到第几格 */
  step: number;
  /** ❤ 状态（归零=被迫收工） */
  hp: number;
  /** 🎒 行囊（撤退/通关时统一入库） */
  bag: ExpDrop[];
  /** 际遇日志（故事书） */
  log: ExpRunLogEntry[];
  /** 本趟剩余事件 id（queue[0]=当前停留处） */
  queue: string[];
  /** 当前挂起的决策（选项 / 战斗），null=没挂起。
   *  inline=由选项后果 {t:"combat"} 临时引爆的战斗（没有对应内容事件，foe/难度/胜负文案就地带着）。 */
  pending?: { type: "choice" | "combat"; eventId: string; inline?: { foe: string; difficulty?: ExpDifficulty; record?: string; win?: ExpCombatResult; lose?: { text: string } } } | null;
  /** 护身符 + 祝福语 */
  charm?: ExpCharm | null;
  /** 祝福语是否已在途中"回响"过一次（避免重复） */
  charmEchoed?: boolean;
  /** 临时检定加成（buff 累计，用一次清零） */
  buffMod: number;
  startedAt: number;
}

/** 旅程簿一条。 */
export interface ExpJourney {
  mapId: string; mapName: string; at: number; summary: string;
  log: ExpRunLogEntry[]; blessing?: string;
}
