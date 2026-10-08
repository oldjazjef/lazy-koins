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
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { contentDisposition } from '../common/http/raw-body.middleware';
import { BEARER_SCHEME } from '../openapi/security-schemes';
import { DuplicateUserFileException } from './application/my-files.handlers';
import {
  FileCandidateResponseDto,
  SelectProjectFilesDto,
  SelectProjectFilesResponseDto,
  UserFileResponseDto,
} from './dto/my-file.dto';
import {
  ChangeProjectFileDto,
  FilePreviewResponseDto,
  PreviewQueryDto,
  UploadFileQueryDto,
} from './dto/project-file.dto';
import { FilesService } from './files.service';

/** Uploads are heavier than other writes: at most 200 files per account in 10 minutes. */
const UPLOAD_BUDGET = { writes: { limit: 200, ttl: 10 * 60_000 } };

/** F5.21–F5.23: my files, independent of projects (the main menu's "Dateien"). */
@ApiTags('files')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('files')
export class MyFilesController {
  constructor(private readonly files: FilesService) {}

  @Get()
  @ApiOperation({
    summary:
      'Every file of mine with how it is read and the projects that use it (F5.21)',
  })
  @ApiOkResponse({ type: [UserFileResponseDto] })
  async list(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UserFileResponseDto[]> {
    return (await this.files.myFiles(user.userId)).map(
      UserFileResponseDto.from,
    );
  }

  @Post()
  @Throttle(UPLOAD_BUDGET)
  @ApiOperation({
    summary:
      'Upload one file outside any project (F5.21): the raw bytes as body, the name in `?name=`',
    description:
      'CSV, XLSX or PDF up to 20 MB, recognised from the bytes and read with the standard format or one of my mappings. Bytes I already have → 409 `duplicateFile` with `existing`.',
  })
  @ApiConsumes('application/octet-stream')
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ApiCreatedResponse({ type: UserFileResponseDto })
  @ApiConflictResponse({ description: 'Already among my files' })
  @ApiPayloadTooLargeResponse({ description: 'Larger than 20 MB' })
  @ApiUnsupportedMediaTypeResponse({ description: 'Not CSV, XLSX or PDF' })
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: UploadFileQueryDto,
    @Req() request: Request,
  ): Promise<UserFileResponseDto> {
    const body: unknown = request.body;
    if (!Buffer.isBuffer(body)) {
      throw new BadRequestException('Send the file as the raw request body');
    }
    try {
      return UserFileResponseDto.from(
        await this.files.uploadMine(user.userId, query.name, body),
      );
    } catch (error) {
      if (error instanceof DuplicateUserFileException) {
        const existing = (await this.files.myFiles(user.userId)).find(
          (file) => file.id === error.existing.id,
        );
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          message: 'This file is already among your files',
          code: 'duplicateFile',
          existing: existing ? UserFileResponseDto.from(existing) : null,
        });
      }
      throw error;
    }
  }

  @Get(':fileId/content')
  @ApiOperation({ summary: 'The original bytes, unchanged (F5.3)' })
  @ApiProduces('text/csv', 'application/pdf', 'application/octet-stream')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  @ApiNotFoundResponse({ description: 'Missing, or not mine' })
  async content(
    @CurrentUser() user: AuthenticatedUser,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<StreamableFile> {
    const content = await this.files.myContent(user.userId, fileId);
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
  @ApiNotFoundResponse({ description: 'Missing, or not mine' })
  async preview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Query() query: PreviewQueryDto,
  ): Promise<FilePreviewResponseDto> {
    return FilePreviewResponseDto.from(
      await this.files.previewMine(user.userId, fileId, query.rows ?? 50),
    );
  }

  @Patch(':fileId')
  @ApiOperation({
    summary:
      'Read with a mapping, detect again, or keep as evidence only — for every project using it (F5.21)',
  })
  @ApiOkResponse({ type: UserFileResponseDto })
  @ApiNotFoundResponse({ description: 'Missing, or not mine' })
  @ApiConflictResponse({
    description:
      '`usedByClosedProject` (with `projects`): a closed project uses the file',
  })
  async change(
    @CurrentUser() user: AuthenticatedUser,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Body() dto: ChangeProjectFileDto,
  ): Promise<UserFileResponseDto> {
    const assignment =
      dto.mode === 'mapping'
        ? { mode: 'mapping' as const, mappingId: dto.mappingId ?? '' }
        : { mode: dto.mode };
    return UserFileResponseDto.from(
      await this.files.changeMine(user.userId, fileId, assignment),
    );
  }

  @Delete(':fileId')
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Delete the file and take it out of every project (F5.23) — not while a closed project uses it',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Missing, or not mine' })
  @ApiConflictResponse({
    description: '`usedByClosedProject` (with `projects`)',
  })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<void> {
    await this.files.deleteMine(user.userId, fileId);
  }
}

/** F5.22: "Dateien auswählen" in a project. */
@ApiTags('files')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('projects/:projectId')
export class ProjectFileSelectionController {
  constructor(private readonly files: FilesService) {}

  @Get('file-candidates')
  @ApiOperation({
    summary:
      'All my files for "Dateien auswählen": already selected, and suggested for the tax year (F5.22)',
  })
  @ApiOkResponse({ type: [FileCandidateResponseDto] })
  @ApiNotFoundResponse({ description: 'Missing, or not mine' })
  async candidates(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<FileCandidateResponseDto[]> {
    return (await this.files.candidates(user.userId, projectId)).map(
      FileCandidateResponseDto.fromCandidate,
    );
  }

  @Post('files/select')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Add some of my files to the project (F5.22)',
  })
  @ApiOkResponse({ type: SelectProjectFilesResponseDto })
  @ApiNotFoundResponse({ description: 'A project or file that is not mine' })
  @ApiConflictResponse({ description: 'The project is closed (F4.5)' })
  async select(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: SelectProjectFilesDto,
  ): Promise<SelectProjectFilesResponseDto> {
    return SelectProjectFilesResponseDto.from(
      await this.files.select(user.userId, projectId, dto.fileIds),
    );
  }
}
