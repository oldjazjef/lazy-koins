import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { ActivityService } from '../../../../core/activity/activity.service';
import type { DashboardView } from '../../../../core/api/dashboard.types';
import {
  lastTwelveMonths,
  presetFrom,
  presetValue,
  taxYearPeriod,
  yearToDate,
} from '../../dashboard-period';
import { DashboardPageService } from './dashboard-page.service';

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
};

const view = (over: Partial<DashboardView> = {}): DashboardView => ({
  from: '2026-01-01',
  to: '2026-10-06',
  series: [],
  startValueChf: '100',
  endValueChf: '120',
  changeChf: '20',
  changePct: '20.00',
  kpis: [],
  incomeSharePct: null,
  allocation: [],
  holdings: [
    {
      asset: 'BTC',
      quantity: '0.5',
      priceChf: '80000',
      valueChf: '40000',
      status: 'ok',
      sparkline: [],
      accounts: [
        {
          platform: 'kraken',
          accountId: 'spot',
          quantity: '0.5',
          valueChf: '40000',
        },
      ],
    },
    {
      asset: 'ETH',
      quantity: '10',
      priceChf: '2000',
      valueChf: '20000',
      status: 'ok',
      sparkline: [],
      accounts: [
        {
          platform: 'ledger',
          accountId: 'main',
          quantity: '10',
          valueChf: '20000',
        },
      ],
    },
    {
      asset: 'XYZ',
      quantity: '5',
      priceChf: null,
      valueChf: null,
      status: 'missingPrice',
      sparkline: [],
      accounts: [],
    },
  ],
  missingPrices: ['XYZ', 'ABC'],
  projects: [
    { id: 'p2', name: 'Steuern 2025', taxYear: 2025 },
    { id: 'p1', name: 'Steuern 2024', taxYear: 2024 },
  ],
  online: true,
  unreadable: 0,
  ...over,
});

async function setup() {
  TestBed.configureTestingModule({
    providers: [
      DashboardPageService,
      provideHttpClient(),
      provideHttpClientTesting(),
      provideTranslateService(),
    ],
  });
  const service = TestBed.inject(DashboardPageService);
  const http = TestBed.inject(HttpTestingController);
  await settle();
  return { service, http };
}

describe('dashboard periods (F11.4)', () => {
  const today = new Date(2026, 9, 6);

  it('defaults to 01.01. of the current year → today and offers the usual picks', () => {
    expect(yearToDate(today)).toEqual({ from: '2026-01-01', to: '2026-10-06' });
    expect(lastTwelveMonths(today)).toEqual({
      from: '2025-10-07',
      to: '2026-10-06',
    });
    expect(taxYearPeriod(2025, today)).toEqual({
      from: '2025-01-01',
      to: '2025-12-31',
    });
    expect(taxYearPeriod(2026, today).to).toBe('2026-10-06');
    expect(presetFrom(presetValue({ key: 'year', year: 2024 }))).toEqual({
      key: 'year',
      year: 2024,
    });
  });
});

describe('DashboardPageService', () => {
  afterEach(() => {
    try {
      TestBed.inject(HttpTestingController).verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('loads the period from the API and offers the tax years of my projects', async () => {
    const { service, http } = await setup();
    const { from, to } = service.period();
    http
      .expectOne(
        (r) =>
          r.url === '/api/dashboard' &&
          r.params.get('from') === from &&
          r.params.get('to') === to,
      )
      .flush(view());
    await settle();
    expect(service.taxYears()).toEqual([2025, 2024]);
    service.setPreset({ key: 'year', year: 2024 });
    await settle();
    http
      .expectOne(
        (r) =>
          r.params.get('from') === '2024-01-01' &&
          r.params.get('to') === '2024-12-31',
      )
      .flush(view());
    await settle();
  });

  it('sorts and searches the holdings without turning amounts into numbers', async () => {
    const { service, http } = await setup();
    http.expectOne((r) => r.url === '/api/dashboard').flush(view());
    await settle();
    expect(service.holdings().map((h) => h.asset)).toEqual([
      'BTC',
      'ETH',
      'XYZ',
    ]);
    service.sortBy('quantity');
    expect(service.holdings().map((h) => h.asset)).toEqual([
      'ETH',
      'XYZ',
      'BTC',
    ]);
    service.sortBy('asset');
    expect(service.holdings().map((h) => h.asset)).toEqual([
      'BTC',
      'ETH',
      'XYZ',
    ]);
    service.search.set('ledger');
    expect(service.holdings().map((h) => h.asset)).toEqual(['ETH']);
    service.toggle('ETH');
    expect(service.expanded().has('ETH')).toBe(true);
  });

  it('drills a KPI down to its bookings', async () => {
    const { service, http } = await setup();
    http.expectOne((r) => r.url === '/api/dashboard').flush(view());
    await settle();
    const done = service.showRecords('deposits', 'Einzahlungen');
    await settle();
    http
      .expectOne(
        (r) =>
          r.url === '/api/dashboard/records' &&
          r.params.get('kpi') === 'deposits',
      )
      .flush({ figureId: 'kpi:deposits', total: 0, records: [] });
    await done;
    expect(service.records()?.figureId).toBe('kpi:deposits');
    service.closeRecords();
    expect(service.recordsOf()).toBeNull();
  });

  it('refreshes rates: FX first, then one asset at a time, then reloads', async () => {
    const { service, http } = await setup();
    http.expectOne((r) => r.url === '/api/dashboard').flush(view());
    await settle();
    const done = service.refreshRates();
    for (const assets of [[], ['XYZ'], ['ABC']]) {
      await settle();
      const request = http.expectOne('/api/dashboard/rates/refresh');
      expect(request.request.body.assets).toEqual(assets);
      expect(service.refreshing()).not.toBeNull();
      // The app-wide activity indicator shows it, with the progress.
      const [task] = TestBed.inject(ActivityService).tasks();
      expect(task?.label).toBe('activity.rates');
      expect(task?.progress()?.total).toBe(3);
      request.flush({
        fx: 0,
        assets: assets.map((asset) => ({
          asset,
          status: 'fetched',
          source: 'binance',
          points: 3,
        })),
      });
    }
    await done;
    await settle();
    expect(service.refreshing()).toBeNull();
    expect(TestBed.inject(ActivityService).count()).toBe(0);
    expect(service.lastRefresh()?.map((r) => r.asset)).toEqual(['XYZ', 'ABC']);
    http
      .expectOne((r) => r.url === '/api/dashboard')
      .flush(view({ missingPrices: [] }));
    await settle();
  });
});
