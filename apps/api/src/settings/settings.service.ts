import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  GetSettingsQuery,
  type SettingsChanges,
  type SettingsView,
  UpdateSettingsCommand,
} from './application/settings.handlers';

/** Thin façade over the buses — no logic here; it lives in the handlers. */
@Injectable()
export class SettingsService {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  get(userId: string): Promise<SettingsView> {
    return this.queries.execute(new GetSettingsQuery(userId));
  }

  update(userId: string, changes: SettingsChanges): Promise<SettingsView> {
    return this.commands.execute(new UpdateSettingsCommand(userId, changes));
  }
}
