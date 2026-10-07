import {
  HttpClient,
  HttpErrorResponse,
  httpResource,
} from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { defineAction } from '../../core/actions/action';
import { ActionRunner } from '../../core/actions/action-runner';
import { extractErrorDetail } from '../../core/actions/extract-error-detail';
import { apiUrl } from '../../core/api/api-url';
import type {
  Settings,
  UpdateSettingsRequest,
} from '../../core/api/calculation.types';
import type { KeyCheckResult } from '../../core/api/setup.types';
import { NotificationService } from '../../core/notifications/notification.service';

/**
 * F11: personal data for the exports, number/date format, rate lookups on/off, and the API keys
 * (F6.7) — keys are sent once and come back only as a hint.
 */
@Injectable({ providedIn: 'root' })
export class UserSettingsService {
  private readonly http = inject(HttpClient);
  private readonly actions = inject(ActionRunner);
  private readonly notifications = inject(NotificationService);

  readonly settings = httpResource<Settings>(() => apiUrl('/settings'));

  private readonly saveAction = defineAction<UpdateSettingsRequest, Settings>({
    run: (changes) =>
      firstValueFrom(this.http.put<Settings>(apiUrl('/settings'), changes)),
    messages: {
      success: 'settings.saved',
      error: 'settings.saveFailed',
    },
  });

  private readonly status = this.actions.status<Settings>('settings');
  readonly isSaving = computed(() => this.status()?.state === 'pending');

  /**
   * Saves the changes. `quiet`: no "Gespeichert" toast (the setup wizard moves on instead — a
   * toast would sit on its "Weiter" button); a failure is still reported.
   */
  async save(
    changes: UpdateSettingsRequest,
    options: { quiet?: boolean } = {},
  ): Promise<void> {
    try {
      const saved = await this.actions.run(this.saveAction, changes, {
        key: 'settings',
        silent: options.quiet === true,
      });
      this.settings.set(saved);
    } catch (error) {
      if (options.quiet) {
        this.notifications.error(
          'settings.saveFailed',
          extractErrorDetail(error),
        );
      }
      throw error;
    }
  }

  /** Removes a stored key (`null` = remove). */
  removeKey(name: 'coingecko' | 'etherscan'): Promise<void> {
    return this.save({ keys: { [name]: null } });
  }

  /** The last CoinGecko key test ("Testen", F11.0s) — with the provider's details on failure. */
  readonly coingeckoTest = signal<KeyCheckResult | null>(null);
  readonly coingeckoTesting = signal(false);

  /** Tests the typed key (never stored) or, without one, the stored key. */
  async testCoingeckoKey(typed?: string): Promise<KeyCheckResult | null> {
    this.coingeckoTesting.set(true);
    this.coingeckoTest.set(null);
    try {
      const key = typed?.trim();
      const result = await firstValueFrom(
        this.http.post<KeyCheckResult>(
          apiUrl('/settings/keys/coingecko/test'),
          key ? { key } : {},
        ),
      );
      this.coingeckoTest.set(result);
      return result;
    } catch (error) {
      const code =
        error instanceof HttpErrorResponse
          ? (error.error as { code?: unknown } | null)?.code
          : undefined;
      this.notifications.error(
        code === 'noKey' || code === 'offline'
          ? `settings.keyTest.${code}`
          : 'settings.keyTest.failed',
      );
      return null;
    } finally {
      this.coingeckoTesting.set(false);
    }
  }
}
