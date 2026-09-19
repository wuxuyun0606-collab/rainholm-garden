// 适配器能力漂移检查（零依赖，读源码文本，不依赖 dist）。
// 守的不变量：
//   ① POST 动作面（引擎 dispatch + runFarm 直接处理的并集）  ==  docs/PARITY.md 表里登记的动作集
//   ② agent 页可执行的动作（去掉纯导航/链接生命周期）        ⊆  表里登记的动作集
// 任一被破坏 = 有人改了动作面但没更新对照表 → 失败，逼着回去登记 + 决定各适配器待遇。
// 跑：npm run parity
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const uniq = (a) => [...new Set(a)].sort();
const matchAll = (s, re) => [...s.matchAll(re)].map((m) => m[1]);
const fmt = (a) => (a.length ? a.join(", ") : "（无）");

const gameSrc = read("src/game.ts");
const serverSrc = read("src/server.ts");

// ① POST 动作面 = 引擎 dispatch 的 case "x"  ∪  runFarm 直接处理的 action === "x"
const dispatchActions = matchAll(gameSrc, /case\s+"([a-z][a-z-]*)"/g);
const runFarmActions = matchAll(serverSrc, /\baction === "([a-z-]+)"/g);
const post = uniq([...dispatchActions, ...runFarmActions]);

// 表：docs/PARITY.md 里 | `action` | … 行
const table = uniq(matchAll(read("docs/PARITY.md"), /^\|\s*`([a-z-]+)`\s*\|/gm));

// ② agent 页可执行：server.ts 的 agentDo 里 a === "x"
//    去掉 agent-链接生命周期(create/...)和纯导航目标(mypage)——它们不是游戏动作。
const NON_ACTION = new Set(["create", "make-agent", "revoke-agent", "mypage"]);
const agentExec = uniq(matchAll(serverSrc, /\ba === "([a-z-]+)"/g).filter((a) => !NON_ACTION.has(a)));

const errs = [];

// 检查①：POST 动作面 == 表
const missInTable = post.filter((a) => !table.includes(a)); // 代码有、表没登记
const staleInTable = table.filter((a) => !post.includes(a)); // 表有、代码已删
if (missInTable.length)
  errs.push(`代码新增了动作但 docs/PARITY.md 未登记：${fmt(missInTable)}\n    → 在表里加这些行，并决定 agent/MCP 各自怎么暴露。`);
if (staleInTable.length)
  errs.push(`docs/PARITY.md 登记了代码已不存在的动作：${fmt(staleInTable)}\n    → 从表里删掉这些行。`);

// 检查②：agent 可执行 ⊆ 表
const agentNotInTable = agentExec.filter((a) => !table.includes(a));
if (agentNotInTable.length)
  errs.push(`agent 页能执行但 docs/PARITY.md 未登记的动作：${fmt(agentNotInTable)}\n    → 在表里补上并标注 agent 列。`);

if (errs.length) {
  console.error("✗ 适配器对照表漂移：\n");
  for (const e of errs) console.error("  • " + e + "\n");
  console.error(`POST动作面(${post.length})：${fmt(post)}`);
  console.error(`表登记(${table.length})：${fmt(table)}`);
  console.error(`agent可执行(${agentExec.length})：${fmt(agentExec)}`);
  process.exit(1);
}

console.log(`✓ 适配器对照表与代码一致（POST ${post.length} 动作、agent 可执行 ${agentExec.length}，均已登记）`);
