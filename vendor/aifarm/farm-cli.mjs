#!/usr/bin/env node
// AI 农场 · headless CLI 适配器（供 ChatGPT 等代码执行环境试玩）。
// 零网络、零 API key、零登录。与 HTTP 接口同一套规则(dist/game.js)与存档结构。
// 用法：
//   node farm-cli.mjs help
//   node farm-cli.mjs status
//   node farm-cli.mjs run '{"action":"plant","common":3,"fantasy":3}'
//   node farm-cli.mjs reset --seed 42
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { dispatch, HELP, farmView, makeFarm, advance, shopBrief } from "./dist/game.js";
import { viewLeaderboard } from "./dist/leaderboard.js";
import { allUgc, dumpUgc, loadUgc } from "./dist/ugc.js";

const DIR = dirname(fileURLToPath(import.meta.url));
const SAVE = resolve(DIR, "farm_save.json");
const UGC_SAVE = resolve(DIR, "ugc_save.json");
const out = (obj) => console.log(JSON.stringify(obj));

// 每个进程都要先重载 UGC 注册表，否则自创作物种子查不到
if (existsSync(UGC_SAVE)) { try { loadUgc(JSON.parse(readFileSync(UGC_SAVE, "utf8"))); } catch { /* 忽略 */ } }

function load() {
  if (existsSync(SAVE)) { try { return JSON.parse(readFileSync(SAVE, "utf8")); } catch { /* 损坏则重开 */ } }
  return null;
}
function persist(f) {
  writeFileSync(SAVE, JSON.stringify(f, null, 2), "utf8");
  writeFileSync(UGC_SAVE, JSON.stringify(dumpUgc(), null, 2), "utf8");
}

try {
  const [cmd, ...rest] = process.argv.slice(2);
  const now = Date.now();

  if (!cmd || cmd === "help") { out({ ok: true, text: HELP }); process.exit(0); }

  if (cmd === "reset") {
    const i = rest.indexOf("--seed");
    const seed = i >= 0 ? Number(rest[i + 1]) : undefined;
    const f = makeFarm("AI 试玩农场", seed);
    persist(f);
    out({ ok: true, text: `🌱 新农场已创建${seed != null && Number.isFinite(seed) ? `（seed=${seed}，可复现）` : ""}。\n${shopBrief(f, now)}`, farm: farmView(f, now) });
    process.exit(0);
  }

  // 其余命令：确保有存档
  let f = load();
  if (!f) { f = makeFarm("AI 试玩农场"); persist(f); }
  advance(f, now); // 按真实时间结算生长

  if (cmd === "status") {
    const r = dispatch(f, { action: "status" }, now);
    persist(f);
    out({ ok: r.ok, text: r.text, farm: farmView(f, now) });
    process.exit(0);
  }

  if (cmd === "run") {
    // 支持 run '<JSON>' / run -（从 stdin 读，避免命令行 JSON 转义）/ run @file.json
    let raw = rest[0];
    if (raw === "-") { try { raw = readFileSync(0, "utf8").trim(); } catch { raw = ""; } }
    else if (raw && raw.startsWith("@")) {
      try { raw = readFileSync(raw.slice(1), "utf8"); }
      catch (e) { out({ ok: false, text: `读取文件失败：${e.message}` }); process.exit(0); }
    }
    let body;
    try { body = raw ? JSON.parse(raw) : {}; }
    catch (e) { out({ ok: false, text: `action JSON 解析失败：${e.message}` }); process.exit(0); }
    if (body.action === "leaderboard" || body.action === "ranking") {
      out({ ok: true, text: viewLeaderboard([f], allUgc()) });
      process.exit(0);
    }
    const r = dispatch(f, body, now);
    persist(f);
    // 动作响应只回文字+末尾一行 HUD（够决策）；完整结构化 farm 仅在 status 或显式 verbose 时给，省 token。
    out({ ok: r.ok, text: r.text, ...(body.verbose ? { farm: farmView(f, now) } : {}) });
    process.exit(0);
  }

  out({ ok: false, text: `未知命令：${cmd}（可用 help / status / run / reset）` });
} catch (e) {
  out({ ok: false, text: `内部错误：${e?.message ?? String(e)}` });
}
