import { HttpException, Injectable, Logger } from '@nestjs/common';
import { redactSecrets } from '../../integrations/ai/redact';
import { summarizeArgs } from '../domain/args-summary';
import {
  type AnyTool,
  type ToolContext,
  ToolError,
  type ToolErrorCode,
  type ToolPreview,
} from '../domain/tool';
import type { ToolAuditStatus } from '../domain/tool-audit';
import { ToolAuditRepositoryPort } from '../ports/tool-audit.repository.port';
import { type McpToolPolicy, ToolRegistry } from './tool-registry';

/** A failed call as the model or the MCP client sees it — redacted, no stack. */
export interface ToolFailure {
  readonly code: ToolErrorCode;
  readonly message: string;
  /** The HTTP status of the service's answer (404, 409 …), when there was one. */
  readonly status?: number;
}

export type ToolCallResult =
  | { readonly ok: true; readonly tool: AnyTool; readonly output: unknown }
  | {
      readonly ok: false;
      readonly tool: AnyTool | undefined;
      readonly error: ToolFailure;
    };

export interface ToolCallOptions {
  /** MCP: the user's switches. Required for `source: 'mcp'`. */
  readonly policy?: McpToolPolicy;
  /** Chat: a write/destructive tool runs only from a confirmed proposal. */
  readonly confirmed?: boolean;
}

/**
 * Runs tools of the registry for the acting user (owner scoping is the services' — every call
 * passes `context.userId`): validates the arguments with the tool's zod schema, applies the
 * policy (MCP areas + write switch; chat writes only when confirmed), runs it, parses the result
 * through the output schema (an allow-list), maps service errors to codes and **audits every
 * call** (`tool_audit`: user, source, tool, redacted argument summary, outcome, duration).
 */
@Injectable()
export class ToolExecutor {
  private readonly logger = new Logger(ToolExecutor.name);

  constructor(
    readonly registry: ToolRegistry,
    private readonly audit: ToolAuditRepositoryPort,
  ) {}

  async call(
    context: ToolContext,
    name: string,
    args: unknown,
    options: ToolCallOptions = {},
  ): Promise<ToolCallResult> {
    const started = Date.now();
    const tool = this.registry.get(name);
    const finish = async (
      result: ToolCallResult,
      status: ToolAuditStatus,
    ): Promise<ToolCallResult> => {
      await this.record(context, name, args, status, result, started);
      return result;
    };
    try {
      if (
        !tool ||
        !this.registry.allowed(tool, context.source, options.policy)
      ) {
        const refusal = tool ? this.refusal(tool, context, options) : undefined;
        return finish(
          {
            ok: false,
            tool,
            error: refusal ?? {
              code: 'unknownTool',
              message: `No tool named "${name}" is available here`,
            },
          },
          refusal ? 'refused' : 'error',
        );
      }
      if (
        context.source === 'chat' &&
        tool.effect !== 'readOnly' &&
        !options.confirmed
      ) {
        return finish(
          {
            ok: false,
            tool,
            error: {
              code: 'refused',
              message: 'A change runs only after the user confirmed it',
            },
          },
          'refused',
        );
      }
      const input = this.parse(tool, args);
      const output = tool.output.parse(await tool.run(context, input));
      return finish({ ok: true, tool, output }, 'ok');
    } catch (error) {
      return finish({ ok: false, tool, error: failureOf(error) }, 'error');
    }
  }

  /** The validated arguments, or a `ToolError('invalidArguments')` naming the problems. */
  parse(tool: AnyTool, args: unknown): unknown {
    const parsed = tool.input.safeParse(args ?? {});
    if (!parsed.success) {
      throw new ToolError(
        'invalidArguments',
        parsed.error.issues
          .slice(0, 8)
          .map(
            (issue) =>
              `${issue.path.join('.') || '(arguments)'}: ${issue.message}`,
          )
          .join('; '),
      );
    }
    return parsed.data;
  }

