import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { BEARER_SCHEME } from '../openapi/security-schemes';
import {
  HintStateResponseDto,
  ProjectHintsResponseDto,
  UpdateHintStateDto,
} from './dto/project-hint.dto';
import { FilesService } from './files.service';

/** F5.8 "Hinweise" of a project: what may be missing or wrong in its files, with a status. */
@ApiTags('files')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('projects/:projectId/hints')
export class HintsController {
  constructor(private readonly files: FilesService) {}

  @Get()
  @ApiOperation({
    summary:
      'Hints (F5.8): coverage gaps of the tax year, unread files, row errors — with their status',
  })
  @ApiOkResponse({ type: ProjectHintsResponseDto })
  @ApiNotFoundResponse()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ProjectHintsResponseDto> {
    return (await this.files.hints(
      user.userId,
      projectId,
    )) as unknown as ProjectHintsResponseDto;
  }

  @Patch()
  @ApiOperation({
    summary:
      'Mark a hint as done or ignored (with a note), or open it again — survives recalculation',
  })
  @ApiOkResponse({ type: HintStateResponseDto })
  @ApiConflictResponse({ description: 'The project is closed (F4.5)' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: UpdateHintStateDto,
  ): Promise<HintStateResponseDto> {
    const saved = await this.files.updateHint(
      user.userId,
      projectId,
      dto.key,
      dto.status,
      dto.note ?? '',
    );
    return saved
      ? { key: saved.hintKey, status: saved.status, note: saved.note }
      : { key: dto.key, status: 'open', note: '' };
  }
}
