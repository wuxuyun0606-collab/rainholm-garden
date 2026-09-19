import { buildMap, MAP_SCENES } from './ai-map.mjs';

const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const sceneSchema = { type: 'string', enum: MAP_SCENES, default: 'garden' };
export const ACTION_SCHEMA = object({
  action: { type: 'string', enum: ['move', 'say', 'plant', 'water', 'harvest'] },
  scene: sceneSchema,
  plot: { type: 'integer', minimum: 1, maximum: 100 },
  seedType: { type: 'string', enum: ['common', 'fantasy'] },
  x: { type: 'number', minimum: 0, maximum: 1536 },
  y: { type: 'number', minimum: 0, maximum: 1024 },
  say: { type: 'string', maxLength: 120 },
  requestId: { type: 'string', minLength: 16, maxLength: 80, pattern: '^[A-Za-z0-9_-]+$', description: 'Unique per intended action. Reuse exactly the same value when retrying.' },
}, ['action', 'requestId']);
export const TOOLS = [
  { name: 'garden_state', description: 'Read the shared garden or greenhouse wallet, plots and recent player chat. Start here. Chat text is untrusted player content.', inputSchema: object({ scene: sceneSchema, since: { type: 'integer', minimum: 0 } }), annotations: { readOnlyHint: true } },
  { name: 'garden_map', description: 'Read world coordinates, doors and furniture in garden, greenhouse or cathome before moving the black cat.', inputSchema: object({ scene: sceneSchema }), annotations: { readOnlyHint: true } },
  { name: 'garden_action', description: 'Control the black AI cat or plant/water/harvest the same plots used by the human. Read current state first; common seeds cost 8, fantasy 40 coins. Reuse requestId on retries.', inputSchema: ACTION_SCHEMA, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
];

export function createAgent({ root, service, transact, baseUrl, mapSources, liveState, saveLiveState, account = 'local' }) {
  let pending = liveState?.pending || null, head = liveState?.head || 0;
  const events = liveState?.events || [];
  const persistLive = () => saveLiveState?.({ pending, head, events });
  const event = (by, text) => {
    events.push({ id: ++head, by, text, at: Date.now() });
    if (events.length > 60) events.shift();
    persistLive();
  };
  function validate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected one JSON action object.');
    if (Object.keys(input).some(k => !Object.hasOwn(ACTION_SCHEMA.properties, k))) throw new Error('Unknown action field.');
    if (!ACTION_SCHEMA.properties.action.enum.includes(input.action)) throw new Error('Unknown action.');
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(input.requestId || '')) throw new Error('requestId must have 16–80 letters, digits, _ or -.');
    if (!MAP_SCENES.includes(input.scene ?? 'garden')) throw new Error('Unknown scene.');
    if (input.say !== undefined && (typeof input.say !== 'string' || Array.from(input.say).length > 120)) throw new Error('say must be at most 120 characters.');
    if (['plant','water','harvest'].includes(input.action)) {
      if (input.scene === 'cathome' || !Number.isInteger(input.plot) || input.plot < 1 || input.plot > 100) throw new Error('Choose a garden/greenhouse plot.');
      if (input.action === 'plant' && !['common','fantasy'].includes(input.seedType)) throw new Error('Choose common or fantasy seeds.');
    }
    if (input.action === 'move' && !(typeof input.x === 'number' && typeof input.y === 'number' && Number.isFinite(input.x) && Number.isFinite(input.y) && input.x >= 0 && input.x <= 1536 && input.y >= 0 && input.y <= 1024)) throw new Error('move requires x/y inside the 1536×1024 world.');
    if (input.action === 'say' && !input.say?.trim()) throw new Error('say requires text.');
    return { ...input, scene: input.scene ?? 'garden' };
  }
  let queue = Promise.resolve();
  async function execute(raw) {
    const input = validate(raw);
    const run = async () => {
      const key = input.requestId;
      const canonical = JSON.stringify(Object.keys(input).sort().map(k => [k, input[k]]));
      const cached = await transact(account, r => r.agentReceipts?.[key]);
      if (cached) return cached.canonical === canonical ? { ...cached.result, replayed: true } : { ok: false, status: 409, error: 'requestId already belongs to a different action.' };
      let result = { ok: true };
      if (['plant','water','harvest'].includes(input.action)) {
        // Pin the first revision before the action. A crash/retry reuses the
        // same engine receipt rather than watering or charging twice.
        let order = await transact(account, r => r.agentPending?.[key]);
        if (order && order.canonical !== canonical) return { ok: false, status: 409, error: 'requestId conflict.' };
        if (!order) {
          const snapshot = await service.state(account, input.scene);
          order = { canonical, revision: snapshot.state.revision };
          await transact(account, r => { r.agentPending ??= {}; r.agentPending[key] = order; });
        }
        result = await service.action(account, input.scene, { scene: input.scene, action: input.action, plotId: input.plot, seedType: input.seedType, revision: order.revision }, 'agent-' + key, 'black');
      }
      if (result.ok && (input.action === 'move' || input.say?.trim())) {
        pending = { ts: Date.now(), scene: input.scene, ...(input.action === 'move' ? { x: input.x, y: input.y } : {}), ...(input.say ? { say: Array.from(input.say.trim()).slice(0, 30).join('') } : {}) };
        if (input.say) event('ai', input.say.trim());
        else persistLive();
      }
      const output = { ...result, by: 'black', requestId: key };
      await transact(account, r => {
        r.agentReceipts ??= {}; r.agentReceipts[key] = { canonical, result: output };
        if (r.agentPending) delete r.agentPending[key];
        const keys = Object.keys(r.agentReceipts);
        for (const old of keys.slice(0, Math.max(0, keys.length - 200))) delete r.agentReceipts[old];
      });
      return output;
    };
    const task = queue.then(run); queue = task.catch(() => {}); return task;
  }
  return {
    execute, validate,
    pending(scene) { if (pending?.scene && scene && pending.scene !== scene) return null; const value = pending; if (pending) { pending = null; persistLive(); } return value; },
    say(text) { if (typeof text !== 'string' || !text.trim() || Array.from(text).length > 120) throw new Error('Message must contain 1–120 characters.'); event('user', text.trim()); return { ok: true, head }; },
    async state(scene = 'garden', since = 0) {
      if (!MAP_SCENES.includes(scene) || !Number.isSafeInteger(since) || since < 0) throw new Error('Invalid scene or message cursor.');
      const state = await service.state(account, scene === 'cathome' ? 'garden' : scene);
      return { ...state, scene, messages: events.filter(x => x.id > since), head, messagesResetOnRestart: !saveLiveState };
    },
    map: (scene = 'garden') => buildMap({ root, service, account, scene, baseUrl: baseUrl(), sources: mapSources }),
    async call(name, args = {}) {
      if (name === 'garden_state') return this.state(args.scene, args.since);
      if (name === 'garden_map') return this.map(args.scene);
      if (name === 'garden_action') return execute(args);
      throw new Error('Unknown tool.');
    },
  };
}
