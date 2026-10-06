import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucidePlus } from '@ng-icons/lucide';
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
import { WalletsPageService } from './wallets-page.service';

/**
 * Wallets in the main navigation (F6.1): my wallets with label, address, networks, where each
 * was used (F6.4) and fetched (F6.3), and the projects that include it. A row opens the wallet.
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

  constructor() {
    this.service.refresh();
  }

  protected open(id: string): void {
    void this.router.navigate(['/app/wallets', id]);
  }

  protected used(wallet: Wallet): string[] {
    return wallet.perNetwork
      .filter((n) => n.used === true)
      .map((n) => n.network);
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
