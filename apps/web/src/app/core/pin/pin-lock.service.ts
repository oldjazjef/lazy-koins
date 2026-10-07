import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  computed,
  DestroyRef,
  DOCUMENT,
  effect,
  inject,
  Injectable,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { apiUrl } from '../api/api-url';
import type {
  PinReset,
  PinStatus,
  PinUnlocked,
  UnlockGrant,
} from '../api/setup.types';
import { AuthService } from '../auth/auth.service';
import { desktopBridge } from '../desktop/desktop-bridge';

/** The header the API reads the unlock token from (F11.0p). */
export const UNLOCK_HEADER = 'x-lazykoins-unlock';

/** sessionStorage: the token of this tab — gone when the tab/window is closed. */
export const UNLOCK_STORAGE_KEY = 'lk-unlock';

/** localStorage: "PIN vergessen" was started on the web; after the next sign-in it resets. */
export const FORGOT_STORAGE_KEY = 'lk-pin-forgot';

const CHANNEL = 'lk-pin';
/** How long a new tab waits for an open tab to share its unlock (ms). */
const ASK_TABS_MS = 250;
/** Activity without data requests keeps the API session alive at most this often (ms). */
const RENEW_EVERY_MS = 60_000;
const IDLE_CHECK_MS = 15_000;
const ACTIVITY_EVENTS = [
  'pointerdown',
  'keydown',
  'wheel',
  'touchstart',
  'mousemove',
] as const;

export type LockState = 'unknown' | 'unlocked' | 'locked';

/** What went wrong at the lock screen, for the message. */
export interface PinProblem {
  code: string;
  retryAfterSeconds: number;
  attemptsLeft: number | null;
}

type ChannelMessage =
  { type: 'ask' } | { type: 'grant'; token: string } | { type: 'lock' };

/**
 * The PIN lock in the app (F11.0p). The API is the one that enforces it (423 for data requests
 * without a valid `x-lazykoins-unlock` token); this service keeps the token, knows whether the
 * app is locked, shows the lock screen (`lk-lock-screen` in the root) and holds API requests while
 * locked (`unlockInterceptor`).
 *
 * - The token lives in **sessionStorage**: a new tab or window after the app was closed has none →
 *   locked. While another tab is open and unlocked it shares its token (BroadcastChannel), so a
 *   second tab does not ask again.
 * - **Inactivity** (no input for the auto-lock time) locks; activity renews the API session.
 * - **Desktop**: the shell locks on OS lock / suspend / system idle and tells the window.
 */
