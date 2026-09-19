// 🗺️ 探险引擎：进入随机秘境 → 批量播到决策点 → 选项/战斗(2d6) → 深入/撤退 → 结算入库。
// 状态机挂在 Farm.expedition 上，持久化、可 resume。掉落只用 金币/银币/药水/装饰 四类，与熔炼解耦。
import type { Farm, Expedition, ExpEvent, ExpDrop, ExpOption, ExpOutcome, ExpRunLogEntry, ExpCharm, ExpDifficulty } from "./types.js";
import { expMaps, expEvents, expEventById, expMapById, expDecorById } from "./content.js";
import { Rng } from "./rng.js";
import { currentDayIndex } from "./time.js";
import { EXP_DAILY_CAP, EXP_EVENTS_PER_CHARGE, EXP_MAX_CHARGES_PER_ENTRY, EXP_START_HP, EXP_DC, EXP_BLESSING_MAX } from "./config.js";

type Out = { ok: boolean; text: string };

const ev = (id: string): ExpEvent | undefined => expEventById.get(id);
const human = (f: Farm) => f.humanName || "伴侣";

// —— 行囊 / 掉落 ——
function dropLabel(d: ExpDrop): string {
  if (d.t === "coins") return `+${d.n}金`;
  if (d.t === "silver") return `+${d.n}银`;
  if (d.t === "potion") return `+加速药水×${d.n}`;
  if (d.t === "decor") return `🏡${expDecorById.get(d.id!)?.name ?? "装饰"}`;
  return "";
}
function addDrops(exp: Expedition, drops?: ExpDrop[]): string[] {
  if (!drops?.length) return [];
  for (const d of drops) exp.bag.push(d);
  return drops.map(dropLabel);
}
function bagSummary(exp: Expedition): string {
  let coins = 0, silver = 0, potion = 0; const decor: string[] = [];
  for (const d of exp.bag) {
    if (d.t === "coins") coins += d.n ?? 0;
    else if (d.t === "silver") silver += d.n ?? 0;
    else if (d.t === "potion") potion += d.n ?? 0;
    else if (d.t === "decor") decor.push(expDecorById.get(d.id!)?.name ?? "装饰");
  }
  const parts: string[] = [];
  if (coins) parts.push(`${coins}金`);
  if (silver) parts.push(`${silver}银`);
  if (potion) parts.push(`药水×${potion}`);
  if (decor.length) parts.push(`🏡${decor.join("、")}`);
  return parts.length ? parts.join("、") : "空";
}

// —— HUD 一行 ——
function expHud(f: Farm): string {
  const exp = f.expedition!;
  const map = expMapById.get(exp.mapId);
  const tail = exp.pending?.type === "combat" ? `·⚔️待${human(f)}摇骰`
    : exp.pending?.type === "choice" ? "·🔀待选择"
    : exp.status === "finished" ? "·✅结束" : "";
  return `🗺️${map?.name ?? "秘境"}·第${exp.step}格·❤${exp.hp}·🎒${bagSummary(exp)}${tail}`;
}

// —— 抽一趟的事件序列：浅层在前、深层居中、终景压轴 ——
function weightedSampleNoRepeat(rng: Rng, pool: ExpEvent[], k: number): ExpEvent[] {
  const picked: ExpEvent[] = [];
  const rest = pool.slice();
  while (picked.length < k && rest.length) {
    const i = rng.weighted(rest.map((e) => e.weight));
    picked.push(rest[i]);
    rest.splice(i, 1);
  }
  return picked;
}
const LAYER_RANK: Record<string, number> = { shallow: 0, deep: 1, finale: 2 };
// 抽 budget 段际遇：未解锁优先（重复进同一秘境时尽量给新格子），不够再用已解锁补；按层排序，浅→深→终景压轴。
function buildQueue(rng: Rng, mapId: string, budget: number, seen: Set<string>): string[] {
  const map = expMapById.get(mapId)!;
  const all = map.events.map(ev).filter((e): e is ExpEvent => !!e);
  const unseen = all.filter((e) => !seen.has(e.id));
  const seenPool = all.filter((e) => seen.has(e.id));
  const picked = weightedSampleNoRepeat(rng, unseen, Math.min(budget, unseen.length));
  if (picked.length < budget) {
    picked.push(...weightedSampleNoRepeat(rng, seenPool, Math.min(budget - picked.length, seenPool.length)));
  }
  picked.sort((a, b) => (LAYER_RANK[a.layer] ?? 1) - (LAYER_RANK[b.layer] ?? 1));
  return picked.map((e) => e.id);
}

