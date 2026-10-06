import { DatePipe, JsonPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideDownload, lucidePencil, lucideTrash2 } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmDialogImports } from '@lazykoins/ui/dialog';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import { EmptyState } from '../../../../shared/components/empty-state';
import { PageHeader } from '../../../../shared/components/page-header';
import {
  MappingWorkbench,
  MappingWorkbenchService,
} from '../../components/mapping-workbench';
import { ProjectStatusBadge } from '../../../projects/components/project-status-badge';
import { MappingDetailPageService } from './mapping-detail-page.service';

/**
 * One mapping (F11.0): facts, the JSON (view, and edit with a sample file and a live preview),
 * re-apply after saving, download, delete with the affected files listed, and where it is used —
 * each project and file linking to the project.
 */
@Component({
  selector: 'lk-mapping-detail-page',
  imports: [
    DatePipe,
    JsonPipe,
    RouterLink,
    NgIcon,
    TranslatePipe,
    PageHeader,
    EmptyState,
    MappingWorkbench,
    ProjectStatusBadge,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmDialogImports,
    ...HlmSkeletonImports,
    ...HlmTableImports,
  ],
  providers: [
    MappingDetailPageService,
    MappingWorkbenchService,
    provideIcons({ lucideDownload, lucidePencil, lucideTrash2 }),
  ],
  templateUrl: './mapping-detail-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MappingDetailPage {
  protected readonly service = inject(MappingDetailPageService);
  protected readonly workbench = inject(MappingWorkbenchService);

  /** Route param `:id` — no default, absent params bind as `undefined` (see CLAUDE.md). */
  readonly id = input<string | undefined>();

  protected readonly confirmDelete = signal(false);

  constructor() {
    effect(() => this.service.mappingId.set(this.id()));
  }

  protected deleteState(): 'open' | 'closed' {
    return this.confirmDelete() ? 'open' : 'closed';
  }

  protected deleteChanged(state: 'open' | 'closed'): void {
    if (state === 'closed') this.confirmDelete.set(false);
  }

  protected deleteConfirmed(): void {
    this.confirmDelete.set(false);
    void this.service.remove();
  }

  protected reapplyState(): 'open' | 'closed' {
    return this.service.reapplyOffer() === null ? 'closed' : 'open';
  }

  protected reapplyChanged(state: 'open' | 'closed'): void {
    if (state === 'closed') this.service.declineReapply();
  }
}
