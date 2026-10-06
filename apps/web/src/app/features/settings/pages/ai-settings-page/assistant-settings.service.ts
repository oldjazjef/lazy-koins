import { HttpClient, httpResource } from '@angular/common/http';
import { computed, inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { defineAction } from '../../../../core/actions/action';
import { ActionRunner } from '../../../../core/actions/action-runner';
import { apiUrl } from '../../../../core/api/api-url';
import type {
  AssistantSettings,
  SaveAssistantSettingsRequest,
} from '../../../../core/api/assistant.types';
import { AssistantEvents } from '../../../../core/assistant/assistant-events';
import { NotificationService } from '../../../../core/notifications/notification.service';

const KEY = 'assistant-settings';

/**
 * Einstellungen › AI › Assistent (F11.15): the assistant's system prompt (own text or the
 * default), the safety rules that always apply (read-only) and the chat's consent (F5.14).
 */
@Injectable({ providedIn: 'root' })
export class AssistantSettingsService {
  private readonly http = inject(HttpClient);
  private readonly actions = inject(ActionRunner);
  private readonly events = inject(AssistantEvents);
  private readonly notifications = inject(NotificationService);

  readonly settings = httpResource<AssistantSettings>(() =>
    apiUrl('/assistant/settings'),
  );

  private readonly saveAction = defineAction<
    SaveAssistantSettingsRequest,
    AssistantSettings
  >({
    run: (request) =>
      firstValueFrom(
        this.http.put<AssistantSettings>(
          apiUrl('/assistant/settings'),
          request,
        ),
      ),
    messages: { error: 'assistant.saveFailed' },
  });

  private readonly status = this.actions.status<AssistantSettings>(KEY);
  readonly isSaving = computed(() => this.status()?.state === 'pending');

  /** Stores an own prompt; an empty one means the default. */
  savePrompt(systemPrompt: string): Promise<boolean> {
    return this.save(
      { systemPrompt: systemPrompt.trim() === '' ? null : systemPrompt },
      'assistant.saved',
    );
  }

  resetPrompt(): Promise<boolean> {
    return this.save({ systemPrompt: null }, 'assistant.reset');
  }

  /** F5.14: the next chat question asks for the consent again. */
  revokeConsent(): Promise<boolean> {
    return this.save({ revokeChatConsent: true }, 'assistant.consent.revoked');
  }

  private async save(
    request: SaveAssistantSettingsRequest,
    message: string,
  ): Promise<boolean> {
    try {
      const saved = await this.actions.run(this.saveAction, request, {
        key: KEY,
      });
      this.settings.set(saved);
      this.events.settingsChanged();
      this.notifications.success(message);
      return true;
    } catch {
      return false;
    }
  }
}
