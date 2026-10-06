import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  type DashboardRecords,
  type DashboardRefreshSummary,
  type DashboardView,
  GetDashboardQuery,
  GetDashboardRecordsQuery,
  RefreshDashboardRatesCommand,
} from './application/dashboard.handlers';

/** Thin façade over the buses — no logic here; it lives in the handlers. */
@Injectable()
export class DashboardService {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  get(
    userId: string,
    from: string,
    to: string,
    projectId?: string,
  ): Promise<DashboardView> {
    return this.queries.execute(
      new GetDashboardQuery(userId, from, to, projectId),
    );
  }

  records(
    userId: string,
    from: string,
    to: string,
    kpi: string,
    projectId?: string,
  ): Promise<DashboardRecords> {
    return this.queries.execute(
      new GetDashboardRecordsQuery(userId, from, to, kpi, projectId),
    );
  }

  refresh(
    userId: string,
    from: string,
    to: string,
    assets: readonly string[],
    force: boolean,
  ): Promise<DashboardRefreshSummary> {
    return this.commands.execute(
      new RefreshDashboardRatesCommand(userId, from, to, assets, force),
    );
  }
}
