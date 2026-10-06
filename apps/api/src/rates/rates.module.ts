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
  DeleteManualRateHandler,
  GetRatesHandler,
  GetRefreshStatusHandler,
  ImportKurslisteHandler,
  RefreshRatesHandler,
  SetManualRateHandler,
} from './application/rates.handlers';
import { RefreshProgress } from './application/refresh-progress';
import { RatesController } from './rates.controller';
import { RatesService } from './rates.service';

/**
 * Rates of a project (F7.4): fetched on request through the rate-source ports (bound in
 * `IntegrationsModule`), stored per project, overridable; ESTV Kursliste import.
 */
@Module({
  imports: [CqrsModule, CalculationModule, SettingsModule],
  controllers: [RatesController],
  providers: [
    RatesService,
    GetRatesHandler,
    RefreshRatesHandler,
    RefreshProgress,
    GetRefreshStatusHandler,
    SetManualRateHandler,
    DeleteManualRateHandler,
    ImportKurslisteHandler,
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
