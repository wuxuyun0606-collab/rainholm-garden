import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { TOOLS } from './agent.mjs';

export async function handleMcp(req, res, agent, body) {
  // This stateless server returns JSON and sends no unsolicited notifications.
  // Decline the optional SSE listener, so cloud objects can sleep between calls.
  if (req.method === 'GET') {
    res.writeHead(405, { Allow: 'POST', 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Use Streamable HTTP POST; SSE listening is not supported.' }));
    return;
  }
  const server = new Server({ name: 'rainholm-garden', version: '1.3.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    try {
      const result = await agent.call(params.name, params.arguments);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: result.ok === false };
    } catch (e) { return { content: [{ type: 'text', text: e.message }], isError: true }; }
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
