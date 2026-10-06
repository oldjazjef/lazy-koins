import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  ForgotPinCommand,
  GetPinStatusQuery,
  LockCommand,
  type PinActor,
  type PinReset,
  type PinStatus,
  type PinUnlocked,
  RemovePinCommand,
  SetAutoLockCommand,
  SetPinCommand,
  UnlockCommand,
} from './application/pin.handlers';

/** Thin façade over the buses — no logic here; it lives in the handlers. */
@Injectable()
export class PinService {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  status(actor: PinActor, token?: string): Promise<PinStatus> {
    return this.queries.execute(new GetPinStatusQuery(actor, token));
  }

  set(
    actor: PinActor,
    pin: string,
    currentPin?: string,
    autoLockMinutes?: number,
  ): Promise<PinUnlocked> {
    return this.commands.execute(
      new SetPinCommand(actor, pin, currentPin, autoLockMinutes),
    );
  }

  remove(actor: PinActor, currentPin: string): Promise<PinStatus> {
    return this.commands.execute(new RemovePinCommand(actor, currentPin));
  }

  unlock(actor: PinActor, pin: string): Promise<PinUnlocked> {
    return this.commands.execute(new UnlockCommand(actor, pin));
  }

  lock(token: string | undefined): Promise<void> {
    return this.commands.execute(new LockCommand(token));
  }

  autoLock(
    actor: PinActor,
    minutes: number,
    token?: string,
  ): Promise<PinStatus> {
    return this.commands.execute(new SetAutoLockCommand(actor, minutes, token));
  }

  forgot(actor: PinActor, confirmClearKeys: boolean): Promise<PinReset> {
    return this.commands.execute(new ForgotPinCommand(actor, confirmClearKeys));
  }
}
