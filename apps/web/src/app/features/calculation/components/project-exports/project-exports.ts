import { DatePipe } from '@angular/common';
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
import {
  EXPORT_KINDS,
  type ExportKind,
  type MailDraft,
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

/**
 * Exporte (F10): create the simple and the detailed statement as PDF or Excel, every one kept
 * with its date (F10.5) and downloadable; the mail draft to the Treuhänder (F10.6). Allowed on
 * a closed project too — that is when the final statement is made.
 */
@Component({
  selector: 'lk-project-exports',
  imports: [
    DatePipe,
    TranslatePipe,
    Paginator,
    Truncate,
    RowActions,
    ChfPipe,
    EmptyState,
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
  protected readonly kinds = EXPORT_KINDS;

  protected readonly draft = signal<MailDraft | null>(null);

  /** Stored exports (F10), newest first, 10 per page. */
  protected readonly exportsPager = paginate(
    computed(() =>
      this.service.exports.hasValue() ? this.service.exports.value() : [],
    ),
    { storageKey: 'exports' },
  );
  protected readonly actions: readonly RowAction[] = [
    { id: 'download', labelKey: 'exports.download', icon: lucideDownload },
  ];

  protected create(kind: ExportKind): void {
    void this.service.createExport(kind).catch(() => undefined);
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
