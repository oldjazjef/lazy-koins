import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import type { AiSettings } from '../../../../core/api/api.types';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { AiSettingsFormSchema } from './ai-settings.schema';
import { AiSettingsPageService } from './ai-settings-page.service';

const settings = (over: Partial<AiSettings> = {}): AiSettings => ({
  enabled: true,
  provider: 'anthropic',
  baseUrl: '',
  model: '',
  hasApiKey: true,
  apiKeyHint: '…1234',
  consentAt: '2026-10-01T10:00:00.000Z',
  ready: true,
  canStoreKey: true,
  privateUrlsAllowed: false,
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
  const service = TestBed.inject(AiSettingsPageService);
  const http = TestBed.inject(HttpTestingController);
  await settle();
  http.expectOne('/api/ai/settings').flush(settings());
  await settle();
  return { service, http, notifications };
}

describe('AiSettingsPageService', () => {
  afterEach(() => {
    try {
      TestBed.inject(HttpTestingController).verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('loads the settings (the key only as a hint)', async () => {
    const { service } = await setup();
    expect(service.settings.value()?.apiKeyHint).toBe('…1234');
  });

  it('saves, sending a new key only when one is entered', async () => {
    const { service, http, notifications } = await setup();
    const saved = service.save({
      enabled: true,
      provider: 'openai_compatible',
      baseUrl: 'https://api.mistral.ai/v1',
      model: 'mistral-large-latest',
      apiKey: 'sk-new',
    });
    const request = http.expectOne('/api/ai/settings');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toMatchObject({ apiKey: 'sk-new' });
    request.flush(
      settings({ provider: 'openai_compatible', apiKeyHint: '…-new' }),
    );
    expect(await saved).toBe(true);
    expect(service.settings.value()?.apiKeyHint).toBe('…-new');
    expect(notifications.success).toHaveBeenCalledWith('settings.ai.saved');
  });

  it('translates a refused address', async () => {
    const { service, http, notifications } = await setup();
    const saved = service.save({
      enabled: true,
      provider: 'openai_compatible',
      baseUrl: 'http://localhost:11434/v1',
      model: '',
    });
    http
      .expectOne('/api/ai/settings')
      .flush(
        { statusCode: 422, code: 'privateUrl' },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
    expect(await saved).toBe(false);
    expect(notifications.error).toHaveBeenCalledWith('ai.errors.privateUrl');
  });

  it('removes the key and withdraws the consent through the same save', async () => {
    const { service, http } = await setup();
    const removed = service.removeKey(settings());
    const remove = http.expectOne('/api/ai/settings');
    expect(remove.request.body).toEqual({
      enabled: true,
      provider: 'anthropic',
      baseUrl: '',
      model: '',
      apiKey: '',
    });
    remove.flush(settings({ hasApiKey: false, apiKeyHint: null }));
    await removed;

    const revoked = service.revokeConsent(settings());
    const revoke = http.expectOne('/api/ai/settings');
    expect(revoke.request.body).toMatchObject({ revokeConsent: true });
    revoke.flush(settings({ consentAt: null }));
    await revoked;
    expect(service.settings.value()?.consentAt).toBeNull();
  });

  it('tests the saved connection and reports a provider failure', async () => {
    const { service, http, notifications } = await setup();
    const ok = service.test();
    http.expectOne('/api/ai/settings/test').flush({
      ok: true,
      model: 'claude-sonnet-5-5',
      usage: null,
      millis: 420,
    });
    await ok;
    expect(service.testResult()?.model).toBe('claude-sonnet-5-5');

    const failed = service.test();
    http
      .expectOne('/api/ai/settings/test')
      .flush(
        { statusCode: 502, code: 'network' },
        { status: 502, statusText: 'Bad Gateway' },
      );
    await failed;
    expect(service.testResult()).toBeNull();
    expect(notifications.error).toHaveBeenCalledWith('ai.errors.network');
  });
});

describe('AiSettingsFormSchema', () => {
  const base = {
    enabled: true,
    provider: 'openai_compatible',
    baseUrl: '',
    model: '',
    apiKey: '',
  };

  it('accepts an empty or an http(s) address', () => {
    expect(AiSettingsFormSchema.safeParse(base).success).toBe(true);
    expect(
      AiSettingsFormSchema.safeParse({
        ...base,
        baseUrl: 'http://localhost:1234/v1',
      }).success,
    ).toBe(true);
  });

  it('refuses other addresses with an i18n key', () => {
    const parsed = AiSettingsFormSchema.safeParse({
      ...base,
      baseUrl: 'ftp://x',
    });
    expect(parsed.error?.issues[0]?.message).toBe(
      'settings.ai.form.baseUrlInvalid',
    );
  });
});
