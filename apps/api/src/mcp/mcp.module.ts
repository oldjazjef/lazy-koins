import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import type { Env } from '../config/env';
import { PinModule } from '../pin/pin.module';
import { ToolsModule } from '../tools/tools.module';
import { McpAccess } from './application/mcp-access';
import {
  CreateMcpTokenHandler,
  GetMcpSettingsHandler,
  ListMcpTokensHandler,
  ListToolAuditHandler,
  McpRuntime,
  RevokeMcpTokenHandler,
  SaveMcpSettingsHandler,
} from './application/mcp-settings.handlers';
import { McpController, McpSettingsController } from './mcp.controller';
import { McpService } from './mcp.service';

/**
 * F11.16: the MCP server over the shared tool layer (Streamable HTTP at `/api/mcp`, personal
 * access tokens, per-token rate limit) and Einstellungen › MCP (switches, tokens, audit log).
 */
@Module({
  imports: [CqrsModule, ToolsModule, PinModule],
  controllers: [McpController, McpSettingsController],
  providers: [
    McpService,
    McpAccess,
    {
      provide: McpRuntime,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new McpRuntime(
          config.get('AUTH_MODE', { infer: true }) === 'local',
          config.get('PUBLIC_API_URL', { infer: true }),
        ),
    },
    GetMcpSettingsHandler,
    SaveMcpSettingsHandler,
    ListMcpTokensHandler,
    CreateMcpTokenHandler,
    RevokeMcpTokenHandler,
    ListToolAuditHandler,
  ],
})
export class McpModule {}
