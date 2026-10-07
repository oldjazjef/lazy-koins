import { HttpClient } from '@angular/common/http';
import {
  computed,
  DestroyRef,
  inject,
  Injectable,
  Injector,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom, type Subscription } from 'rxjs';
import { EstvService } from '../../shared/estv/estv.service';
import { formatRelative } from '../../shared/format/relative-time';
import {
  type ActivityFinished,
  ActivityService,
} from '../activity/activity.service';
import { apiUrl } from '../api/api-url';
import type {
  AppNotification,
  NotificationCount,
  NotificationList,
} from '../api/notifications.types';
import { desktopBridge } from '../desktop/desktop-bridge';
import { NotificationService } from '../notifications/notification.service';

/** How often the bell asks for news (F11.11: lightweight polling, no websocket). */
export const POLL_MS = 60_000;
/** The panel shows the newest of these. */
export const PANEL_LIMIT = 50;
const HIDE_RESOLVED_KEY = 'lk-notifications-hide-resolved';
const PROJECT_URL = /^\/app\/projects\/([0-9a-f-]{36})(?:[/?#]|$)/i;

/** Params that are codes: shown as their text (`simple_pdf` → "Einfach (PDF)"). */
const PARAM_TRANSLATIONS: readonly (readonly [string, string])[] = [
  ['reason', 'notifications.reason.'],
  ['code', 'ai.errors.'],
  ['kind', 'exports.kind.'],
];

/** A notification ready to show: its text translated, its time relative. */
export interface NotificationView {
  readonly notification: AppNotification;
  readonly title: string;
  readonly when: string;
  readonly unread: boolean;
  readonly resolved: boolean;
}

export interface NotificationGroup {
  /** null = not about one project. */
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly items: readonly NotificationView[];
}

function readHideResolved(): boolean {
  try {
    return globalThis.localStorage?.getItem(HIDE_RESOLVED_KEY) !== 'false';
  } catch {
    return true;
  }
}

/** `/app/projects/x?tab=rates#f` → path and query. */
function splitUrl(url: string): {
  path: string;
  query: Record<string, string>;
} {
  const [beforeHash] = url.split('#');
  const [path = '', search = ''] = (beforeHash ?? '').split('?');
  const query: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(search)) query[key] = value;
  return { path, query };
}

/** Only flat values go to the server; it sanitises them again. */
function flatParams(
  params: Readonly<Record<string, unknown>>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(params)) {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * The notification centre in the app (F11.11–F11.13): the bell's unread count and the newest
 * notifications, polled every minute while signed in and after every finished task; mark read /
 * all read / dismiss; a notification's action (navigate, or a named action like "Erneut
 * versuchen"). Tasks of the activity indicator that fail — or finish after the user left their
 * page — are reported to the API (`POST /api/notifications/activity`). In the desktop app new
 * errors and "Handlungsbedarf" also become OS notifications (when switched on).
 */
@Injectable({ providedIn: 'root' })
export class NotificationCentreService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly toasts = inject(NotificationService);
  private readonly activity = inject(ActivityService);
  private readonly injector = inject(Injector);

  private readonly list = signal<readonly AppNotification[]>([]);
  private readonly count = signal(0);
  private readonly clock = signal(Date.now());
  private readonly failed = signal(false);
  private timer: ReturnType<typeof setInterval> | null = null;
  private finishedSub: Subscription | null = null;
  /** `id|occurredAt` of what was already there — never shown as an OS notification again. */
  private readonly seen = new Set<string>();
  private primed = false;

  readonly unread = this.count.asReadonly();
  readonly loadFailed = this.failed.asReadonly();
  readonly loaded = signal(false);
  /** "Erledigte ausblenden" (default on), remembered in this browser. */
  readonly hideResolved = signal(readHideResolved());

  readonly views = computed<NotificationView[]>(() => {
    const now = this.clock();
    return this.list()
      .filter((n) => !this.hideResolved() || n.resolvedAt === null)
      .map((notification) => ({
        notification,
        title: this.text(notification),
        when: formatRelative(notification.occurredAt, now),
        unread: notification.readAt === null,
        resolved: notification.resolvedAt !== null,
      }));
  });

  /** Newest first, grouped by project (the group of the newest notification first). */
  readonly groups = computed<NotificationGroup[]>(() => {
    const groups = new Map<string, NotificationGroup>();
    for (const view of this.views()) {
      const key = view.notification.projectId ?? '';
      const group = groups.get(key) ?? {
        projectId: view.notification.projectId,
        projectName: view.notification.projectName,
        items: [],
      };
      groups.set(key, { ...group, items: [...group.items, view] });
    }
    return [...groups.values()];
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  /** Starts polling (the shell, once signed in). */
  start(): void {
    if (this.timer !== null) return;
    void this.reportSyncConflicts().then(() => this.refresh());
    this.timer = setInterval(() => void this.refresh(), POLL_MS);
    this.finishedSub = this.activity.finished.subscribe(
      (finished) => void this.onFinished(finished),
    );
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.finishedSub?.unsubscribe();
    this.finishedSub = null;
  }

  setHideResolved(hide: boolean): void {
    this.hideResolved.set(hide);
    try {
      globalThis.localStorage?.setItem(HIDE_RESOLVED_KEY, String(hide));
    } catch {
      // Private mode: the toggle just is not remembered.
    }
  }

  /** The newest notifications and the badge, in one request. */
  async refresh(): Promise<void> {
    try {
      const page = await firstValueFrom(
        this.http.get<NotificationList>(apiUrl('/notifications'), {
          params: {
            status: 'all',
            includeResolved: 'true',
            limit: PANEL_LIMIT,
          },
        }),
      );
      this.list.set(page.items);
      this.count.set(page.unread);
      this.clock.set(Date.now());
      this.failed.set(false);
      this.loaded.set(true);
      this.notifyOs(page.items);
    } catch {
      this.failed.set(true);
    }
  }

  async markRead(notification: AppNotification): Promise<void> {
    if (notification.readAt !== null) return;
    this.patch(notification.id, { readAt: new Date().toISOString() });
    await this.post(`/notifications/${notification.id}/read`);
  }

  async markAllRead(): Promise<void> {
    const now = new Date().toISOString();
    this.list.update((items) =>
      items.map((n) => (n.readAt === null ? { ...n, readAt: now } : n)),
    );
    this.count.set(0);
    await this.post('/notifications/read-all');
  }

  async dismiss(notification: AppNotification): Promise<void> {
    this.list.update((items) => items.filter((n) => n.id !== notification.id));
    await this.post(`/notifications/${notification.id}/dismiss`);
  }

  /** The notification's button: marks it read, runs a named action, then navigates. */
  async open(notification: AppNotification): Promise<void> {
    const action = notification.action;
    void this.markRead(notification);
    if (!action) return;
    if (action.named === 'retry:rates' && notification.projectId) {
      void this.retryRates(notification.projectId);
    } else if (action.named === 'retry:estv') {
      void this.injector
        .get(EstvService)
        .update()
        .catch(() => undefined);
    }
    await this.router.navigate([action.route], {
      queryParams: action.query ?? {},
      fragment: action.fragment,
    });
  }

  /** The translated one-line text of a notification. */
  text(notification: AppNotification): string {
    // F11.2: a signal read — the lists that call this re-translate on a language switch.
    this.translate.currentLang();
    const params: Record<string, unknown> = { ...notification.params };
    const task = notification.params['task'];
    if (typeof task === 'string') {
      params['task'] = this.translate.instant(task, notification.params);
    }
    for (const [name, prefix] of PARAM_TRANSLATIONS) {
      const value = notification.params[name];
      if (typeof value === 'string') params[name] = this.lookup(prefix, value);
    }
    const reasons = notification.params['reasons'];
    if (typeof reasons === 'string') {
      params['reasons'] = reasons
        .split(',')
        .filter((reason) => reason !== '')
        .map((reason) => this.lookup('projects.sent.reason.', reason))
        .join(', ');
    }
    return this.translate.instant(notification.titleKey, params);
  }

  /** `prefix + code` translated, or the code itself when there is no text for it. */
  private lookup(prefix: string, code: string): string {
    const key = `${prefix}${code}`;
    const text = this.translate.instant(key);
    return text === key ? code : text;
  }

  private async retryRates(projectId: string): Promise<void> {
    try {
      await this.activity.track(
        'activity.rates',
        this.http.post(apiUrl(`/projects/${projectId}/rates/refresh`), {
          force: false,
        }),
        {
          success: 'notifications.retryDone',
          error: 'notifications.retryFailed',
        },
      );
    } catch {
      // The activity toast has said it; the server raised the notification again.
    }
  }

  /** F11.13: a failure, or a task finished after its page was left, becomes a notification. */
  private async onFinished(finished: ActivityFinished): Promise<void> {
    const start = splitUrl(finished.startUrl);
    const left = start.path !== splitUrl(finished.endUrl).path;
    if (finished.outcome === 'error' || left) {
      const projectId = PROJECT_URL.exec(start.path)?.[1];
      try {
        await firstValueFrom(
          this.http.post(apiUrl('/notifications/activity'), {
            label: finished.label,
            outcome: finished.outcome,
            params: flatParams(finished.params),
            ...(projectId ? { projectId } : {}),
            ...(start.path.startsWith('/app/') ? { route: start.path } : {}),
            ...(Object.keys(start.query).length > 0
              ? { query: start.query }
              : {}),
          }),
        );
      } catch {
        // A lost report is no reason to bother the user twice.
      }
    }
    await this.refresh();
  }

  /** Desktop only (F3.4): conflict copies of the database next to it → "Sync-Konflikt". */
  private async reportSyncConflicts(): Promise<void> {
    const bridge = desktopBridge();
    if (!bridge) return;
    try {
      const info = await bridge.storage.info();
      await firstValueFrom(
        this.http.put(apiUrl('/notifications/sync-conflict'), {
          count: info.conflictCopies.length,
        }),
      );
    } catch {
      // The storage page shows the copies anyway.
    }
  }

  /** Desktop only: new unread errors / "Handlungsbedarf" since the last poll (F11.13). */
  private notifyOs(items: readonly AppNotification[]): void {
    const bridge = desktopBridge()?.notifications;
    const fresh = items.filter(
      (n) =>
        n.readAt === null &&
        n.resolvedAt === null &&
        !this.seen.has(`${n.id}|${n.occurredAt}`),
    );
    for (const n of items) this.seen.add(`${n.id}|${n.occurredAt}`);
    if (!this.primed) {
      // What was there at start is not news.
      this.primed = true;
      return;
    }
    if (!bridge) return;
    for (const n of fresh) {
      if (n.kind !== 'error' && n.kind !== 'action') continue;
      void bridge
        .show({
          kind: n.kind,
          title: this.text(n),
          body: n.projectName ?? this.translate.instant('notifications.osBody'),
        })
        .catch(() => undefined);
    }
  }

  private patch(id: string, changes: Partial<AppNotification>): void {
    this.list.update((items) =>
      items.map((n) => (n.id === id ? { ...n, ...changes } : n)),
    );
  }

  private async post(path: `/${string}`): Promise<void> {
    try {
      const answer = await firstValueFrom(
        this.http.post<NotificationCount>(apiUrl(path), {}),
      );
      this.count.set(answer.unread);
    } catch {
      this.toasts.error('notifications.updateFailed');
      await this.refresh();
    }
  }
}
