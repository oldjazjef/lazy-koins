import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { SourceFileReader } from '../files/application/source-file-reader';
import { CalculationInputService } from './application/calculation-input.service';
import {
  CalculateProjectHandler,
  CreateCorrectionHandler,
  GetChecksHandler,
  GetFigureRecordsHandler,
  GetResultHandler,
  GetResultStatusHandler,
  ListCorrectionsHandler,
  SetCorrectionUndoneHandler,
  UpdateOpenItemHandler,
} from './application/calculation.handlers';
import { ListTransactionsHandler } from './application/transactions.handlers';
import { CalculationController } from './calculation.controller';
import { CalculationService } from './calculation.service';

/**
 * The calculation (F7), checks (F8) and corrections (F9) of a project. The engine does the work;
 * this slice assembles its input from storage and keeps the result. `CalculationInputService`
 * is exported for rates (which assets need prices) and exports.
 */
@Module({
  imports: [CqrsModule],
  controllers: [CalculationController],
  providers: [
    CalculationService,
    CalculationInputService,
    SourceFileReader,
    CalculateProjectHandler,
    GetResultHandler,
    GetResultStatusHandler,
    GetFigureRecordsHandler,
    GetChecksHandler,
    UpdateOpenItemHandler,
    ListCorrectionsHandler,
    CreateCorrectionHandler,
    SetCorrectionUndoneHandler,
    ListTransactionsHandler,
  ],
  exports: [CalculationService, CalculationInputService],
})
export class CalculationModule {}
