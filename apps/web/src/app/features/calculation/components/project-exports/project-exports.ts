import { LkDatePipe } from '../../../../shared/format/date.pipe';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { lucideDownload } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmDialogImports } from '@lazykoins/ui/dialog';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import { HlmTextareaImports } from '@lazykoins/ui/textarea';
import { BOOKING_KINDS } from '../../../../core/api/api.types';
import type { DataExportFilter } from '../../../../core/api/dashboard.types';
import {
  type ExportKind,
  INTERNAL_KINDS,
  isInternalKind,
  type MailDraft,
  STATEMENT_KINDS,
} from '../../../../core/api/calculation.types';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { EmptyState } from '../../../../shared/components/empty-state';
import { ChfPipe } from '../../../../shared/format/number-format';
import { ProjectWorkspaceService } from '../project-workspace/project-workspace.service';
import { paginate, Paginator } from '../../../../shared/components/paginator';
import { Truncate } from '../../../../shared/components/truncate';
import {
  type RowAction,
  RowActions,
} from '../../../../shared/components/row-actions';
import { SendToAdvisor } from '../send-to-advisor/send-to-advisor';

/**
 * Exporte (F10): create the simple and the detailed statement as PDF or Excel — asking first while
 * open items exist, since a statement goes to the tax authority — and the internal check report
 * (F10.2a), every one kept with its date (F10.5) and downloadable, listed in two groups; the mail
 * draft to the Treuhänder (F10.6). Allowed on a closed project too — that is when the final
 * statement is made.
 */
@Component({
  selector: 'lk-project-exports',
  imports: [
    LkDatePipe,
    TranslatePipe,
    Paginator,
    Truncate,
    RowActions,
    ChfPipe,
    EmptyState,
    SendToAdvisor,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmDialogImports,
    ...HlmInputImports,
    ...HlmLabelImports,
    ...HlmSkeletonImports,
    ...HlmTableImports,
    ...HlmTextareaImports,
  ],
  templateUrl: './project-exports.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectExports {
  protected readonly service = inject(ProjectWorkspaceService);
  private readonly notifications = inject(NotificationService);
  protected readonly statementKinds = STATEMENT_KINDS;
  protected readonly internalKinds = INTERNAL_KINDS;

  /** Stored documents in two groups: statements for the authority, internal reports. */
  protected readonly groups = computed(() => {
    const all = this.service.exports.hasValue()
      ? this.service.exports.value()
      : [];
    return [
      {
        key: 'statements' as const,
        items: all.filter((item) => !isInternalKind(item.kind)),
      },
      {
        key: 'internal' as const,
        items: all.filter((item) => isInternalKind(item.kind)),
      },
    ].filter((group) => group.items.length > 0);
  });

  protected readonly draft = signal<MailDraft | null>(null);
  protected readonly bookingKinds = BOOKING_KINDS;
  protected readonly filter = signal<DataExportFilter>({});

  protected setFilter(key: keyof DataExportFilter, value: string): void {
    this.filter.update((current) => ({ ...current, [key]: value }));
  }

  protected data(format: 'csv' | 'xlsx', type: 'bookings' | 'holdings'): void {
    void this.service.downloadData(format, type, this.filter());
  }

  protected packageDownload(): void {
    void this.service.downloadPackage();
  }

  /** Each group of stored exports (F10), newest first, 10 per page. */
  protected readonly pagers = {
    statements: paginate(
      computed(
        () => this.groups().find((g) => g.key === 'statements')?.items ?? [],
      ),
      { storageKey: 'exports' },
    ),
    internal: paginate(
      computed(
        () => this.groups().find((g) => g.key === 'internal')?.items ?? [],
      ),
      { storageKey: 'exports' },
    ),
  };
  protected readonly actions: readonly RowAction[] = [
    { id: 'download', labelKey: 'exports.download', icon: lucideDownload },
  ];

  protected create(kind: ExportKind): void {
    void this.service.requestExport(kind).catch(() => undefined);
  }

  protected confirmState(): 'open' | 'closed' {
    return this.service.pendingExport() ? 'open' : 'closed';
  }

  protected confirmChanged(state: 'open' | 'closed'): void {
    if (state === 'closed') this.service.cancelExport();
  }

  protected confirm(): void {
    void this.service.confirmExport().catch(() => undefined);
  }

  protected async openDraft(): Promise<void> {
    try {
      this.draft.set(await this.service.mailDraft());
    } catch {
      this.notifications.error('exports.mail.failed');
    }
  }

  protected draftState(): 'open' | 'closed' {
    return this.draft() ? 'open' : 'closed';
  }

  protected draftChanged(state: 'open' | 'closed'): void {
    if (state === 'closed') this.draft.set(null);
  }

  protected async copy(draft: MailDraft): Promise<void> {
    try {
      await navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`);
      this.notifications.success('exports.mail.copied');
    } catch {
      this.notifications.error('exports.mail.copyFailed');
    }
  }
}
