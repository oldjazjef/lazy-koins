import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { BEARER_SCHEME } from '../openapi/security-schemes';
import type {
  DashboardRecords,
  DashboardRefreshSummary,
  DashboardView,
} from './application/dashboard.handlers';
import { DashboardService } from './dashboard.service';
import {
  DashboardQueryDto,
  DashboardRecordsQueryDto,
  DashboardResponseDto,
  RefreshDashboardRatesDto,
} from './dto/dashboard.dto';

/** Rate lookups go to public APIs: a modest budget per account. */
const REFRESH_BUDGET = { writes: { limit: 120, ttl: 10 * 60_000 } };

/** The dashboard over all of my projects (F11.4–F11.9). */
@ApiTags('dashboard')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @ApiOperation({
    summary:
      'Wealth over a period across all my projects: daily totals, KPIs, allocation, holdings (F11.4–F11.8)',
  })
  @ApiOkResponse({ type: DashboardResponseDto })
  @ApiBadRequestResponse({ description: 'Bad period' })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DashboardQueryDto,
  ): Promise<DashboardView> {
    return this.dashboard.get(user.userId, query.from, query.to, query.project);
  }

  @Get('records')
  @ApiOperation({
    summary:
      'The bookings behind a KPI of the period, with file and row (F11.6, F7.5)',
  })
  records(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DashboardRecordsQueryDto,
  ): Promise<DashboardRecords> {
    return this.dashboard.records(
      user.userId,
      query.from,
      query.to,
      query.kpi,
      query.project,
    );
  }

  @Post('rates/refresh')
  @HttpCode(200)
  @Throttle(REFRESH_BUDGET)
  @ApiOperation({
    summary:
      'Fetch the missing daily series for the period into my rate cache (F11.4, F11.3)',
  })
  @ApiConflictResponse({ description: 'Rate lookups are switched off' })
  refresh(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RefreshDashboardRatesDto,
  ): Promise<DashboardRefreshSummary> {
    return this.dashboard.refresh(
      user.userId,
      dto.from,
      dto.to,
      dto.assets ?? [],
      dto.force ?? false,
    );
  }
}