// —— 见闻录：遇到即解锁一格 ——
function recordSeen(f: Farm, id: string) {
  f.expCodex ??= [];
  if (!f.expCodex.includes(id)) f.expCodex.push(id);
}

// —— 推进：每次只揭示「一个」事件就停（剧情/掉落显示后等"继续前进"，选项/战斗等输入）——
function advance(f: Farm, now: number): string {
  const exp = f.expedition!;
  // 跳过坏 id
  while (exp.queue.length && !ev(exp.queue[0])) exp.queue.shift();
  if (!exp.queue.length) return settle(f, now, "走到了头");
  const e = ev(exp.queue[0])!;
  recordSeen(f, e.id);
  // 决策点：停下，等 choose / roll（不消费 queue，待 resolve）
  if (e.options?.length) {
    exp.pending = { type: "choice", eventId: e.id };
    exp.status = "awaiting-choice";
    return `〔${e.title}〕${e.story}\n${optionsText(e)}`;
  }
  if (e.type === "combat") {
    exp.pending = { type: "combat", eventId: e.id };
    exp.status = "awaiting-roll";
    const target = EXP_DC[e.difficulty ?? "mid"];
    return `〔${e.title}〕${e.story}\n⚔️ 遭遇【${e.foe}】！掷两颗六面骰，**和 ≥${target}** 才能赢。等 ${human(f)} 帮你摇一把（等不及可自掷：roll）。`;
  }
  // 纯剧情 / 掉落：揭示这一个，消费它，然后停下等"继续前进"
  exp.step += 1;
  const got = addDrops(exp, e.drops);
  const line = `${e.story}${got.length ? `（${got.join("、")} 进行囊）` : ""}`;
  exp.log.push({ eventId: e.id, title: e.title, text: line });
  exp.queue.shift();
  const echo = echoBlessingIfLow(f);
  const body = `〔${e.title}〕${line}${echo.length ? "\n" + echo.join("\n") : ""}`;
  if (!exp.queue.length) return `${body}\n\n${settle(f, now, "走到了头")}`;
  exp.status = "exploring";
  return `${body}\n（还剩 ${exp.queue.length} 段 · explore 继续前进）`;
}

function optionsText(e: ExpEvent): string {
  const opts = (e.options ?? []).map((o) => `  ${o.key}. ${o.label}`).join("\n");
  return `你可以：\n${opts}\n（choose {"option":"${e.options?.[0]?.key ?? "A"}"}）`;
}

