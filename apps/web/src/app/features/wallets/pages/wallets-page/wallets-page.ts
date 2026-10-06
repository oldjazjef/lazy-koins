import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideDownload,
  lucidePlus,
  lucideShieldCheck,
} from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import type { Wallet } from '../../../../core/api/wallets.types';
import { EmptyState } from '../../../../shared/components/empty-state';
import { PageHeader } from '../../../../shared/components/page-header';
import { paginate, Paginator } from '../../../../shared/components/paginator';
import {
  type RowAction,
  RowActions,
} from '../../../../shared/components/row-actions';
import { Truncate } from '../../../../shared/components/truncate';
import { WalletsPageService } from './wallets-page.service';

type WalletAction = 'check' | 'fetch';

/**
 * Wallets in the main navigation (F6.1): my wallets with label, address, where each was used
 * (F6.4) and fetched (F6.3), and the projects that include it. A row opens the wallet; its
 * actions run the network check and the fetch.
 */
@Component({
  selector: 'lk-wallets-page',
  imports: [
    DatePipe,
    FormsModule,
    RouterLink,
    NgIcon,
    TranslatePipe,
    PageHeader,
    EmptyState,
    Paginator,
    RowActions,
    Truncate,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmInputImports,
    ...HlmLabelImports,
    ...HlmSkeletonImports,
    ...HlmTableImports,
  ],
  providers: [provideIcons({ lucidePlus })],
  templateUrl: './wallets-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WalletsPage {
  protected readonly service = inject(WalletsPageService);
  private readonly router = inject(Router);
  protected readonly skeletonRows = [1, 2, 3];

  protected readonly pager = paginate(this.service.visible, {
    storageKey: 'wallets',
    resetOn: () => this.service.search(),
  });

  protected readonly actions = computed<readonly RowAction<WalletAction>[]>(
    () => {
      const busy = this.service.busyId() !== null;
      return [
        {
          id: 'check',
          labelKey: 'wallets.check',
          icon: lucideShieldCheck,
          disabled: busy,
        },
        {
          id: 'fetch',
          labelKey: 'wallets.fetch',
          icon: lucideDownload,
          disabled: busy,
        },
      ];
    },
  );

  constructor() {
    this.service.refresh();
  }

  protected open(id: string): void {
    void this.router.navigate(['/app/wallets', id]);
  }

  protected act(action: string, wallet: Wallet): void {
    if (action === 'check') void this.service.checkNetworks(wallet);
    if (action === 'fetch') void this.service.fetch(wallet);
  }

  protected used(wallet: Wallet): string[] {
    return wallet.perNetwork
      .filter((n) => n.used === true)
      .map((n) => n.network);
  }

  protected projectNames(wallet: Wallet): string {
    return wallet.projects.map((p) => p.name).join(', ');
  }

  protected fetchedAt(wallet: Wallet): string | null {
    const dates = wallet.perNetwork
      .map((n) => n.fetchedAt)
      .filter((d): d is string => d !== null)
      .sort();
    return dates.at(-1) ?? null;
  }

  protected failed(wallet: Wallet): number {
    return wallet.perNetwork.filter((n) => n.selected && n.status === 'error')
      .length;
  }
}
