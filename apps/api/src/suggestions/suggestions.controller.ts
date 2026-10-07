import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { BEARER_SCHEME } from '../openapi/security-schemes';
import {
  ProjectSuggestionsDto,
  StandardMappingDetailResponseDto,
  StandardMappingResponseDto,
  SuggestionPreviewQueryDto,
  SuggestionPreviewResponseDto,
  TakenStandardMappingResponseDto,
  TakeStandardMappingDto,
} from './dto/suggestions.dto';
import { SuggestionsService } from './suggestions.service';

/** Catalogue ids are file names: lower-case letters, digits and dashes. */
const STANDARD_ID = /^[a-z0-9][a-z0-9-]{0,80}$/;

function standardId(id: string): string {
  // An id that cannot exist reads like a missing one — the handler answers 404.
  return STANDARD_ID.test(id) ? id : '-';
}

@ApiTags('mappings')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('standard-mappings')
export class StandardMappingsController {
  constructor(private readonly suggestions: SuggestionsService) {}

  @Get()
  @ApiOperation({
    summary:
      'The bundled standard mappings (F5.19, read-only templates) with my copy of each, if any',
  })
  @ApiOkResponse({ type: [StandardMappingResponseDto] })
  async list(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StandardMappingResponseDto[]> {
    return (await this.suggestions.listStandard(user.userId)).map(
      StandardMappingResponseDto.from,
    );
  }

  @Get(':id')
  @ApiOkResponse({ type: StandardMappingDetailResponseDto })
  @ApiNotFoundResponse()
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<StandardMappingDetailResponseDto> {
    return StandardMappingDetailResponseDto.fromDetail(
      await this.suggestions.getStandard(user.userId, standardId(id)),
    );
  }

  @Post(':id/take')
  @ApiOperation({
    summary:
      'Take a standard mapping: a copy in my mappings (an identical copy is reused); with projectId + projectFileId also assigned to that file',
  })
  @ApiCreatedResponse({ type: TakenStandardMappingResponseDto })
  @ApiNotFoundResponse({
    description: 'Entry, project or file missing / not mine',
  })
  @ApiConflictResponse({ description: 'The project is closed (F4.5)' })
  @ApiBadRequestResponse({ description: 'The file is a PDF' })
  async take(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: TakeStandardMappingDto,
  ): Promise<TakenStandardMappingResponseDto> {
    const target =
      dto.projectId && dto.projectFileId
        ? { projectId: dto.projectId, projectFileId: dto.projectFileId }
        : undefined;
    return TakenStandardMappingResponseDto.from(
      await this.suggestions.takeStandard(user.userId, standardId(id), target),
    );
  }
}

@ApiTags('mappings')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('projects/:projectId')
export class MappingSuggestionsController {
  constructor(private readonly suggestions: SuggestionsService) {}

  @Get('mapping-suggestions')
  @ApiOperation({
    summary:
      'F5.19: per file that needs a mapping, the ranked suggestions (my mappings incl. near matches, standard mappings, library)',
  })
  @ApiOkResponse({ type: ProjectSuggestionsDto })
  @ApiNotFoundResponse({ description: 'Missing, or not mine' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ProjectSuggestionsDto> {
    return ProjectSuggestionsDto.from(
      await this.suggestions.forProject(user.userId, projectId),
    );
  }

  @Get('files/:fileId/suggestion-preview')
  @ApiOperation({
    summary:
      'What one suggestion would read from the file: kind counts, unknown values, row errors, first records (nothing stored)',
  })
  @ApiOkResponse({ type: SuggestionPreviewResponseDto })
  @ApiNotFoundResponse()
  async preview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Query() query: SuggestionPreviewQueryDto,
  ): Promise<SuggestionPreviewResponseDto> {
    const id = query.source === 'standard' ? standardId(query.id) : query.id;
    return SuggestionPreviewResponseDto.from(
      await this.suggestions.preview(
        user.userId,
        projectId,
        fileId,
        query.source,
        id,
        query.limit ?? 20,
      ),
    );
  }
}
