import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCheck,
  lucideCircleOff,
  lucideEye,
  lucideLink2,
  lucidePencil,
  lucideRotateCcw,
  lucideSparkles,
} from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import { BOOKING_KINDS } from '../../../../core/api/api.types';
import type { Transaction } from '../../../../core/api/transactions.types';
import {
  type DateRange,
  type DateRangePreset,
  DateRangePicker,
} from '../../../../shared/components/date-range-picker';
import { EmptyState } from '../../../../shared/components/empty-state';
import { PageHeader } from '../../../../shared/components/page-header';
import { Paginator } from '../../../../shared/components/paginator';
import {
  type RowAction,
  RowActions,
} from '../../../../shared/components/row-actions';
import { Truncate } from '../../../../shared/components/truncate';
import { LkDatePipe } from '../../../../shared/format/date.pipe';
import { ChfPipe, QuantityPipe } from '../../../../shared/format/number-format';
import { TransactionAiDialog } from '../../../../shared/transactions/transaction-ai-dialog';
import { TransactionDetailDialog } from '../../../../shared/transactions/transaction-detail-dialog';
import {
  TransactionEditDialog,
  type TransactionEditRequest,
} from '../../../../shared/transactions/transaction-edit-dialog';
import { TransactionEditsService } from '../../../../shared/transactions/transaction-edits.service';
import { TransactionLinkDialog } from '../../../../shared/transactions/transaction-link-dialog';
import { TransactionsPageService } from './transactions-page.service';

type RowActionId =
  'detail' | 'edit' | 'link' | 'ai' | 'hide' | 'show' | 'accept';

const SEARCH_DEBOUNCE_MS = 300;

/**
 * The row menu of one transaction; changes are hidden while a closed project uses it (F9.9). The
 * AI review stays: it only suggests (accepting a suggestion is still refused while locked).
 */
export function ledgerActions(t: Transaction): RowAction<RowActionId>[] {
  const locked = t.lockedBy.length > 0;
  return [
    { id: 'detail', labelKey: 'ledger.actions.detail', icon: lucideEye },
    {
      id: 'accept',
      labelKey: 'ledger.actions.accept',
      icon: lucideCheck,
      hidden: locked || !t.suggestion,
    },
    {
      id: 'edit',
      labelKey: 'txEdit.save.edit',
      icon: lucidePencil,
      hidden: locked,
    },
    {
      id: 'link',
      labelKey: 'txDetail.link',
      icon: lucideLink2,
      hidden: locked,
    },
    { id: 'ai', labelKey: 'ledger.actions.ai', icon: lucideSparkles },
    {
      id: 'show',
      labelKey: 'txEdit.save.show',
      icon: lucideRotateCcw,
      hidden: locked || !t.hidden,
    },
    {
      id: 'hide',
      labelKey: 'txEdit.save.hide',
      icon: lucideCircleOff,
      danger: true,
      hidden: locked || t.hidden,
    },
  ];
}

function isoDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * F9.5: "Transaktionen" — every transaction of every file and wallet, how it is classified, its
 * value, where it comes from and whether it was changed; bulk edits (F9.8), links, hiding, the
 * AI review (F9.10) and the history per transaction.
 */
