import {
  HttpClient,
  HttpErrorResponse,
  httpResource,
} from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { apiUrl } from '../../core/api/api-url';
import type {
  PriceProviderId,
  PriceSourceSetting,
  PriceSourcesView,
  PriceSourceTestResult,
} from '../../core/api/price-sources.types';
import { NotificationService } from '../../core/notifications/notification.service';
import { UserSettingsService } from './user-settings.service';

/** One provider's last "Testen": running, its result, or nothing yet. */
export type PriceSourceTestState =
  | { readonly state: 'testing' }
  | { readonly state: 'done'; readonly result: PriceSourceTestResult };

/**
 * Price sources (F7.4, phase 2): the crypto price providers in the user's order, on/off, what each
 * offers, and "Testen" per provider. Saving goes through `UserSettingsService.save` (`PUT
 * /settings` — the interceptor then refreshes every project's rates and results). Root: shared by
 * Einstellungen › Kurse and the setup wizard's rates step.
 */
@Injectable({ providedIn: 'root' })
export class PriceSourcesService {
  private readonly http = inject(HttpClient);
  private readonly settings = inject(UserSettingsService);
  private readonly notifications = inject(NotificationService);

  readonly sources = httpResource<PriceSourcesView>(() =>
    apiUrl('/settings/price-sources'),
  );
  readonly isSaving = computed(() => this.settings.isSaving());

  private readonly testsState = signal<
    Partial<Record<PriceProviderId, PriceSourceTestState>>
  >({});
  readonly tests = this.testsState.asReadonly();

  /**
   * Saves the order (and a typed CoinMarketCap key: a string stores it, `null` removes it,
   * absent keeps it), then reloads the list.
   */
  async save(
    order: readonly PriceSourceSetting[],
    options: { coinmarketcapKey?: string | null; quiet?: boolean } = {},
  ): Promise<void> {
    await this.settings.save(
      {
        priceSources: order.map((p) => ({ id: p.id, enabled: p.enabled })),
        ...(options.coinmarketcapKey !== undefined
          ? { keys: { coinmarketcap: options.coinmarketcapKey } }
          : {}),
      },
      { quiet: options.quiet },
    );
    this.sources.reload();
  }

  /** "Testen": the typed key (never stored) or the stored one. */
  async test(
    provider: PriceProviderId,
    typedKey?: string,
  ): Promise<PriceSourceTestResult | null> {
    this.testsState.update((all) => ({
      ...all,
      [provider]: { state: 'testing' },
    }));
    try {
      const key = typedKey?.trim();
      const result = await firstValueFrom(
        this.http.post<PriceSourceTestResult>(
          apiUrl(`/settings/price-sources/${provider}/test`),
          key ? { key } : {},
        ),
      );
      this.testsState.update((all) => ({
        ...all,
        [provider]: { state: 'done', result },
      }));
      return result;
    } catch (error) {
      this.testsState.update((all) => {
        const next = { ...all };
        delete next[provider];
        return next;
      });
      const code =
        error instanceof HttpErrorResponse
          ? (error.error as { code?: unknown } | null)?.code
          : undefined;
      this.notifications.error(
        code === 'noKey' || code === 'offline'
          ? `settings.priceSources.test.${code}`
          : 'settings.priceSources.test.error',
      );
      return null;
    }
  }
}
