import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideBookUp,
  lucideCopyPlus,
  lucideEye,
  lucideStar,
  lucideTrash2,
  lucideUpload,
} from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmDialogImports } from '@lazykoins/ui/dialog';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import {
  LIBRARY_SORTS,
  type LibraryEntry,
  type LibrarySort,
} from '../../../../core/api/api.types';
import { EmptyState } from '../../../../shared/components/empty-state';
import { PageHeader } from '../../../../shared/components/page-header';
import { paginate, Paginator } from '../../../../shared/components/paginator';
import {
  type RowAction,
  RowActions,
} from '../../../../shared/components/row-actions';
import { Truncate } from '../../../../shared/components/truncate';
import { LkDatePipe } from '../../../../shared/format/date.pipe';
import {
  LibraryPublishDialog,
  LibraryPublishService,
} from '../../components/publish-dialog';
import { StarRating } from '../../components/star-rating';
import { LibraryPageService } from './library-page.service';

type LibraryAction = 'view' | 'take' | 'rate' | 'newVersion' | 'delete';

/**
 * F5.15–F5.17: the mapping library page (`/app/mappings/library`, web only) — the shared mappings of all
 * users with search, platform filter and sort; per row: Ansehen, Übernehmen (a private copy),
 * Bewerten, and for my own entries Neue Version and Löschen. "Mapping veröffentlichen" opens
 * the review dialog.
 */
@Component({
  selector: 'lk-library-page',
  imports: [
    FormsModule,
    RouterLink,
    NgIcon,
    TranslatePipe,
    LkDatePipe,
    PageHeader,
    EmptyState,
    Paginator,
    RowActions,
    Truncate,
    StarRating,
    LibraryPublishDialog,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmDialogImports,
    ...HlmInputImports,
    ...HlmLabelImports,
    ...HlmSkeletonImports,
    ...HlmTableImports,
  ],
  providers: [LibraryPublishService, provideIcons({ lucideBookUp })],
  templateUrl: './library-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LibraryPage {
  protected readonly service = inject(LibraryPageService);
  protected readonly publish = inject(LibraryPublishService);
  private readonly router = inject(Router);
  protected readonly sorts = LIBRARY_SORTS;
  protected readonly skeletonRows = [1, 2, 3];
  protected readonly pager = paginate(this.service.visible, {
    storageKey: 'library',
    resetOn: () => [
      this.service.search(),
      this.service.platform(),
      this.service.sort(),
    ],
  });

  /** The entry being rated / deleted (dialogs). */
  protected readonly rating = signal<LibraryEntry | null>(null);
  protected readonly deleting = signal<LibraryEntry | null>(null);

  /** The row actions, built once per list. */
  protected readonly actions = computed(() => {
    const byId = new Map<string, readonly RowAction<LibraryAction>[]>();
    for (const entry of this.service.visible()) {
      byId.set(entry.id, [
        { id: 'view', labelKey: 'library.actions.view', icon: lucideEye },
        { id: 'take', labelKey: 'library.actions.take', icon: lucideCopyPlus },
        {
          id: 'rate',
          labelKey: 'library.actions.rate',
          icon: lucideStar,
          hidden: entry.mine,
        },
        {
          id: 'newVersion',
          labelKey: 'library.actions.newVersion',
          icon: lucideUpload,
          hidden: !entry.mine,
        },
        {
          id: 'delete',
          labelKey: 'library.actions.delete',
          icon: lucideTrash2,
          danger: true,
          hidden: !entry.mine,
        },
      ]);
    }
    return byId;
  });

  constructor() {
    this.service.refresh();
    this.publish.onPublished = () => this.service.refresh();
  }

  protected setSort(value: string): void {
    if ((LIBRARY_SORTS as readonly string[]).includes(value)) {
      this.service.sort.set(value as LibrarySort);
    }
  }

  protected open(id: string): void {
    void this.router.navigate(['/app/mappings/library', id]);
  }

  protected act(action: string, entry: LibraryEntry): void {
    switch (action as LibraryAction) {
      case 'view':
        this.open(entry.id);
        return;
      case 'take':
        void this.service.take(entry);
        return;
      case 'rate':
        this.rating.set(entry);
        return;
      case 'newVersion':
        this.publish.start({ libraryId: entry.id });
        return;
      case 'delete':
        this.deleting.set(entry);
        return;
    }
  }

  protected async rate(stars: number | null): Promise<void> {
    const entry = this.rating();
    this.rating.set(null);
    if (entry) await this.service.rate(entry, stars);
  }

  protected async confirmDelete(): Promise<void> {
    const entry = this.deleting();
    this.deleting.set(null);
    if (entry) await this.service.remove(entry);
  }

  protected rateState(): 'open' | 'closed' {
    return this.rating() ? 'open' : 'closed';
  }

  protected rateChanged(state: 'open' | 'closed'): void {
    if (state === 'closed') this.rating.set(null);
  }

  protected deleteState(): 'open' | 'closed' {
    return this.deleting() ? 'open' : 'closed';
  }

  protected deleteChanged(state: 'open' | 'closed'): void {
    if (state === 'closed') this.deleting.set(null);
  }
}
