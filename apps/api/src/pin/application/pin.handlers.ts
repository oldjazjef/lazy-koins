import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import {
  AUTO_LOCK_MINUTES,
  clampAutoLock,
  delayAfterFailures,
  isValidPin,
  type PinMode,
  secondsUntil,
  signedInAfter,
  type UserPin,
  WEB_MAX_FAILURES,
} from '../domain/pin';
import { hashPin, needsRehash, verifyPin } from '../domain/pin-hash';
import { UserPinRepositoryPort } from '../ports/user-pin.repository.port';
import {
  PinClock,
  PinLockState,
  PinRuntime,
  PinSessions,
  type UnlockGrant,
} from './pin-sessions';
import { type ErasedKeys, SealedKeysEraser } from './sealed-keys';

/** Who asks: the user and when they signed in (Firebase `auth_time`; null when unknown). */
export interface PinActor {
  readonly userId: string;
  readonly authTime?: string | null;
}

/** What the app needs to know about the lock (no secret in it). */
export interface PinStatus {
  readonly mode: PinMode;
  readonly hasPin: boolean;
  /** Desktop: a PIN is required (the setup wizard asks for one). */
  readonly required: boolean;
  /** No PIN, or the sent unlock token is valid. */
  readonly unlocked: boolean;
  /** When the sent unlock token runs out without activity. */
  readonly expiresAt: string | null;
  readonly autoLockMinutes: number;
  readonly failedAttempts: number;
  /** Seconds before the next attempt is allowed. */
  readonly retryAfterSeconds: number;
  /** Web: too many wrong attempts — sign in again. */
  readonly reloginRequired: boolean;
  /** Web: wrong attempts allowed before a new sign-in; null on the desktop. */
  readonly maxFailures: number | null;
}

/** The answer of every write that unlocks: the status plus the new token. */
export interface PinUnlocked {
  readonly status: PinStatus;
  readonly unlock: UnlockGrant;
}

/** Shared by the handlers: the status, the throttled check of a PIN, one check per user at a time. */
@Injectable()
export class PinPolicy {
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly pins: UserPinRepositoryPort,
    private readonly state: PinLockState,
    private readonly sessions: PinSessions,
    private readonly runtime: PinRuntime,
    private readonly clock: PinClock,
  ) {}

  get mode(): PinMode {
    return this.runtime.mode;
  }

  status(pin: UserPin | null, token?: string): PinStatus {
    const now = this.clock.now();
    const expiresAt = pin ? this.sessions.touch(token, pin.userId) : undefined;
    return {
      mode: this.mode,
      hasPin: pin !== null,
      required: this.mode === 'desktop',
      unlocked: pin === null || expiresAt !== undefined,
      expiresAt: expiresAt ?? null,
      autoLockMinutes: pin?.autoLockMinutes ?? AUTO_LOCK_MINUTES.default,
      failedAttempts: pin?.failedAttempts ?? 0,
      retryAfterSeconds: secondsUntil(pin?.nextAttemptAt ?? null, now),
      reloginRequired: pin?.reloginRequiredAt != null,
      maxFailures: this.mode === 'web' ? WEB_MAX_FAILURES : null,
    };
  }

  /** Runs `work` after every earlier PIN check of this user — no parallel guessing. */
  serial<T>(userId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(userId) ?? Promise.resolve();
    const next = previous.then(work, work);
    const settled = next.catch(() => undefined);
    this.queues.set(userId, settled);
    void settled.then(() => {
      if (this.queues.get(userId) === settled) this.queues.delete(userId);
    });
    return next;
  }

  /**
   * Checks `pin` against the stored hash, with the growing wait and (web) the sign-in after too
   * many failures. Throws 403 `reloginRequired`, 429 `pinThrottled` or 422 `wrongPin`; returns
   * the record with the counter reset on success.
   */
  async check(actor: PinActor, record: UserPin, pin: string): Promise<UserPin> {
    const nowMs = this.clock.now();
    let current = record;
    if (current.reloginRequiredAt !== null) {
      if (!signedInAfter(actor.authTime, current.reloginRequiredAt, nowMs)) {
        throw reloginRequired();
      }
      current = await this.save(current, {
        failedAttempts: 0,
        nextAttemptAt: null,
        reloginRequiredAt: null,
      });
    }
    const wait = secondsUntil(current.nextAttemptAt, nowMs);
    if (wait > 0) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: `Wait ${wait} s before the next attempt`,
          code: 'pinThrottled',
          retryAfterSeconds: wait,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (isValidPin(pin) && (await verifyPin(pin, current.pinHash))) {
      const rehash = needsRehash(current.pinHash);
      if (current.failedAttempts > 0 || current.nextAttemptAt || rehash) {
        current = await this.save(current, {
          failedAttempts: 0,
          nextAttemptAt: null,
          ...(rehash ? { pinHash: await hashPin(pin) } : {}),
        });
      }
      return current;
    }

    const failures = current.failedAttempts + 1;
    const delay = delayAfterFailures(failures);
    const relogin = this.mode === 'web' && failures >= WEB_MAX_FAILURES;
    await this.save(current, {
      failedAttempts: failures,
      nextAttemptAt:
        delay > 0 ? new Date(nowMs + delay * 1000).toISOString() : null,
      reloginRequiredAt: relogin ? new Date(nowMs).toISOString() : null,
    });
    if (relogin) {
      this.sessions.revokeUser(current.userId);
      throw reloginRequired();
    }
    throw new UnprocessableEntityException({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: 'Wrong PIN',
      code: 'wrongPin',
      retryAfterSeconds: delay,
      failedAttempts: failures,
      attemptsLeft: this.mode === 'web' ? WEB_MAX_FAILURES - failures : null,
    });
  }

  async save(record: UserPin, changes: Partial<UserPin>): Promise<UserPin> {
    const next = { ...record, ...changes };
    const saved = await this.pins.save(record.userId, {
      pinHash: next.pinHash,
      failedAttempts: next.failedAttempts,
      nextAttemptAt: next.nextAttemptAt,
      reloginRequiredAt: next.reloginRequiredAt,
      autoLockMinutes: next.autoLockMinutes,
    });
    this.state.forget(record.userId);
    return saved;
  }
}

