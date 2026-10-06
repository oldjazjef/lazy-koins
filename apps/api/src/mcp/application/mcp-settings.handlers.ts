import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import {
  type AssistantSettings,
  cleanAreas,
  defaultAssistantSettings,
} from '../../assistant/domain/assistant-settings';
import { AssistantSettingsRepositoryPort } from '../../assistant/ports/assistant.repository.port';
import { ToolRegistry } from '../../tools/application/tool-registry';
import {
  availableIn,
  type ToolArea,
  type ToolEffect,
} from '../../tools/domain/tool';
import type { ToolAuditEntry } from '../../tools/domain/tool-audit';
import { ToolAuditRepositoryPort } from '../../tools/ports/tool-audit.repository.port';
import { localMcpEndpoint, MCP_PATH } from '../domain/mcp-endpoint';
import {
  generateMcpToken,
  hashMcpToken,
  type McpToken,
  mcpTokenHint,
  type McpTokenState,
  tokenState,
} from '../domain/mcp-token';
import { McpTokenRepositoryPort } from '../ports/mcp-token.repository.port';

/** Process-wide MCP facts (bound in `McpModule`). */
export class McpRuntime {
  constructor(
    /** `local` = the desktop app (loopback, stdio proxy). */
    readonly desktop: boolean,
    /** `PUBLIC_API_URL` — the server's public origin. */
    readonly publicApiUrl: string,
  ) {}

  endpoint(): string {
    return this.desktop
      ? (localMcpEndpoint() ?? `http://127.0.0.1${MCP_PATH}`)
      : `${this.publicApiUrl.replace(/\/+$/, '')}${MCP_PATH}`;
  }
}

export interface McpToolInfo {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly area: ToolArea;
  readonly effect: ToolEffect;
}

export interface McpSettingsView {
  readonly enabled: boolean;
  readonly areas: readonly ToolArea[];
  readonly allowWrite: boolean;
  /** The URL clients connect to (Streamable HTTP). */
  readonly endpoint: string;
  readonly mode: 'web' | 'desktop';
  /** Every MCP tool with its area and effect — the settings list them with descriptions. */
  readonly tools: readonly McpToolInfo[];
}

async function settingsOf(
  repository: AssistantSettingsRepositoryPort,
  userId: string,
): Promise<AssistantSettings> {
  return (await repository.find(userId)) ?? defaultAssistantSettings(userId);
}

function view(
  settings: AssistantSettings,
  runtime: McpRuntime,
  registry: ToolRegistry,
): McpSettingsView {
  return {
    enabled: settings.mcpEnabled,
    areas: settings.mcpAreas,
    allowWrite: settings.mcpAllowWrite,
    endpoint: runtime.endpoint(),
    mode: runtime.desktop ? 'desktop' : 'web',
    tools: registry
      .all()
      .filter((tool) => availableIn(tool, 'mcp') && tool.area !== 'ui')
      .map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        area: tool.area as ToolArea,
        effect: tool.effect,
      })),
  };
}

export class GetMcpSettingsQuery {
  constructor(readonly userId: string) {}
}

@QueryHandler(GetMcpSettingsQuery)
export class GetMcpSettingsHandler implements IQueryHandler<
  GetMcpSettingsQuery,
  McpSettingsView
> {
  constructor(
    private readonly settings: AssistantSettingsRepositoryPort,
    private readonly runtime: McpRuntime,
    private readonly registry: ToolRegistry,
  ) {}

  async execute({ userId }: GetMcpSettingsQuery): Promise<McpSettingsView> {
    return view(
      await settingsOf(this.settings, userId),
      this.runtime,
      this.registry,
    );
  }
}

export interface SaveMcpSettingsInput {
  readonly enabled: boolean;
  readonly areas: readonly string[];
  readonly allowWrite: boolean;
}

export class SaveMcpSettingsCommand {
  constructor(
    readonly userId: string,
    readonly input: SaveMcpSettingsInput,
  ) {}
}

/** F11.16: on/off (default off), the areas and whether write tools are allowed. */
@CommandHandler(SaveMcpSettingsCommand)
export class SaveMcpSettingsHandler implements ICommandHandler<
  SaveMcpSettingsCommand,
  McpSettingsView
> {
  constructor(
    private readonly settings: AssistantSettingsRepositoryPort,
    private readonly runtime: McpRuntime,
    private readonly registry: ToolRegistry,
  ) {}

  async execute({
    userId,
    input,
  }: SaveMcpSettingsCommand): Promise<McpSettingsView> {
    const current = await settingsOf(this.settings, userId);
    const { userId: _id, updatedAt: _at, ...rest } = current;
    return view(
      await this.settings.save(userId, {
        ...rest,
        mcpEnabled: input.enabled,
        mcpAreas: cleanAreas(input.areas),
        mcpAllowWrite: input.allowWrite,
      }),
      this.runtime,
      this.registry,
    );
  }
}

