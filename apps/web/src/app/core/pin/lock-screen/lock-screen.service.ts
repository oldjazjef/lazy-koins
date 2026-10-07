import {
  computed,
  DestroyRef,
  inject,
  Injectable,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../auth/auth.service';
import { type PinProblem, PinLockService } from '../pin-lock.service';

export type ForgotStep = 'closed' | 'confirm' | 'working';

/**
 * The lock screen's logic (F11.0p): the typed PIN, unlocking, the wait after wrong attempts as a
 * countdown, "PIN vergessen" (desktop: reset with the confirmation that the stored keys are
 * cleared; web: sign in again, then reset) and signing out (web).
 */
@Injectable()
export class LockScreenService {
  readonly pin = inject(PinLockService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly value = signal('');
  readonly busy = signal(false);
  readonly problem = signal<PinProblem | null>(null);
  /** Seconds left before the next attempt (counts down). */
  readonly wait = signal(0);
  readonly forgotStep = signal<ForgotStep>('closed');
  readonly understood = signal(false);

  readonly desktop = computed(() => this.pin.status()?.mode === 'desktop');
  readonly reloginRequired = computed(
    () =>
      this.problem()?.code === 'reloginRequired' ||
      this.pin.status()?.reloginRequired === true,
  );
  readonly canSubmit = computed(
    () =>
      /^\d{4,8}$/.test(this.value()) &&
      !this.busy() &&
      this.wait() === 0 &&
      !this.reloginRequired(),
  );

  private timer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopTimer());
  }

  /** When the screen opens: the stored wait, and (web) a pending "PIN vergessen". */
  async open(): Promise<void> {
    this.startWait(this.pin.status()?.retryAfterSeconds ?? 0);
    if (!this.desktop() && this.pin.forgotPending()) {
      await this.resetWeb();
    }
  }

  /** A digit from the pad (at most 8). */
  press(digit: string): void {
    if (!/^\d$/.test(digit) || this.value().length >= 8) return;
    this.value.update((value) => value + digit);
    this.problem.set(null);
  }

  backspace(): void {
    this.value.update((value) => value.slice(0, -1));
  }

  /** From the input field: digits only, at most 8. */
  typed(raw: string): void {
    this.value.set(raw.replace(/\D/g, '').slice(0, 8));
    this.problem.set(null);
  }

  async submit(): Promise<boolean> {
    if (!this.canSubmit()) return false;
    this.busy.set(true);
    try {
      const problem = await this.pin.unlock(this.value());
      this.value.set('');
      this.problem.set(problem);
      if (problem) this.startWait(problem.retryAfterSeconds);
      return problem === null;
    } finally {
      this.busy.set(false);
    }
  }

  openForgot(): void {
    this.understood.set(false);
    this.forgotStep.set('confirm');
  }

  closeForgot(): void {
    this.forgotStep.set('closed');
  }

  /** Desktop: reset after the confirmation; the wizard then asks for a new PIN. */
  async resetDesktop(): Promise<void> {
    if (!this.understood()) return;
    this.forgotStep.set('working');
    const result = await this.pin.forgot(true);
    if ('code' in result) {
      this.problem.set(result);
      this.forgotStep.set('confirm');
      return;
    }
    this.forgotStep.set('closed');
    await this.router.navigate(['/app/setup'], {
      queryParams: { step: 'pin' },
    });
  }

  /**
   * Web: right after a sign-in the API resets the PIN; otherwise sign out first — the reset runs
   * automatically after the next sign-in.
   */
  async resetWeb(): Promise<void> {
    this.forgotStep.set('working');
    const result = await this.pin.forgot(false);
    if ('code' in result) {
      if (result.code === 'reloginRequired') {
        this.pin.rememberForgot();
        await this.signOut();
        return;
      }
      this.pin.clearForgotFlag();
      this.problem.set(result);
      this.forgotStep.set('closed');
      return;
    }
    this.forgotStep.set('closed');
    await this.router.navigate(['/app/setup'], {
      queryParams: { step: 'pin' },
    });
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigate(['/login']);
  }

  private startWait(seconds: number): void {
    this.stopTimer();
    this.wait.set(Math.max(0, Math.ceil(seconds)));
    if (this.wait() === 0) return;
    this.timer = setInterval(() => {
      this.wait.update((left) => Math.max(0, left - 1));
      if (this.wait() === 0) this.stopTimer();
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
