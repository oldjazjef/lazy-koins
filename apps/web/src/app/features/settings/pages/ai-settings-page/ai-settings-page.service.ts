import { HttpClient, httpResource } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { defineAction } from '../../../../core/actions/action';
import { ActionRunner } from '../../../../core/actions/action-runner';
import { apiUrl } from '../../../../core/api/api-url';
import type {
  AiConnectionTest,
  TestAiConnectionRequest,
  AiProvider,
  AiSettings,
  SaveAiSettingsRequest,
} from '../../../../core/api/api.types';
import { AssistantEvents } from '../../../../core/assistant/assistant-events';
import { NotificationService } from '../../../../core/notifications/notification.service';
import {
  aiErrorInfo,
  type AiErrorInfo,
} from '../../../../shared/ai/ai-error-details';
import { aiErrorKey } from '../../../../shared/ai/ai-error-key';

/** A provider the user can pick in one click; the rest is editable. */
export interface AiPreset {
  readonly id: string;
  readonly provider: AiProvider;
  readonly baseUrl: string;
  /** Local servers on the user's machine — only offered where the API allows them. */
  readonly local: boolean;
}

export const AI_PRESETS: readonly AiPreset[] = [
  {
    id: 'openai',
    provider: 'openai_compatible',
    baseUrl: 'https://api.openai.com/v1',
    local: false,
  },
  { id: 'anthropic', provider: 'anthropic', baseUrl: '', local: false },
  {
    id: 'mistral',
    provider: 'openai_compatible',
    baseUrl: 'https://api.mistral.ai/v1',
    local: false,
  },
  {
    id: 'groq',
    provider: 'openai_compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    local: false,
  },
  {
    id: 'openrouter',
    provider: 'openai_compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    local: false,
  },
  {
    id: 'ollama',
    provider: 'openai_compatible',
    baseUrl: 'http://localhost:11434/v1',
    local: true,
  },
  {
    id: 'lmstudio',
    provider: 'openai_compatible',
    baseUrl: 'http://localhost:1234/v1',
    local: true,
  },
];

const KEY = 'ai-settings';

/**
 * The AI plugin's settings (F5.13, F5.14): provider, address, model, key (write-only — the API
 * returns a hint), on/off, the connection test and the consent. Errors are translated from the
 * API's codes (`ai.errors.<code>`).
 */
@Injectable({ providedIn: 'root' })
export class AiSettingsPageService {
  private readonly http = inject(HttpClient);
  private readonly actions = inject(ActionRunner);
  private readonly notifications = inject(NotificationService);
  /** The chat's status (available, consent) follows these settings. */
  private readonly events = inject(AssistantEvents);

  readonly settings = httpResource<AiSettings>(() => apiUrl('/ai/settings'));
  readonly testResult = signal<AiConnectionTest | null>(null);
  /** The last failed test, with the provider's details (shown under the buttons). */
  readonly testError = signal<AiErrorInfo | null>(null);
  readonly testing = signal(false);

  private readonly saveAction = defineAction<SaveAiSettingsRequest, AiSettings>(
    {
      run: (request) =>
        firstValueFrom(
          this.http.put<AiSettings>(apiUrl('/ai/settings'), request),
        ),
    },
  );

  private readonly status = this.actions.status<AiSettings>(KEY);
  readonly isSaving = computed(() => this.status()?.state === 'pending');

  async save(
    request: SaveAiSettingsRequest,
    message = 'settings.ai.saved',
  ): Promise<boolean> {
    try {
      const saved = await this.actions.run(this.saveAction, request, {
        key: KEY,
        silent: true,
      });
      this.settings.set(saved);
      this.events.settingsChanged();
      this.testResult.set(null);
      this.testError.set(null);
      this.notifications.success(message);
      return true;
    } catch (error) {
      this.notifications.error(aiErrorKey(error));
      return false;
    }
  }

  /** Removes the stored key (everything else as saved). */
  removeKey(current: AiSettings): Promise<boolean> {
    return this.save(
      { ...requestOf(current), apiKey: '' },
      'settings.ai.keyRemoved',
    );
  }

  /** F5.14: withdraw the consent; the next AI request asks again. */
  revokeConsent(current: AiSettings): Promise<boolean> {
    return this.save(
      { ...requestOf(current), revokeConsent: true },
      'settings.ai.consentRevoked',
    );
  }

  /**
   * One tiny request without user data. `draft` = the form's current values (unsaved ones
   * included); omitted = the saved settings. A failure is kept with its details for the panel.
   */
  async test(draft?: TestAiConnectionRequest): Promise<void> {
    this.testing.set(true);
    this.testResult.set(null);
    this.testError.set(null);
    try {
      this.testResult.set(
        await firstValueFrom(
          this.http.post<AiConnectionTest>(
            apiUrl('/ai/settings/test'),
            draft ?? {},
          ),
        ),
      );
    } catch (error) {
      const info = aiErrorInfo(error);
      this.testError.set(info);
      this.notifications.error(info.key);
    } finally {
      this.testing.set(false);
    }
  }
}

function requestOf(settings: AiSettings): SaveAiSettingsRequest {
  return {
    enabled: settings.enabled,
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
  };
}
