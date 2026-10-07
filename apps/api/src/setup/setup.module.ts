import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { PinModule } from '../pin/pin.module';
import {
  CompleteSetupHandler,
  GetSetupHandler,
  SetupFactsReader,
  SetupViews,
  UpdateSetupHandler,
} from './application/setup.handlers';
import { SetupController } from './setup.controller';
import { SetupService } from './setup.service';

/**
 * F11.0s — the setup wizard's progress. What is configured is read from the other slices' ports
 * (settings, AI, mail, PIN); the forms themselves are the settings endpoints. The repository port
 * is bound in the global `PersistenceModule`.
 */
@Module({
  imports: [CqrsModule, PinModule],
  controllers: [SetupController],
  providers: [
    SetupService,
    SetupFactsReader,
    SetupViews,
    GetSetupHandler,
    UpdateSetupHandler,
    CompleteSetupHandler,
  ],
})
export class SetupModule {}
