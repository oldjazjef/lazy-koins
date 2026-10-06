import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import type {
  MailSettings,
  MailTemplate,
} from '../../../../core/api/mail.types';
import { NotificationService } from '../../../../core/notifications/notification.service';
import {
  MailSettingsFormSchema,
  MailTemplateFormSchema,
} from './mail-settings.schema';
import { MailSettingsPageService } from './mail-settings-page.service';

const settings = (over: Partial<MailSettings> = {}): MailSettings => ({
  enabled: true,
  host: 'smtp.example.ch',
  port: 587,
  security: 'starttls',
  username: 'anna',
  hasPassword: true,
  passwordHint: '…word',
  fromName: 'Anna',
  fromAddress: 'anna@example.ch',
  ready: true,
  canStorePassword: true,
  privateHostsAllowed: false,
  testRecipient: 'anna@lazykoins.dev',
  ...over,
});

const template = (over: Partial<MailTemplate> = {}): MailTemplate => ({
  language: 'de-CH',
  subject: 'Steuern {{steuerjahr}}',
  body: 'Hallo {{treuhaender}}',
  isDefault: true,
  defaultSubject: 'Steuern {{steuerjahr}}',
  defaultBody: 'Hallo {{treuhaender}}',
  placeholders: ['name', 'treuhaender'],
  sampleValues: {},
  preview: {
    subject: 'Steuern 2025',
    body: 'Hallo Beat',
    unknownPlaceholders: [],
  },
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
  const service = TestBed.inject(MailSettingsPageService);
  const http = TestBed.inject(HttpTestingController);
  await settle();
  http.expectOne('/api/mail/settings').flush(settings());
  http.expectOne('/api/mail/template').flush(template());
  await settle();
  return { service, http, notifications };
}

describe('MailSettingsPageService', () => {
  afterEach(() => {
    try {
      TestBed.inject(HttpTestingController).verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('loads the mailer (password only as a hint) and the template', async () => {
    const { service } = await setup();
    expect(service.settings.value()?.passwordHint).toBe('…word');
    expect(service.template.value()?.isDefault).toBe(true);
  });

  it('saves the mailer, sending a password only when typed', async () => {
    const { service, http, notifications } = await setup();
    const saved = service.save({
      enabled: true,
      host: 'smtp.other.ch',
      port: 465,
      security: 'tls',
      username: 'anna',
      fromName: 'Anna',
      fromAddress: 'anna@example.ch',
    });
    const request = http.expectOne('/api/mail/settings');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).not.toHaveProperty('password');
    request.flush(settings({ host: 'smtp.other.ch' }));
    expect(await saved).toBe(true);
    expect(service.settings.value()?.host).toBe('smtp.other.ch');
    expect(notifications.success).toHaveBeenCalledWith('settings.mail.saved');
  });

  it('removes the password with ""', async () => {
    const { service, http } = await setup();
    const done = service.removePassword(settings());
    const request = http.expectOne('/api/mail/settings');
    expect(request.request.body).toMatchObject({ password: '' });
    request.flush(settings({ hasPassword: false, passwordHint: null }));
    expect(await done).toBe(true);
  });

  it('tests the unsaved form values and shows the SMTP details of a failure', async () => {
    const { service, http, notifications } = await setup();
    const ok = service.test({
      host: 'smtp.other.ch',
      port: 587,
      security: 'starttls',
      username: 'anna',
      password: 'typed',
      fromName: 'Anna',
      fromAddress: 'anna@example.ch',
    });
    const first = http.expectOne('/api/mail/settings/test');
    expect(first.request.body).toMatchObject({
      host: 'smtp.other.ch',
      password: 'typed',
    });
    first.flush({
      ok: true,
      to: 'anna@lazykoins.dev',
      millis: 12,
      response: '250 Ok',
    });
    await ok;
    expect(service.testResult()?.to).toBe('anna@lazykoins.dev');

    const failed = service.test();
    http.expectOne('/api/mail/settings/test').flush(
      {
        code: 'smtpFailed',
        smtp: {
          kind: 'auth',
          host: 'smtp.example.ch',
          port: 587,
          smtpCode: 535,
          response: '535 Authentication failed',
          command: 'AUTH PLAIN',
          code: 'EAUTH',
        },
      },
      { status: 502, statusText: 'Bad Gateway' },
    );
    await failed;
    expect(service.testResult()).toBeNull();
    expect(service.testError()).toMatchObject({ kind: 'auth', smtpCode: 535 });
    expect(notifications.error).not.toHaveBeenCalled();

    const conflict = service.test();
    http
      .expectOne('/api/mail/settings/test')
      .flush({ code: 'privateHost' }, { status: 409, statusText: 'Conflict' });
    await conflict;
    expect(notifications.error).toHaveBeenCalledWith('mail.errors.privateHost');
  });

  it('saves and resets the template', async () => {
    const { service, http, notifications } = await setup();
    const saved = service.saveTemplate({ subject: 'S', body: 'B {{name}}' });
    const put = http.expectOne('/api/mail/template');
    expect(put.request.method).toBe('PUT');
    put.flush(template({ subject: 'S', isDefault: false }));
    expect(await saved).toBe(true);
    expect(service.template.value()?.isDefault).toBe(false);

    const reset = service.saveTemplate(null);
    const del = http.expectOne('/api/mail/template');
    expect(del.request.method).toBe('DELETE');
    del.flush(template());
    expect(await reset).toBe(true);
    expect(notifications.success).toHaveBeenCalledWith(
      'settings.mail.template.reset',
    );
  });

  it('refuses unknown placeholders on save with their names', async () => {
    const { service, http, notifications } = await setup();
    const saved = service.saveTemplate({ subject: 'S', body: '{{foo}}' });
    http
      .expectOne('/api/mail/template')
      .flush(
        { code: 'unknownPlaceholders', placeholders: ['foo'] },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
    expect(await saved).toBe(false);
    expect(notifications.error).toHaveBeenCalledWith(
      'mail.errors.unknownPlaceholders',
    );
  });

  it('previews typed text through the API', async () => {
    const { service, http } = await setup();
    service.previewText.set({ subject: '{{projekt}}', body: '{{x}}' });
    await settle();
    const request = http.expectOne('/api/mail/template/preview');
    expect(request.request.method).toBe('POST');
    request.flush({
      subject: 'Steuern 2025',
      body: '{{x}}',
      unknownPlaceholders: ['x'],
    });
    await settle();
    expect(service.preview.value()?.unknownPlaceholders).toEqual(['x']);
  });
});

describe('mail settings schemas', () => {
  const base = {
    enabled: true,
    host: 'smtp.example.ch',
    port: 587,
    security: 'starttls' as const,
    username: '',
    password: '',
    fromName: '',
    fromAddress: 'anna@example.ch',
  };

  it('accepts a host name and refuses URLs, bad ports and addresses', () => {
    expect(MailSettingsFormSchema.safeParse(base).success).toBe(true);
    for (const bad of [
      { host: 'smtp://smtp.example.ch' },
      { host: 'smtp.example.ch:587' },
      { port: 0 },
      { port: 70000 },
      { fromAddress: 'anna' },
    ]) {
      expect(
        MailSettingsFormSchema.safeParse({ ...base, ...bad }).success,
      ).toBe(false);
    }
  });

  it('needs subject and text in the template', () => {
    expect(
      MailTemplateFormSchema.safeParse({ subject: 'S', body: 'B' }).success,
    ).toBe(true);
    expect(
      MailTemplateFormSchema.safeParse({ subject: ' ', body: 'B' }).success,
    ).toBe(false);
    expect(
      MailTemplateFormSchema.safeParse({ subject: 'S', body: ' ' }).success,
    ).toBe(false);
  });
});
