import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { contentDisposition } from '../common/http/raw-body.middleware';
import { BEARER_SCHEME } from '../openapi/security-schemes';
import {
  DataExportQuery,
  type DataExportFile,
} from './application/data-export.handlers';
import {
  CreateExportDto,
  DataExportQueryDto,
  ExportResponseDto,
  MailDraftResponseDto,
} from './dto/exports.dto';
import { ExportsService } from './exports.service';

/** Rendering a PDF starts Chromium: a handful per account and minute. */
const EXPORT_BUDGET = { writes: { limit: 30, ttl: 10 * 60_000 } };

@ApiTags('exports')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('projects/:projectId')
export class ExportsController {
  constructor(
    private readonly exports: ExportsService,
    private readonly queries: QueryBus,
  ) {}

  @Get('data-export')
  @ApiOperation({
    summary:
      'Bookings and holdings in the standard format, CSV or XLSX, with corrections, price used and origin (F10.7)',
  })
  @ApiProduces(
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  @ApiNotFoundResponse()
  async dataExport(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: DataExportQueryDto,
  ): Promise<StreamableFile> {
    const file = await this.queries.execute<DataExportQuery, DataExportFile>(
      new DataExportQuery(
        user.userId,
        projectId,
        query.format,
        query.type ?? 'bookings',
        {
          platform: query.platform || undefined,
          accountId: query.account || undefined,
          asset: query.asset || undefined,
          kind: (query.kind || undefined) as DataExportQuery['filter']['kind'],
          from: query.from || undefined,
          to: query.to || undefined,
        },
      ),
    );
    return new StreamableFile(Buffer.from(file.bytes), {
      type: file.mediaType,
      length: file.bytes.length,
      disposition: contentDisposition(file.fileName),
    });
  }

  @Post('exports')
  @Throttle(EXPORT_BUDGET)
  @ApiOperation({
    summary:
      'Create a statement (F10.1/F10.2) from the latest result — recalculated first when the data changed',
  })
  @ApiCreatedResponse({ type: ExportResponseDto })
  @ApiConflictResponse({ description: 'A closed project never calculated' })
  @ApiServiceUnavailableResponse({ description: 'No Chromium for PDFs' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateExportDto,
  ): Promise<ExportResponseDto> {
    return ExportResponseDto.from(
      await this.exports.create(user.userId, projectId, dto.kind),
    );
  }

  @Get('exports')
  @ApiOperation({ summary: 'Stored statements, newest first (F10.5)' })
  @ApiOkResponse({ type: [ExportResponseDto] })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ExportResponseDto[]> {
    return (await this.exports.list(user.userId, projectId)).map(
      ExportResponseDto.from,
    );
  }

  @Get('exports/:exportId/content')
  @ApiOperation({ summary: 'Download a stored statement' })
  @ApiProduces(
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  @ApiNotFoundResponse()
  async content(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('exportId', ParseUUIDPipe) exportId: string,
  ): Promise<StreamableFile> {
    const content = await this.exports.content(
      user.userId,
      projectId,
      exportId,
    );
    return new StreamableFile(Buffer.from(content.bytes), {
      type: content.mediaType,
      length: content.size,
      disposition: contentDisposition(content.fileName),
    });
  }

  @Get('mail-draft')
  @ApiOperation({
    summary: 'Mail draft to the Treuhänder (F10.6) — text to copy',
  })
  @ApiOkResponse({ type: MailDraftResponseDto })
  @ApiNotFoundResponse({ description: 'Not calculated yet' })
  async mailDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<MailDraftResponseDto> {
    return this.exports.mailDraft(user.userId, projectId);
  }
}
