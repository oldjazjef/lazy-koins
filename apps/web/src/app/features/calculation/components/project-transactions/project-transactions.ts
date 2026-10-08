import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  lucideCircleCheck,
  lucideCircleOff,
  lucideEye,
  lucideLink2,
  lucideListTree,
  lucideSparkles,
  lucideTags,
} from '@ng-icons/lucide';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { ChatService } from '../../../../core/assistant/chat.service';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import type { Transaction } from '../../../../core/api/transactions.types';
import { TransactionDetailDialog } from '../../../../shared/transactions/transaction-detail-dialog';
import {
  TransactionEditDialog,
  type TransactionEditRequest,
} from '../../../../shared/transactions/transaction-edit-dialog';
import { TransactionLinkDialog } from '../../../../shared/transactions/transaction-link-dialog';
import {
  BOOKING_TREATMENTS,
  type BookingTreatment,
  type TransactionRow,
} from '../../../../core/api/calculation.types';
import { EmptyState } from '../../../../shared/components/empty-state';
import { Paginator } from '../../../../shared/components/paginator';
import {
  type RowAction,
  RowActions,
} from '../../../../shared/components/row-actions';
import { Truncate } from '../../../../shared/components/truncate';
import { LkDatePipe } from '../../../../shared/format/date.pipe';
import { ChfPipe, QuantityPipe } from '../../../../shared/format/number-format';
import { TransactionEditsService } from '../../../../shared/transactions/transaction-edits.service';
import { ProjectTransactionsService } from './project-transactions.service';

type TransactionAction =
  | 'aiFix'
  | 'detail'
  | 'exclude'
  | 'reactivate'
  | 'reclassify'
  | 'link'
  | 'figure';

const SEARCH_DEBOUNCE_MS = 300;

/** Badge look per treatment: what counts stands out, what does not is quiet. */
const BADGE: Readonly<
  Record<BookingTreatment, 'default' | 'secondary' | 'outline' | 'destructive'>
> = {
  income: 'default',
  oneOff: 'default',
  balance: 'secondary',
  checkOnly: 'outline',
  transfer: 'outline',
  spam: 'outline',
  unknown: 'destructive',
  afterYear: 'outline',
  excluded: 'outline',
};

/**
 * The row menu: details and history, reclassify / link / hide / show again (global edits, F9.8),
 * show the figure, ask the assistant. A manual booking is a correction (no key) — changed in
 * the corrections tab.
 */
export function transactionActions(
  row: TransactionRow,
  closed: boolean,
): RowAction<TransactionAction>[] {
  const excluded = row.treatment === 'excluded';
  const editable = !closed && row.key !== null;
  return [
    {
      id: 'detail',
      labelKey: 'ledger.actions.detail',
      icon: lucideEye,
      hidden: row.key === null,
    },
    {
      id: 'aiFix',
      labelKey: 'transactions.actions.aiFix',
      icon: lucideSparkles,
      hidden: closed,
    },
    {
      id: 'figure',
      labelKey: 'transactions.actions.figure',
      icon: lucideListTree,
      hidden: row.figureIds.length === 0,
    },
    {
      id: 'reclassify',
      labelKey: 'transactions.actions.reclassify',
      icon: lucideTags,
      hidden: !editable || excluded,
    },
    {
      id: 'link',
      labelKey: 'txDetail.link',
      icon: lucideLink2,
      hidden: !editable || excluded,
    },
    {
      id: 'reactivate',
      labelKey: 'transactions.actions.reactivate',
      icon: lucideCircleCheck,
      hidden: !editable || !row.hidden,
    },
    {
      id: 'exclude',
      labelKey: 'transactions.actions.exclude',
      icon: lucideCircleOff,
      danger: true,
      hidden: !editable || excluded,
    },
  ];
}

/**
 * Tab "Transaktionen": every booking (imported and manual) with how it counts in the tax
 * calculation — income, wealth at 31.12., only checked against a statement, transfer, spam,
 * unclassified, after the year, or deactivated with its reason. Deactivating is a correction
 * (`exclude_booking`): the file is never changed and it can be taken back at any time.
 */
