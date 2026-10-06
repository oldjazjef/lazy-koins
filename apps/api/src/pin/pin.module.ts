import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import {
  PinClock,
  PinLockState,
  PinRuntime,
  PinSessions,
} from './application/pin-sessions';
import {
  ForgotPinHandler,
  GetPinStatusHandler,
  LockHandler,
  PinPolicy,
  RemovePinHandler,
  SetAutoLockHandler,
  SetPinHandler,
  UnlockHandler,
} from './application/pin.handlers';
import { SealedKeysEraser } from './application/sealed-keys';
import { PinLockGuard } from './pin-lock.guard';
import { PinController } from './pin.controller';
import { PinService } from './pin.service';

/**
 * F11.0p — the PIN lock. `PinLockGuard` is bound globally in `app.module.ts` (after the access
 * token guard); the unlocked sessions live in `PinSessions`, in memory. The repository port is
 * bound in the global `PersistenceModule`.
 */
@Module({
  imports: [CqrsModule],
  controllers: [PinController],
  providers: [
    PinService,
    PinClock,
    PinRuntime,
    PinSessions,
    PinLockState,
    PinPolicy,
    SealedKeysEraser,
    PinLockGuard,
    GetPinStatusHandler,
    SetPinHandler,
    RemovePinHandler,
    UnlockHandler,
    LockHandler,
    SetAutoLockHandler,
    ForgotPinHandler,
  ],
  exports: [PinSessions, PinLockState, PinRuntime, PinClock, PinLockGuard],
})
export class PinModule {}
