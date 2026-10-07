import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import {
  GetSettingsHandler,
  SettingsReader,
  SettingsSecrets,
  TestCoingeckoKeyHandler,
  UpdateSettingsHandler,
} from './application/settings.handlers';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/**
 * F11 settings and F6.7 key storage. `SettingsReader` is exported for the slices that need a
 * user's settings or opened keys (rates, exports). The repository port is bound in the global
 * `PersistenceModule`.
 */
@Module({
  imports: [CqrsModule],
  controllers: [SettingsController],
  providers: [
    SettingsService,
    SettingsSecrets,
    SettingsReader,
    GetSettingsHandler,
    UpdateSettingsHandler,
    TestCoingeckoKeyHandler,
  ],
  exports: [SettingsReader, SettingsService],
})
export class SettingsModule {}
