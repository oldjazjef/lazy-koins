import { NotFoundException } from '@nestjs/common';
import {
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import { loadOwnProject } from '../../projects/application/project-access';
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import {
  type AppNotification,
  isAppRoute,
  type NotificationKind,
  type NotificationStatusFilter,
  Topics,
} from '../domain/notification';
import { NotificationRepositoryPort } from '../ports/notification.repository.port';
import { NotificationService } from './notification.service';

/** A notification as the app gets it (no user id). */
export type NotificationView = Omit<AppNotification, 'userId'>;

export interface NotificationListView {
  readonly items: readonly NotificationView[];
  readonly total: number;
  /** The bell's badge at the time of the answer. */
  readonly unread: number;
}

function view(notification: AppNotification): NotificationView {
  const { userId: _userId, ...rest } = notification;
  return rest;
}

export class ListNotificationsQuery {
  constructor(
    readonly userId: string,
    readonly criteria: {
      readonly status: NotificationStatusFilter;
      readonly includeResolved: boolean;
      readonly kind?: NotificationKind;
      readonly projectId?: string;
      readonly offset: number;
      readonly limit: number;
    },
  ) {}
}

/** F11.11: my notifications, newest first, paged; dismissed ones never. */
@QueryHandler(ListNotificationsQuery)
export class ListNotificationsHandler implements IQueryHandler<
  ListNotificationsQuery,
  NotificationListView
> {
  constructor(private readonly repository: NotificationRepositoryPort) {}

  async execute({
    userId,
    criteria,
  }: ListNotificationsQuery): Promise<NotificationListView> {
    const [page, unread] = await Promise.all([
      this.repository.list(userId, criteria),
      this.repository.countUnread(userId),
    ]);
    return { items: page.items.map(view), total: page.total, unread };
  }
}

export class CountNotificationsQuery {
  constructor(readonly userId: string) {}
}

/** The bell's badge: unread, unresolved, not dismissed. Polled by the app. */
@QueryHandler(CountNotificationsQuery)
export class CountNotificationsHandler implements IQueryHandler<
  CountNotificationsQuery,
  { unread: number }
> {
  constructor(private readonly repository: NotificationRepositoryPort) {}

  async execute({
    userId,
  }: CountNotificationsQuery): Promise<{ unread: number }> {
    return { unread: await this.repository.countUnread(userId) };
  }
}

export class MarkNotificationReadCommand {
  constructor(
    readonly userId: string,
    readonly id: string,
  ) {}
}

/** Someone else's notification is a 404, exactly like a missing one. */
@CommandHandler(MarkNotificationReadCommand)
export class MarkNotificationReadHandler implements ICommandHandler<
  MarkNotificationReadCommand,
  { unread: number }
> {
  constructor(
    private readonly repository: NotificationRepositoryPort,
    private readonly notifications: NotificationService,
  ) {}

  async execute({
    userId,
    id,
  }: MarkNotificationReadCommand): Promise<{ unread: number }> {
    const found = await this.repository.markRead(
      userId,
      id,
      this.notifications.now().toISOString(),
    );
    if (!found) throw new NotFoundException('No such notification');
    return { unread: await this.repository.countUnread(userId) };
  }
}

export class MarkAllNotificationsReadCommand {
  constructor(readonly userId: string) {}
}

@CommandHandler(MarkAllNotificationsReadCommand)
export class MarkAllNotificationsReadHandler implements ICommandHandler<
  MarkAllNotificationsReadCommand,
  { unread: number }
> {
  constructor(
    private readonly repository: NotificationRepositoryPort,
    private readonly notifications: NotificationService,
  ) {}

  async execute({
    userId,
  }: MarkAllNotificationsReadCommand): Promise<{ unread: number }> {
    await this.repository.markAllRead(
      userId,
      this.notifications.now().toISOString(),
    );
    return { unread: await this.repository.countUnread(userId) };
  }
}

export class DismissNotificationCommand {
  constructor(
    readonly userId: string,
    readonly id: string,
  ) {}
}

/** Hides one notification ("Ausblenden"); it returns when its cause changes. */
@CommandHandler(DismissNotificationCommand)
export class DismissNotificationHandler implements ICommandHandler<
  DismissNotificationCommand,
  { unread: number }
> {
  constructor(
    private readonly repository: NotificationRepositoryPort,
    private readonly notifications: NotificationService,
  ) {}

  async execute({
    userId,
    id,
  }: DismissNotificationCommand): Promise<{ unread: number }> {
    const found = await this.repository.dismiss(
      userId,
      id,
      this.notifications.now().toISOString(),
    );
    if (!found) throw new NotFoundException('No such notification');
    return { unread: await this.repository.countUnread(userId) };
  }
}

/** An activity label the app may report (`activity.rates`, `activity.ai.mapping`). */
export const ACTIVITY_LABEL = /^activity\.[a-zA-Z]+(?:\.[a-zA-Z]+)?$/;

/** An error the server notified about itself within this window is not reported twice. */
export const SERVER_ERROR_WINDOW_MS = 2 * 60 * 1000;

export interface ActivityReport {
  readonly label: string;
  readonly outcome: 'success' | 'error';
  readonly params?: Readonly<Record<string, unknown>>;
  readonly projectId?: string;
  /** Where the task was started — the notification's "Anzeigen" goes there. */
  readonly route?: string;
  readonly query?: Readonly<Record<string, string>>;
}

export class ReportActivityCommand {
  constructor(
    readonly userId: string,
    readonly report: ActivityReport,
  ) {}
}

/**
 * F11.13: a task of the activity indicator finished — the app reports it when the user left the
 * page meanwhile, and every failure. A failure the server already notified about (rate refresh,
 * export, AI, mail …) within the last two minutes is not reported a second time. Labels are
 * `activity.*` i18n keys; params are sanitised like every other.
 */
@CommandHandler(ReportActivityCommand)
export class ReportActivityHandler implements ICommandHandler<
  ReportActivityCommand,
  { notified: boolean }
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly repository: NotificationRepositoryPort,
    private readonly notifications: NotificationService,
  ) {}

  async execute({
    userId,
    report,
  }: ReportActivityCommand): Promise<{ notified: boolean }> {
    if (!ACTIVITY_LABEL.test(report.label)) return { notified: false };
    const projectId = report.projectId
      ? (await loadOwnProject(this.projects, userId, report.projectId)).id
      : null;
    const route =
      report.route && isAppRoute(report.route)
        ? report.route
        : projectId
          ? `/app/projects/${projectId}`
          : null;
    const action = route
      ? {
          labelKey: 'notifications.action.show',
          route,
          ...(report.query ? { query: report.query } : {}),
        }
      : null;
    const params = { ...(report.params ?? {}), task: report.label };
    if (report.outcome === 'error') {
      const since = new Date(
        this.notifications.now().getTime() - SERVER_ERROR_WINDOW_MS,
      ).toISOString();
      if (await this.repository.hasErrorSince(userId, projectId, since)) {
        return { notified: false };
      }
      await this.notifications.raise(
        userId,
        Topics.taskFailed(report.label, projectId),
        { kind: 'error', projectId, params, action },
      );
      return { notified: true };
    }
    await this.notifications.resolve(
      userId,
      Topics.taskFailed(report.label, projectId),
    );
    await this.notifications.raise(
      userId,
      Topics.taskDone(report.label, projectId),
      { kind: 'success', projectId, params, action },
    );
    return { notified: true };
  }
}

export class ReportSyncConflictCommand {
  constructor(
    readonly userId: string,
    /** Conflict copies of the database the desktop app found next to it (F3.4); 0 = none. */
    readonly count: number,
  ) {}
}

/** F3.4 in the centre: the desktop app reports its sync conflict copies at start. */
@CommandHandler(ReportSyncConflictCommand)
export class ReportSyncConflictHandler implements ICommandHandler<
  ReportSyncConflictCommand,
  void
> {
  constructor(private readonly notifications: NotificationService) {}

  async execute({ userId, count }: ReportSyncConflictCommand): Promise<void> {
    await this.notifications.toggle(userId, Topics.syncConflict(), count > 0, {
      kind: 'action',
      params: { count },
      action: {
        labelKey: 'notifications.action.toStorage',
        route: '/app/settings/storage',
      },
    });
  }
}
