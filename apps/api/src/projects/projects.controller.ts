import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { BEARER_SCHEME } from '../openapi/security-schemes';
import {
  CreateProjectDto,
  ProjectListItemDto,
  ProjectResponseDto,
  UpdateProjectDto,
} from './dto/project.dto';
import { ProjectsService } from './projects.service';

@ApiTags('projects')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @ApiOperation({
    summary:
      'My projects, newest tax year first, with Vermögen and Ertrag of the latest calculation (F4.2)',
  })
  @ApiOkResponse({ type: [ProjectListItemDto] })
  async list(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ProjectListItemDto[]> {
    return (await this.projects.listMine(user.userId)).map(
      ProjectListItemDto.fromEntry,
    );
  }

  @Post()
  @ApiOperation({ summary: 'Start a project for one tax year (F4.1, F4.3)' })
  @ApiCreatedResponse({ type: ProjectResponseDto })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProjectDto,
  ): Promise<ProjectResponseDto> {
    return ProjectResponseDto.from(
      await this.projects.create(user.userId, {
        name: dto.name,
        taxYear: dto.taxYear,
        country: dto.country,
        canton: dto.canton,
        notes: dto.notes ?? '',
      }),
    );
  }

  @Get(':id')
  @ApiOkResponse({ type: ProjectResponseDto })
  @ApiNotFoundResponse({ description: 'Missing, or not mine' })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProjectResponseDto> {
    return ProjectResponseDto.from(await this.projects.get(user.userId, id));
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Rename, notes, status, canton; a closed project only reopens',
  })
  @ApiOkResponse({ type: ProjectResponseDto })
  @ApiNotFoundResponse({ description: 'Missing, or not mine' })
  @ApiConflictResponse({ description: 'The project is closed (F4.5)' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
  ): Promise<ProjectResponseDto> {
    return ProjectResponseDto.from(
      await this.projects.update(user.userId, id, dto),
    );
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a project (F4.6); not while closed' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Missing, or not mine' })
  @ApiConflictResponse({ description: 'The project is closed (F4.5)' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.projects.remove(user.userId, id);
  }
}
