import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import {
  CreateFollowUpProjectHandler,
  GetFollowUpOptionsHandler,
  GetTakeOverSourcesHandler,
  ListCarryoversHandler,
  TakeOverFilesHandler,
} from './application/carryover.handlers';
import { CarryoverController } from './carryover.controller';

/**
 * Carry-over between projects: the follow-up project (F4.4a), files taken over from another
 * project (F4.4), and the list of what a project took over. Writes go through
 * `ProjectBundleRepositoryPort` (one transaction).
 */
@Module({
  imports: [CqrsModule],
  controllers: [CarryoverController],
  providers: [
    GetFollowUpOptionsHandler,
    CreateFollowUpProjectHandler,
    GetTakeOverSourcesHandler,
    TakeOverFilesHandler,
    ListCarryoversHandler,
  ],
})
export class CarryoverModule {}
