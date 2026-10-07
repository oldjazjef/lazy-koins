import type { Booking, Holding } from '../bookings/booking';
import type { Correction } from '../corrections/corrections';
import { dashboard } from '../dashboard/dashboard';
import { parseDecimal } from '../money/decimal';
import {
  RateTable,
  type RateEntry,
  unitPriceChf,
  yearlyAverageChf,
} from '../rates/rate-table';
import {
  chRules,
  defaultTaxCurrency,
  isTaxCurrency,
  withTaxCurrency,
} from '../rules/country-rules';
import { standardExport } from '../standard/standard-export';
import { calculate } from './calculate';
import { ENGINE_VERSION } from './types';

/**
 * F4.1a: the tax currency per project. Synthetic records and rates only (CLAUDE.md, Private
 * data): an EUR project end to end, cross rates, and CHF unchanged.
 */

const eurRules = withTaxCurrency(chRules, 'EUR');

const fx = (
  asset: string,
  currency: string,
  date: string,
  value: string,
  source: RateEntry['source'] = 'ecb',
): RateEntry => ({ kind: 'fx', asset, currency, date, value, source });
const price = (
  asset: string,
  currency: string,
  date: string,
  value: string,
  source: RateEntry['source'] = 'binance',
): RateEntry => ({ kind: 'price', asset, currency, date, value, source });

let seq = 0;
function booking(
  over: Partial<Omit<Booking, 'quantity'>> & { quantity: string },
): Booking {
  seq += 1;
  const { quantity, ...rest } = over;
  return {
    id: `f1:${seq}`,
    sourceFileId: 'f1',
    row: seq,
    platform: 'kraken',
    accountId: 'main',
    timestamp: '2025-06-01T12:00:00.000Z',
    asset: 'BTC',
    kind: 'trade',
    rawType: 'trade',
    ...rest,
    quantity: parseDecimal(quantity),
  } as Booking;
}

function holding(
  over: Partial<Omit<Holding, 'quantity' | 'priceChf'>> & {
    quantity: string;
    priceChf?: string;
  },
): Holding {
  seq += 1;
  const { quantity, priceChf, ...rest } = over;
  return {
    id: `s1:${seq}:holding`,
    sourceFileId: 's1',
    row: seq,
    platform: 'wallet',
    accountId: 'main',
    asset: 'BTC',
    asOf: '2025-12-31',
    ...rest,
    quantity: parseDecimal(quantity),
    priceChf: priceChf === undefined ? undefined : parseDecimal(priceChf),
  } as Holding;
}

describe('country rules and the tax currency', () => {
  it('defaults to CHF for Switzerland and keeps the CH rules for CHF', () => {
    expect(defaultTaxCurrency('CH')).toBe('CHF');
    expect(withTaxCurrency(chRules, 'CHF')).toBe(chRules);
    expect(isTaxCurrency('EUR')).toBe(true);
    expect(isTaxCurrency('eur')).toBe(false);
    expect(isTaxCurrency('XYZ')).toBe(false);
  });

  it('values in another currency with everything else of the country', () => {
    expect(eurRules.homeCurrency).toBe('EUR');
    expect(eurRules.dustThreshold).toBe(chRules.dustThreshold);
    expect(eurRules.fiat).toContain('EUR');
    expect(withTaxCurrency(chRules, 'SEK').fiat).toContain('SEK');
  });
});

describe('rate table in a tax currency (cross rates)', () => {
  const rates = [
    fx('USD', 'EUR', '2025-12-31', '0.85'),
    fx('EUR', 'CHF', '2025-12-31', '0.94'),
    fx('USD', 'CHF', '2025-12-31', '0.80'),
  ];

  it('uses the stored pair first, then the inverse, then a pivot', () => {
    const table = new RateTable(rates, 'EUR');
    expect(table.fx('USD', '2025-12-31')?.value.toString()).toBe('0.85');
    // CHF/EUR = 1 / (EUR/CHF).
    expect(
      table.fx('CHF', '2025-12-31')?.value.toDecimalPlaces(6).toString(),
    ).toBe('1.06383');
    expect(table.fx('EUR', '2025-12-31')?.value.toString()).toBe('1');
    // GBP via USD: GBP/USD × USD/EUR.
    const withGbp = new RateTable(
      [...rates, fx('GBP', 'USD', '2025-12-31', '1.25')],
      'EUR',
    );
    expect(withGbp.fx('GBP', '2025-12-31')?.value.toString()).toBe('1.0625');
  });

  it('answers CHF exactly as before (the default quote)', () => {
    const table = new RateTable(rates);
    expect(table.quote).toBe('CHF');
    expect(table.fx('USD', '2025-12-31')?.value.toString()).toBe('0.8');
    expect(table.fx('EUR', '2025-12-31')?.value.toString()).toBe('0.94');
    expect(table.fx('CHF', '2025-12-31')?.value.toString()).toBe('1');
  });

  it('never uses ESTV values or a record CHF price outside CHF', () => {
    const table = new RateTable(
      [
        ...rates,
        price('BTC', 'CHF', '2025-12-31', '70000', 'estv'),
        price('BTC', 'USD', '2025-12-31', '100000'),
      ],
      'EUR',
    );
    const quote = unitPriceChf(table, eurRules, 'BTC', '2025-12-31', {
      priceChf: parseDecimal('1'),
    });
    expect(quote?.origin).toBe('tableUsd');
    expect(quote?.priceChf.toString()).toBe('85000');
    const chfTable = new RateTable(
      [...rates, price('BTC', 'CHF', '2025-12-31', '70000', 'estv')],
      'CHF',
    );
    expect(unitPriceChf(chfTable, chRules, 'BTC', '2025-12-31')?.origin).toBe(
      'estv',
    );
  });

  it('prefers a stored price in the tax currency and an override in it', () => {
    const table = new RateTable(
      [
        ...rates,
        price('ETH', 'EUR', '2025-12-31', '2500', 'coingecko'),
        price('ETH', 'USD', '2025-12-31', '3000'),
        price('SOL', 'EUR', '2025-12-31', '150', 'manual'),
        price('SOL', 'USD', '2025-12-31', '200'),
      ],
      'EUR',
    );
    expect(unitPriceChf(table, eurRules, 'ETH', '2025-12-31')).toMatchObject({
      origin: 'tableChf',
      source: 'coingecko',
    });
    expect(
      unitPriceChf(table, eurRules, 'SOL', '2025-12-31')?.priceChf.toString(),
    ).toBe('150');
    expect(
      unitPriceChf(table, eurRules, 'USDT', '2025-12-31')?.priceChf.toString(),
    ).toBe('0.85');
    expect(unitPriceChf(table, eurRules, 'EUR', '2025-12-31')?.origin).toBe(
      'home',
    );
  });

  it('averages USD/T for pegged assets, also through a cross rate', () => {
    const direct = new RateTable(
      [
        fx('USD', 'EUR', '2025-03-01', '0.9'),
        fx('USD', 'EUR', '2025-09-01', '0.8'),
      ],
      'EUR',
    );
    expect(yearlyAverageChf(direct, eurRules, 'USDC', 2025)?.toString()).toBe(
      '0.85',
    );
    const cross = new RateTable(
      [
        fx('EUR', 'USD', '2025-03-01', '1.25'),
        fx('EUR', 'USD', '2025-09-01', '1'),
      ],
      'EUR',
    );
    expect(yearlyAverageChf(cross, eurRules, 'USDC', 2025)?.toString()).toBe(
      '0.9',
    );
  });
});

