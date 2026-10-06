import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import type { Settings } from '../../core/api/calculation.types';
import { NotificationService } from '../../core/notifications/notification.service';
import {
  profileChanges,
  ProfileSchema,
} from '../profile/pages/profile-page/profile-page';
import { ratesSettingsChanges } from './pages/rates-settings-page/rates-settings-page';
import { RatesSettingsPageService } from './pages/rates-settings-page/rates-settings-page.service';
import { UserSettingsService } from './user-settings.service';

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

function configure() {
  const notifications = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideTranslateService(),
      { provide: NotificationService, useValue: notifications },
    ],
  });
  return { notifications, http: TestBed.inject(HttpTestingController) };
}

describe('UserSettingsService (Profil, Einstellungen)', () => {
  afterEach(() => {
    try {
      TestBed.inject(HttpTestingController).verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('loads and saves; keys come back as hints only (F6.7)', async () => {
    const { notifications, http } = configure();
    const service = TestBed.inject(UserSettingsService);
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

  it('imports an ESTV Kursliste into the chosen project as the raw file', async () => {
    const { notifications, http } = configure();
    const page = TestBed.inject(RatesSettingsPageService);
    await settle();
    http.expectOne('/api/projects').flush([]);
    const file = new File(['asset;kurs_chf\nBTC;1'], 'kursliste.csv');
    const done = page.importKursliste('p1', file);
    const post = http.expectOne('/api/projects/p1/rates/estv');
    expect(post.request.body).toBe(file);
    expect(post.request.headers.get('Content-Type')).toBe(
      'application/octet-stream',
    );
    post.flush({ imported: 1, skipped: 0 });
    await done;
    expect(notifications.info).toHaveBeenCalledWith('rates.estvImported', {
      count: 1,
    });
  });
});

describe('profile and rate settings forms (F11)', () => {
  it('maps the profile and validates the e-mail', () => {
    const value = {
      displayName: 'Anna',
      canton: 'ZH' as const,
      advisorName: 'Treuhand AG',
      advisorEmail: '',
    };
    expect(profileChanges(value)).toEqual(value);
    expect(
      ProfileSchema.safeParse({ ...value, advisorEmail: 'nope' }).success,
    ).toBe(false);
  });

  it('sends the CoinGecko key only when one was typed', () => {
    expect(
      ratesSettingsChanges({ onlineRates: false, coingeckoKey: '' }),
    ).toEqual({ onlineRates: false });
    expect(
      ratesSettingsChanges({ onlineRates: true, coingeckoKey: 'CG' }),
    ).toEqual({ onlineRates: true, keys: { coingecko: 'CG' } });
  });
});