// —— 选项结算 ——
export function expChoose(f: Farm, optKey: string, now: number): Out {
  const exp = f.expedition;
  if (!exp) return { ok: false, text: "你现在没在探险（explore 出门）。" };
  if (exp.pending?.type !== "choice") return { ok: false, text: exp.pending?.type === "combat" ? `⚔️ 在等${human(f)}摇骰，摇了才能继续（或 roll 自掷）。` : "现在没有要选的（explore 继续往前走）。" };
  const e = ev(exp.pending.eventId)!;
  const opt = (e.options ?? []).find((o) => o.key.toLowerCase() === String(optKey).toLowerCase());
  if (!opt) return { ok: false, text: `没有选项「${optKey}」。${optionsText(e)}` };
  const lines = applyOutcomes(f, exp, opt.outcomes);
  exp.log.push({ eventId: e.id, title: e.title, text: `${e.story}\n→ 你选了：${opt.label}` });
  exp.step += 1;
  exp.pending = null;
  exp.queue.shift(); // 当前事件消费掉
  const head = `〔${e.title}〕你选了：${opt.label}\n${lines.join("\n")}`;
  // 控制类后果：applyOutcomes 只管数值/文字，流程走这里。
  // {t:"combat"} 就地引爆一场战斗（内联，等摇骰）；{t:"jump"} 把玩家引到另一段际遇。
  const fight = opt.outcomes.find((o) => o.t === "combat") as { t: "combat"; foe: string; difficulty?: ExpDifficulty } | undefined;
  if (fight) {
    const dc = EXP_DC[fight.difficulty ?? "mid"];
    exp.pending = { type: "combat", eventId: e.id, inline: {
      foe: fight.foe, difficulty: fight.difficulty ?? "mid", record: fight.foe,
      win: { text: `` },
      lose: { text: `` },
    } };
    exp.status = "awaiting-roll";
    return { ok: true, text: `${head}\n⚔️ 遭遇【${fight.foe}】！掷两颗六面骰，**和 ≥${dc}** 才能赢。等 ${human(f)} 帮你摇一把（等不及可自掷：roll）。\n${expHud(f)}`.trimEnd() };
  }
  const jump = opt.outcomes.find((o) => o.t === "jump") as { t: "jump"; to: string } | undefined;
  if (jump && ev(jump.to)) exp.queue.unshift(jump.to); // 目标 id 有效才跳；无效则忽略（不崩）
  // 选完只给这一格的结果就停，下一段要再 explore「继续前进」
  if (!exp.queue.length) return { ok: true, text: `${head}\n\n${settle(f, now, "走到了头")}`.trimEnd() };
  exp.status = "exploring";
  return { ok: true, text: `${head}\n（还剩 ${exp.queue.length} 段 · explore 继续前进）\n${expHud(f)}`.trimEnd() };
}

function applyOutcomes(f: Farm, exp: Expedition, outcomes: ExpOutcome[]): string[] {
  const lines: string[] = [];
  for (const o of outcomes) {
    if (o.text) lines.push(o.text);
    switch (o.t) {
      case "coins": case "silver": case "potion": {
        addDrops(exp, [{ t: o.t, n: o.n }]); lines.push(`（${dropLabel({ t: o.t, n: o.n })} 进行囊）`); break;
      }
      case "decor": {
        addDrops(exp, [{ t: "decor", id: o.id }]); lines.push(`（${dropLabel({ t: "decor", id: o.id })} 进行囊）`); break;
      }
      case "status": {
        exp.hp = Math.max(0, exp.hp + o.n); lines.push(o.n >= 0 ? `（❤状态+${o.n}）` : `（❤状态${o.n}）`); break;
      }
      case "buff": { exp.buffMod += o.mod; lines.push(`（下次检定 +${o.mod}）`); break; }
      case "none": default: break;
    }
  }
  lines.push(...echoBlessingIfLow(f));
  return lines.filter(Boolean);
}

