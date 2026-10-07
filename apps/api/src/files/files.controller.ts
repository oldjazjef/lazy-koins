import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiProduces,
  ApiTags,
  ApiUnprocessableEntityResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { contentDisposition } from '../common/http/raw-body.middleware';
import { BEARER_SCHEME } from '../openapi/security-schemes';
import { DuplicateFileException } from './application/commands/upload-project-file.command';
import {
  ChangeProjectFileDto,
  FilePreviewResponseDto,
  MappingPreviewRequestDto,
  MappingPreviewResponseDto,
  PreviewQueryDto,
  ProjectFileResponseDto,
  ProjectFilesResponseDto,
  RowErrorsResponseDto,
  UploadFileQueryDto,
} from './dto/project-file.dto';
import { FilesService } from './files.service';

/** Uploads are heavier than other writes: at most 200 files per account in 10 minutes. */
const UPLOAD_BUDGET = { writes: { limit: 200, ttl: 10 * 60_000 } };

@ApiTags('files')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('projects/:projectId/files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post()
  @Throttle(UPLOAD_BUDGET)
  @ApiOperation({
    summary:
      'Upload one file (F5.1): the raw bytes as body, the name in `?name=`',
    description:
      'CSV, XLSX or PDF up to 20 MB, recognised from the bytes. Read with the standard format or a stored mapping (F5.2). Same bytes in this project → 409 with `existing`; in another project → stored once, origin `from_project`.',
  })
  @ApiConsumes('application/octet-stream')
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ApiCreatedResponse({ type: ProjectFileResponseDto })
  @ApiConflictResponse({
    description: 'Duplicate (body.existing) or closed project',
  })
  @ApiPayloadTooLargeResponse({ description: 'Larger than 20 MB' })
  @ApiUnsupportedMediaTypeResponse({ description: 'Not CSV, XLSX or PDF' })
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: UploadFileQueryDto,
    @Req() request: Request,
  ): Promise<ProjectFileResponseDto> {
    const body: unknown = request.body;
    if (!Buffer.isBuffer(body)) {
      throw new BadRequestException('Send the file as the raw request body');
    }
    try {
      return ProjectFileResponseDto.from(
        await this.files.upload(user.userId, projectId, query.name, body),
      );
    } catch (error) {
      if (error instanceof DuplicateFileException) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          message: 'This file is already in the project',
          code: 'duplicateFile',
          existing: ProjectFileResponseDto.from(
            await this.files.view(user.userId, error.existing),
          ),
        });
      }
      throw error;
    }
  }

  @Get()
  @ApiOperation({
    summary:
      "The project's files grouped by platform (F5.5) and missing-file hints (F5.8)",
  })
  @ApiOkResponse({ type: ProjectFilesResponseDto })
  @ApiNotFoundResponse({ description: 'Missing, or not mine' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ProjectFilesResponseDto> {
    const overview = await this.files.list(user.userId, projectId);
    return ProjectFilesResponseDto.from(
      overview.taxYear,
      overview.files,
      overview.missing,
    );
  }

  @Get(':fileId/content')
  @ApiOperation({ summary: 'The original bytes, unchanged (F5.3)' })
  @ApiProduces('text/csv', 'application/pdf', 'application/octet-stream')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  @ApiNotFoundResponse()
  async content(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<StreamableFile> {
    const content = await this.files.content(user.userId, projectId, fileId);
    return new StreamableFile(Buffer.from(content.bytes), {
      type: content.mediaType,
      length: content.size,
      disposition: contentDisposition(content.originalName),
    });
  }

  @Get(':fileId/preview')
  @ApiOperation({
    summary: 'The first rows of each table (F5.6); for a PDF just `kind: pdf`',
  })
  @ApiOkResponse({ type: FilePreviewResponseDto })
  @ApiNotFoundResponse()
  async preview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Query() query: PreviewQueryDto,
  ): Promise<FilePreviewResponseDto> {
    return FilePreviewResponseDto.from(
      await this.files.preview(
        user.userId,
        projectId,
        fileId,
        query.rows ?? 50,
      ),
    );
  }

  @Get(':fileId/row-errors')
  @ApiOperation({
    summary:
      'Rows the file’s own reader could not read (F5.10) — row, code, column; no cell values',
  })
  @ApiOkResponse({ type: RowErrorsResponseDto })
  @ApiNotFoundResponse()
  async rowErrors(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Query() query: PreviewQueryDto,
  ): Promise<RowErrorsResponseDto> {
    const result = await this.files.rowErrors(
      user.userId,
      projectId,
      fileId,
      query.rows ?? 50,
    );
    return {
      total: result.total,
      errors: result.errors.map((error) => ({ ...error })),
    };
  }

  @Post(':fileId/mapping-preview')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'What a mapping (stored or unsaved) would read from this file — nothing is stored',
  })
  @ApiOkResponse({ type: MappingPreviewResponseDto })
  @ApiNotFoundResponse()
  @ApiUnprocessableEntityResponse({
    description: 'A PDF, or an unreadable workbook',
  })
  async previewMapping(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Body() dto: MappingPreviewRequestDto,
  ): Promise<MappingPreviewResponseDto> {
    const source =
      dto.spec !== undefined
        ? { spec: dto.spec }
        : { mappingId: dto.mappingId ?? '' };
    return MappingPreviewResponseDto.from(
      await this.files.previewMapping(
        user.userId,
        projectId,
        fileId,
        source,
        dto.limit ?? 50,
      ),
    );
  }

  @Patch(':fileId')
  @ApiOperation({
    summary:
      'Read with a mapping, detect again, or keep as evidence only (F5.2)',
  })
  @ApiOkResponse({ type: ProjectFileResponseDto })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'The project is closed (F4.5)' })
  async change(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Body() dto: ChangeProjectFileDto,
  ): Promise<ProjectFileResponseDto> {
    const assignment =
      dto.mode === 'mapping'
        ? { mode: 'mapping' as const, mappingId: dto.mappingId ?? '' }
        : { mode: dto.mode };
    return ProjectFileResponseDto.from(
      await this.files.change(user.userId, projectId, fileId, assignment),
    );
  }

  @Delete(':fileId')
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Remove from the project (F5.7); the bytes go when no project uses them',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'The project is closed (F4.5)' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<void> {
    await this.files.remove(user.userId, projectId, fileId);
  }
}
