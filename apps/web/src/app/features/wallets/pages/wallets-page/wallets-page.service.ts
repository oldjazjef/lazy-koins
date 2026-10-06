import { httpResource } from '@angular/common/http';
import { computed, Injectable, signal } from '@angular/core';
import { apiUrl } from '../../../../core/api/api-url';
import type { Wallet } from '../../../../core/api/wallets.types';

/**
 * The global wallets page (F6.1): every wallet of mine with its networks, the network check
 * (F6.4) and the last fetch (F6.3), searchable by label and address.
 */
@Injectable({ providedIn: 'root' })
export class WalletsPageService {
  readonly wallets = httpResource<Wallet[]>(() => apiUrl('/wallets'));
  readonly search = signal('');

  readonly isEmpty = computed(
    () => this.wallets.hasValue() && this.wallets.value().length === 0,
  );

  readonly visible = computed<Wallet[]>(() => {
    const all = this.wallets.hasValue() ? this.wallets.value() : [];
    const needle = this.search().trim().toLocaleLowerCase('de-CH');
    if (!needle) return all;
    return all.filter(
      (w) =>
        w.label.toLocaleLowerCase('de-CH').includes(needle) ||
        w.address.toLocaleLowerCase('de-CH').includes(needle),
    );
  });

  refresh(): void {
    this.wallets.reload();
  }
}