@Component({
  selector: 'lk-transactions-page',
  imports: [
    FormsModule,
    RouterLink,
    NgIcon,
    TranslatePipe,
    LkDatePipe,
    ChfPipe,
    QuantityPipe,
    PageHeader,
    EmptyState,
    Paginator,
    RowActions,
    Truncate,
    DateRangePicker,
    TransactionDetailDialog,
    TransactionEditDialog,
    TransactionLinkDialog,
    TransactionAiDialog,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmInputImports,
    ...HlmLabelImports,
    ...HlmSkeletonImports,
    ...HlmTableImports,
  ],
  providers: [provideIcons({ lucideSparkles })],
  // Fill-page mode: the table takes the rest of the height and is the only part that scrolls.
  host: { class: 'lk-fill-page' },
  templateUrl: './transactions-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TransactionsPage {
  protected readonly service = inject(TransactionsPageService);
  protected readonly edits = inject(TransactionEditsService);
  protected readonly kinds = BOOKING_KINDS;
  protected readonly skeletonRows = [1, 2, 3, 4];

  /** `?key=` (links from the chat/MCP tools): opens that transaction's detail. */
  readonly key = input<string>();

  protected readonly search = signal('');
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly detailKey = signal<string | null>(null);
  protected readonly editRequest = signal<TransactionEditRequest | null>(null);
  protected readonly linking = signal<Transaction | null>(null);
  protected readonly aiKeys = signal<readonly string[] | null>(null);

  protected readonly actions = computed(
    () =>
      new Map(
        this.service.rows().map((t) => [t.key, ledgerActions(t)] as const),
      ),
  );

  /** This year, last year and the year before. */
  protected readonly presets = computed<DateRangePreset[]>(() => {
    const year = new Date().getFullYear();
    return [year, year - 1, year - 2].map((y) => ({
      id: `year:${y}`,
      labelKey: 'ledger.year',
      labelParams: { year: y },
      range: { from: `${y}-01-01`, to: `${y}-12-31` },
    }));
  });
  protected readonly today = isoDay(new Date());

  protected readonly selectedSuggestions = computed(() =>
    this.service
      .selectedRows()
      .flatMap((t) =>
        t.suggestion && t.lockedBy.length === 0 ? [t.suggestion.id] : [],
      ),
  );
  protected readonly selectionLocked = computed(() =>
    this.service.selectedRows().some((t) => t.lockedBy.length > 0),
  );

  constructor() {
    this.service.follow();
    inject(DestroyRef).onDestroy(() => clearTimeout(this.searchTimer));
    effect(() => {
      const key = this.key();
      if (key) this.detailKey.set(key);
    });
  }

  protected typed(value: string): void {
    this.search.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(
      () => this.service.query.set(value),
      SEARCH_DEBOUNCE_MS,
    );
  }

  protected setPeriod(range: DateRange): void {
    this.service.period.set(range);
  }

  protected reset(): void {
    this.search.set('');
    this.service.resetFilters();
  }

  protected act(action: string, t: Transaction): void {
    switch (action as RowActionId) {
      case 'detail':
        this.detailKey.set(t.key);
        return;
      case 'edit':
        this.editRequest.set(this.request(t, 'edit'));
        return;
      case 'hide':
        this.editRequest.set(this.request(t, 'hide'));
        return;
      case 'show':
        this.editRequest.set(this.request(t, 'show'));
        return;
      case 'link':
        this.linking.set(t);
        return;
      case 'ai':
        this.aiKeys.set([t.key]);
        return;
      case 'accept':
        if (t.suggestion) {
          void this.edits
            .decide([t.suggestion.id], true)
            .catch(() => undefined);
        }
        return;
    }
  }

  private request(
    t: Transaction,
    mode: TransactionEditRequest['mode'],
  ): TransactionEditRequest {
    return { keys: [t.key], mode, kind: t.kind, asset: t.asset, note: t.note };
  }

  /** Bulk: edit / hide the selection; AI on the selection or every "unbekannt". */
  protected bulk(mode: TransactionEditRequest['mode']): void {
    const keys = this.service.selectedRows().map((t) => t.key);
    if (keys.length > 0) this.editRequest.set({ keys, mode });
  }

  protected aiReview(): void {
    this.aiKeys.set(this.service.selectedRows().map((t) => t.key));
  }

  protected acceptSelected(): void {
    const ids = this.selectedSuggestions();
    if (ids.length > 0) {
      void this.edits.decide(ids, true).catch(() => undefined);
    }
  }

  protected editClosed(): void {
    this.editRequest.set(null);
  }

  protected openEdit(request: TransactionEditRequest): void {
    this.detailKey.set(null);
    this.editRequest.set(request);
  }

  protected openLink(t: Transaction): void {
    this.detailKey.set(null);
    this.linking.set(t);
  }

  protected statusVariant(
    t: Transaction,
  ): 'default' | 'secondary' | 'outline' | 'destructive' {
    return t.status === 'aiSuggested'
      ? 'default'
      : t.status === 'changed'
        ? 'secondary'
        : 'outline';
  }
}
