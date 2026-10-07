import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import type { PinMode, UserPin } from '../domain/pin';
import { UserPinRepositoryPort } from '../ports/user-pin.repository.port';

/** The header that carries the unlock token on every data request (F11.0p). */
export const UNLOCK_HEADER = 'x-lazykoins-unlock';

/** At most this many open sessions (tabs, windows) per user; the oldest goes first. */
const MAX_SESSIONS_PER_USER = 20;

/** The time, replaceable in specs. */
@Injectable()
export class PinClock {
  now(): number {
    return Date.now();
  }
}

/** Desktop or web — from `AUTH_MODE` (local = the desktop app). */
@Injectable()
export class PinRuntime {
  readonly mode: PinMode;

  constructor(config: ConfigService<Env, true>) {
    this.mode =
      config.get('AUTH_MODE', { infer: true }) === 'local' ? 'desktop' : 'web';
  }
}

export interface UnlockGrant {
  /** Opaque, 256 bits; sent back in `x-lazykoins-unlock`. */
  readonly token: string;
  /** ISO timestamp; every request with the token moves it on (sliding). */
  readonly expiresAt: string;
}

interface Session {
  readonly userId: string;
  readonly idleMs: number;
  readonly createdAt: number;
  expiresAt: number;
}

/**
 * The unlocked sessions, **in memory** — on purpose: a restart of the API (every start of the
 * desktop app, which runs it in-process) locks everyone, which is exactly "PIN on every start".
 * A token is valid for the user's auto-lock time after its last use; only its SHA-256 is kept.
 * One API process per database (CLAUDE.md), so no shared store is needed.
 */
@Injectable()
export class PinSessions {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly clock: PinClock) {}

  issue(userId: string, idleMinutes: number): UnlockGrant {
    const now = this.clock.now();
    this.prune(now);
    const mine = [...this.sessions.entries()]
      .filter(([, session]) => session.userId === userId)
      .sort(([, a], [, b]) => a.createdAt - b.createdAt);
    for (const [key] of mine.slice(
      0,
      Math.max(0, mine.length - MAX_SESSIONS_PER_USER + 1),
    )) {
      this.sessions.delete(key);
    }
    const token = randomBytes(32).toString('base64url');
    const idleMs = idleMinutes * 60_000;
    this.sessions.set(digest(token), {
      userId,
      idleMs,
      createdAt: now,
      expiresAt: now + idleMs,
    });
    return { token, expiresAt: new Date(now + idleMs).toISOString() };
  }

  /**
   * Whether `token` unlocks `userId` now; a valid token is renewed (its idle time starts again).
   * Returns the new expiry, or `undefined`.
   */
  touch(token: string | undefined, userId: string): string | undefined {
    if (!token) return undefined;
    const key = digest(token);
    const session = this.sessions.get(key);
    const now = this.clock.now();
    if (!session || session.userId !== userId) return undefined;
    if (session.expiresAt <= now) {
      this.sessions.delete(key);
      return undefined;
    }
    session.expiresAt = now + session.idleMs;
    return new Date(session.expiresAt).toISOString();
  }

  /**
   * Whether `userId` has any unlocked session right now — without renewing it (F11.16: the
   * desktop's MCP requests are refused while the app is locked; they never keep it open).
   */
  isUnlocked(userId: string): boolean {
    const now = this.clock.now();
    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.expiresAt > now) return true;
    }
    return false;
  }

  revoke(token: string | undefined): void {
    if (token) this.sessions.delete(digest(token));
  }

  revokeUser(userId: string): void {
    for (const [key, session] of this.sessions) {
      if (session.userId === userId) this.sessions.delete(key);
    }
  }

  /** Locks everyone — the desktop shell calls it on OS lock / suspend. */
  revokeAll(): void {
    this.sessions.clear();
  }

  private prune(now: number): void {
    for (const [key, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(key);
    }
  }
}

function digest(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

/**
 * Whether a user has a PIN, cached per user — the lock guard asks on every request. Every write
 * goes through the PIN handlers, which call `forget`.
 */
@Injectable()
export class PinLockState {
  private readonly cache = new Map<string, UserPin | null>();

  constructor(private readonly pins: UserPinRepositoryPort) {}

  async pinOf(userId: string): Promise<UserPin | null> {
    if (!this.cache.has(userId)) {
      if (this.cache.size > 10_000) this.cache.clear();
      this.cache.set(userId, (await this.pins.find(userId)) ?? null);
    }
    return this.cache.get(userId) ?? null;
  }

  forget(userId: string): void {
    this.cache.delete(userId);
  }
}