// —— 战斗：2d6 + 修正 vs 难度目标，四档 ——
export function expRoll(f: Farm, byHuman: boolean, now: number): Out {
  const exp = f.expedition;
  if (!exp) return { ok: false, text: "你现在没在探险。" };
  if (exp.pending?.type !== "combat") return { ok: false, text: "现在没有战斗要摇骰（explore 继续）。" };
  // 战斗定义来自两处：内容事件（正常战斗）或选项后果就地带的内联战斗（inline）。
  const inline = !!exp.pending.inline;
  const contentEv = inline ? undefined : ev(exp.pending.eventId);
  const c = exp.pending.inline
    ?? (contentEv ? { foe: contentEv.foe!, difficulty: contentEv.difficulty, record: contentEv.record, win: contentEv.win, lose: contentEv.lose } : undefined);
  if (!c) return { ok: false, text: "现在没有战斗要摇骰（explore 继续）。" };
  const rng = new Rng(f.rngState);
  const d1 = rng.int(6) + 1, d2 = rng.int(6) + 1;
  f.rngState = rng.state;
  const natural = d1 + d2;
  const buff = exp.buffMod;                         // 途中拾到的临时加成
  const concord = byHuman ? 1 : 0;                  // 同心 +1（伴侣摇才有）
  const charmBonus = exp.charm?.kind === "check" ? 1 : 0;
  const mod = buff + concord + charmBonus;
  const total = natural + mod;
  const target = EXP_DC[c.difficulty ?? "mid"];
  // 消耗：buff 清零、护身符检定加成用掉
  exp.buffMod = 0;
  if (exp.charm?.kind === "check") exp.charm.kind = undefined;

  let band: "crit" | "win" | "graze" | "loss";
  if (natural === 12 || total >= target + 3) band = "crit";
  else if (total >= target) band = "win";
  else if (natural === 2 || total <= target - 3) band = "loss";
  else band = "graze";

  const modParts = [concord ? `+${concord}同心` : "", charmBonus ? "+1护符" : "", buff ? `+${buff}加成` : ""].filter(Boolean).join("");
  const head = `🎲 ${byHuman ? `${human(f)}替你` : "你"}掷出 ${d1}+${d2}${modParts ? `${modParts}=${total}` : ""} · 目标≥${target}`;
  const lines: string[] = [head];

  if (band === "crit" || band === "win") {
    if (contentEv?.record) recordSeen(f, contentEv.id);
    const drops = (c.win?.drops ?? []).slice();
    if (band === "crit" && c.win?.critDrops) drops.push(...c.win.critDrops);
    const got = addDrops(exp, drops);
    lines.push(band === "crit" ? "🌟 大胜！" : "✅ 胜！");
    if (c.win?.text) lines.push(c.win.text);
    if (got.length) lines.push(`（战利品：${got.join("、")} 进行囊）`);
    if (band === "crit" && c.win?.critDrops) lines.push("（大胜额外犒赏！）");
    // 默契度：每赢一场 +1，封顶 100
    const before = f.expConcord ?? 0;
    if (before < 100) {
      f.expConcord = before + 1;
      lines.push(`💞（默契度 +1 → ${f.expConcord}${f.expConcord >= 100 ? "·满！" : ""}）`);
    }
  } else {
    const dmg = band === "graze" ? 1 : 2;
    exp.hp = Math.max(0, exp.hp - dmg);
    lines.push(band === "graze" ? "😬 险负——扛住了，但挂了彩。" : "💥 惨败！");
    if (c.lose?.text) lines.push(c.lose.text);
    lines.push(`（❤状态-${dmg}，剩 ${exp.hp}）`);
  }
  lines.push(...echoBlessingIfLow(f));

  const won0 = band === "crit" || band === "win";
  exp.log.push({ eventId: contentEv?.id ?? `inline:${c.foe}`, title: contentEv?.title ?? c.foe, text: `${contentEv?.story ?? `与${c.foe}的一场较量`}\n→ ${byHuman ? human(f) + "替你摇" : "你掷"}出 ${total}（目标≥${target}）：${won0 ? (c.win?.text ?? "胜") : (c.lose?.text ?? "败")}` });
  exp.step += 1;
  exp.pending = null;
  if (!inline) exp.queue.shift(); // 内容战斗才消费 queue；内联战斗没有对应事件，别误删下一格

  const won = band === "crit" || band === "win";
  let tail = "";
  if (exp.hp <= 0) {
    tail = "\n\n" + settle(f, now, "被迫收工");
  } else if (!exp.queue.length) {
    tail = "\n\n" + settle(f, now, won ? "通关" : "退回林外");
  } else {
    exp.status = "exploring";
    tail = "\n（explore 继续往里走，或 retreat 落袋为安）";
  }
  return { ok: true, text: `${lines.join("\n")}${tail}\n${f.expedition ? expHud(f) : ""}`.trimEnd() };
}

// —— 祝福语在状态告急（≤1）时回响一次 ——
function echoBlessingIfLow(f: Farm): string[] {
  const exp = f.expedition!;
  if (exp.charm?.blessing && !exp.charmEchoed && exp.hp <= 1) {
    exp.charmEchoed = true;
    return [`💗【${human(f)}的祝福】${exp.charm.blessing}`];
  }
  return [];
}

