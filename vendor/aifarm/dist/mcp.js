// MCP 适配器（第 4 个传输层）：手写最小 JSON-RPC 2.0，零依赖（不引入 MCP SDK，守住「只用 Node 内置」）。
// 设计：只暴露「一个」工具 farm，AI 把动作名+参数自己写进调用里，薄转发到 runFarm——
//   省掉「每动作一个工具」的常驻 schema token；动作表是文本知识（farm({action:"help"})），不是工具签名。
// 与 /a/<key> 链接同一把 agentKey、同一个 runFarm、同一份存档与 HUD 文案：玩法体验和 POST 版完全一致。
// 单工具定义。描述里写清「动作名+参数平铺」的调用法与 help 入口，常驻成本就这一份 schema。
const FARM_TOOL = {
    name: "farm",
    description: "在 AI 农场里执行一个动作（种地/浇水/收获/熔炼/串门/留言…）。一个工具走天下：动作名放 action，其余参数平铺在同级，"
        + "例如 {action:\"plant\",common:3,fantasy:3}、{action:\"run\"}、{action:\"harvest\"}。串别人家时参数里加 to:\"对方门牌号\"（偷/浇/买/留言/串门）。"
        + "不知道有哪些动作、或想看完整玩法，先调 {action:\"help\"} 把动作表读进来；查看类用 {action:\"status\"}（巡视农场）。"
        + "返回 text 末尾那行 🌾【季·土地】熟N·长N·空N · 🧪药水 · 💰金 就是给你决策的状态摘要(HUD)。需要结构化农场数据时任意动作加 detail:true。",
    inputSchema: {
        type: "object",
        properties: {
            action: {
                type: "string",
                description: "动作名，如 status/shop/plant/water/harvest/run/use/upgrade-land/craft/bag/encyclopedia/wander/visit/steal/message/help …；完整表见 action:\"help\"",
            },
        },
        required: ["action"],
        additionalProperties: true, // 让 AI 自由平铺 common/fantasy/to/materials/plotId… 任意参数
    },
};
// 处理单条 JSON-RPC 请求。返回响应对象；通知（无 id 的 method）返回 undefined 表示「无需回应」。
function handleOne(rpc, ctx) {
    const id = rpc?.id ?? null;
    const ok = (result) => ({ jsonrpc: "2.0", id, result });
    const fail = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
    switch (rpc?.method) {
        case "initialize":
            return ok({
                protocolVersion: rpc?.params?.protocolVersion ?? "2025-06-18",
                capabilities: { tools: {} },
                serverInfo: { name: ctx.serverName, version: "1.0.0" },
                instructions: "种田游戏。只有一个工具 farm：动作名放 action、参数平铺同级。先调 farm({action:\"help\"}) 看动作表。",
            });
        case "ping":
            return ok({});
        case "tools/list":
            return ok({ tools: [FARM_TOOL] });
        case "tools/call": {
            if (rpc?.params?.name !== "farm")
                return fail(-32602, `未知工具：${rpc?.params?.name}。这个服务只有一个工具 farm。`);
            const args = (rpc?.params?.arguments ?? {});
            const { action, ...params } = args;
            if (!action || typeof action !== "string")
                return fail(-32602, "缺少 action（动作名）。先调 farm({action:\"help\"}) 看动作表。");
            const out = ctx.run(action, params);
            // 业务报错（如金币不够）走 isError:true + 文字，不当协议错误抛——让 AI 读 text 自己纠正。
            return ok({ content: [{ type: "text", text: out.text }], isError: !out.ok });
        }
        default:
            if (typeof rpc?.method === "string" && rpc.method.startsWith("notifications/"))
                return undefined; // 通知一律不回
            return fail(-32601, `不支持的方法：${rpc?.method}`);
    }
}
// 入口：支持单条与 JSON-RPC 批量（数组）。返回 undefined 表示全是通知、HTTP 应回 202 空体。
export function mcpDispatch(rpc, ctx) {
    if (Array.isArray(rpc)) {
        const out = rpc.map((r) => handleOne(r, ctx)).filter((x) => x !== undefined);
        return out.length ? out : undefined;
    }
    return handleOne(rpc, ctx);
}
export { FARM_TOOL };
//# sourceMappingURL=mcp.js.map