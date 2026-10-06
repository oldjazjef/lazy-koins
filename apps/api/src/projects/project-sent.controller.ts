import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { BEARER_SCHEME } from '../openapi/security-schemes';
import {
  MarkProjectSentDto,
  ProjectSentResponseDto,
} from './dto/project-sent.dto';
import { ProjectsService } from './projects.service';

/** F4.7 "An Treuhänder gesendet": read, mark by hand, undo. */
@ApiTags('projects')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('projects/:id/sent')
export class ProjectSentController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Whether and when the documents went to the Treuhänder, and what changed since (F4.7)',
  })
  @ApiOkResponse({ type: ProjectSentResponseDto })
  @ApiNotFoundResponse({ description: 'Missing, or not mine' })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProjectSentResponseDto> {
    return ProjectSentResponseDto.from(
      await this.projects.sent(user.userId, id),
    );
  }

  @Put()
  @ApiOperation({
    summary:
      '"Als gesendet markieren": date, way (mail, post, personal, other), note — also on a closed project',
  })
  @ApiOkResponse({ type: ProjectSentResponseDto })
  @ApiBadRequestResponse({ description: 'Bad or future date' })
  @ApiNotFoundResponse({ description: 'Missing, or not mine' })
  async mark(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkProjectSentDto,
  ): Promise<ProjectSentResponseDto> {
    return ProjectSentResponseDto.from(
      await this.projects.markSent(user.userId, id, {
        date: dto.date,
        via: dto.via,
        note: dto.note ?? '',
        to: dto.to ?? '',
        exportIds: dto.exportIds ?? [],
      }),
    );
  }

  @Delete()
  @ApiOperation({
    summary: '"Rückgängig": not sent any more; the mail log stays',
  })
  @ApiOkResponse({ type: ProjectSentResponseDto })
  @ApiNotFoundResponse({ description: 'Missing, or not mine' })
  async undo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProjectSentResponseDto> {
    return ProjectSentResponseDto.from(
      await this.projects.undoSent(user.userId, id),
    );
  }
}