// —— 结算：行囊入库 + 旅程簿 + 见闻 ——
function settle(f: Farm, now: number, how: string): string {
  const exp = f.expedition!;
  const map = expMapById.get(exp.mapId);
  let coins = 0, silver = 0, potion = 0; const decorNames: string[] = [];
  for (const d of exp.bag) {
    if (d.t === "coins") { f.coins += d.n ?? 0; coins += d.n ?? 0; }
    else if (d.t === "silver") { f.silver += d.n ?? 0; silver += d.n ?? 0; }
    else if (d.t === "potion") { f.items.speed_potion = (f.items.speed_potion ?? 0) + (d.n ?? 0); potion += d.n ?? 0; }
    else if (d.t === "decor") {
      const ranch = (f.ranch ??= { coins: 0, animals: [] });
      // 进牧场仓库（decorStore），由伴侣在仓库页「摆上」才展示；已拥有(已摆/在库)则不重复给
      const owned = [...(ranch.decor ?? []), ...(ranch.decorStore ?? [])];
      if (!owned.includes(d.id!)) (ranch.decorStore ??= []).push(d.id!);
      decorNames.push(expDecorById.get(d.id!)?.name ?? "装饰");
    }
  }
  const haul: string[] = [];
  if (coins) haul.push(`+${coins}金`);
  if (silver) haul.push(`+${silver}银`);
  if (potion) haul.push(`+药水×${potion}`);
  if (decorNames.length) haul.push(`🏡${decorNames.join("、")}（已进农场，${human(f)}可摆出来）`);

  const summary = `${how}·${haul.length ? haul.join("、") : "空手而归"}`;
  f.expJourneys ??= [];
  f.expJourneys.unshift({ mapId: exp.mapId, mapName: map?.name ?? "秘境", at: now, summary, log: exp.log.slice(), blessing: exp.charm?.blessing });
  if (f.expJourneys.length > 30) f.expJourneys.length = 30;

  const blessLine = exp.charm?.blessing ? `\n💗 这趟带着${human(f)}的祝福：「${exp.charm.blessing}」` : "";
  f.expedition = null;
  return `🏁 这趟探险结束（${how}）。\n🎒 行囊入库：${haul.length ? haul.join("、") : "空手而归"}${blessLine}\n📔 见闻录已更新（可让 ${human(f)} 帮你翻翻「秘境图鉴」）。`;
}

// —— 进入：花「次数」进一个随机秘境，触发 3×次数 段际遇（未解锁优先），播到第一个决策点 ——
export function expEnter(f: Farm, now: number, charges = 1): Out {
  if (f.expedition) return { ok: false, text: `你正在「${expMapById.get(f.expedition.mapId)?.name ?? "秘境"}」里——先把这一程走完，或 retreat 撤回。\n${expHud(f)}` };
  const today = currentDayIndex(now);
  const used = f.expDaily && f.expDaily.day === today ? f.expDaily.n : 0;
  const remaining = EXP_DAILY_CAP - used;
  if (remaining <= 0) return { ok: false, text: `🗺️ 今天的探险次数用完了（${EXP_DAILY_CAP}/${EXP_DAILY_CAP}），明天再来。` };
  const spend = Math.max(1, Math.min(Math.floor(Number(charges) || 1), EXP_MAX_CHARGES_PER_ENTRY, remaining));

  const open = expMaps.filter((m) => m.unlock == null); // TODO: 解锁条件
  if (!open.length) return { ok: false, text: "暂时没有可去的秘境。" };
  const rng = new Rng(f.rngState);
  const map = open[rng.int(open.length)];
  const seen = new Set(f.expCodex ?? []);
  const queue = buildQueue(rng, map.id, spend * EXP_EVENTS_PER_CHARGE, seen);
  f.rngState = rng.state;

  // 焊入出门前祈福
  const charm: ExpCharm | null = f.expCharm ?? null;
  let hp = EXP_START_HP;
  if (charm?.kind === "hp") { hp += 1; charm.kind = undefined; }
  f.expCharm = null;

  f.expedition = {
    mapId: map.id, status: "exploring", step: 0, hp, bag: [], log: [],
    queue, pending: null, charm, charmEchoed: false, buffMod: 0, startedAt: now,
  };
  f.expDaily = { day: today, n: used + spend };
  f.expRuns = (f.expRuns ?? 0) + 1; // 探险称号累计（一次进秘境=一趟）

  const charmLine = charm?.kind || charm?.blessing
    ? `\n🧿 ${human(f)}为你祈福：${charm?.kind === "check" ? "护身符(+1检定) " : charm?.kind === "hp" ? "护身符(+1状态) " : ""}${charm?.blessing ? `「${charm.blessing}」` : ""}`
    : "";
  const total = queue.length; // advance 会消费 queue，先记原始段数
  const body = advance(f, now);
  const head = `🗺️ 你踏进了【${map.name}】（花 ${spend} 次数 · ${total} 段际遇 · 今日剩 ${EXP_DAILY_CAP - (used + spend)} 次数）。`;
  return { ok: true, text: `${head}\n${map.intro}${charmLine}\n\n${body}\n${f.expedition ? expHud(f) : ""}`.trimEnd() };
}

