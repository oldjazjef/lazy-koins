import { homedir } from 'node:os';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { resolveMcpEndpoint } from '../main/lib/mcp-endpoint';
import {
  type FetchLike,
  forwardMcpMessage,
  type JsonRpcMessage,
} from '../main/lib/mcp-forward';

/**
 * `mcp-stdio.js` — the desktop app's MCP server over **stdio** (F11.16) for clients that start a
 * process (Claude Desktop, Claude Code): it proxies stdin/stdout to the running app's loopback
 * endpoint (`http://127.0.0.1:<port>/api/mcp`, found in `<data folder>/mcp-endpoint.json`) with
 * the personal access token from `LAZYKOINS_MCP_TOKEN`. Run it with the app's own runtime:
 *
 *   ELECTRON_RUN_AS_NODE=1 "<lazy-koins.exe>" "<resources>/app.asar/mcp-stdio.js"
 *
 * (or any Node ≥ 22). Einstellungen › MCP shows the exact configuration. Nothing is logged to
 * stdout except JSON-RPC; diagnostics go to stderr.
 */
const token = process.env['LAZYKOINS_MCP_TOKEN']?.trim() || undefined;

const transport = new StdioServerTransport();

transport.onmessage = (message: JSONRPCMessage) => {
  // The port changes with every start of the app: look it up for every message.
  const { url } = resolveMcpEndpoint(process.env, process.platform, homedir());
  void forwardMcpMessage(
    message as unknown as JsonRpcMessage,
    { url, token },
    fetch as unknown as FetchLike,
  )
    .then((replies) =>
      Promise.all(
        replies.map((reply) =>
          transport.send(reply as unknown as JSONRPCMessage),
        ),
      ),
    )
    .catch((error: unknown) => {
      process.stderr.write(`lazy-koins mcp: ${String(error)}\n`);
    });
};

transport.onerror = (error) => {
  process.stderr.write(`lazy-koins mcp: ${error.message}\n`);
};

transport.onclose = () => process.exit(0);
// The client closed our stdin: the session is over.
process.stdin.on('end', () => process.exit(0));

void transport.start();
