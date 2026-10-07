import { LkDatePipe } from '../../../../shared/format/date.pipe';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideArrowRight,
  lucideCheck,
  lucideCheckCheck,
  lucideX,
} from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import type {
  AppNotification,
  NotificationKind,
} from '../../../../core/api/notifications.types';
import {
  KIND_CLASSES,
  KIND_ICON_SET,
  KIND_ICONS,
} from '../../../../core/notification-centre/notification-bell';
import { NotificationCentreService } from '../../../../core/notification-centre/notification-centre.service';
import { EmptyState } from '../../../../shared/components/empty-state';
import { PageHeader } from '../../../../shared/components/page-header';
import { paginate, Paginator } from '../../../../shared/components/paginator';
import {
  type RowAction,
  RowActions,
} from '../../../../shared/components/row-actions';
import { Truncate } from '../../../../shared/components/truncate';
import {
  NotificationsPageService,
  STATUS_FILTERS,
  type StatusFilter,
} from './notifications-page.service';

type RowActionId = 'open' | 'read' | 'dismiss';

/**
 * F11.11: all my notifications as a table (truncated text, row actions, paginator) with filters
 * by kind, project and status — the bell's panel shows only the newest.
 */
@Component({
  selector: 'lk-notifications-page',
  imports: [
    LkDatePipe,
    FormsModule,
    NgIcon,
    TranslatePipe,
    PageHeader,
    EmptyState,
    Paginator,
    RowActions,
    Truncate,
    ...HlmButtonImports,
    ...HlmInputImports,
    ...HlmLabelImports,
    ...HlmSkeletonImports,
    ...HlmTableImports,
  ],
  providers: [provideIcons({ lucideCheckCheck, ...KIND_ICON_SET })],
  templateUrl: './notifications-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationsPage {
  protected readonly service = inject(NotificationsPageService);
  protected readonly centre = inject(NotificationCentreService);
  protected readonly statuses = STATUS_FILTERS;
  protected readonly icons = KIND_ICONS;
  protected readonly classes = KIND_CLASSES;
  protected readonly skeletonRows = [1, 2, 3];
  protected readonly pager = paginate(this.service.rows, {
    storageKey: 'notifications',
    resetOn: () => [
      this.service.kind(),
      this.service.projectId(),
      this.service.status(),
    ],
  });

  /** One action list per row, built once per load (not per change detection). */
  protected readonly actions = computed(() => {
    const map = new Map<string, readonly RowAction<RowActionId>[]>();
    for (const row of this.service.rows()) {
      const n = row.notification;
      map.set(n.id, [
        {
          id: 'open',
          labelKey: n.action?.labelKey ?? 'notifications.action.show',
          icon: lucideArrowRight,
          hidden: !n.action,
        },
        {
          id: 'read',
          labelKey: 'notifications.markRead',
          icon: lucideCheck,
          hidden: n.readAt !== null,
        },
        {
          id: 'dismiss',
          labelKey: 'notifications.dismiss',
          icon: lucideX,
          danger: true,
        },
      ]);
    }
    return map;
  });

  constructor() {
    // Reload whenever the bell's count moves (polling, panel actions, finished tasks).
    effect(() => {
      this.centre.unread();
      untracked(() => this.service.refresh());
    });
  }

  protected setKind(value: string): void {
    this.service.kind.set(
      (this.service.kinds as readonly string[]).includes(value)
        ? (value as NotificationKind)
        : '',
    );
  }

  protected setStatus(value: string): void {
    if ((STATUS_FILTERS as readonly string[]).includes(value)) {
      this.service.status.set(value as StatusFilter);
    }
  }

  protected act(id: string, notification: AppNotification): void {
    if (id === 'open') void this.service.open(notification);
    else if (id === 'read') void this.service.markRead(notification);
    else void this.service.dismiss(notification);
  }
}
