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
import { HlmDialogImports } from '@lazykoins/ui/dialog';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import { HlmTextareaImports } from '@lazykoins/ui/textarea';
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
import { ProjectTransactionsService } from './project-transactions.service';

type TransactionAction =
  'aiFix' | 'exclude' | 'reactivate' | 'reclassify' | 'figure';

/** The longest reason the API takes for a correction. */
export const EXCLUDE_REASON_MAX = 1000;
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

/** The row menu: deactivate (with a reason) or take back in, reclassify, show the figure. */
export function transactionActions(
  row: TransactionRow,
  closed: boolean,
): RowAction<TransactionAction>[] {
  const excluded = row.treatment === 'excluded';
  return [
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
      hidden: closed || excluded || row.manual,
    },
    {
      id: 'reactivate',
      labelKey: 'transactions.actions.reactivate',
      icon: lucideCircleCheck,
      hidden: closed || !excluded || !row.correctionId,
    },
    {
      id: 'exclude',
      labelKey: 'transactions.actions.exclude',
      icon: lucideCircleOff,
      danger: true,
      hidden: closed || excluded || row.manual,
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
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmDialogImports,
    ...HlmInputImports,
    ...HlmSkeletonImports,
    ...HlmTableImports,
    ...HlmTextareaImports,
  ],
  providers: [ProjectTransactionsService, provideIcons({ lucideSparkles })],
  templateUrl: './project-transactions.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectTransactions {
  protected readonly service = inject(ProjectTransactionsService);
  private readonly translate = inject(TranslateService);
  private readonly chat = inject(ChatService);
  protected readonly treatments = BOOKING_TREATMENTS;
  protected readonly badge = BADGE;
  protected readonly reasonMax = EXCLUDE_REASON_MAX;

  readonly closed = input(false);

  /** The search field as typed; applied to the service after a pause. */
  protected readonly search = signal('');
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  /** The booking being deactivated, and the reason typed for it. */
  protected readonly excluding = signal<TransactionRow | null>(null);
  protected readonly reason = signal('');
  protected readonly reasonMissing = signal(false);

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
      case 'exclude':
        this.reason.set('');
        this.reasonMissing.set(false);
        this.excluding.set(row);
        break;
      case 'reactivate':
        void this.service.reactivate(row).catch(() => undefined);
        break;
      case 'reclassify':
        this.service.reclassify(row);
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

  protected confirmExclude(): void {
    const row = this.excluding();
    const reason = this.reason().trim();
    if (!row) return;
    if (!reason) {
      this.reasonMissing.set(true);
      return;
    }
    this.excluding.set(null);
    void this.service
      .exclude(row, reason.slice(0, EXCLUDE_REASON_MAX))
      .catch(() => undefined);
  }

  protected dialogChanged(state: 'open' | 'closed'): void {
    if (state === 'closed') this.excluding.set(null);
  }

  /** `+0.5` / `-0.1`: the sign shows the direction. */
  protected signed(quantity: string): string {
    return quantity.startsWith('-') ? quantity : `+${quantity}`;
  }
}
