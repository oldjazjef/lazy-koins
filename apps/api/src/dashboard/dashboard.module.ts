import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { CalculationModule } from '../calculation/calculation.module';
import { SettingsModule } from '../settings/settings.module';
import { DashboardInputService } from './application/dashboard-input.service';
import {
  DashboardCache,
  DashboardCalculator,
  GetDashboardHandler,
  GetDashboardRecordsHandler,
  RefreshDashboardRatesHandler,
} from './application/dashboard.handlers';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/**
 * The dashboard (F11.4–F11.9): the engine's `dashboard()` over all projects of a user, cached
 * per input hash; its own rate cache (`user_rate`) filled by "Kurse aktualisieren".
 */
@Module({
  imports: [CqrsModule, CalculationModule, SettingsModule],
  controllers: [DashboardController],
  providers: [
    DashboardService,
    DashboardInputService,
    DashboardCache,
    DashboardCalculator,
    GetDashboardHandler,
    GetDashboardRecordsHandler,
    RefreshDashboardRatesHandler,
  ],
})
export class DashboardModule {}