describe('an EUR project end to end', () => {
  const rates: RateEntry[] = [
    fx('USD', 'EUR', '2025-06-01', '0.9'),
    fx('USD', 'EUR', '2025-12-31', '0.85'),
    fx('EUR', 'EUR', '2025-12-31', '1'),
    price('BTC', 'USD', '2025-12-31', '100000'),
    price('DOT', 'USD', '2025-06-01', '5'),
    price('DOT', 'USD', '2025-12-31', '4'),
    // A CHF rate stored for another reason must not leak into an EUR valuation.
    price('BTC', 'CHF', '2025-12-31', '1', 'estv'),
  ];
  const bookings = [
    booking({ asset: 'BTC', quantity: '0.5' }),
    booking({ asset: 'DOT', quantity: '100' }),
    booking({ asset: 'USDT', quantity: '1000' }),
    booking({
      asset: 'DOT',
      quantity: '10',
      kind: 'income_staking',
      rawType: 'staking',
    }),
  ];
  const corrections: Correction[] = [
    {
      id: 'c1',
      createdAt: '2026-01-10T00:00:00.000Z',
      reason: 'Test',
      data: {
        type: 'price_override',
        asset: 'USDT',
        date: '2025-12-31',
        priceChf: '0.9',
      },
    },
  ];

  it('values positions, income and parameters in EUR', () => {
    const result = calculate({
      taxYear: 2025,
      rules: eurRules,
      bookings,
      holdings: [],
      corrections,
      rates,
    });
    expect(result.engineVersion).toBe(ENGINE_VERSION);
    expect(result.currency).toBe('EUR');
    const value = (asset: string) =>
      result.positions.find((p) => p.asset === asset)?.valueChf;
    // 0.5 × 100000 USD × 0.85.
    expect(value('BTC')).toBe('42500');
    // 110 DOT × 4 USD × 0.85.
    expect(value('DOT')).toBe('374');
    // The override is in EUR.
    expect(value('USDT')).toBe('900');
    expect(result.totals.wealthChf).toBe('43774');
    // 10 DOT × 5 USD × 0.9 at arrival.
    expect(result.income[0]?.valueChf).toBe('45');
    expect(result.totals.incomeChf).toBe('45');
    expect(result.parameters.usdChf).toBe('0.85');
    expect(result.parameters.eurChf).toBe('1');
  });

  it('labels the data export with the currency', () => {
    const exported = standardExport({
      rules: eurRules,
      bookings,
      holdings: [holding({ quantity: '1' })],
      corrections,
      rates,
      fileNames: {},
    });
    expect(exported.bookings.header).toContain('Wert EUR');
    expect(exported.bookings.header).toContain('Kurs EUR verwendet');
    expect(exported.bookings.header).not.toContain('Wert CHF');
  });

  it('runs the dashboard in EUR', () => {
    const result = dashboard({
      rules: eurRules,
      bookings,
      holdings: [],
      corrections: [],
      rates,
      from: '2025-12-31',
      to: '2025-12-31',
    });
    expect(result.currency).toBe('EUR');
    // BTC 42500 + DOT 374 + USDT 850 (pegged, 1 USD × 0.85).
    expect(result.endValueChf).toBe('43724');
  });
});

describe('a CHF project stays unchanged', () => {
  it('reports CHF and the same values as before', () => {
    const result = calculate({
      taxYear: 2025,
      rules: chRules,
      bookings: [booking({ asset: 'BTC', quantity: '1' })],
      holdings: [],
      corrections: [],
      rates: [
        fx('USD', 'CHF', '2025-12-31', '0.8'),
        price('BTC', 'USD', '2025-12-31', '100000'),
      ],
    });
    expect(result.currency).toBe('CHF');
    expect(result.totals.wealthChf).toBe('80000');
    expect(result.parameters.usdChf).toBe('0.8');
  });
});
