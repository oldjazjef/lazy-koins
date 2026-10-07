import type { ConfigService } from '@nestjs/config';
import { InMemoryAiSettingsRepository } from '../../ai/testing/in-memory-ai-settings.repository';
import type { Env } from '../../config/env';
import { InMemoryMailSettingsRepository } from '../../mail/testing/mail-doubles';
import { InMemoryUserSettingsRepository } from '../../settings/testing/in-memory-user-settings.repository';
import { InMemoryChainSettingsRepository } from '../../wallets/testing/in-memory-wallet.repository';
import {
  PinClock,
  PinLockState,
  PinRuntime,
  PinSessions,
} from '../application/pin-sessions';
import {
  ForgotPinHandler,
  GetPinStatusHandler,
  LockHandler,
  PinPolicy,
  RemovePinHandler,
  SetAutoLockHandler,
  SetPinHandler,
  UnlockHandler,
} from '../application/pin.handlers';
import { SealedKeysEraser } from '../application/sealed-keys';
import type { PinMode } from '../domain/pin';
import { InMemoryUserPinRepository } from './in-memory-user-pin.repository';

/** A clock the spec moves by hand. */
export class ManualClock extends PinClock {
  constructor(public ms = Date.parse('2026-10-07T10:00:00Z')) {
    super();
  }

  override now(): number {
    return this.ms;
  }

  advance(seconds: number): void {
    this.ms += seconds * 1000;
  }

  iso(): string {
    return new Date(this.ms).toISOString();
  }
}

export function fakeConfig(
  values: Partial<Record<keyof Env, string>>,
): ConfigService<Env, true> {
  return {
    get: (key: keyof Env) => values[key],
  } as unknown as ConfigService<Env, true>;
}

/** Every PIN handler over port doubles, for one platform. */
export function pinSetup(mode: PinMode) {
  const clock = new ManualClock();
  const pins = new InMemoryUserPinRepository();
  const settings = new InMemoryUserSettingsRepository();
  const ai = new InMemoryAiSettingsRepository();
  const mail = new InMemoryMailSettingsRepository();
  const chains = new InMemoryChainSettingsRepository();
  const runtime = new PinRuntime(
    fakeConfig({ AUTH_MODE: mode === 'desktop' ? 'local' : 'dev' }),
  );
  const sessions = new PinSessions(clock);
  const state = new PinLockState(pins);
  const policy = new PinPolicy(pins, state, sessions, runtime, clock);
  const eraser = new SealedKeysEraser(settings, ai, mail, chains);
  return {
    clock,
    pins,
    settings,
    ai,
    mail,
    chains,
    runtime,
    sessions,
    state,
    policy,
    status: new GetPinStatusHandler(state, policy),
    set: new SetPinHandler(pins, state, sessions, policy),
    remove: new RemovePinHandler(pins, state, sessions, policy),
    unlock: new UnlockHandler(pins, sessions, policy),
    lock: new LockHandler(sessions),
    autoLock: new SetAutoLockHandler(pins, policy),
    forgot: new ForgotPinHandler(pins, state, sessions, policy, eraser, clock),
  };
}
