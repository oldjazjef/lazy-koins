import { HttpClient, httpResource } from '@angular/common/http';
import { computed, inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { defineAction } from '../../../../core/actions/action';
import { ActionRunner } from '../../../../core/actions/action-runner';
import { apiUrl } from '../../../../core/api/api-url';
import type {
  Settings,
  UpdateSettingsRequest,
} from '../../../../core/api/calculation.types';

/**
 * F11: personal data for the exports, number/date format, rate lookups on/off, and the API keys
 * (F6.7) — keys are sent once and come back only as a hint.
 */
@Injectable({ providedIn: 'root' })
export class SettingsPageService {
  private readonly http = inject(HttpClient);
  private readonly actions = inject(ActionRunner);

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

  async save(changes: UpdateSettingsRequest): Promise<void> {
    const saved = await this.actions.run(this.saveAction, changes, {
      key: 'settings',
    });
    this.settings.set(saved);
  }

  /** Removes a stored key (`null` = remove). */
  removeKey(name: 'coingecko' | 'etherscan'): Promise<void> {
    return this.save({ keys: { [name]: null } });
  }
}