function reloginRequired(): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    error: 'Forbidden',
    message: 'Too many wrong attempts or a forgotten PIN: sign in again',
    code: 'reloginRequired',
  });
}

function invalidPin(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    statusCode: 422,
    error: 'Unprocessable Entity',
    message: 'The PIN must be 4 to 8 digits',
    code: 'invalidPin',
  });
}

function noPin(): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message: 'No PIN is set',
    code: 'noPin',
  });
}

// --- status ---

export class GetPinStatusQuery {
  constructor(
    readonly actor: PinActor,
    readonly token?: string,
  ) {}
}

@QueryHandler(GetPinStatusQuery)
export class GetPinStatusHandler implements IQueryHandler<
  GetPinStatusQuery,
  PinStatus
> {
  constructor(
    private readonly state: PinLockState,
    private readonly policy: PinPolicy,
  ) {}

  async execute({ actor, token }: GetPinStatusQuery): Promise<PinStatus> {
    return this.policy.status(await this.state.pinOf(actor.userId), token);
  }
}

// --- set / change ---

export class SetPinCommand {
  constructor(
    readonly actor: PinActor,
    readonly pin: string,
    /** Required to change an existing PIN. */
    readonly currentPin?: string,
    readonly autoLockMinutes?: number,
  ) {}
}

/** Sets the first PIN, or changes it with the current one; the caller is unlocked afterwards. */
@CommandHandler(SetPinCommand)
export class SetPinHandler implements ICommandHandler<
  SetPinCommand,
  PinUnlocked
> {
  constructor(
    private readonly pins: UserPinRepositoryPort,
    private readonly state: PinLockState,
    private readonly sessions: PinSessions,
    private readonly policy: PinPolicy,
  ) {}

  async execute(command: SetPinCommand): Promise<PinUnlocked> {
    if (!isValidPin(command.pin)) throw invalidPin();
    return this.policy.serial(command.actor.userId, () => this.run(command));
  }

  private async run({
    actor,
    pin,
    currentPin,
    autoLockMinutes,
  }: SetPinCommand): Promise<PinUnlocked> {
    const existing = await this.pins.find(actor.userId);
    if (existing) {
      if (currentPin === undefined || currentPin === '') {
        throw new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          message: 'The current PIN is required to change it',
          code: 'currentPinRequired',
        });
      }
      await this.policy.check(actor, existing, currentPin);
    }
    const saved = await this.pins.save(actor.userId, {
      pinHash: await hashPin(pin),
      failedAttempts: 0,
      nextAttemptAt: null,
      reloginRequiredAt: null,
      autoLockMinutes: clampAutoLock(
        autoLockMinutes ??
          existing?.autoLockMinutes ??
          AUTO_LOCK_MINUTES.default,
      ),
    });
    this.state.forget(actor.userId);
    // Other tabs and windows must unlock with the new PIN.
    this.sessions.revokeUser(actor.userId);
    const unlock = this.sessions.issue(actor.userId, saved.autoLockMinutes);
    return { status: this.policy.status(saved, unlock.token), unlock };
  }
}

// --- remove (web only) ---

export class RemovePinCommand {
  constructor(
    readonly actor: PinActor,
    readonly currentPin: string,
  ) {}
}

@CommandHandler(RemovePinCommand)
export class RemovePinHandler implements ICommandHandler<
  RemovePinCommand,
  PinStatus