@Component({
  selector: 'lk-project-transactions',
  imports: [
    NgIcon,
    TranslatePipe,
    LkDatePipe,
    ChfPipe,
    QuantityPipe,
    EmptyState,
    Paginator,
    RowActions,
    Truncate,
    TransactionDetailDialog,
    TransactionEditDialog,
    TransactionLinkDialog,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmInputImports,
    ...HlmSkeletonImports,
    ...HlmTableImports,
  ],
  providers: [ProjectTransactionsService, provideIcons({ lucideSparkles })],
  templateUrl: './project-transactions.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectTransactions {
  protected readonly service = inject(ProjectTransactionsService);
  private readonly translate = inject(TranslateService);
  private readonly chat = inject(ChatService);
  private readonly edits = inject(TransactionEditsService);
  protected readonly treatments = BOOKING_TREATMENTS;
  protected readonly badge = BADGE;

  readonly closed = input(false);

  /** The search field as typed; applied to the service after a pause. */
  protected readonly search = signal('');
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  /** F9.8: the shared dialogs (detail + history, edit, link). */
  protected readonly detailKey = signal<string | null>(null);
  protected readonly editRequest = signal<TransactionEditRequest | null>(null);
  protected readonly linking = signal<Transaction | null>(null);

  /** One action list per row (not a new array per change detection). */
  protected readonly actions = computed(() => {
    const closed = this.closed();
    return new Map(
      this.service
        .rows()
        .map((row) => [row.id, transactionActions(row, closed)] as const),
    );
  });

  constructor() {
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

  protected setTreatment(treatment: BookingTreatment | ''): void {
    this.service.treatment.set(treatment);
  }

  protected setPlatform(platform: string): void {
    this.service.platform.set(platform);
  }

  protected act(action: string, row: TransactionRow): void {
    switch (action as TransactionAction) {
      case 'aiFix':
        void this.chat.startWith(this.aiQuestion(row));
        break;
      case 'detail':
        if (row.key) this.detailKey.set(row.key);
        break;
      case 'exclude':
        this.editRequest.set(this.request(row, 'hide'));
        break;
      case 'reactivate':
        this.editRequest.set(this.request(row, 'show'));
        break;
      case 'reclassify':
        this.editRequest.set(this.request(row, 'edit'));
        break;
      case 'link':
        // The link dialog needs the global view of the transaction: the detail has it.
        if (row.key) void this.linkFrom(row.key);
        break;
      case 'figure': {
        const figureId = row.figureIds[0];
        if (figureId) {
          this.service.showFigure(
            figureId,
            this.translate.instant('transactions.figureTitle', {
              asset: row.asset,
              platform: row.platform,
            }),
          );
        }
        break;
      }
    }
  }

  /** "Mit AI prüfen": the assistant looks over the bookings that most likely need a fix. */
  protected aiReview(): void {
    void this.chat.startWith(this.translate.instant('transactions.ai.review'));
  }

  /** The question for one booking — everything the assistant needs to find it and its neighbours. */
  private aiQuestion(row: TransactionRow): string {
    return this.translate.instant('transactions.ai.fix', {
      id: row.id,
      asset: row.asset,
      quantity: this.signed(row.quantity),
      timestamp: row.timestamp,
      platform: row.platform,
      account: row.accountId,
      kind: row.kind,
      rawType: row.rawType,
      origin: row.manual
        ? this.translate.instant('transactions.manual')
        : this.translate.instant('transactions.origin', {
            file: row.fileName ?? row.sourceFileId,
            row: row.row,
          }),
      treatment: this.translate.instant(
        'transactions.treatment.' + row.treatment,
      ),
    });
  }

  private request(
    row: TransactionRow,
    mode: TransactionEditRequest['mode'],
  ): TransactionEditRequest {
    return {
      keys: row.key ? [row.key] : [],
      mode,
      kind: row.kind,
      asset: row.asset,
      note: row.note,
    };
  }

  private async linkFrom(key: string): Promise<void> {
    try {
      this.linking.set((await this.edits.detail(key)).transaction);
    } catch {
      // Nothing to link: the detail could not be loaded.
    }
  }

  protected openEdit(request: TransactionEditRequest): void {
    this.detailKey.set(null);
    this.editRequest.set(request);
  }

  protected openLink(t: Transaction): void {
    this.detailKey.set(null);
    this.linking.set(t);
  }

  /** `+0.5` / `-0.1`: the sign shows the direction. */
  protected signed(quantity: string): string {
    return quantity.startsWith('-') ? quantity : `+${quantity}`;
  }
}
