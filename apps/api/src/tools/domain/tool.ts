import type { z } from 'zod';

/**
 * The one tool layer (F11.14, F11.16): the chat sidebar and the MCP server call the same typed
 * tools. A tool = name, description, area, effect, zod input + output schema and a `run` that
 * calls an existing application service (never Prisma), always for the acting user.
 */

/** Areas a user can open or close for MCP (Einstellungen › MCP); `ui` is chat-only. */
export const TOOL_AREAS = [
  'projects',
  'files',
  'mappings',
  'rates',
  'results',
  'checks',
  'corrections',
  'exports',
  'wallets',
  'settings',
  'mail',
] as const;
export type ToolArea = (typeof TOOL_AREAS)[number];

/** `readOnly` runs right away; `write` / `destructive` need a confirmation (chat) or the MCP switch. */
export const TOOL_EFFECTS = ['readOnly', 'write', 'destructive'] as const;
export type ToolEffect = (typeof TOOL_EFFECTS)[number];

export const TOOL_SOURCES = ['chat', 'mcp'] as const;
export type ToolSource = (typeof TOOL_SOURCES)[number];

/** Who calls: the acting user (owner scoping), from where, and with which MCP token. */
export interface ToolContext {
  readonly userId: string;
  readonly source: ToolSource;
  readonly tokenId?: string;
}

/** One line of a proposal card: what changes, before → after (null = nothing / unknown). */
export interface ToolChange {
  readonly label: string;
  readonly before: string | null;
  readonly after: string | null;
}

/** What a write tool will do, shown before it runs (chat proposal card). */
export interface ToolPreview {
  readonly summary: string;
  readonly changes: readonly ToolChange[];
  /** The project concerned, for the card's link. */
  readonly projectId?: string;
}

export interface ToolDefinition<
  I extends z.ZodType = z.ZodType,
  O extends z.ZodType = z.ZodType,
> {
  /** `snake_case`, `^[a-z][a-z0-9_]{2,63}$` — valid for OpenAI, Anthropic and MCP. */
  readonly name: string;
  /** Short German title for cards and the MCP tool list. */
  readonly title: string;
  /** What it does and when to use it — for the model; English. */
  readonly description: string;
  readonly area: ToolArea | 'ui';
  readonly effect: ToolEffect;
  /** Default: both. `ui` tools are chat-only; byte uploads are MCP-only. */
  readonly channels?: readonly ToolSource[];
  readonly input: I;
  /** An allow-list: the result is parsed through it, so nothing else (no key) leaves the tool. */
  readonly output: O;
  run(context: ToolContext, input: z.output<I>): Promise<z.input<O>>;
  /** Before/after for the proposal card; without it the arguments are listed. */
  preview?(context: ToolContext, input: z.output<I>): Promise<ToolPreview>;
}

/** Erases the generics for lists of tools (`run`/`preview` are methods, hence bivariant). */
export type AnyTool = ToolDefinition;

/** Typed helper: the compiler checks `run` against the schemas. */
export function defineTool<I extends z.ZodType, O extends z.ZodType>(
  tool: ToolDefinition<I, O>,
): ToolDefinition<I, O> {
  return tool;
}

export function availableIn(tool: AnyTool, source: ToolSource): boolean {
  return (tool.channels ?? TOOL_SOURCES).includes(source);
}

/** Stable codes of a failed tool call (both the model and MCP clients see them). */
export const TOOL_ERROR_CODES = [
  'unknownTool',
  'invalidArguments',
  'areaDisabled',
  'writeDisabled',
  'notFound',
  'conflict',
  'refused',
  'failed',
] as const;
export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];

export class ToolError extends Error {
  constructor(
    readonly code: ToolErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}