// —— explore：没在探险=进入（可带 charges 一口气花几次数）；在探险=继续推进 ——
export function expExplore(f: Farm, now: number, charges = 1): Out {
  if (!f.expedition) return expEnter(f, now, charges);
  const exp = f.expedition;
  if (exp.pending?.type === "choice") return { ok: false, text: `先选一个——${optionsText(ev(exp.pending.eventId)!)}` };
  if (exp.pending?.type === "combat") return { ok: false, text: `⚔️ 在等${human(f)}摇骰，摇了才能继续（或 roll 自掷）。\n${expHud(f)}` };
  const body = advance(f, now);
  return { ok: true, text: `${body}\n${f.expedition ? expHud(f) : ""}`.trimEnd() };
}

// —— retreat：主动撤退，行囊落袋 ——
export function expRetreat(f: Farm, now: number): Out {
  if (!f.expedition) return { ok: false, text: "你现在没在探险。" };
  if (f.expedition.pending?.type === "combat") return { ok: false, text: `⚔️ 正面对【${ev(f.expedition.pending.eventId)?.foe}】，要么摇骰过去、要么先 roll，撤不了。` };
  return { ok: true, text: settle(f, now, "见好就收") };
}

// —— 当前进度 / resume ——
export function expView(f: Farm, now: number): Out {
  const exp = f.expedition;
  if (!exp) {
    const today = currentDayIndex(now);
    const used = f.expDaily && f.expDaily.day === today ? f.expDaily.n : 0;
    const left = EXP_DAILY_CAP - used;
    const avail = left > 0
      ? `今日还剩 ${left}/${EXP_DAILY_CAP} 次数（1 次数=进一个随机秘境触发 3 段；一口气最多花 ${EXP_MAX_CHARGES_PER_ENTRY} 次数=9 段、深挖一个秘境）。现在可 explore 出门。`
      : `今日 ${EXP_DAILY_CAP} 次数已用完，明天再来。`;
    return { ok: true, text: `🗺️ 你现在没在探险。\n${avail}\n花费多个体力可以走到秘境更深处：explore {"charges":3}\n（explore 进随机秘境；战斗要 ${human(f)} 帮你摇骰子配合。重复进同一秘境会优先给没见过的际遇。）` };
  }
  const map = expMapById.get(exp.mapId);
  const last = exp.log.length ? `\n最近：〔${exp.log[exp.log.length - 1].title}〕` : "";
  let next = "explore 继续";
  if (exp.pending?.type === "choice") next = optionsText(ev(exp.pending.eventId)!);
  else if (exp.pending?.type === "combat") next = `⚔️ 等 ${human(f)} 摇骰（或 roll 自掷）`;
  return { ok: true, text: `🗺️ 探险进行中：【${map?.name}】${last}\n${expHud(f)}\n下一步：${next}` };
}

// —— 出门前祈福：伴侣前端设置（active 时设给这趟，否则预存到下趟）——
export function expSetCharm(f: Farm, kind: "check" | "hp" | undefined, blessing: string | undefined, now: number): Out {
  const bl = (blessing ?? "").trim().slice(0, EXP_BLESSING_MAX);
  const charm: ExpCharm = { kind, blessing: bl || undefined };
  if (f.expedition) {
    // 进行中：检定加成可续上；hp 立即 +1（仅当本趟还没用过 hp 护符的简单处理：直接加）
    const cur = (f.expedition.charm ??= {});
    if (kind === "check") cur.kind = "check";
    else if (kind === "hp") { f.expedition.hp += 1; }
    if (bl) { cur.blessing = bl; f.expedition.charmEchoed = false; }
    return { ok: true, text: `🧿 已为这趟探险祈福。` };
  }
  f.expCharm = charm;
  return { ok: true, text: `🧿 祈福已备好，${f.aiName || "TA"}下次出门探险时生效。` };
}
