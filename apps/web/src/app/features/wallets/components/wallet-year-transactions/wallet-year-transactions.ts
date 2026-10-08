import { httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import { apiUrl } from '../../../../core/api/api-url';
import type { TransactionsPage } from '../../../../core/api/transactions.types';
import { DataChanges, reloadOn } from '../../../../core/data/data-changes';
import { LkDatePipe } from '../../../../shared/format/date.pipe';
import { ChfPipe, QuantityPipe } from '../../../../shared/format/number-format';

/** Rows per page — a compact list inside the wallet's card. */
export const WALLET_YEAR_PAGE = 10;

/**
 * F9.7: in a project's Wallets tab each wallet shows only the transactions of the tax year
 * (the Wallets page and "Transaktionen" keep all). Read from the global list (F9.5), paged by
 * the API; changes are made on the Transaktionen page or tab.
 */
@Component({
  selector: 'lk-wallet-year-transactions',
  imports: [
    TranslatePipe,
    LkDatePipe,
    ChfPipe,
    QuantityPipe,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmSkeletonImports,
    ...HlmTableImports,
  ],
  templateUrl: './wallet-year-transactions.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WalletYearTransactions {
  private readonly changes = inject(DataChanges);

  readonly walletId = input.required<string>();
  /** `yyyy-12-31` of the project's tax year. */
  readonly yearEnd = input.required<string>();

  protected readonly page = signal(0);
  protected readonly year = computed(() => this.yearEnd().slice(0, 4));

  protected readonly view = httpResource<TransactionsPage>(() => ({
    url: apiUrl('/transactions'),
    params: {
      walletId: this.walletId(),
      from: `${this.year()}-01-01`,
      to: this.yearEnd(),
      offset: this.page() * WALLET_YEAR_PAGE,
      limit: WALLET_YEAR_PAGE,
    },
  }));

  protected readonly pages = computed(() =>
    this.view.hasValue()
      ? Math.max(1, Math.ceil(this.view.value().total / WALLET_YEAR_PAGE))
      : 1,
  );

  constructor() {
    reloadOn(
      () =>
        `${this.changes.globalVersion('transactions')}|${this.changes.globalVersion('wallets')}`,
      [this.view],
    );
  }

  protected move(by: number): void {
    this.page.set(Math.min(Math.max(0, this.page() + by), this.pages() - 1));
  }
}
