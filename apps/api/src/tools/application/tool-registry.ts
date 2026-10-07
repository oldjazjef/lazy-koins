import { z } from 'zod';
import { calculationTools } from '../definitions/calculation.tools';
import type { ToolServices } from '../definitions/common';
import { exportTools } from '../definitions/export.tools';
import { fileTools } from '../definitions/file.tools';
import { libraryTools } from '../definitions/library.tools';
import { mappingTools } from '../definitions/mapping.tools';
import { projectTools } from '../definitions/project.tools';
import { rateTools } from '../definitions/rate.tools';
import { settingsTools } from '../definitions/settings.tools';
import { walletTools } from '../definitions/wallet.tools';
import {
  type AnyTool,
  availableIn,
  type ToolArea,
  type ToolSource,
} from '../domain/tool';
import { identityFieldsOf } from '../domain/tool-scope';

/** Every tool of the app, built over the application services. */
export function buildTools(services: ToolServices): AnyTool[] {
  return [
    ...projectTools(services),
    ...fileTools(services),
    ...mappingTools(services),
    // Web only: on the desktop (AUTH_MODE=local) the library does not exist.
    ...(services.library?.enabled ? libraryTools(services.library) : []),
    ...rateTools(services),
    ...calculationTools(services),
    ...exportTools(services),
    ...walletTools(services),
    ...settingsTools(services),
  ];
}

/** Which tools an MCP client sees (Einstellungen › MCP). */
export interface McpToolPolicy {
  readonly areas: readonly ToolArea[];
  readonly allowWrite: boolean;
}

export type JsonSchema = Record<string, unknown>;

/** zod → JSON Schema for the model / MCP (`$schema` removed, always an object at the top). */
export function jsonSchemaOf(
  schema: z.ZodType,
  io: 'input' | 'output',
): JsonSchema {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, {
    io,
    unrepresentable: 'any',
  }) as JsonSchema;
  return rest['type'] === 'object' ? rest : { type: 'object', ...rest };
}

/**
 * The one tool layer's catalogue (F11.14, F11.16): the chat and the MCP server list and look up
 * tools here; `ToolExecutor` runs them. Names are unique — a duplicate is a programming error.
 */
export class ToolRegistry {
  private readonly byName = new Map<string, AnyTool>();
  private readonly schemas = new Map<
    string,
    { input: JsonSchema; output: JsonSchema }
  >();

  constructor(tools: readonly AnyTool[]) {
    for (const tool of tools) {
      if (!/^[a-z][a-z0-9_]{2,63}$/.test(tool.name)) {
        throw new Error(`Invalid tool name: ${tool.name}`);
      }
      if (this.byName.has(tool.name)) {
        throw new Error(`Duplicate tool: ${tool.name}`);
      }
      // User scoping (F11.16): who a tool acts for comes from the authenticated context only —
      // an input field that could name a user (userId, ownerId, …) is a programming error.
      const identity = identityFieldsOf(jsonSchemaOf(tool.input, 'input'));
      if (identity.length > 0) {
        throw new Error(
          `Tool ${tool.name} must not take a user/owner argument: ${identity.join(', ')}`,
        );
      }
      this.byName.set(tool.name, tool);
    }
  }

  static over(services: ToolServices): ToolRegistry {
    return new ToolRegistry(buildTools(services));
  }

  all(): AnyTool[] {
    return [...this.byName.values()];
  }

  get(name: string): AnyTool | undefined {
    return this.byName.get(name);
  }

  /** The chat sees every tool of its channel; writes become proposals there. */
  forChat(): AnyTool[] {
    return this.all().filter((tool) => availableIn(tool, 'chat'));
  }

  /** MCP: only the enabled areas, write/destructive tools only with the switch on. */
  forMcp(policy: McpToolPolicy): AnyTool[] {
    return this.all().filter((tool) => this.allowed(tool, 'mcp', policy));
  }

  allowed(tool: AnyTool, source: ToolSource, policy?: McpToolPolicy): boolean {
    if (!availableIn(tool, source)) return false;
    if (source === 'chat' || !policy) return source === 'chat';
    return (
      tool.area !== 'ui' &&
      policy.areas.includes(tool.area) &&
      (tool.effect === 'readOnly' || policy.allowWrite)
    );
  }

  schemaOf(tool: AnyTool): { input: JsonSchema; output: JsonSchema } {
    let schemas = this.schemas.get(tool.name);
    if (!schemas) {
      schemas = {
        input: jsonSchemaOf(tool.input, 'input'),
        output: jsonSchemaOf(tool.output, 'output'),
      };
      this.schemas.set(tool.name, schemas);
    }
    return schemas;
  }
}
