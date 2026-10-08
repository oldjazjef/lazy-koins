import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { lucideEye, lucideEyeOff } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmDialogImports } from '@lazykoins/ui/dialog';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import { HlmTextareaImports } from '@lazykoins/ui/textarea';
import {
  ADMIN_LIBRARY_FILTERS,
  type AdminLibraryEntry,
  type AdminLibraryFilter,
} from '../../../../core/api/admin.types';
import { EmptyState } from '../../../../shared/components/empty-state';
import { PageHeader } from '../../../../shared/components/page-header';
import { paginate, Paginator } from '../../../../shared/components/paginator';
import {
  type RowAction,
  RowActions,
} from '../../../../shared/components/row-actions';
import { Truncate } from '../../../../shared/components/truncate';
import { LkDatePipe } from '../../../../shared/format/date.pipe';
import { AdminLibraryPageService } from './admin-library-page.service';

type ActionId = 'hide' | 'unhide';
type Dialog = { readonly kind: ActionId; readonly entry: AdminLibraryEntry };

const SEARCH_DEBOUNCE_MS = 300;
const REASON_MAX = 500;

export function libraryActions(
  entry: AdminLibraryEntry,
): RowAction<ActionId>[] {
  return [
    {
      id: 'unhide',
      labelKey: 'admin.library.actions.unhide',
      icon: lucideEye,
      hidden: entry.hiddenAt === null,
    },
    {
      id: 'hide',
      labelKey: 'admin.library.actions.hide',
      icon: lucideEyeOff,
      danger: true,
      hidden: entry.hiddenAt !== null,
    },
  ];
}

/**
 * `/app/admin/library`: moderation of the public mapping library. Hiding needs a reason, the
 * author gets a notification; copies others took stay untouched.
 */
@Component({
  selector: 'lk-admin-library-page',
  imports: [
    FormsModule,
    TranslatePipe,
    LkDatePipe,
    PageHeader,
    EmptyState,
    Paginator,
    RowActions,
    Truncate,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmDialogImports,
    ...HlmInputImports,
    ...HlmLabelImports,
    ...HlmSkeletonImports,
    ...HlmTableImports,
    ...HlmTextareaImports,
  ],
  templateUrl: './admin-library-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminLibraryPage {
  protected readonly service = inject(AdminLibraryPageService);
  protected readonly filters = ADMIN_LIBRARY_FILTERS;
  protected readonly skeletonRows = [1, 2, 3, 4];
  protected readonly reasonMax = REASON_MAX;

  protected readonly search = signal(this.service.query());
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly pager = paginate(this.service.rows, {
    storageKey: 'admin-library',
    resetOn: () => [this.service.query(), this.service.filter()],
  });

  protected readonly actions = computed(
    () =>
      new Map(
        this.service.rows().map((e) => [e.id, libraryActions(e)] as const),
      ),
  );

  protected readonly dialog = signal<Dialog | null>(null);
  protected readonly reason = signal('');
  protected readonly busy = signal(false);
  protected readonly canConfirm = computed(
    () =>
      this.dialog() !== null &&
      (this.dialog()?.kind === 'unhide' || this.reason().trim().length > 0),
  );

  constructor() {
    this.service.follow();
    inject(DestroyRef).onDestroy(() => clearTimeout(this.searchTimer));
  }

  protected typed(value: string): void {
    this.search.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(
      () => this.service.query.set(value),
      SEARCH_DEBOUNCE_MS,
    );
  }

  protected setFilter(value: AdminLibraryFilter): void {
    this.service.filter.set(value);
  }

  protected act(action: string, entry: AdminLibraryEntry): void {
    this.reason.set('');
    this.dialog.set({ kind: action as ActionId, entry });
  }

  protected dialogChanged(state: 'open' | 'closed'): void {
    if (state === 'closed' && !this.busy()) this.dialog.set(null);
  }

  protected async confirm(): Promise<void> {
    const current = this.dialog();
    if (!current || !this.canConfirm()) return;
    this.busy.set(true);
    try {
      if (current.kind === 'hide') {
        await this.service.hide(current.entry, this.reason().trim());
      } else {
        await this.service.unhide(current.entry);
      }
      this.dialog.set(null);
    } catch {
      // The ActionRunner showed the error; the dialog stays open.
    } finally {
      this.busy.set(false);
    }
  }
}
