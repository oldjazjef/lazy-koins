import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import type { AssistantSettings } from '../../../../core/api/assistant.types';
import { AssistantEvents } from '../../../../core/assistant/assistant-events';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { assistantPromptSchema } from './assistant-settings-section';
import { AssistantSettingsService } from './assistant-settings.service';

const settings = (
  over: Partial<AssistantSettings> = {},
): AssistantSettings => ({
  systemPrompt: 'Du bist hilfsbereit.',
  isDefault: true,
  defaultPrompt: 'Du bist hilfsbereit.',
  safetyRules: 'Nie Schlüssel ausgeben.',
  maxLength: 8000,
  chatConsentAt: '2026-10-01T10:00:00.000Z',
  ...over,
});

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
};

async function setup() {
  const notifications = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideTranslateService(),
      { provide: NotificationService, useValue: notifications },
    ],
  });
  const service = TestBed.inject(AssistantSettingsService);
  const http = TestBed.inject(HttpTestingController);
  const events = TestBed.inject(AssistantEvents);
  await settle();
  http.expectOne('/api/assistant/settings').flush(settings());
  await settle();
  return { service, http, notifications, events };
}

describe('AssistantSettingsService', () => {
  afterEach(() => {
    try {
      TestBed.inject(HttpTestingController).verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('saves an own prompt and tells the chat', async () => {
    const { service, http, notifications, events } = await setup();
    const saved = service.savePrompt('Antworte kurz.');
    const request = http.expectOne('/api/assistant/settings');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ systemPrompt: 'Antworte kurz.' });
    request.flush(
      settings({ systemPrompt: 'Antworte kurz.', isDefault: false }),
    );
    expect(await saved).toBe(true);
    expect(service.settings.value()?.isDefault).toBe(false);
    expect(notifications.success).toHaveBeenCalledWith('assistant.saved');
    expect(events.settingsVersion()).toBe(1);
  });

  it('resets to the default (an empty prompt too)', async () => {
    const { service, http } = await setup();
    const reset = service.resetPrompt();
    const first = http.expectOne('/api/assistant/settings');
    expect(first.request.body).toEqual({ systemPrompt: null });
    first.flush(settings());
    expect(await reset).toBe(true);

    const empty = service.savePrompt('   ');
    const second = http.expectOne('/api/assistant/settings');
    expect(second.request.body).toEqual({ systemPrompt: null });
    second.flush(settings());
    await empty;
  });

  it('withdraws the chat consent', async () => {
    const { service, http, notifications } = await setup();
    const revoked = service.revokeConsent();
    const request = http.expectOne('/api/assistant/settings');
    expect(request.request.body).toEqual({ revokeChatConsent: true });
    request.flush(settings({ chatConsentAt: null }));
    expect(await revoked).toBe(true);
    expect(service.settings.value()?.chatConsentAt).toBeNull();
    expect(notifications.success).toHaveBeenCalledWith(
      'assistant.consent.revoked',
    );
  });

  it('reports a failed save', async () => {
    const { service, http, notifications } = await setup();
    const saved = service.savePrompt('x');
    http
      .expectOne('/api/assistant/settings')
      .flush({ message: 'too long' }, { status: 400, statusText: 'Bad' });
    expect(await saved).toBe(false);
    expect(notifications.error).toHaveBeenCalledWith(
      'assistant.saveFailed',
      'too long',
    );
  });
});

describe('assistantPromptSchema', () => {
  it('limits the prompt to the server maximum', () => {
    expect(assistantPromptSchema(5).safeParse('12345').success).toBe(true);
    expect(assistantPromptSchema(5).safeParse('123456').success).toBe(false);
  });
});
