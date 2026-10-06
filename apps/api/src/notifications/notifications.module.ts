import { Global, Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { NotificationService } from './application/notification.service';
import {
  CountNotificationsHandler,
  DismissNotificationHandler,
  ListNotificationsHandler,
  MarkAllNotificationsReadHandler,
  MarkNotificationReadHandler,
  ReportActivityHandler,
  ReportSyncConflictHandler,
} from './application/notifications.handlers';
import { ProjectNotifications } from './application/project-notifications.service';
import { NotificationCentreService } from './notification-centre.service';
import { NotificationsController } from './notifications.controller';

/**
 * The notification centre (F11.11–F11.13). Global: every feature raises and resolves through
 * `NotificationService` (and the project conditions through `ProjectNotifications`) without
 * importing this module. The repository port is bound in `PersistenceModule`.
 */
@Global()
@Module({
  imports: [CqrsModule],
  controllers: [NotificationsController],
  providers: [
    NotificationService,
    ProjectNotifications,
    NotificationCentreService,
    ListNotificationsHandler,
    CountNotificationsHandler,
    MarkNotificationReadHandler,
    MarkAllNotificationsReadHandler,
    DismissNotificationHandler,
    ReportActivityHandler,
    ReportSyncConflictHandler,
  ],
  exports: [NotificationService, ProjectNotifications],
})
export class NotificationsModule {}
