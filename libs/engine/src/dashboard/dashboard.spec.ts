import type { Booking, BookingKind, Holding } from '../bookings/booking';
import { parseDecimal } from '../money/decimal';
import type { RateEntry } from '../rates/rate-table';
import { chRules } from '../rules/country-rules';
import {
  dashboard,
  dashboardCorrections,
  dashboardRates,
  type ProjectCorrection,
  uniqueRecords,
  yearOwner,
} from './dashboard';

/** Synthetic records only. */
function booking(
  id: string,
  timestamp: string,
  asset: string,
  quantity: string,
  kind: BookingKind,
  extra: Partial<Booking> = {},
): Booking {
  return {
    id,
    sourceFileId: 'f1',
    row: 1,
    platform: 'kraken',
    accountId: 'main',
    timestamp,
    asset,
    quantity: parseDecimal(quantity),
    kind,
    rawType: kind,
    ...extra,
  };
}

const fx = (date: string, value: string): RateEntry => ({
  kind: 'fx',
  asset: 'USD',
  currency: 'CHF',
  date,
  value,
  source: 'ecb',
});
const usd = (asset: string, date: string, value: string): RateEntry => ({
  kind: 'price',
  asset,
  currency: 'USD',
  date,
  value,
  source: 'binance',
});

const rates: RateEntry[] = [
  fx('2025-01-01', '1'),
  usd('ETH', '2025-01-01', '1000'),
  usd('ETH', '2025-01-03', '1200'),
];

const bookings: Booking[] = [
  booking('f1:1', '2025-01-01T10:00:00.000Z', 'ETH', '2', 'deposit'),
  booking('f1:2', '2025-01-02T10:00:00.000Z', 'ETH', '0.1', 'income_staking'),
  booking('f1:3', '2025-01-02T11:00:00.000Z', 'ETH', '-0.5', 'trade', {
    group: 'T1',
    fee: parseDecimal('0.01'),
  }),
  booking('f1:4', '2025-01-02T11:00:00.000Z', 'CHF', '500', 'trade', {
    group: 'T1',
  }),
  booking('f1:5', '2025-01-03T09:00:00.000Z', 'ETH', '-0.2', 'loss'),
  booking('f1:6', '2025-01-03T09:00:00.000Z', 'SCAM', '1000', 'spam'),
];

const base = {
  rules: chRules,
  bookings,
  holdings: [] as Holding[],
  corrections: [],
  rates,
  from: '2025-01-01',
  to: '2025-01-03',
};

