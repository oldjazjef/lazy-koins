import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCopyPlus, lucideTrash2, lucideUpload } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmDialogImports } from '@lazykoins/ui/dialog';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { EmptyState } from '../../../../shared/components/empty-state';
import { PageHeader } from '../../../../shared/components/page-header';
import { LkDatePipe } from '../../../../shared/format/date.pipe';
import {
  LibraryPublishDialog,
  LibraryPublishService,
} from '../../components/publish-dialog';
import { StarRating } from '../../components/star-rating';
import { LibraryDetailPageService } from './library-detail-page.service';

/**
 * One library entry (F5.15–F5.17): the JSON, version and facts (author as pseudonym), my rating,
 * "Übernehmen" (a private copy in my mappings); my own entry: a new version, delete.
 */
@Component({
  selector: 'lk-library-detail-page',
  imports: [
    NgIcon,
    TranslatePipe,
    LkDatePipe,
    PageHeader,
    EmptyState,
    StarRating,
    LibraryPublishDialog,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmDialogImports,
    ...HlmSkeletonImports,
  ],
  providers: [
    LibraryDetailPageService,
    LibraryPublishService,
    provideIcons({ lucideCopyPlus, lucideTrash2, lucideUpload }),
  ],
  templateUrl: './library-detail-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LibraryDetailPage {
  protected readonly service = inject(LibraryDetailPageService);
  protected readonly publish = inject(LibraryPublishService);

  /** Route param `:id` — no default, absent params bind as `undefined` (see CLAUDE.md). */
  readonly id = input<string | undefined>();

  protected readonly confirmDelete = signal(false);

  constructor() {
    effect(() => this.service.entryId.set(this.id()));
    this.publish.onPublished = () => this.service.entry.reload();
  }

  protected newVersion(): void {
    const id = this.id();
    if (id) this.publish.start({ libraryId: id });
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
}