  /** The proposal card's content; falls back to the arguments when the tool has no preview. */
  async preview(
    context: ToolContext,
    tool: AnyTool,
    input: unknown,
  ): Promise<ToolPreview> {
    if (tool.preview) {
      try {
        return await tool.preview(context, input);
      } catch (error) {
        // A failing preview (a 404 for a wrong id) still shows the arguments; running will fail.
        this.logger.debug(`preview of ${tool.name} failed: ${String(error)}`);
      }
    }
    const projectId =
      typeof (input as { projectId?: unknown }).projectId === 'string'
        ? (input as { projectId: string }).projectId
        : undefined;
    return {
      summary: tool.title,
      changes: Object.entries(input as Record<string, unknown>)
        .filter(([key]) => key !== 'projectId')
        .map(([key, value]) => ({
          label: key,
          before: null,
          after: redactSecrets(
            typeof value === 'string' ? value : JSON.stringify(value),
          ).slice(0, 200),
        })),
      ...(projectId ? { projectId } : {}),
    };
  }

  /** Audits a proposal (the tool did not run yet). */
  async proposed(
    context: ToolContext,
    name: string,
    args: unknown,
  ): Promise<void> {
    await this.audit.add({
      userId: context.userId,
      source: context.source,
      tool: name,
      args: summarizeArgs(args),
      status: 'proposed',
      errorCode: null,
      durationMs: 0,
      tokenId: context.tokenId ?? null,
    });
  }

  private refusal(
    tool: AnyTool,
    context: ToolContext,
    options: ToolCallOptions,
  ): ToolFailure | undefined {
    if (context.source !== 'mcp' || !options.policy) return undefined;
    if (tool.area === 'ui' || !options.policy.areas.includes(tool.area)) {
      return {
        code: 'areaDisabled',
        message: `The area "${tool.area}" is not enabled for MCP (Einstellungen › MCP)`,
      };
    }
    if (tool.effect !== 'readOnly' && !options.policy.allowWrite) {
      return {
        code: 'writeDisabled',
        message:
          'Write tools are switched off for MCP (Einstellungen › MCP › "Schreibende Werkzeuge erlauben")',
      };
    }
    return undefined;
  }

  private async record(
    context: ToolContext,
    name: string,
    args: unknown,
    status: ToolAuditStatus,
    result: ToolCallResult,
    started: number,
  ): Promise<void> {
    try {
      await this.audit.add({
        userId: context.userId,
        source: context.source,
        tool: name.slice(0, 100),
        args: summarizeArgs(args),
        status,
        errorCode: result.ok ? null : result.error.code,
        durationMs: Math.max(0, Date.now() - started),
        tokenId: context.tokenId ?? null,
      });
    } catch (error) {
      // The call happened; a failing audit write must not turn it into an error — but say so.
      this.logger.error(`tool audit failed for ${name}: ${String(error)}`);
    }
  }
}

/** A service error as a tool failure: Nest HTTP exceptions keep their status and message. */
export function failureOf(error: unknown): ToolFailure {
  if (error instanceof ToolError) {
    return { code: error.code, message: redactSecrets(error.message) };
  }
  if (error instanceof HttpException) {
    const status = error.getStatus();
    const body = error.getResponse();
    const message =
      typeof body === 'string'
        ? body
        : messageOf(body as Record<string, unknown>) || error.message;
    return {
      code:
        status === 404
          ? 'notFound'
          : status === 409
            ? 'conflict'
            : status === 400 || status === 422
              ? 'invalidArguments'
              : status === 403
                ? 'refused'
                : 'failed',
      message: redactSecrets(message),
      status,
    };
  }
  return {
    code: 'failed',
    message: redactSecrets(
      error instanceof Error ? error.message : 'The tool failed',
    ),
  };
}

function messageOf(body: Record<string, unknown>): string {
  const parts: string[] = [];
  const message = body['message'];
  if (typeof message === 'string') parts.push(message);
  if (Array.isArray(message)) parts.push(message.map(String).join('; '));
  for (const key of ['code', 'detail']) {
    if (typeof body[key] === 'string') parts.push(`${key}: ${body[key]}`);
  }
  if (Array.isArray(body['issues'])) {
    parts.push(`issues: ${JSON.stringify(body['issues']).slice(0, 400)}`);
  }
  return parts.join(' · ');
}
