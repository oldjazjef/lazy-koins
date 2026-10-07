#!/usr/bin/env node
/**
 * A tiny MCP client (official SDK) for checking lazy-koins' MCP server by hand (F11.16).
 *
 *   node scripts/dev/mcp-client.mjs <endpoint> [tool] [json-arguments]
 *     LAZYKOINS_MCP_TOKEN=lkmcp_…   the personal access token (Einstellungen › MCP),
 *     or LAZYKOINS_MCP_TOKEN_FILE=<file holding it>
 *
 *   node scripts/dev/mcp-client.mjs http://localhost:3333/api/mcp
 *       → server info + the tool list (name, effect)
 *   node scripts/dev/mcp-client.mjs http://localhost:3333/api/mcp list_projects
 *   node scripts/dev/mcp-client.mjs http://localhost:3333/api/mcp get_result '{"projectId":"…"}'
 *
 * Or over stdio through the desktop proxy (`mcp-stdio.js`):
 *   node scripts/dev/mcp-client.mjs --stdio <path/to/mcp-stdio.js> [tool] [json]
 *
 * Prints results as JSON; the token is never printed.
 */
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const args = process.argv.slice(2);
// LAZYKOINS_MCP_TOKEN_FILE keeps the token out of the shell history.
const token =
  process.env.LAZYKOINS_MCP_TOKEN ??
  (process.env.LAZYKOINS_MCP_TOKEN_FILE
    ? readFileSync(process.env.LAZYKOINS_MCP_TOKEN_FILE, 'utf8').trim()
    : undefined);
if (!token || args.length === 0) {
  console.error(
    'Usage: LAZYKOINS_MCP_TOKEN=lkmcp_… node scripts/dev/mcp-client.mjs <endpoint> | --stdio <mcp-stdio.js> [tool] [json]',
  );
  process.exit(2);
}

let transport;
if (args[0] === '--stdio') {
  args.shift();
  const script = args.shift();
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [script],
    env: { ...process.env, LAZYKOINS_MCP_TOKEN: token },
    // Diagnostics of the proxy go to our stderr; stdout carries JSON-RPC only.
    stderr: 'inherit',
  });
} else {
  transport = new StreamableHTTPClientTransport(new URL(args.shift()), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
}
const [tool, json] = args;

const client = new Client({ name: 'lazy-koins-dev-client', version: '1.0.0' });
try {
  await client.connect(transport);
  if (!tool) {
    const info = client.getServerVersion();
    const { tools } = await client.listTools();
    console.log(`${info?.name} ${info?.version} — ${tools.length} tools`);
    for (const t of tools) {
      const effect = t.annotations?.destructiveHint
        ? 'destructive'
        : t.annotations?.readOnlyHint
          ? 'read'
          : 'write';
      console.log(
        `  ${t.name.padEnd(28)} ${effect.padEnd(12)} ${t.title ?? ''}`,
      );
    }
  } else {
    const result = await client.callTool({
      name: tool,
      arguments: json ? JSON.parse(json) : {},
    });
    console.log(
      JSON.stringify(
        result.isError
          ? { isError: true, content: result.content }
          : (result.structuredContent ?? result.content),
        null,
        2,
      ),
    );
    if (result.isError) process.exitCode = 1;
  }
} catch (error) {
  console.error(
    `mcp-client: ${error instanceof Error ? error.message : error}`,
  );
  process.exitCode = 1;
} finally {
  await client.close();
}