@Injectable({ providedIn: 'root' })
export class PinLockService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly document = inject(DOCUMENT);

  private readonly stateSignal = signal<LockState>('unknown');
  private readonly statusSignal = signal<PinStatus | null>(null);
  readonly state = this.stateSignal.asReadonly();
  readonly status = this.statusSignal.asReadonly();
  readonly locked = computed(() => this.stateSignal() === 'locked');
  /** Why the shell locked (desktop: lock-screen, suspend, idle) — for a hint, nothing else. */
  readonly lockReason = signal<string | null>(null);

  private initializing: Promise<void> | null = null;
  private waiters: Array<() => void> = [];
  private readonly channel: BroadcastChannel | null =
    typeof BroadcastChannel === 'function'
      ? new BroadcastChannel(CHANNEL)
      : null;
  private lastActivity = Date.now();
  private lastRenew = Date.now();
  private idleTimer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    this.channel?.addEventListener('message', (event: MessageEvent) =>
      this.onMessage(event.data as ChannelMessage),
    );
    for (const name of ACTIVITY_EVENTS) {
      this.document.addEventListener(name, this.onActivity, { passive: true });
    }
    desktopBridge()?.lock?.onLocked((reason) => {
      this.lockReason.set(reason);
      this.markLocked();
    });
    // A new sign-in (or a sign-out) starts over: the lock state belongs to the session.
    let previous = this.auth.session();
    effect(() => {
      const session = this.auth.session();
      const changed = previous !== 'restoring' && session !== previous;
      previous = session;
      if (changed) untracked(() => this.reset());
    });
    inject(DestroyRef).onDestroy(() => this.dispose());
  }

  /** The unlock token of this tab, if any. */
  token(): string | null {
    try {
      return sessionStorage.getItem(UNLOCK_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  /**
   * Resolves when data requests may go out: signed out (the API answers 401 anyway), no PIN, or
   * unlocked. Waits while the lock screen is up.
   */
  async whenUnlocked(): Promise<void> {
    await this.ensure();
    if (this.stateSignal() !== 'locked') return;
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  /** Loads the status once per session (the first data request or the guard triggers it). */
  ensure(): Promise<void> {
    if (this.stateSignal() !== 'unknown') return Promise.resolve();
    this.initializing ??= this.initialize().finally(() => {
      this.initializing = null;
    });
    return this.initializing;
  }

  /** Reloads the status (after "PIN vergessen", a new PIN, …). */
  async refresh(): Promise<PinStatus | null> {
    try {
      const status = await firstValueFrom(
        this.http.get<PinStatus>(apiUrl('/pin/status')),
      );
      this.apply(status);
      return status;
    } catch {
      return null;
    }
  }

  /** Unlock with the PIN; `null` = unlocked, else what went wrong (wait, attempts left). */
  async unlock(pin: string): Promise<PinProblem | null> {
    try {
      const result = await firstValueFrom(
        this.http.post<PinUnlocked>(apiUrl('/pin/unlock'), { pin }),
      );
      this.adopt(result);
      return null;
    } catch (error) {
      const problem = problemOf(error);
      if (problem.code === 'reloginRequired') void this.refresh();
      return problem;
    }
  }

  /** Sets the first PIN, or changes it with the current one; unlocks this session. */
  async setPin(
    pin: string,
    currentPin?: string,
    autoLockMinutes?: number,
  ): Promise<PinProblem | null> {
    try {
      this.adopt(
        await firstValueFrom(
          this.http.put<PinUnlocked>(apiUrl('/pin'), {
            pin,
            ...(currentPin ? { currentPin } : {}),
            ...(autoLockMinutes ? { autoLockMinutes } : {}),
          }),
        ),
      );
      return null;
    } catch (error) {
      return problemOf(error);
    }
  }

  /** Web: removes the PIN (current PIN required). */
  async removePin(currentPin: string): Promise<PinProblem | null> {
    try {
      const status = await firstValueFrom(
        this.http.post<PinStatus>(apiUrl('/pin/remove'), { currentPin }),
      );
      this.clearToken();
      this.apply(status);
      return null;
    } catch (error) {
      return problemOf(error);
    }
  }

  /** Minutes without activity before the app locks (1–240). */
  async setAutoLock(minutes: number): Promise<PinProblem | null> {
    try {
      const status = await firstValueFrom(
        this.http.put<PinStatus>(apiUrl('/pin/auto-lock'), { minutes }),
      );
      // The idle timer uses the new time at once; the API session keeps its time until unlock.
      this.statusSignal.set(status);
      void desktopBridge()
        ?.lock?.setIdleMinutes(status.autoLockMinutes)
        .catch(() => undefined);
      return null;
    } catch (error) {
      return problemOf(error);
    }
  }

  /** After setting or changing the PIN: this session is unlocked with the new token. */
  adopt(result: PinUnlocked): void {
    this.store(result.unlock);
    this.channel?.postMessage({
      type: 'grant',
      token: result.unlock.token,
    } satisfies ChannelMessage);
    this.apply(result.status, true);
  }

  /** Locks now ("Sperren", inactivity); ends the token on the API too. */
  async lock(): Promise<void> {
    const token = this.token();
    this.markLocked();
    this.channel?.postMessage({ type: 'lock' } satisfies ChannelMessage);
    if (token) {
      try {
        await firstValueFrom(
          this.http.post(apiUrl('/pin/lock'), null, {
            headers: { [UNLOCK_HEADER]: token },
          }),
        );
      } catch {
        // Locked locally either way; the API session expires on its own.
      }
    }
  }

  /** A 423 from the API (token expired or the shell locked): show the lock screen. */
  markLocked(): void {
    this.clearToken();
    if (this.statusSignal()?.hasPin === false) return;
    this.stateSignal.set('locked');
  }

  /** "PIN vergessen": desktop with the confirmation (keys cleared), web after a fresh sign-in. */
  async forgot(confirmClearKeys: boolean): Promise<PinReset | PinProblem> {
    try {
      const reset = await firstValueFrom(
        this.http.post<PinReset>(apiUrl('/pin/forgot'), { confirmClearKeys }),
      );
      this.clearForgotFlag();
      this.apply(reset.status);
      return reset;
    } catch (error) {
      return problemOf(error);
    }
  }

  /** Web: remember that the user wants to reset the PIN after signing in again. */
  rememberForgot(): void {
    try {
      localStorage.setItem(FORGOT_STORAGE_KEY, '1');
    } catch {
      // Without storage the user starts "PIN vergessen" again after the sign-in.
    }
  }

  forgotPending(): boolean {
    try {
      return localStorage.getItem(FORGOT_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  clearForgotFlag(): void {
    try {
      localStorage.removeItem(FORGOT_STORAGE_KEY);
    } catch {
      // Nothing stored, nothing to clear.
    }
  }

  private async initialize(): Promise<void> {
    await this.auth.ready;
    if (!this.auth.isSignedIn()) return;
    if (!this.token()) {
      const shared = await this.askOtherTabs();
      if (shared) this.storeToken(shared);
    }
    const status = await this.refresh();
    if (!status) {
      // The API is unreachable: let the requests fail on their own instead of hanging.
      this.stateSignal.set('unlocked');
    }
  }

  private apply(status: PinStatus, unlocked = status.unlocked): void {
    this.statusSignal.set(status);
    if (!status.hasPin || unlocked) {
      this.lockReason.set(null);
      this.stateSignal.set('unlocked');
      const waiters = this.waiters;
      this.waiters = [];
      for (const resolve of waiters) resolve();
      this.lastActivity = Date.now();
      this.startIdleTimer();
    } else {
      this.clearToken();
      this.stateSignal.set('locked');
    }
    void desktopBridge()
      ?.lock?.setIdleMinutes(status.autoLockMinutes)
      .catch(() => undefined);
  }

  private askOtherTabs(): Promise<string | null> {
    const channel = this.channel;
    if (!channel) return Promise.resolve(null);
    return new Promise((resolve) => {
      const listener = (event: MessageEvent) => {
        const message = event.data as ChannelMessage;
        if (message?.type === 'grant' && typeof message.token === 'string') {
          done(message.token);
        }
      };
      const timer = setTimeout(() => done(null), ASK_TABS_MS);
      const done = (token: string | null) => {
        clearTimeout(timer);
        channel.removeEventListener('message', listener);
        resolve(token);
      };
      channel.addEventListener('message', listener);
      channel.postMessage({ type: 'ask' } satisfies ChannelMessage);
    });
  }

  private onMessage(message: ChannelMessage): void {
    if (message?.type === 'ask') {
      const token = this.token();
      if (token && this.stateSignal() === 'unlocked') {
        this.channel?.postMessage({
          type: 'grant',
          token,
        } satisfies ChannelMessage);
      }
    } else if (message?.type === 'lock') {
      this.markLocked();
    } else if (
      message?.type === 'grant' &&
      this.stateSignal() === 'locked' &&
      typeof message.token === 'string'
    ) {
      // Another tab was unlocked: so is this one.
      this.storeToken(message.token);
      void this.refresh();
    }
  }

  private readonly onActivity = (): void => {
    const now = Date.now();
    this.lastActivity = now;
    if (
      this.stateSignal() === 'unlocked' &&
      this.statusSignal()?.hasPin &&
      now - this.lastRenew > RENEW_EVERY_MS
    ) {
      this.lastRenew = now;
      const token = this.token();
      if (token) {
        this.http
          .post(apiUrl('/pin/renew'), null, {
            headers: { [UNLOCK_HEADER]: token },
          })
          .subscribe({ error: () => undefined });
      }
    }
  };

  private startIdleTimer(): void {
    if (this.idleTimer) return;
    this.idleTimer = setInterval(() => this.checkIdle(), IDLE_CHECK_MS);
  }

  /** Locks after the auto-lock time without any input (public for the spec). */
  checkIdle(now = Date.now()): void {
    const status = this.statusSignal();
    if (this.stateSignal() !== 'unlocked' || !status?.hasPin) return;
    if (now - this.lastActivity >= status.autoLockMinutes * 60_000) {
      this.lockReason.set('idle');
      void this.lock();
    }
  }

  private reset(): void {
    this.stateSignal.set('unknown');
    this.statusSignal.set(null);
    this.lockReason.set(null);
    if (!this.auth.isSignedIn()) this.clearToken();
  }

  private store(grant: UnlockGrant): void {
    this.storeToken(grant.token);
  }

  private storeToken(token: string): void {
    try {
      sessionStorage.setItem(UNLOCK_STORAGE_KEY, token);
    } catch {
      // Without sessionStorage the app asks for the PIN on every reload.
    }
  }

  private clearToken(): void {
    try {
      sessionStorage.removeItem(UNLOCK_STORAGE_KEY);
    } catch {
      // Nothing stored.
    }
  }

  private dispose(): void {
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.channel?.close();
    for (const name of ACTIVITY_EVENTS) {
      this.document.removeEventListener(name, this.onActivity);
    }
  }
}

/** The API's error body → code, wait and attempts left. */
export function problemOf(error: unknown): PinProblem {
  if (error instanceof HttpErrorResponse) {
    const body = (error.error ?? {}) as {
      code?: unknown;
      retryAfterSeconds?: unknown;
      attemptsLeft?: unknown;
    };
    return {
      code: typeof body.code === 'string' ? body.code : 'failed',
      retryAfterSeconds:
        typeof body.retryAfterSeconds === 'number' ? body.retryAfterSeconds : 0,
      attemptsLeft:
        typeof body.attemptsLeft === 'number' ? body.attemptsLeft : null,
    };
  }
  return { code: 'failed', retryAfterSeconds: 0, attemptsLeft: null };
}