describe('dashboard (F11.4–F11.9)', () => {
  it('values every day as holdings × daily CHF price, spam left out', () => {
    const result = dashboard(base);
    expect(result.series.map((p) => [p.date, p.valueChf])).toEqual([
      ['2025-01-01', '2000'],
      // 1.59 ETH × 1000 + 500 CHF
      ['2025-01-02', '2090'],
      // 1.39 ETH × 1200 + 500 CHF
      ['2025-01-03', '2168'],
    ]);
    expect(result.startValueChf).toBe('0');
    expect(result.endValueChf).toBe('2168');
    expect(result.changePct).toBeNull();
    expect(result.holdings.map((h) => h.asset)).toEqual(['ETH', 'CHF']);
  });

  it('sums the KPIs in CHF with their bookings', () => {
    const kpis = Object.fromEntries(
      dashboard(base).kpis.map((k) => [k.kind, k]),
    );
    expect(kpis['deposits']).toMatchObject({
      valueChf: '2000',
      recordIds: ['f1:1'],
    });
    expect(kpis['income']).toMatchObject({
      valueChf: '100',
      recordIds: ['f1:2'],
    });
    expect(kpis['tradingFees']).toMatchObject({
      valueChf: '10',
      recordIds: ['f1:3'],
    });
    expect(kpis['costs']).toMatchObject({
      valueChf: '240',
      recordIds: ['f1:5'],
    });
    expect(kpis['withdrawals']?.valueChf).toBe('0');
  });

  it('marks missing prices instead of counting them as 0 (F11.9)', () => {
    const result = dashboard({
      ...base,
      bookings: [
        ...bookings,
        booking('f1:7', '2025-01-02T00:00:00.000Z', 'NOPRICE', '5', 'deposit'),
      ],
    });
    expect(result.series[1]?.missing).toEqual(['NOPRICE']);
    expect(result.series[1]?.valueChf).toBe('2090');
    expect(result.missingPrices).toEqual(['NOPRICE']);
    const holding = result.holdings.find((h) => h.asset === 'NOPRICE');
    expect(holding).toMatchObject({
      status: 'missingPrice',
      priceChf: null,
      valueChf: null,
    });
    expect(result.kpis.find((k) => k.kind === 'deposits')?.missingPrices).toBe(
      1,
    );
  });

  it('counts the same record of a file shared by two projects once', () => {
    const twice = dashboard({ ...base, bookings: [...bookings, ...bookings] });
    expect(twice.endValueChf).toBe(dashboard(base).endValueChf);
    expect(uniqueRecords([{ id: 'a' }, { id: 'b' }, { id: 'a' }])).toEqual([
      { id: 'a' },
      { id: 'b' },
    ]);
  });

  it('leaves internal transfers out of In and Out', () => {
    const result = dashboard({
      ...base,
      bookings: [
        ...bookings,
        booking('f1:8', '2025-01-03T10:00:00.000Z', 'ETH', '-1', 'withdrawal'),
        booking('f2:1', '2025-01-03T10:30:00.000Z', 'ETH', '0.999', 'deposit', {
          platform: 'ledger',
          sourceFileId: 'f2',
        }),
      ],
    });
    const kpis = Object.fromEntries(result.kpis.map((k) => [k.kind, k]));
    expect(kpis['withdrawals']?.recordIds).toEqual([]);
    expect(kpis['deposits']?.recordIds).toEqual(['f1:1']);
  });

  it('keeps the latest statement of an account without bookings', () => {
    const wallet: Holding = {
      id: 'w:1',
      sourceFileId: 'w',
      row: 2,
      platform: 'ledger',
      accountId: 'main',
      asset: 'ETH',
      quantity: parseDecimal('1'),
      asOf: '2025-01-01',
    };
    const result = dashboard({ ...base, holdings: [wallet] });
    // 1 ETH more on every day from the statement on.
    expect(result.series.map((p) => p.valueChf)).toEqual([
      '3000',
      '3090',
      '3368',
    ]);
    expect(
      result.holdings.find((h) => h.asset === 'ETH')?.accounts,
    ).toHaveLength(2);
  });

  it('names the largest seven assets and sums the rest as "Andere"', () => {
    const assets = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
    const result = dashboard({
      ...base,
      bookings: assets.map((asset, i) =>
        booking(`x:${i}`, '2025-01-01T00:00:00.000Z', asset, '1', 'deposit'),
      ),
      rates: [
        fx('2025-01-01', '1'),
        ...assets.map((asset, i) => usd(asset, '2025-01-01', String(i + 1))),
      ],
    });
    expect(result.allocation).toHaveLength(8);
    expect(result.allocation[0]).toMatchObject({
      asset: 'I',
      sharePct: '20.00',
    });
    expect(result.allocation[7]).toMatchObject({
      asset: null,
      valueChf: '3',
      assets: 2,
    });
    expect(result.holdings[0]?.sparkline).toEqual(['9', '9', '9']);
  });
});

describe('dashboard rules across projects', () => {
  const projects = [
    { id: 'p2024', taxYear: 2024 },
    { id: 'p2025', taxYear: 2025 },
  ];

  it('gives each year to its project, else the newest before, else the oldest', () => {
    expect(yearOwner(projects, 2025)).toBe('p2025');
    expect(yearOwner(projects, 2026)).toBe('p2025');
    expect(yearOwner(projects, 2020)).toBe('p2024');
  });

  it("applies a project's corrections only within its years", () => {
    const corrections: ProjectCorrection[] = [
      {
        id: 'c1',
        projectId: 'p2024',
        createdAt: '2025-02-01T00:00:00.000Z',
        reason: 'r',
        data: { type: 'reclassify', bookingId: 'f1:1', kind: 'transfer' },
      },
      {
        id: 'c2',
        projectId: 'p2025',
        createdAt: '2025-02-01T00:00:00.000Z',
        reason: 'r',
        data: { type: 'reclassify', bookingId: 'f1:1', kind: 'income_airdrop' },
      },
      {
        id: 'c3',
        projectId: 'p2025',
        createdAt: '2025-02-01T00:00:00.000Z',
        reason: 'r',
        data: { type: 'reclassify', bookingId: 'gone', kind: 'spam' },
      },
    ];
    expect(
      dashboardCorrections(projects, corrections, bookings).map((c) => c.id),
    ).toEqual(['c2']);
  });

  it('keeps overrides only from the project of their year', () => {
    const manual = (date: string): RateEntry => ({
      kind: 'price',
      asset: 'ETH',
      currency: 'CHF',
      date,
      value: '1',
      source: 'manual',
    });
    const merged = dashboardRates(
      projects,
      [
        {
          projectId: 'p2024',
          rates: [
            manual('2024-12-31'),
            manual('2025-12-31'),
            rates[1] as RateEntry,
          ],
        },
        { projectId: 'p2025', rates: [rates[1] as RateEntry] },
      ],
      [usd('ETH', '2026-01-01', '5')],
    );
    expect(merged).toEqual([
      manual('2024-12-31'),
      rates[1],
      usd('ETH', '2026-01-01', '5'),
    ]);
  });
});
