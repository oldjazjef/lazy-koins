/**
 * F11.0p on the desktop: when the app locks itself. Pure (no Electron import) so it is unit-tested;
 * main.ts feeds it `powerMonitor` events and the system idle time, and `lock` ends every unlocked
 * session in the in-process API (`RunningApi.lockAll`) and tells the window.
 *
 * - **Start**: the API runs in this process and keeps unlocked sessions in memory, so every start
 *   is locked anyway — `start()` only records it.
 * - **OS lock / suspend** (`lock-screen`, `suspend`): lock at once.
 * - **Inactivity**: no keyboard/mouse input on the whole system for the auto-lock time (the user's
 *   setting, reported by the window; default 15 min) → lock once, until there is input again.
 *   The window has its own idle timer for the app, and the API expires an unused token too.
 */
export type LockReason = 'start' | 'suspend' | 'lock-screen' | 'idle';

/** `powerMonitor` events that lock right away. */
export const LOCKING_EVENTS = ['suspend', 'lock-screen'] as const;

/** How often main.ts checks the system idle time. */
export const LOCK_TICK_MS = 30_000;

export const DEFAULT_IDLE_MINUTES = 15;

export interface LockWatchOptions {
  lock(reason: LockReason): void;
  /** Seconds since the last input on the system (`powerMonitor.getSystemIdleTime`). */
  systemIdleSeconds(): number;
}

export class LockWatch {
  private idleMinutes = DEFAULT_IDLE_MINUTES;
  private idleLocked = false;
  private started = false;

  constructor(private readonly options: LockWatchOptions) {}

  get autoLockMinutes(): number {
    return this.idleMinutes;
  }

  /** Every start begins locked (the API has no unlocked session yet). */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.options.lock('start');
  }

  /** The user's auto-lock time, 1–240 minutes; anything else keeps the current value. */
  setIdleMinutes(minutes: unknown): void {
    if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return;
    this.idleMinutes = Math.min(240, Math.max(1, Math.round(minutes)));
  }

  /** A `powerMonitor` event; the locking ones lock immediately. */
  onSystemEvent(event: string): boolean {
    if (!(LOCKING_EVENTS as readonly string[]).includes(event)) return false;
    this.options.lock(event as LockReason);
    return true;
  }

  /** Locks once when the system has been idle for the auto-lock time. */
  tick(): boolean {
    const idle = this.options.systemIdleSeconds();
    if (idle < this.idleMinutes * 60) {
      this.idleLocked = false;
      return false;
    }
    if (this.idleLocked) return false;
    this.idleLocked = true;
    this.options.lock('idle');
    return true;
  }
}
