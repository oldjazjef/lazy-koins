import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import type { RemoteLibrarySettings } from '../../../../core/api/api.types';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { LibrarySettingsPageService } from './library-settings-page.service';

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
};

const settings = (
  over: Partial<RemoteLibrarySettings> = {},
): RemoteLibrarySettings => ({
  url: '',
  enabled: false,
  suggestions: true,
  updatedAt: null,
  ...over,
});

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
  const service = TestBed.inject(LibrarySettingsPageService);
  const http = TestBed.inject(HttpTestingController);
  await settle();
  http.expectOne('/api/settings/library').flush(settings());
  await settle();
  return { service, http, notifications };
}

describe('LibrarySettingsPageService (F5.18, desktop)', () => {
  afterEach(() => {
    try {
      TestBed.inject(HttpTestingController).verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('loads the link (empty by default) and saves it', async () => {
    const { service, http, notifications } = await setup();
    expect(service.settings.value()).toMatchObject({ url: '', enabled: false });
    const saved = service.save({
      url: 'https://lazykoins.example.ch',
      enabled: true,
      suggestions: false,
    });
    const request = http.expectOne('/api/settings/library');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({
      url: 'https://lazykoins.example.ch',
      enabled: true,
      suggestions: false,
    });
    request.flush(
      settings({
        url: 'https://lazykoins.example.ch',
        enabled: true,
        suggestions: false,
      }),
    );
    expect(await saved).toBe(true);
    expect(service.settings.value()?.enabled).toBe(true);
    expect(notifications.success).toHaveBeenCalledWith('library.remote.saved');
  });

  it('shows why an address was refused under the field (no toast)', async () => {
    const { service, http, notifications } = await setup();
    const saved = service.save({
      url: 'http://lazykoins.example.ch',
      enabled: true,
      suggestions: true,
    });
    http
      .expectOne('/api/settings/library')
      .flush(
        { code: 'libraryUrlInvalid', problem: 'httpsRequired' },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
    expect(await saved).toBe(false);
    expect(service.urlProblem()).toBe('httpsRequired');
    expect(notifications.error).not.toHaveBeenCalled();
  });

  it('tests the typed address and reports the outcome by its code', async () => {
    const { service, http } = await setup();
    let testing = service.test('https://lazykoins.example.ch');
    let request = http.expectOne('/api/settings/library/test');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      url: 'https://lazykoins.example.ch',
    });
    request.flush({ server: 'https://lazykoins.example.ch', total: 12 });
    await testing;
    expect(service.testResult()).toEqual({
      server: 'https://lazykoins.example.ch',
      total: 12,
    });
    expect(service.testError()).toBeNull();

    testing = service.test('https://lazykoins.example.ch');
    request = http.expectOne('/api/settings/library/test');
    request.flush(
      { code: 'libraryTimeout', detail: 'no answer within 10000 ms' },
      { status: 502, statusText: 'Bad Gateway' },
    );
    await testing;
    expect(service.testResult()).toBeNull();
    expect(service.testError()).toBe('errors.api.libraryTimeout');

    testing = service.test('https://x.example.ch');
    http
      .expectOne('/api/settings/library/test')
      .flush({ code: 'offline' }, { status: 409, statusText: 'Conflict' });
    await testing;
    expect(service.testError()).toBe('errors.api.offline');
    expect(service.testing()).toBe(false);
  });
});
