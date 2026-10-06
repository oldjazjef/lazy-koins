import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { ProjectFileResponseDto } from '../files/dto/project-file.dto';
import { MappingResponseDto } from '../mappings/dto/mapping.dto';
import { BEARER_SCHEME } from '../openapi/security-schemes';
import { AiService } from './ai.service';
import {
  AcceptAiMappingDto,
  AcceptStatementDto,
  AiConnectionTestResponseDto,
  AiConsentDto,
  AiRequestPreviewResponseDto,
  AiSettingsResponseDto,
  MappingCandidateResponseDto,
  SaveAiSettingsDto,
  StatementCandidateResponseDto,
} from './dto/ai.dto';

/** Provider calls cost money and time: at most 30 per account in 10 minutes. */
const AI_BUDGET = { writes: { limit: 30, ttl: 10 * 60_000 } };

const AI_CONFLICT =
  'body.code: aiDisabled | aiNotConfigured | consentRequired | keyUnreadable | privateUrl | invalidUrl';
const AI_GATEWAY =
  'The provider failed — body.code: invalidKey | rateLimited | network | timeout | badResponse | providerError | modelNotFound';

@ApiTags('ai')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('ai')
export class AiSettingsController {
  constructor(private readonly ai: AiService) {}

  @Get('settings')
  @ApiOperation({
    summary: 'My AI plugin settings (F5.13) — the key only as a hint',
  })
  @ApiOkResponse({ type: AiSettingsResponseDto })
  settings(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AiSettingsResponseDto> {
    return this.ai.settings(user.userId);
  }

  @Put('settings')
  @ApiOperation({
    summary:
      'Save provider, address, model, key (encrypted at rest) and on/off',
  })
  @ApiOkResponse({ type: AiSettingsResponseDto })
  @ApiUnprocessableEntityResponse({
    description: 'body.code: invalidUrl | privateUrl | encryptionUnavailable',
  })
  save(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SaveAiSettingsDto,
  ): Promise<AiSettingsResponseDto> {
    return this.ai.saveSettings(user.userId, dto);
  }

  @Post('settings/test')
  @HttpCode(200)
  @Throttle(AI_BUDGET)
  @ApiOperation({
    summary: 'One tiny request without user data, with the saved settings',
  })
  @ApiOkResponse({ type: AiConnectionTestResponseDto })
  @ApiConflictResponse({ description: AI_CONFLICT })
  @ApiBadGatewayResponse({ description: AI_GATEWAY })
  test(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AiConnectionTestResponseDto> {
    return this.ai.testConnection(user.userId);
  }
}

@ApiTags('ai')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('projects/:projectId/files/:fileId/ai')
export class AiFilesController {
  constructor(private readonly ai: AiService) {}

  @Get('mapping/payload')
  @ApiOperation({
    summary:
      'F5.14: exactly what would be sent to write a mapping — nothing is sent',
  })
  @ApiOkResponse({ type: AiRequestPreviewResponseDto })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: AI_CONFLICT })
  mappingPayload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<AiRequestPreviewResponseDto> {
    return this.ai.mappingPayload(user.userId, projectId, fileId);
  }

  @Post('mapping')
  @HttpCode(200)
  @Throttle(AI_BUDGET)
  @ApiOperation({
    summary:
      'F5.13: let the AI write a mapping for this file — a proposal, nothing is saved',
    description:
      'Sends the sample from `mapping/payload`, validates the answer, dry-runs it on the whole file and, if needed, asks once more with the concrete errors.',
  })
  @ApiOkResponse({ type: MappingCandidateResponseDto })
  @ApiConflictResponse({ description: AI_CONFLICT })
  @ApiBadGatewayResponse({ description: AI_GATEWAY })
  async generateMapping(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Body() dto: AiConsentDto,
  ): Promise<MappingCandidateResponseDto> {
    return MappingCandidateResponseDto.from(
      await this.ai.generateMapping(
        user.userId,
        projectId,
        fileId,
        dto.consent === true,
      ),
    );
  }

  @Post('mapping/accept')
  @ApiOperation({
    summary:
      'Save the reviewed spec as a mapping (origin ai) and read the file with it',
  })
  @ApiCreatedResponse({ description: '{ mapping, file }' })
  @ApiConflictResponse({ description: 'The project is closed (F4.5)' })
  async acceptMapping(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Body() dto: AcceptAiMappingDto,
  ): Promise<{ mapping: MappingResponseDto; file: ProjectFileResponseDto }> {
    const accepted = await this.ai.acceptMapping(
      user.userId,
      projectId,
      fileId,
      dto.spec,
    );
    return {
      mapping: MappingResponseDto.from(accepted.mapping),
      file: ProjectFileResponseDto.from(accepted.file),
    };
  }

  @Get('statement/payload')
  @ApiOperation({
    summary:
      'F5.14: the PDF text that would be sent to read the balances — nothing is sent',
  })
  @ApiOkResponse({ type: AiRequestPreviewResponseDto })
  @ApiConflictResponse({ description: AI_CONFLICT })
  @ApiUnprocessableEntityResponse({
    description: 'Not a PDF, or no text in it (code noText)',
  })
  statementPayload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<AiRequestPreviewResponseDto> {
    return this.ai.statementPayload(user.userId, projectId, fileId);
  }

  @Post('statement')
  @HttpCode(200)
  @Throttle(AI_BUDGET)
  @ApiOperation({
    summary:
      'Read the balances of a PDF statement with the AI — a proposal, nothing is saved',
  })
  @ApiOkResponse({ type: StatementCandidateResponseDto })
  @ApiConflictResponse({ description: AI_CONFLICT })
  @ApiBadGatewayResponse({ description: AI_GATEWAY })
  async extractStatement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Body() dto: AiConsentDto,
  ): Promise<StatementCandidateResponseDto> {
    return StatementCandidateResponseDto.from(
      await this.ai.extractStatement(
        user.userId,
        projectId,
        fileId,
        dto.consent === true,
      ),
    );
  }

  @Post('statement/accept')
  @ApiOperation({
    summary:
      'Store the confirmed balances as a derived standard-format CSV (origin derived_from); the PDF stays',
  })
  @ApiCreatedResponse({ type: ProjectFileResponseDto })
  @ApiConflictResponse({
    description: 'Closed project, or the same CSV is already there',
  })
  async acceptStatement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Body() dto: AcceptStatementDto,
  ): Promise<ProjectFileResponseDto> {
    return ProjectFileResponseDto.from(
      await this.ai.acceptStatement(
        user.userId,
        projectId,
        fileId,
        dto.holdings,
      ),
    );
  }
}
