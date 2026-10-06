import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { mappingJsonSchema } from '@lazykoins/engine';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { contentDisposition } from '../common/http/raw-body.middleware';
import { BEARER_SCHEME } from '../openapi/security-schemes';
import {
  CreateMappingDto,
  MappingResponseDto,
  MappingSummaryResponseDto,
  MappingUsageProjectDto,
  ProjectMappingResponseDto,
  ReapplyResponseDto,
  UpdatedMappingResponseDto,
  UpdateMappingDto,
} from './dto/mapping.dto';
import { MappingsService } from './mappings.service';

@ApiTags('mappings')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('mappings')
export class MappingsController {
  constructor(private readonly mappings: MappingsService) {}

  @Get()
  @ApiOperation({
    summary: 'My mapping specs (all my projects), with how many files use each',
  })
  @ApiOkResponse({ type: [MappingSummaryResponseDto] })
  async list(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MappingSummaryResponseDto[]> {
    return (await this.mappings.listMine(user.userId)).map(
      MappingSummaryResponseDto.fromSummary,
    );
  }

  @Get('schema')
  @ApiOperation({
    summary: 'JSON Schema of the mapping spec (editor validation, LLM prompts)',
  })
  @ApiOkResponse({ schema: { type: 'object' } })
  schema(): Record<string, unknown> {
    return mappingJsonSchema();
  }

  @Get(':id')
  @ApiOkResponse({ type: MappingResponseDto })
  @ApiNotFoundResponse({ description: 'Missing, or not mine' })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MappingResponseDto> {
    return MappingResponseDto.from(await this.mappings.get(user.userId, id));
  }

  @Get(':id/usage')
  @ApiOperation({
    summary: 'The projects and files read with this mapping (F11.0)',
  })
  @ApiOkResponse({ type: [MappingUsageProjectDto] })
  @ApiNotFoundResponse({ description: 'Missing, or not mine' })
  async usage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MappingUsageProjectDto[]> {
    return (await this.mappings.usage(user.userId, id)).map(
      MappingUsageProjectDto.from,
    );
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'The spec as a .json file' })
  @ApiProduces('application/json')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  @ApiNotFoundResponse()
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    const mapping = await this.mappings.get(user.userId, id);
    const bytes = Buffer.from(
      `${JSON.stringify(mapping.spec, null, 2)}\n`,
      'utf8',
    );
    const slug = mapping.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return new StreamableFile(bytes, {
      type: 'application/json; charset=utf-8',
      length: bytes.length,
      disposition: contentDisposition(`${slug || 'mapping'}.mapping.json`),
    });
  }

  @Post()
  @ApiOperation({ summary: 'Save a mapping spec (editor or uploaded .json)' })
  @ApiCreatedResponse({ type: MappingResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid spec — body.issues lists path + message',
  })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateMappingDto,
  ): Promise<MappingResponseDto> {
    return MappingResponseDto.from(
      await this.mappings.create(user.userId, dto.spec, dto.origin ?? 'manual'),
    );
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Replace the spec; files keep their results until re-applied',
  })
  @ApiOkResponse({ type: UpdatedMappingResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid spec' })
  @ApiNotFoundResponse()
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMappingDto,
  ): Promise<UpdatedMappingResponseDto> {
    const updated = await this.mappings.update(user.userId, id, dto.spec);
    return {
      mapping: MappingResponseDto.from(updated.mapping),
      filesUsing: updated.filesUsing,
    };
  }

  @Post(':id/reapply')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Read every file of this mapping again (after an edit)',
  })
  @ApiOkResponse({ type: ReapplyResponseDto })
  @ApiNotFoundResponse()
  async reapply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReapplyResponseDto> {
    return this.mappings.reapply(user.userId, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete; its files go back to "needs mapping"' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'A closed project uses it (F4.5)' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.mappings.remove(user.userId, id);
  }
}

@ApiTags('mappings')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('projects/:projectId/mappings')
export class ProjectMappingsController {
  constructor(private readonly mappings: MappingsService) {}

  @Get()
  @ApiOperation({ summary: "The mappings this project's files are read with" })
  @ApiOkResponse({ type: [ProjectMappingResponseDto] })
  @ApiNotFoundResponse({ description: 'Missing, or not mine' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ProjectMappingResponseDto[]> {
    return (await this.mappings.listForProject(user.userId, projectId)).map(
      ProjectMappingResponseDto.from,
    );
  }
}
