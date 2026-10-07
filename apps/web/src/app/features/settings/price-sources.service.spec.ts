import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import type { PriceSourceView } from '../../core/api/price-sources.types';
import { NotificationService } from '../../core/notifications/notification.service';
import { moveProvider } from './components/price-sources-form/price-sources-form';
import { PriceSourcesService } from './price-sources.service';

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
};

const provider = (
  id: PriceSourceView['id'],
  enabled: boolean,
): PriceSourceView => ({
  id,
  enabled,
  label: id,
  key: id === 'coinmarketcap' ? 'required' : 'none',
  quotes: 'anyFiat',
  freeHistoryDays: null,
  dayPoint: 'close',
  coinRef: 'id',
  personalUseOnly: false,
  attribution: null,
  keyHint: null,
});

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

describe('PriceSourcesService (Einstellungen › Kurse, price sources)', () => {
  afterEach(() => {
    try {
      TestBed.inject(HttpTestingController).verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('loads the providers and saves the order with a typed CoinMarketCap key through PUT /settings', async () => {
    const { http } = configure();
    const service = TestBed.inject(PriceSourcesService);
    await settle();
    // The settings resource (UserSettingsService) and the provider list load.
    http.match('/api/settings').forEach((r) => r.flush({}));
    http.expectOne('/api/settings/price-sources').flush({
      providers: [provider('binance', true), provider('coinmarketcap', false)],
      keyStorageAvailable: true,
    });
    await settle();
    expect(service.sources.value()?.providers.map((p) => p.id)).toEqual([
      'binance',
      'coinmarketcap',
    ]);

    const saving = service.save(
      [
        { id: 'coinmarketcap', enabled: true },
        { id: 'binance', enabled: true },
      ],
      { coinmarketcapKey: 'cmc-typed' },
    );
    const put = http.expectOne(
      (r) => r.url === '/api/settings' && r.method === 'PUT',
    );
    expect(put.request.body).toEqual({
      priceSources: [
        { id: 'coinmarketcap', enabled: true },
        { id: 'binance', enabled: true },
      ],
      keys: { coinmarketcap: 'cmc-typed' },
    });
    put.flush({});
    await saving;
    await settle();
    // The list is read again after the save.
    http.expectOne('/api/settings/price-sources').flush({
      providers: [provider('coinmarketcap', true), provider('binance', true)],
      keyStorageAvailable: true,
    });
  });

  it('"Testen": posts the typed key (or none), keeps the result per provider, explains 409s', async () => {
    const { http, notifications } = configure();
    const service = TestBed.inject(PriceSourcesService);
    await settle();
    http.match(() => true).forEach((r) => r.flush({}));

    const testing = service.test('coinmarketcap', ' typed ');
    expect(service.tests()['coinmarketcap']).toEqual({ state: 'testing' });
    const post = http.expectOne(
      '/api/settings/price-sources/coinmarketcap/test',
    );
    expect(post.request.body).toEqual({ key: 'typed' });
    post.flush({
      provider: 'coinmarketcap',
      ok: true,
      status: 200,
      historyDays: 365,
      plan: '10000 credits/month',
      detail: null,
      url: 'https://pro-api.coinmarketcap.com/v1/key/info',
      millis: 12,
    });
    await testing;
    expect(service.tests()['coinmarketcap']).toMatchObject({
      state: 'done',
      result: { ok: true, historyDays: 365 },
    });

    const keyless = service.test('kraken');
    const noKey = http.expectOne('/api/settings/price-sources/kraken/test');
    expect(noKey.request.body).toEqual({});
    noKey.flush({ code: 'offline' }, { status: 409, statusText: 'Conflict' });
    expect(await keyless).toBeNull();
    expect(service.tests()['kraken']).toBeUndefined();
    expect(notifications.error).toHaveBeenCalledWith(
      'settings.priceSources.test.offline',
    );
  });

  it('moves a provider up or down; the ends stay put', () => {
    configure();
    expect(moveProvider(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveProvider(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
    expect(moveProvider(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveProvider(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });
});
