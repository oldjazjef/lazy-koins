import { HttpClient, httpResource } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { apiUrl } from '../../../../core/api/api-url';
import type { Wallet } from '../../../../core/api/wallets.types';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { walletError } from '../../wallet-errors';

/**
 * The global wallets page (F6.1): every wallet of mine with its networks, the network check
 * (F6.4) and the last fetch (F6.3), searchable by label and address; "Netzwerke prüfen" and
 * "Abrufen" per row (they refresh every project that includes the wallet).
 */
@Injectable({ providedIn: 'root' })
export class WalletsPageService {
  private readonly http = inject(HttpClient);
  private readonly notifications = inject(NotificationService);

  readonly wallets = httpResource<Wallet[]>(() => apiUrl('/wallets'));
  readonly search = signal('');
  /** The wallet a lookup is running for (one at a time). */
  readonly busyId = signal<string | null>(null);

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

  checkNetworks(wallet: Wallet): Promise<void> {
    return this.lookup(wallet, 'check-networks', 'wallets.checked');
  }

  fetch(wallet: Wallet): Promise<void> {
    return this.lookup(wallet, 'fetch', 'wallets.fetched');
  }

  private async lookup(
    wallet: Wallet,
    action: 'check-networks' | 'fetch',
    success: string,
  ): Promise<void> {
    this.busyId.set(wallet.id);
    try {
      const updated = await firstValueFrom(
        this.http.post<Wallet>(apiUrl(`/wallets/${wallet.id}/${action}`), {}),
      );
      if (this.wallets.hasValue()) {
        this.wallets.set(
          this.wallets.value().map((w) => (w.id === updated.id ? updated : w)),
        );
      }
      this.notifications.success(success);
    } catch (error) {
      const { key, detail } = walletError(error);
      this.notifications.error(key, detail);
    } finally {
      this.busyId.set(null);
    }
  }
}
