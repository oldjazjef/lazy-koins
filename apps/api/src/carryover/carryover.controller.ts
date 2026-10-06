import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { BEARER_SCHEME } from '../openapi/security-schemes';
import {
  type CarryoverView,
  CreateFollowUpProjectCommand,
  type FollowUpOptions,
  GetFollowUpOptionsQuery,
  GetTakeOverSourcesQuery,
  ListCarryoversQuery,
  TakeOverFilesCommand,
  type TakeOverSource,
} from './application/carryover.handlers';

export class CreateFollowUpDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @ApiProperty() @IsInt() taxYear!: number;
  @ApiProperty() @Matches(/^[A-Z]{2}$/) canton!: string;
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  fileIds!: string[];
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  correctionIds!: string[];
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  openItemKeys!: string[];
  @ApiProperty({ description: 'Take the notes over' })
  @IsBoolean()
  notes!: boolean;
}

export class TakeOverFilesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  projectFileIds!: string[];
}

/** Follow-up project (F4.4a), files from other projects (F4.4), what was taken over. */
@ApiTags('projects')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('projects/:projectId')
export class CarryoverController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  @Get('follow-up')
  @ApiOperation({
    summary: 'What a follow-up project (next tax year) can take over (F4.4a)',
  })
  @ApiOkResponse({ description: 'Files, corrections, open items, notes' })
  @ApiNotFoundResponse()
  followUpOptions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<FollowUpOptions> {
    return this.queries.execute(
      new GetFollowUpOptionsQuery(user.userId, projectId),
    );
  }

  @Post('follow-up')
  @ApiOperation({
    summary:
      'Create the follow-up project with the chosen items, in one transaction (F4.4a)',
  })
  @ApiCreatedResponse({ description: '{ projectId }' })
  @ApiBadRequestResponse()
  createFollowUp(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateFollowUpDto,
  ): Promise<{ projectId: string }> {
    return this.commands.execute(
      new CreateFollowUpProjectCommand(user.userId, projectId, dto),
    );
  }

  @Get('take-over')
  @ApiOperation({
    summary:
      'Files of my other projects that this project can take over (F4.4)',
  })
  takeOverSources(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<TakeOverSource[]> {
    return this.queries.execute(
      new GetTakeOverSourcesQuery(user.userId, projectId),
    );
  }

  @Post('take-over')
  @ApiOperation({
    summary: 'Link files of other projects into this one, no copy (F4.4)',
  })
  @ApiConflictResponse({ description: 'The project is closed (F4.5)' })
  takeOver(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: TakeOverFilesDto,
  ): Promise<{ added: number; skipped: number }> {
    return this.commands.execute(
      new TakeOverFilesCommand(user.userId, projectId, dto.projectFileIds),
    );
  }

  @Get('carryovers')
  @ApiOperation({ summary: 'What this project took over, and from where' })
  carryovers(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<CarryoverView[]> {
    return this.queries.execute(
      new ListCarryoversQuery(user.userId, projectId),
    );
  }
}
