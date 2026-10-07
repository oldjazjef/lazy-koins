import { HttpClient, httpResource } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { apiUrl } from '../../../../core/api/api-url';
import { DataChanges, reloadOn } from '../../../../core/data/data-changes';
import type {
  AddressInspection,
  NetworkId,
  NetworkTokens,
  Wallet,
  WalletRequest,
} from '../../../../core/api/wallets.types';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { refusedSecret, walletError } from '../../wallet-errors';

/**
 * One wallet (F6.1): new or existing. Saves (the API refuses seed phrases and private keys —
 * F6.2 — and the page then clears the fields), runs the network check (F6.4) and the fetch
 * (F6.3), lists the tokens with their spam verdict and takes "kein Spam" (F6.6), deletes.
 */
@Injectable()
export class WalletPageService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);

  readonly walletId = signal<string | undefined>(undefined);
  readonly wallet = httpResource<Wallet>(() => {
    const id = this.walletId();
    return id ? apiUrl(`/wallets/${id}`) : undefined;
  });
  readonly tokens = httpResource<NetworkTokens[]>(() => {
    const id = this.walletId();
    return id ? apiUrl(`/wallets/${id}/tokens`) : undefined;
  });

  constructor() {
    // A check or fetch (here, or "Abrufen" in a project) changes the tokens. The wallet itself
    // is set from the answers — not reloaded under the open form.
    const changes = inject(DataChanges);
    reloadOn(() => changes.globalVersion('wallets'), [this.tokens]);
  }

  readonly busy = signal<'save' | 'check' | 'fetch' | 'delete' | null>(null);
  /** F6.2: the kind of secret the API (or the inspection) refused. */
  readonly refused = signal<string | null>(null);

  /** What the address is and where it can live — nothing is stored. */
  async inspect(address: string): Promise<AddressInspection | null> {
    if (address.trim() === '') return null;
    try {
      const result = await firstValueFrom(
        this.http.post<AddressInspection>(apiUrl('/wallets/inspect'), {
          address,
        }),
      );
      this.refused.set(result.secret);
      return result;
    } catch {
      return null;
    }
  }

  /** `true` when stored; on a refused secret the caller clears the fields. */
  async save(request: WalletRequest): Promise<boolean> {
    this.busy.set('save');
    this.refused.set(null);
    try {
      const id = this.walletId();
      if (id) {
        const updated = await firstValueFrom(
          this.http.patch<Wallet>(apiUrl(`/wallets/${id}`), {
            label: request.label,
            networks: request.networks,
            notes: request.notes,
          }),
        );
        this.wallet.set(updated);
        this.notifications.success('wallets.saved');
      } else {
        const created = await firstValueFrom(
          this.http.post<Wallet>(apiUrl('/wallets'), request),
        );
        this.notifications.success('wallets.created');
        await this.router.navigate(['/app/wallets', created.id]);
      }
      return true;
    } catch (error) {
      const kind = refusedSecret(error);
      if (kind) {
        this.refused.set(kind);
      } else {
        const { key, detail } = walletError(error);
        this.notifications.error(key, detail);
      }
      return false;
    } finally {
      this.busy.set(null);
    }
  }

  checkNetworks(): Promise<void> {
    return this.lookup('check-networks', 'check', 'wallets.checked');
  }

  fetch(): Promise<void> {
    return this.lookup('fetch', 'fetch', 'wallets.fetched');
  }

  private async lookup(
    path: 'check-networks' | 'fetch',
    busy: 'check' | 'fetch',
    success: string,
  ): Promise<void> {
    const id = this.walletId();
    if (!id) return;
    this.busy.set(busy);
    try {
      const updated = await firstValueFrom(
        this.http.post<Wallet>(apiUrl(`/wallets/${id}/${path}`), {}),
      );
      this.wallet.set(updated);
      this.notifications.success(success);
    } catch (error) {
      const { key, detail } = walletError(error);
      this.notifications.error(key, detail);
    } finally {
      this.busy.set(null);
    }
  }

  async setToken(
    network: NetworkId,
    tokenKey: string,
    notSpam: boolean,
  ): Promise<void> {
    const id = this.walletId();
    if (!id) return;
    try {
      const tokens = await firstValueFrom(
        this.http.put<NetworkTokens[]>(apiUrl(`/wallets/${id}/tokens`), {
          network,
          tokenKey,
          notSpam,
        }),
      );
      this.tokens.set(tokens);
      this.wallet.reload();
      this.notifications.success(
        notSpam ? 'wallets.tokens.markedNotSpam' : 'wallets.tokens.reset',
      );
    } catch (error) {
      const { key, detail } = walletError(error);
      this.notifications.error(key, detail);
    }
  }

  async remove(): Promise<boolean> {
    const id = this.walletId();
    if (!id) return false;
    this.busy.set('delete');
    try {
      await firstValueFrom(this.http.delete<void>(apiUrl(`/wallets/${id}`)));
      this.notifications.success('wallets.deleted');
      await this.router.navigate(['/app/wallets']);
      return true;
    } catch (error) {
      const { key, detail } = walletError(error);
      this.notifications.error(key, detail);
      return false;
    } finally {
      this.busy.set(null);
    }
  }
}
