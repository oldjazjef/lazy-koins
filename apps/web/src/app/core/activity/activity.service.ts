import {
  computed,
  inject,
  Injectable,
  isSignal,
  type Signal,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom, isObservable, type Observable, Subject } from 'rxjs';
import { extractErrorDetail } from '../actions/extract-error-detail';
import {
  type NotificationAction,
  NotificationService,
} from '../notifications/notification.service';

/** How far a task is, when it knows (uploads 2/5, rates 12/40). */
export interface ActivityProgress {
  readonly done: number;
  readonly total: number;
  /** Shown as "45 %" instead of "12/40" (bytes of a download, …). */
  readonly asPercent?: boolean;
}

export interface ActivityOptions {
  /** Values for the label's placeholders; a signal when they change while it runs. */
  readonly params?:
    | Readonly<Record<string, unknown>>
    | Signal<Readonly<Record<string, unknown>>>;
  /** Optional progress, read live by the indicator. */
  readonly progress?: Signal<ActivityProgress | null>;
  /**
   * Toast when done (i18n key), optionally with an action such as "Anzeigen" or "Herunterladen".
   * Leave out when the caller toasts itself (the ActionRunner does, from `action.messages`).
   */
  readonly success?: string | ((result: unknown) => ActivitySuccess | null);
  /** Toast when it fails (i18n key); the server's reason is appended as with the ActionRunner. */
  readonly error?: string;
}

export interface ActivitySuccess {
  readonly key: string;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly action?: NotificationAction;
}

/**
 * A task that ended (F11.13): the notification centre turns a failure, or a task the user left
 * the page of, into a notification. URLs are the router's (`/app/projects/<id>?tab=rates`).
 */
export interface ActivityFinished {
  readonly label: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly outcome: 'success' | 'error';
  /** Where the task was started. */
  readonly startUrl: string;
  /** Where the user is when it ended. */
  readonly endUrl: string;
}

/** One running task, as the indicator shows it. */
export interface ActivityTask {
  readonly id: number;
  /** i18n key. */
  readonly label: string;
  readonly params: Signal<Readonly<Record<string, unknown>>>;
  readonly progress: Signal<ActivityProgress | null>;
}

const NO_PARAMS = signal<Readonly<Record<string, unknown>>>({}).asReadonly();
const NO_PROGRESS = signal<ActivityProgress | null>(null).asReadonly();

/**
 * Everything that runs in the background and may take more than about a second (rate refresh,
 * ESTV import, AI, uploads, recalculation, exports) — the app-wide activity indicator shows it
 * (bottom right, `ActivityIndicator`), and it turns into a success / error toast when done.
 * Root-provided, so leaving the page keeps the task visible. Never blocks the UI.
 *
 * Use `track()` directly, or `ActionRunner.run(…, { activity: … })` for actions.
 */
@Injectable({ providedIn: 'root' })
export class ActivityService {
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router, { optional: true });
  private readonly running = signal<readonly ActivityTask[]>([]);
  private readonly ended = new Subject<ActivityFinished>();
  private seq = 0;

  /** Oldest first. */
  readonly tasks = this.running.asReadonly();
  readonly count = computed(() => this.running().length);
  readonly busy = computed(() => this.running().length > 0);
  /** Every task when it ends — the notification centre listens (F11.13). */
  readonly finished: Observable<ActivityFinished> = this.ended.asObservable();

  /**
   * Shows `label` while `work` runs and resolves/rejects with it. `work` may be a promise, an
   * observable (its first value) or a function starting the work.
   */
  async track<T>(
    label: string,
    work: Promise<T> | Observable<T> | (() => Promise<T>),
    options: ActivityOptions = {},
  ): Promise<T> {
    const params = options.params;
    const task: ActivityTask = {
      id: ++this.seq,
      label,
      params:
        params === undefined
          ? NO_PARAMS
          : isSignal(params)
            ? params
            : signal(params).asReadonly(),
      progress: options.progress ?? NO_PROGRESS,
    };
    this.running.update((tasks) => [...tasks, task]);
    const startUrl = this.currentUrl();
    try {
      const result = await (typeof work === 'function'
        ? work()
        : isObservable(work)
          ? firstValueFrom(work)
          : work);
      this.remove(task.id);
      this.toastSuccess(options.success, result);
      this.announce(task, 'success', startUrl);
      return result;
    } catch (error) {
      this.remove(task.id);
      this.announce(task, 'error', startUrl);
      if (options.error) {
        const detail = extractErrorDetail(error);
        if (detail) this.notifications.error(options.error, detail);
        else this.notifications.error(options.error);
      }
      throw error;
    }
  }

  private toastSuccess(
    success: ActivityOptions['success'],
    result: unknown,
  ): void {
    if (!success) return;
    const message =
      typeof success === 'string' ? { key: success } : success(result);
    if (!message) return;
    if (message.action || message.params) {
      this.notifications.success(message.key, message.action, message.params);
    } else {
      this.notifications.success(message.key);
    }
  }

  private currentUrl(): string {
    return this.router?.url ?? '';
  }

  private announce(
    task: ActivityTask,
    outcome: 'success' | 'error',
    startUrl: string,
  ): void {
    this.ended.next({
      label: task.label,
      params: task.params(),
      outcome,
      startUrl,
      endUrl: this.currentUrl(),
    });
  }

  private remove(id: number): void {
    this.running.update((tasks) => tasks.filter((task) => task.id !== id));
  }
}
