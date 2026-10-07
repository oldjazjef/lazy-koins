import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { BUILD_INFO } from '../../app/build-info';
import type { ToolExecutor } from '../../tools/application/tool-executor';
import type { McpToolPolicy } from '../../tools/application/tool-registry';
import type { AnyTool } from '../../tools/domain/tool';
import { toolContext } from '../../tools/domain/tool-scope';

/** Who is calling: the token's user and the user's MCP switches. */
export interface McpPrincipal {
  readonly userId: string;
  readonly tokenId: string;
  readonly policy: McpToolPolicy;
}

const INSTRUCTIONS = `lazy-koins turns crypto exchange and wallet exports into Swiss tax documents (wealth at 31.12. and income per tax year).
Start with list_projects; most tools take a projectId. Figures are decimal strings in CHF; every figure has a figureId for get_figure_records (the bookings behind it, with file and row).
Changes are corrections with a reason (set_price_override, reclassify_booking, create_correction) and need calculate_project afterwards. Closed projects are read-only (409).
Links in results are paths of the lazy-koins web app. No tool returns keys or passwords; the app gives no tax advice.`;

const EFFECT_NOTE: Record<AnyTool['effect'], string> = {
  readOnly: '',
  write: ' [Changes data.]',
  destructive: ' [Destructive: deletes or sends — cannot be undone.]',
};

/** A registry tool as an MCP tool: JSON Schemas from zod, annotations from its effect. */
export function mcpToolOf(
  tool: AnyTool,
  schemas: { input: Record<string, unknown>; output: Record<string, unknown> },
): Tool {
  return {
    name: tool.name,
    title: tool.title,
    description: `${tool.description}${EFFECT_NOTE[tool.effect]}`,
    inputSchema: schemas.input as Tool['inputSchema'],
    outputSchema: schemas.output as Tool['outputSchema'],
    annotations: {
      title: tool.title,
      readOnlyHint: tool.effect === 'readOnly',
      destructiveHint: tool.effect === 'destructive',
      openWorldHint: false,
    },
  };
}

/**
 * One MCP server per request (stateless Streamable HTTP): it exposes the tool layer filtered by
 * the user's settings (areas, write switch) and project summaries as resources; every call runs
 * through `ToolExecutor` (validation, policy, owner scoping, audit with `source: mcp`).
 */
export function createMcpServer(
  executor: ToolExecutor,
  principal: McpPrincipal,
): Server {
  const server = new Server(
    { name: 'lazy-koins', title: 'lazy-koins', version: BUILD_INFO.version },
    {
      capabilities: { tools: {}, resources: {} },
      instructions: INSTRUCTIONS,
    },
  );
  const registry = executor.registry;
  // User scoping (F11.16): the user comes ONLY from the authenticated token (`McpAccess`), never
  // from the request — not from tool arguments, `_meta`, resource URIs or a session id (there
  // is none: one server per request). Frozen, so no handler can change it.
  const context = toolContext({
    userId: principal.userId,
    source: 'mcp',
    tokenId: principal.tokenId,
  });

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: registry
      .forMcp(principal.policy)
      .map((tool) => mcpToolOf(tool, registry.schemaOf(tool))),
  }));

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request): Promise<CallToolResult> => {
      const result = await executor.call(
        context,
        request.params.name,
        request.params.arguments ?? {},
        { policy: principal.policy },
      );
      if (!result.ok) {
        return {
          isError: true,
          content: [
            { type: 'text', text: JSON.stringify({ error: result.error }) },
          ],
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result.output) }],
        structuredContent: result.output as Record<string, unknown>,
      };
    },
  );

  // Resources: one summary per project (only when the projects area is enabled).
  const projectsOpen = principal.policy.areas.includes('projects');
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    if (!projectsOpen) return { resources: [] };
    const listed = await executor.call(
      context,
      'list_projects',
      {},
      {
        policy: principal.policy,
      },
    );
    const projects = listed.ok
      ? (
          listed.output as {
            projects: { id: string; name: string; taxYear: number }[];
          }
        ).projects
      : [];
    return {
      resources: projects.map((project) => ({
        uri: `lazykoins://projects/${project.id}`,
        name: `${project.name} (${project.taxYear})`,
        mimeType: 'application/json',
        description: 'Project summary: facts and the latest result totals',
      })),
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const match = /^lazykoins:\/\/projects\/([^/]+)$/.exec(request.params.uri);
    if (!match?.[1] || !projectsOpen) {
      throw new Error(`Unknown resource: ${request.params.uri}`);
    }
    const projectId = decodeURIComponent(match[1]);
    const project = await executor.call(
      context,
      'get_project',
      { projectId },
      {
        policy: principal.policy,
      },
    );
    if (!project.ok) throw new Error(project.error.message);
    const result = principal.policy.areas.includes('results')
      ? await executor.call(
          context,
          'get_result',
          { projectId },
          {
            policy: principal.policy,
          },
        )
      : undefined;
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            project: project.output,
            ...(result?.ok ? { result: result.output } : {}),
          }),
        },
      ],
    };
  });

  return server;
}
