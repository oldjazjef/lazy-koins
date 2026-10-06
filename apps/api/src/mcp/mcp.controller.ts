import {
  All,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { BEARER_SCHEME } from '../openapi/security-schemes';
import { ToolExecutor } from '../tools/application/tool-executor';
import type { ToolAuditEntry } from '../tools/domain/tool-audit';
import { McpAccess, McpAccessError } from './application/mcp-access';
import { createMcpServer } from './application/mcp-server';
import type {
  CreatedMcpToken,
  McpSettingsView,
  McpTokenView,
} from './application/mcp-settings.handlers';
import {
  AuditQueryDto,
  CreateMcpTokenDto,
  SaveMcpSettingsDto,
} from './dto/mcp.dto';
import { McpService } from './mcp.service';

const OBJECT = { schema: { type: 'object' } };

/**
 * F11.16: the MCP server — Streamable HTTP, stateless (a server + transport per request, JSON
 * answers). Authenticated by a personal access token, not by the app's login: the route is
 * `@Public()` for the global guard (which never accepts a PAT anywhere else) and checks the
 * token itself. Rate-limited per token (`McpAccess`); the per-IP budget still applies.
 */
@ApiTags('mcp')
@Public()
@SkipThrottle({ writes: true })
@Controller('mcp')
export class McpController {
  constructor(
    private readonly access: McpAccess,
    private readonly executor: ToolExecutor,
  ) {}

  @Post()
  @ApiOperation({
    summary:
      'MCP Streamable HTTP endpoint (JSON-RPC). Authorization: Bearer <personal access token>',
  })
  async handle(@Req() request: Request, @Res() response: Response) {
    let principal;
    try {
      principal = await this.access.authenticate(request.headers.authorization);
    } catch (error) {
      if (!(error instanceof McpAccessError)) throw error;
      if (error.status === 401) {
        response.setHeader('WWW-Authenticate', 'Bearer realm="lazy-koins-mcp"');
      }
      response.status(error.status).json({
        jsonrpc: '2.0',
        error: {
          code: -32001,
          message: error.message,
          data: { code: error.code },
        },
        id: null,
      });
      return;
    }
    const server = createMcpServer(this.executor, principal);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    response.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(request, response, request.body);
  }

  /** Stateless server: no SSE stream to open (GET) and no session to end (DELETE). */
  @All()
  notAllowed(@Res() response: Response) {
    response
      .status(405)
      .setHeader('Allow', 'POST')
      .json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed.' },
        id: null,
      });
  }
}

/** Einstellungen › MCP: switches, tokens, audit log. */
@ApiTags('mcp')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('settings/mcp')
export class McpSettingsController {
  constructor(private readonly mcp: McpService) {}

  @Get()
  @ApiOperation({
    summary: 'MCP on/off, areas, write switch, endpoint and the tool list',
  })
  @ApiOkResponse(OBJECT)
  settings(@CurrentUser() user: AuthenticatedUser): Promise<McpSettingsView> {
    return this.mcp.settings(user.userId);
  }

  @Put()
  @ApiOperation({ summary: 'Switch MCP on/off, choose areas, allow writes' })
  @ApiOkResponse(OBJECT)
  save(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SaveMcpSettingsDto,
  ): Promise<McpSettingsView> {
    return this.mcp.saveSettings(user.userId, body);
  }

  @Get('tokens')
  @ApiOperation({ summary: 'My personal access tokens (never the token)' })
  @ApiOkResponse(OBJECT)
  tokens(@CurrentUser() user: AuthenticatedUser): Promise<McpTokenView[]> {
    return this.mcp.tokens(user.userId);
  }

  @Post('tokens')
  @ApiOperation({
    summary: 'Create a token — the answer is the only time it is shown',
  })
  @ApiCreatedResponse(OBJECT)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateMcpTokenDto,
  ): Promise<CreatedMcpToken> {
    return this.mcp.createToken(
      user.userId,
      body.name,
      body.expiresInDays ?? null,
    );
  }

  @Delete('tokens/:id')
  @ApiOperation({ summary: 'Revoke a token (it stays listed as revoked)' })
  @ApiOkResponse(OBJECT)
  revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<McpTokenView> {
    return this.mcp.revokeToken(user.userId, id);
  }

  @Get('audit')
  @ApiOperation({
    summary: 'Tool calls of the chat and the MCP server, newest first',
  })
  @ApiOkResponse(OBJECT)
  audit(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AuditQueryDto,
  ): Promise<ToolAuditEntry[]> {
    return this.mcp.audit(user.userId, query.source, query.limit ?? 200);
  }
}
