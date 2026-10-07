import { httpResource } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { apiUrl } from '../../../../core/api/api-url';
import { DataChanges, reloadOn } from '../../../../core/data/data-changes';
import type { Project } from '../../../../core/api/api.types';
import {
  type AppNotification,
  NOTIFICATION_KINDS,
  type NotificationKind,
  type NotificationList,
} from '../../../../core/api/notifications.types';
import {
  NotificationCentreService,
  type NotificationView,
} from '../../../../core/notification-centre/notification-centre.service';
import { formatRelative } from '../../../../shared/format/relative-time';

/** The page loads at most this many; the table pages them (U2). */
export const PAGE_LIMIT = 500;

export const STATUS_FILTERS = ['all', 'unread', 'resolved'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

/**
 * F11.11 `/app/notifications`: every notification of mine with filters by kind, project and
 * status (all / unread / incl. erledigte). Actions go through the notification centre, so the
 * bell stays in step; the list reloads after each.
 */
@Injectable({ providedIn: 'root' })
export class NotificationsPageService {
  private readonly centre = inject(NotificationCentreService);
  private readonly changes = inject(DataChanges);

  readonly kind = signal<NotificationKind | ''>('');
  readonly projectId = signal('');
  readonly status = signal<StatusFilter>('all');
  readonly kinds = NOTIFICATION_KINDS;

  readonly notifications = httpResource<NotificationList>(() => ({
    url: apiUrl('/notifications'),
    params: {
      status: this.status() === 'unread' ? 'unread' : 'all',
      includeResolved: String(this.status() === 'resolved'),
      limit: PAGE_LIMIT,
      ...(this.kind() ? { kind: this.kind() } : {}),
      ...(this.projectId() ? { projectId: this.projectId() } : {}),
    },
  }));

  readonly projects = httpResource<Project[]>(() => apiUrl('/projects'));

  /** The rows as shown, with their text translated. */
  readonly rows = computed<NotificationView[]>(() => {
    const now = Date.now();
    const page = this.notifications.hasValue()
      ? this.notifications.value()
      : undefined;
    return (page?.items ?? []).map((notification) => ({
      notification,
      title: this.centre.text(notification),
      when: formatRelative(notification.occurredAt, now),
      unread: notification.readAt === null,
      resolved: notification.resolvedAt !== null,
    }));
  });

  readonly total = computed(() =>
    this.notifications.hasValue() ? this.notifications.value().total : 0,
  );

  refresh(): void {
    this.notifications.reload();
  }

  async open(notification: AppNotification): Promise<void> {
    await this.centre.open(notification);
  }

  /**
   * Called in the page's constructor: reloads now and after every change to notifications (the
   * row actions, the bell's) or to a project (the API raises/resolves by topic) while on screen.
   */
  follow(): void {
    this.refresh();
    reloadOn(
      () =>
        this.changes.globalVersion('notifications') +
        this.changes.globalVersion('projects'),
      [this.notifications],
    );
    reloadOn(() => this.changes.globalVersion('projects'), [this.projects]);
  }

  async markRead(notification: AppNotification): Promise<void> {
    await this.centre.markRead(notification);
  }

  async dismiss(notification: AppNotification): Promise<void> {
    await this.centre.dismiss(notification);
  }

  async markAllRead(): Promise<void> {
    await this.centre.markAllRead();
  }
}
