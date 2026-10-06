import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { ToolAuditEntry } from '../tools/domain/tool-audit';
import {
  type CreatedMcpToken,
  CreateMcpTokenCommand,
  GetMcpSettingsQuery,
  ListMcpTokensQuery,
  ListToolAuditQuery,
  type McpSettingsView,
  type McpTokenView,
  RevokeMcpTokenCommand,
  SaveMcpSettingsCommand,
  type SaveMcpSettingsInput,
} from './application/mcp-settings.handlers';

/** Thin façade over the buses — no logic here; it lives in the handlers. */
@Injectable()
export class McpService {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  settings(userId: string): Promise<McpSettingsView> {
    return this.queries.execute(new GetMcpSettingsQuery(userId));
  }

  saveSettings(
    userId: string,
    input: SaveMcpSettingsInput,
  ): Promise<McpSettingsView> {
    return this.commands.execute(new SaveMcpSettingsCommand(userId, input));
  }

  tokens(userId: string): Promise<McpTokenView[]> {
    return this.queries.execute(new ListMcpTokensQuery(userId));
  }

  createToken(
    userId: string,
    name: string,
    expiresInDays: number | null,
  ): Promise<CreatedMcpToken> {
    return this.commands.execute(
      new CreateMcpTokenCommand(userId, name, expiresInDays),
    );
  }

  revokeToken(userId: string, tokenId: string): Promise<McpTokenView> {
    return this.commands.execute(new RevokeMcpTokenCommand(userId, tokenId));
  }

  audit(
    userId: string,
    source: 'chat' | 'mcp' | undefined,
    limit: number,
  ): Promise<ToolAuditEntry[]> {
    return this.queries.execute(new ListToolAuditQuery(userId, source, limit));
  }
}
