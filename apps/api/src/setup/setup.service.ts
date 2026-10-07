import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  CompleteSetupCommand,
  GetSetupQuery,
  type SetupChanges,
  type SetupView,
  UpdateSetupCommand,
} from './application/setup.handlers';

/** Thin façade over the buses — no logic here; it lives in the handlers. */
@Injectable()
export class SetupService {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  get(userId: string): Promise<SetupView> {
    return this.queries.execute(new GetSetupQuery(userId));
  }

  update(userId: string, changes: SetupChanges): Promise<SetupView> {
    return this.commands.execute(new UpdateSetupCommand(userId, changes));
  }

  complete(userId: string): Promise<SetupView> {
    return this.commands.execute(new CompleteSetupCommand(userId));
  }
}
