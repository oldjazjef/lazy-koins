import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { CalculationService } from './calculation.service';
import {
  ChecksResponseDto,
  CorrectionResponseDto,
  CreateCorrectionDto,
  FigureQueryDto,
  FigureRecordsResponseDto,
  OpenItemStateResponseDto,
  ResultResponseDto,
  ResultStatusResponseDto,
  UpdateOpenItemDto,
} from './dto/calculation.dto';

/** Calculation (F7), checks and open items (F8), corrections (F9) of one project. */
@ApiTags('calculation')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('projects/:projectId')
export class CalculationController {
  constructor(private readonly calculation: CalculationService) {}

  @Post('calculate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Recalculate (F7.6) and store the result as a snapshot',
  })
  @ApiOkResponse({ type: ResultResponseDto })
  @ApiNotFoundResponse({ description: 'Missing, or not mine' })
  @ApiConflictResponse({ description: 'The project is closed (F4.5)' })
  async calculate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ResultResponseDto> {
    return (await this.calculation.calculate(
      user.userId,
      projectId,
    )) as unknown as ResultResponseDto;
  }

  @Get('result')
  @ApiOperation({ summary: 'The latest result, and whether it is stale' })
  @ApiOkResponse({ type: ResultResponseDto })
  @ApiNotFoundResponse({ description: 'Missing, or not mine' })
  async result(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ResultResponseDto> {
    return (await this.calculation.result(
      user.userId,
      projectId,
    )) as unknown as ResultResponseDto;
  }

  @Get('result/status')
  @ApiOperation({
    summary:
      'When it was last calculated and whether that is stale — cheap, for headers and lists',
  })
  @ApiOkResponse({ type: ResultStatusResponseDto })
  @ApiNotFoundResponse({ description: 'Missing, or not mine' })
  resultStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ResultStatusResponseDto> {
    return this.calculation.resultStatus(user.userId, projectId);
  }

  @Get('result/records')
  @ApiOperation({
    summary: 'The records behind a figure, with file and row (F7.5)',
  })
  @ApiOkResponse({ type: FigureRecordsResponseDto })
  @ApiNotFoundResponse({ description: 'No such figure, or not calculated' })
  async records(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: FigureQueryDto,
  ): Promise<FigureRecordsResponseDto> {
    return (await this.calculation.figureRecords(
      user.userId,
      projectId,
      query.figure,
    )) as unknown as FigureRecordsResponseDto;
  }

  @Get('checks')
  @ApiOperation({
    summary: 'Checks with traffic lights and open items (F8.1, F8.2, F8.3)',
  })
  @ApiOkResponse({ type: ChecksResponseDto })
  async checks(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ChecksResponseDto> {
    return (await this.calculation.checks(
      user.userId,
      projectId,
    )) as unknown as ChecksResponseDto;
  }

  @Patch('open-items')
  @ApiOperation({ summary: 'Tick off or annotate an open item (F8.2)' })
  @ApiOkResponse({ type: OpenItemStateResponseDto })
  @ApiConflictResponse({ description: 'The project is closed (F4.5)' })
  async updateOpenItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: UpdateOpenItemDto,
  ): Promise<OpenItemStateResponseDto> {
    return this.calculation.updateOpenItem(user.userId, projectId, dto.key, {
      done: dto.done,
      note: dto.note,
    });
  }

  @Get('corrections')
  @ApiOperation({ summary: 'Corrections with history (F9.4)' })
  @ApiOkResponse({ type: [CorrectionResponseDto] })
  async corrections(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<CorrectionResponseDto[]> {
    return (await this.calculation.corrections(
      user.userId,
      projectId,
    )) as unknown as CorrectionResponseDto[];
  }

  @Post('corrections')
  @ApiOperation({
    summary:
      'Add a correction (F9.1–F9.3): price override, reclassification, manual booking or holding',
  })
  @ApiCreatedResponse({ type: CorrectionResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid correction (with issues)' })
  @ApiConflictResponse({ description: 'The project is closed (F4.5)' })
  async createCorrection(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateCorrectionDto,
  ): Promise<CorrectionResponseDto> {
    const created = await this.calculation.createCorrection(
      user.userId,
      projectId,
      dto.data,
      dto.reason,
    );
    return { ...created, applied: null } as unknown as CorrectionResponseDto;
  }

  @Post('corrections/:correctionId/undo')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Undo a correction (F9.4); it stays in the history',
  })
  @ApiOkResponse({ type: CorrectionResponseDto })
  async undo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('correctionId', ParseUUIDPipe) correctionId: string,
  ): Promise<CorrectionResponseDto> {
    const updated = await this.calculation.setUndone(
      user.userId,
      projectId,
      correctionId,
      true,
    );
    return { ...updated, applied: null } as unknown as CorrectionResponseDto;
  }

  @Post('corrections/:correctionId/redo')
  @HttpCode(200)
  @ApiOperation({ summary: 'Apply an undone correction again' })
  @ApiOkResponse({ type: CorrectionResponseDto })
  async redo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('correctionId', ParseUUIDPipe) correctionId: string,
  ): Promise<CorrectionResponseDto> {
    const updated = await this.calculation.setUndone(
      user.userId,
      projectId,
      correctionId,
      false,
    );
    return { ...updated, applied: null } as unknown as CorrectionResponseDto;
  }
}
