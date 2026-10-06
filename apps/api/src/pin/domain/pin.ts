/**
 * The PIN lock (F11.0p) — hand-written domain types and the pure policy: what a PIN looks like,
 * how long a user waits after wrong attempts, when the web wants a new sign-in.
 */

/** 4–8 digits, nothing else. */
export const PIN_PATTERN = /^\d{4,8}$/;

/**
 * Seconds to wait after the n-th wrong attempt in a row (index n − 1); the last value repeats.
 * The first wrong attempt costs nothing (a typo), then the wait grows.
 */
export const PIN_DELAYS_SECONDS = [
  0, 1, 2, 5, 10, 30, 60, 120, 300, 600, 900,
] as const;

/** Web: after this many wrong attempts in a row, unlocking needs a new sign-in. */
export const WEB_MAX_FAILURES = 10;

/** A sign-in at most this old counts as "just signed in" (web: forgot PIN, too many failures). */
export const FRESH_SIGN_IN_MS = 10 * 60_000;

export const AUTO_LOCK_MINUTES = { min: 1, max: 240, default: 15 } as const;

/**
 * `desktop` = the app on the user's machine (`AUTH_MODE=local`): PIN required, "forgot" resets it
 * and clears the sealed keys. `web` = the multi-user app: PIN optional, "forgot" needs a sign-in.
 */
export type PinMode = 'desktop' | 'web';

export interface UserPin {
  readonly userId: string;
  /** `scrypt$…` (pin-hash.ts) — never the PIN. */
  readonly pinHash: string;
  readonly failedAttempts: number;
  /** ISO timestamp: no attempt before it; null = right away. */
  readonly nextAttemptAt: string | null;
  /** ISO timestamp (web): unlocking needs a sign-in after it; null = not needed. */
  readonly reloginRequiredAt: string | null;
  readonly autoLockMinutes: number;
  readonly updatedAt: string | null;
}

export type SaveUserPinInput = Omit<UserPin, 'userId' | 'updatedAt'>;

export function isValidPin(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

/** The wait after `failures` wrong attempts in a row, in seconds. */
export function delayAfterFailures(failures: number): number {
  if (failures <= 0) return 0;
  const index = Math.min(failures, PIN_DELAYS_SECONDS.length) - 1;
  return PIN_DELAYS_SECONDS[index] ?? 0;
}

/** Whole seconds until `nextAttemptAt`, 0 when an attempt is allowed now. */
export function secondsUntil(
  nextAttemptAt: string | null,
  nowMs: number,
): number {
  if (!nextAttemptAt) return 0;
  const wait = Date.parse(nextAttemptAt) - nowMs;
  return wait > 0 ? Math.ceil(wait / 1000) : 0;
}

/**
 * Whether the request's sign-in happened after `since` (and, without `since`, at most
 * `FRESH_SIGN_IN_MS` ago). `authTime` comes from the identity token (Firebase `auth_time`); no
 * auth time (an old dev token, the desktop) never counts as fresh.
 */
export function signedInAfter(
  authTime: string | null | undefined,
  since: string | null,
  nowMs: number,
): boolean {
  if (!authTime) return false;
  const at = Date.parse(authTime);
  if (Number.isNaN(at)) return false;
  if (since !== null) return at > Date.parse(since);
  return nowMs - at <= FRESH_SIGN_IN_MS && at <= nowMs + 60_000;
}

export function clampAutoLock(minutes: number): number {
  if (!Number.isFinite(minutes)) return AUTO_LOCK_MINUTES.default;
  return Math.min(
    AUTO_LOCK_MINUTES.max,
    Math.max(AUTO_LOCK_MINUTES.min, Math.round(minutes)),
  );
}