> {
  constructor(
    private readonly pins: UserPinRepositoryPort,
    private readonly state: PinLockState,
    private readonly sessions: PinSessions,
    private readonly policy: PinPolicy,
  ) {}

  async execute(command: RemovePinCommand): Promise<PinStatus> {
    if (this.policy.mode === 'desktop') {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: 'The desktop app requires a PIN',
        code: 'pinRequired',
      });
    }
    return this.policy.serial(command.actor.userId, async () => {
      const existing = await this.pins.find(command.actor.userId);
      if (!existing) throw noPin();
      await this.policy.check(command.actor, existing, command.currentPin);
      await this.pins.remove(command.actor.userId);
      this.state.forget(command.actor.userId);
      this.sessions.revokeUser(command.actor.userId);
      return this.policy.status(null);
    });
  }
}

// --- unlock / lock ---

export class UnlockCommand {
  constructor(
    readonly actor: PinActor,
    readonly pin: string,
  ) {}
}

@CommandHandler(UnlockCommand)
export class UnlockHandler implements ICommandHandler<
  UnlockCommand,
  PinUnlocked
> {
  constructor(
    private readonly pins: UserPinRepositoryPort,
    private readonly sessions: PinSessions,
    private readonly policy: PinPolicy,
  ) {}

  execute({ actor, pin }: UnlockCommand): Promise<PinUnlocked> {
    return this.policy.serial(actor.userId, async () => {
      const existing = await this.pins.find(actor.userId);
      if (!existing) throw noPin();
      const checked = await this.policy.check(actor, existing, pin);
      const unlock = this.sessions.issue(actor.userId, checked.autoLockMinutes);
      return { status: this.policy.status(checked, unlock.token), unlock };
    });
  }
}

export class LockCommand {
  constructor(readonly token: string | undefined) {}
}

/** Ends this session's unlock (auto-lock after inactivity, "Sperren"). */
@CommandHandler(LockCommand)
export class LockHandler implements ICommandHandler<LockCommand, void> {
  constructor(private readonly sessions: PinSessions) {}

  async execute({ token }: LockCommand): Promise<void> {
    this.sessions.revoke(token);
  }
}

// --- auto-lock time ---

export class SetAutoLockCommand {
  constructor(
    readonly actor: PinActor,
    readonly minutes: number,
    readonly token?: string,
  ) {}
}

@CommandHandler(SetAutoLockCommand)
export class SetAutoLockHandler implements ICommandHandler<
  SetAutoLockCommand,
  PinStatus
> {
  constructor(
    private readonly pins: UserPinRepositoryPort,
    private readonly policy: PinPolicy,
  ) {}

  async execute({
    actor,
    minutes,
    token,
  }: SetAutoLockCommand): Promise<PinStatus> {
    const existing = await this.pins.find(actor.userId);
    if (!existing) throw noPin();
    const saved = await this.policy.save(existing, {
      autoLockMinutes: clampAutoLock(minutes),
    });
    // Running sessions keep their idle time until the next unlock; the app's own idle timer
    // uses the new time at once.
    return this.policy.status(saved, token);
  }
}

// --- forgot ---

export class ForgotPinCommand {
  constructor(
    readonly actor: PinActor,
    /** Desktop: the user confirmed that the sealed keys are cleared. */
    readonly confirmClearKeys: boolean,
  ) {}
}

export interface PinReset {
  readonly status: PinStatus;
  /** Desktop: which sealed keys were removed (must be entered again). */
  readonly erasedKeys: ErasedKeys | null;
}

/**
 * "PIN vergessen" (F11.0p). Desktop: only with the confirmation that every sealed key (AI, mail,
 * CoinGecko, Etherscan) is cleared — whoever resets the PIN must not inherit them; the wizard then
 * asks for a new PIN. Web: only right after a sign-in (`auth_time` at most 10 min ago) — the
 * account's login is the proof; the PIN is removed and can be set again.
 */
@CommandHandler(ForgotPinCommand)
export class ForgotPinHandler implements ICommandHandler<
  ForgotPinCommand,
  PinReset
> {
  constructor(
    private readonly pins: UserPinRepositoryPort,
    private readonly state: PinLockState,
    private readonly sessions: PinSessions,
    private readonly policy: PinPolicy,
    private readonly eraser: SealedKeysEraser,
    private readonly clock: PinClock,
  ) {}

  async execute({
    actor,
    confirmClearKeys,
  }: ForgotPinCommand): Promise<PinReset> {
    const existing = await this.pins.find(actor.userId);
    if (!existing) throw noPin();
    let erasedKeys: ErasedKeys | null = null;
    if (this.policy.mode === 'desktop') {
      if (!confirmClearKeys) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          message:
            'Resetting the PIN clears every stored key; confirm with confirmClearKeys',
          code: 'confirmationRequired',
        });
      }
      erasedKeys = await this.eraser.eraseAll(actor.userId);
    } else if (!signedInAfter(actor.authTime, null, this.clock.now())) {
      throw reloginRequired();
    }
    await this.pins.remove(actor.userId);
    this.state.forget(actor.userId);
    this.sessions.revokeUser(actor.userId);
    return { status: this.policy.status(null), erasedKeys };
  }
}
