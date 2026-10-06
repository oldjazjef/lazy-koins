import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { RawBodyMiddleware } from '../common/http/raw-body.middleware';
import { CalculationModule } from '../calculation/calculation.module';
import { SettingsModule } from '../settings/settings.module';
import {
  ApplyEstvHandler,
  GetEstvStatusHandler,
  StartEstvUpdateHandler,
} from './application/estv.handlers';
import { EstvNotifier } from './application/estv-notifier';
import { EstvProjectRatesService } from './application/estv-project-rates.service';
import {
  EstvScheduler,
  EstvSyncService,
} from './application/estv-sync.service';
import {
  DeleteManualRateHandler,
  GetRatesHandler,
  GetRefreshStatusHandler,
  ImportKurslisteHandler,
  RefreshRatesHandler,
  SetManualRateHandler,
} from './application/rates.handlers';
import { RefreshProgress } from './application/refresh-progress';
import { EstvController } from './estv.controller';
import { RatesController } from './rates.controller';
import { RatesService } from './rates.service';

/**
 * Rates of a project (F7.4): fetched on request through the rate-source ports (bound in
 * `IntegrationsModule`), stored per project, overridable; ESTV Kursliste import. F7.4a: the
 * deployment-wide ESTV Kursliste — downloaded on demand and checked daily (`EstvScheduler`),
 * applied to projects before the other sources.
 */
@Module({
  imports: [CqrsModule, CalculationModule, SettingsModule],
  controllers: [RatesController, EstvController],
  providers: [
    RatesService,
    GetRatesHandler,
    RefreshRatesHandler,
    RefreshProgress,
    GetRefreshStatusHandler,
    SetManualRateHandler,
    DeleteManualRateHandler,
    ImportKurslisteHandler,
    EstvNotifier,
    EstvSyncService,
    EstvScheduler,
    EstvProjectRatesService,
    GetEstvStatusHandler,
    StartEstvUpdateHandler,
    ApplyEstvHandler,
  ],
})
export class RatesModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // The Kursliste arrives as the raw file, like an upload.
    consumer.apply(RawBodyMiddleware).forRoutes({
      path: 'projects/:projectId/rates/estv',
      method: RequestMethod.POST,
    });
  }
}
