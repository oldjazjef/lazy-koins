import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { RateEntry } from '@lazykoins/engine';
import {
  DeleteManualRateCommand,
  GetRatesQuery,
  ImportKurslisteCommand,
  type ManualRateInput,
  type RatesView,
  RefreshRatesCommand,
  type RefreshSummary,
  SetManualRateCommand,
} from './application/rates.handlers';
import { ApplyEstvCommand } from './application/estv.handlers';
import type { EstvApplySummary } from './application/estv-project-rates.service';
import type { ProjectRate } from './domain/project-rate';

/** Thin façade over the buses — no logic here; it lives in the handlers. */
@Injectable()
export class RatesService {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  list(
    userId: string,
    projectId: string,
    asset?: string,
  ): Promise<RatesView | ProjectRate[]> {
    return this.queries.execute(new GetRatesQuery(userId, projectId, asset));
  }

  refresh(
    userId: string,
    projectId: string,
    force: boolean,
  ): Promise<RefreshSummary> {
    return this.commands.execute(
      new RefreshRatesCommand(userId, projectId, force),
    );
  }

  setManual(
    userId: string,
    projectId: string,
    rate: ManualRateInput,
  ): Promise<RateEntry> {
    return this.commands.execute(
      new SetManualRateCommand(userId, projectId, rate),
    );
  }

  deleteManual(
    userId: string,
    projectId: string,
    key: Omit<ManualRateInput, 'value'> & { source: 'manual' | 'estv' },
  ): Promise<void> {
    return this.commands.execute(
      new DeleteManualRateCommand(userId, projectId, key),
    );
  }

  applyEstv(userId: string, projectId: string): Promise<EstvApplySummary> {
    return this.commands.execute(new ApplyEstvCommand(userId, projectId));
  }

  importKursliste(
    userId: string,
    projectId: string,
    content: string,
  ): Promise<{ imported: number; skipped: number }> {
    return this.commands.execute(
      new ImportKurslisteCommand(userId, projectId, content),
    );
  }
}