// --- Personal access tokens ---

export interface McpTokenView {
  readonly id: string;
  readonly name: string;
  readonly hint: string;
  readonly state: McpTokenState;
  readonly expiresAt: string | null;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
  readonly createdAt: string;
}

export function tokenView(token: McpToken, now = new Date()): McpTokenView {
  return {
    id: token.id,
    name: token.name,
    hint: token.tokenHint,
    state: tokenState(token, now),
    expiresAt: token.expiresAt,
    lastUsedAt: token.lastUsedAt,
    revokedAt: token.revokedAt,
    createdAt: token.createdAt,
  };
}

export class ListMcpTokensQuery {
  constructor(readonly userId: string) {}
}

@QueryHandler(ListMcpTokensQuery)
export class ListMcpTokensHandler implements IQueryHandler<
  ListMcpTokensQuery,
  McpTokenView[]
> {
  constructor(private readonly tokens: McpTokenRepositoryPort) {}

  async execute({ userId }: ListMcpTokensQuery): Promise<McpTokenView[]> {
    const now = new Date();
    return (await this.tokens.listByUser(userId)).map((t) => tokenView(t, now));
  }
}

/** Longest lifetime a token may get (a year); "no expiry" is allowed explicitly. */
export const MAX_TOKEN_DAYS = 365;
/** Active tokens per user. */
export const MAX_ACTIVE_TOKENS = 20;

export class CreateMcpTokenCommand {
  constructor(
    readonly userId: string,
    readonly name: string,
    /** null = no expiry. */
    readonly expiresInDays: number | null,
  ) {}
}

export interface CreatedMcpToken {
  /** Shown exactly once — only its hash is stored. */
  readonly token: string;
  readonly info: McpTokenView;
}

@CommandHandler(CreateMcpTokenCommand)
export class CreateMcpTokenHandler implements ICommandHandler<
  CreateMcpTokenCommand,
  CreatedMcpToken
> {
  constructor(private readonly tokens: McpTokenRepositoryPort) {}

  async execute({
    userId,
    name,
    expiresInDays,
  }: CreateMcpTokenCommand): Promise<CreatedMcpToken> {
    const now = new Date();
    const active = (await this.tokens.listByUser(userId)).filter(
      (token) => tokenState(token, now) === 'active',
    );
    if (active.length >= MAX_ACTIVE_TOKENS) {
      throw new ConflictException({
        statusCode: 409,
        message: `At most ${MAX_ACTIVE_TOKENS} active tokens — revoke one first`,
        code: 'tooManyTokens',
      });
    }
    if (
      expiresInDays !== null &&
      (!Number.isInteger(expiresInDays) ||
        expiresInDays < 1 ||
        expiresInDays > MAX_TOKEN_DAYS)
    ) {
      throw new UnprocessableEntityException(
        `expiresInDays must be 1 to ${MAX_TOKEN_DAYS}`,
      );
    }
    const token = generateMcpToken();
    const stored = await this.tokens.create(userId, {
      name: name.trim(),
      tokenHash: hashMcpToken(token),
      tokenHint: mcpTokenHint(token),
      expiresAt:
        expiresInDays === null
          ? null
          : new Date(now.getTime() + expiresInDays * 86_400_000).toISOString(),
    });
    return { token, info: tokenView(stored, now) };
  }
}

export class RevokeMcpTokenCommand {
  constructor(
    readonly userId: string,
    readonly tokenId: string,
  ) {}
}

@CommandHandler(RevokeMcpTokenCommand)
export class RevokeMcpTokenHandler implements ICommandHandler<
  RevokeMcpTokenCommand,
  McpTokenView
> {
  constructor(private readonly tokens: McpTokenRepositoryPort) {}

  async execute({
    userId,
    tokenId,
  }: RevokeMcpTokenCommand): Promise<McpTokenView> {
    const token = await this.tokens.findById(tokenId);
    if (!token || token.userId !== userId) {
      throw new NotFoundException('Token not found');
    }
    if (token.revokedAt) return tokenView(token);
    return tokenView(
      await this.tokens.revoke(token.id, new Date().toISOString()),
    );
  }
}

// --- Audit log ---

export class ListToolAuditQuery {
  constructor(
    readonly userId: string,
    readonly source: 'chat' | 'mcp' | undefined,
    readonly limit: number,
  ) {}
}

@QueryHandler(ListToolAuditQuery)
export class ListToolAuditHandler implements IQueryHandler<
  ListToolAuditQuery,
  ToolAuditEntry[]
> {
  constructor(private readonly audit: ToolAuditRepositoryPort) {}

  execute({
    userId,
    source,
    limit,
  }: ListToolAuditQuery): Promise<ToolAuditEntry[]> {
    return this.audit.listByUser(userId, {
      ...(source ? { source } : {}),
      limit: Math.min(Math.max(limit, 1), 500),
    });
  }
}
