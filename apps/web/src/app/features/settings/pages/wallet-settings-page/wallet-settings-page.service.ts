import { HttpClient, httpResource } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { apiUrl } from '../../../../core/api/api-url';
import type {
  ChainService,
  ChainServiceTest,
  ChainSettings,
  ChainSettingsRequest,
} from '../../../../core/api/wallets.types';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { walletError } from '../../../wallets/wallet-errors';

/** A "Testen" outcome per service, shown next to its fields. */
export type TestOutcome =
  | { readonly ok: true; readonly detail: string; readonly millis: number }
  | { readonly ok: false; readonly key: string; readonly detail?: string };

/**
 * Einstellungen › Wallets & Netzwerke (F6.7, F11.0b): Etherscan (all EVM chains), Helius / a
 * Solana RPC URL, Subscan, and address overrides for Esplora, Koios and the Cosmos LCD. Keys are
 * sent once and come back as a hint. "Testen" sends the form's current values — saved or not.
 */
@Injectable({ providedIn: 'root' })
export class WalletSettingsPageService {
  private readonly http = inject(HttpClient);
  private readonly notifications = inject(NotificationService);

  readonly settings = httpResource<ChainSettings>(() =>
    apiUrl('/settings/wallets'),
  );
  readonly saving = signal(false);
  readonly testing = signal<ChainService | null>(null);
  readonly results = signal<Partial<Record<ChainService, TestOutcome>>>({});

  /** `quiet`: no "Gespeichert" toast (the setup wizard moves on instead). */
  async save(
    request: ChainSettingsRequest,
    options: { quiet?: boolean } = {},
  ): Promise<boolean> {
    this.saving.set(true);
    try {
      const saved = await firstValueFrom(
        this.http.put<ChainSettings>(apiUrl('/settings/wallets'), request),
      );
      this.settings.set(saved);
      if (!options.quiet) this.notifications.success('settings.saved');
      return true;
    } catch (error) {
      const { key, detail } = walletError(error);
      this.notifications.error(key, detail);
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  async test(
    service: ChainService,
    draft: ChainSettingsRequest,
  ): Promise<void> {
    this.testing.set(service);
    const clear = { ...this.results() };
    delete clear[service];
    this.results.set(clear);
    let outcome: TestOutcome;
    try {
      const answer = await firstValueFrom(
        this.http.post<ChainServiceTest>(apiUrl('/settings/wallets/test'), {
          service,
          ...draft,
        }),
      );
      outcome = { ok: true, detail: answer.detail, millis: answer.millis };
    } catch (error) {
      outcome = { ok: false, ...walletError(error) };
    } finally {
      this.testing.set(null);
    }
    this.results.set({ ...this.results(), [service]: outcome });
  }
}
