import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import type { Settings } from '../../../../core/api/calculation.types';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { settingsChanges, SettingsSchema } from './settings-page';
import { SettingsPageService } from './settings-page.service';

const settings = (over: Partial<Settings> = {}): Settings => ({
  displayName: '',
  canton: '',
  advisorName: '',
  advisorEmail: '',
  numberFormat: 'de-CH',
  dateFormat: 'dd.MM.yyyy',
  onlineRates: true,
  keys: { coingecko: null, etherscan: null },
  coingeckoIds: {},
  keyStorageAvailable: true,
  ...over,
});

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
};

describe('SettingsPageService (F11)', () => {
  afterEach(() => {
    try {
      TestBed.inject(HttpTestingController).verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('loads and saves; keys come back as hints only', async () => {
    const notifications = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService(),
        { provide: NotificationService, useValue: notifications },
      ],
    });
    const service = TestBed.inject(SettingsPageService);
    const http = TestBed.inject(HttpTestingController);
    await settle();
    http.expectOne('/api/settings').flush(settings());
    await settle();

    const saved = service.save({ keys: { coingecko: 'CG-1234' } });
    const put = http.expectOne('/api/settings');
    expect(put.request.method).toBe('PUT');
    put.flush(settings({ keys: { coingecko: '…1234', etherscan: null } }));
    await saved;
    expect(service.settings.value()?.keys.coingecko).toBe('…1234');
    expect(notifications.success).toHaveBeenCalledWith('settings.saved');

    const removed = service.removeKey('coingecko');
    const del = http.expectOne('/api/settings');
    expect(del.request.body).toEqual({ keys: { coingecko: null } });
    del.flush(settings());
    await removed;
  });
});

describe('settings form (F11, F6.7)', () => {
  it('sends a key only when one was typed, and validates the e-mail', () => {
    const value = {
      displayName: 'Anna',
      canton: 'ZH' as const,
      advisorName: '',
      advisorEmail: '',
      onlineRates: false,
      coingeckoKey: '',
      etherscanKey: 'ES-1',
    };
    expect(settingsChanges(value)).toEqual({
      displayName: 'Anna',
      canton: 'ZH',
      advisorName: '',
      advisorEmail: '',
      onlineRates: false,
      keys: { etherscan: 'ES-1' },
    });
    expect(
      SettingsSchema.safeParse({ ...value, advisorEmail: 'nope' }).success,
    ).toBe(false);
  });
});
