import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmTableImports } from '@lazykoins/ui/table';
import type { Wallet } from '../../../../core/api/wallets.types';
import { QuantityPipe } from '../../../../shared/format/number-format';

/**
 * Per network of a wallet: selected?, used (F6.4)?, what the network delivers, the last fetch
 * (F6.3) with its error and the provider's words, hidden spam tokens (F6.6), the balance today as
 * information. Shared by the wallet page and the project's wallets tab.
 */
@Component({
  selector: 'lk-network-status',
  imports: [
    DatePipe,
    TranslatePipe,
    QuantityPipe,
    ...HlmBadgeImports,
    ...HlmTableImports,
  ],
  templateUrl: './network-status.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NetworkStatus {
  readonly wallet = input.required<Wallet>();
}
