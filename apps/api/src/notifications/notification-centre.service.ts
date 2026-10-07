import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  type ActivityReport,
  CountNotificationsQuery,
  DismissNotificationCommand,
  ListNotificationsQuery,
  MarkAllNotificationsReadCommand,
  MarkNotificationReadCommand,
  type NotificationListView,
  ReportActivityCommand,
  ReportSyncConflictCommand,
} from './application/notifications.handlers';

/** Thin façade over the buses — no logic here; it lives in the handlers. */
@Injectable()
export class NotificationCentreService {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  list(
    userId: string,
    criteria: ListNotificationsQuery['criteria'],
  ): Promise<NotificationListView> {
    return this.queries.execute(new ListNotificationsQuery(userId, criteria));
  }

  count(userId: string): Promise<{ unread: number }> {
    return this.queries.execute(new CountNotificationsQuery(userId));
  }

  read(userId: string, id: string): Promise<{ unread: number }> {
    return this.commands.execute(new MarkNotificationReadCommand(userId, id));
  }

  readAll(userId: string): Promise<{ unread: number }> {
    return this.commands.execute(new MarkAllNotificationsReadCommand(userId));
  }

  dismiss(userId: string, id: string): Promise<{ unread: number }> {
    return this.commands.execute(new DismissNotificationCommand(userId, id));
  }

  reportActivity(
    userId: string,
    report: ActivityReport,
  ): Promise<{ notified: boolean }> {
    return this.commands.execute(new ReportActivityCommand(userId, report));
  }

  reportSyncConflict(userId: string, count: number): Promise<void> {
    return this.commands.execute(new ReportSyncConflictCommand(userId, count));
  }
}
