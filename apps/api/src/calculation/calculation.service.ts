import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  CalculateProjectCommand,
  type ChecksView,
  type CorrectionView,
  CreateCorrectionCommand,
  type FigureRecords,
  GetChecksQuery,
  GetFigureRecordsQuery,
  GetResultQuery,
  GetResultStatusQuery,
  ListCorrectionsQuery,
  type ResultStatus,
  type ResultView,
  SetCorrectionUndoneCommand,
  UpdateOpenItemCommand,
} from './application/calculation.handlers';
import type { OpenItemState, StoredCorrection } from './domain/calculation';

/** Thin façade over the buses — no logic here; it lives in the handlers. */
@Injectable()
export class CalculationService {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  calculate(userId: string, projectId: string): Promise<ResultView> {
    return this.commands.execute(
      new CalculateProjectCommand(userId, projectId),
    );
  }

  result(userId: string, projectId: string): Promise<ResultView> {
    return this.queries.execute(new GetResultQuery(userId, projectId));
  }

  resultStatus(userId: string, projectId: string): Promise<ResultStatus> {
    return this.queries.execute(new GetResultStatusQuery(userId, projectId));
  }

  figureRecords(
    userId: string,
    projectId: string,
    figureId: string,
  ): Promise<FigureRecords> {
    return this.queries.execute(
      new GetFigureRecordsQuery(userId, projectId, figureId),
    );
  }

  checks(userId: string, projectId: string): Promise<ChecksView> {
    return this.queries.execute(new GetChecksQuery(userId, projectId));
  }

  updateOpenItem(
    userId: string,
    projectId: string,
    key: string,
    changes: { done?: boolean; note?: string },
  ): Promise<OpenItemState> {
    return this.commands.execute(
      new UpdateOpenItemCommand(userId, projectId, key, changes),
    );
  }

  corrections(userId: string, projectId: string): Promise<CorrectionView[]> {
    return this.queries.execute(new ListCorrectionsQuery(userId, projectId));
  }

  createCorrection(
    userId: string,
    projectId: string,
    data: unknown,
    reason: string,
  ): Promise<StoredCorrection> {
    return this.commands.execute(
      new CreateCorrectionCommand(userId, projectId, data, reason),
    );
  }

  setUndone(
    userId: string,
    projectId: string,
    correctionId: string,
    undone: boolean,
  ): Promise<StoredCorrection> {
    return this.commands.execute(
      new SetCorrectionUndoneCommand(userId, projectId, correctionId, undone),
    );
  }
}
