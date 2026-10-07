import { validateCorrectionData } from '../corrections/corrections';
import { chRules } from '../rules/country-rules';
import { parseKursliste } from './kursliste';
import {
  daysBetween,
  preferFetchedSources,
  type RateEntry,
  RateTable,
  unitPriceChf,
  yearlyAverageChf,
} from './rate-table';

describe('rate table', () => {
  it('prefers a manual rate over ESTV over fetched sources on the same day', () => {
    const table = new RateTable([
      {
        kind: 'price',
        asset: 'btc',
        currency: 'CHF',
        date: '2025-12-31',
        value: '1',
        source: 'coingecko',
      },
      {
        kind: 'price',
        asset: 'BTC',
        currency: 'CHF',
        date: '2025-12-31',
        value: '2',
        source: 'estv',
      },
      {
        kind: 'price',
        asset: 'BTC',
        currency: 'CHF',
        date: '2025-12-31',
        value: '3',
        source: 'manual',
      },
    ]);
    expect(
      table.lookup('price', 'BTC', 'CHF', '2025-12-31', 0)?.value.toString(),
    ).toBe('3');
    expect(unitPriceChf(table, chRules, 'BTC', '2025-12-31')?.origin).toBe(
      'override',
    );
  });

  it('counts days across month and year ends', () => {
    expect(daysBetween('2025-12-17', '2025-12-31')).toBe(14);
    expect(daysBetween('2025-12-31', '2026-01-14')).toBe(14);
  });

  it('averages the daily USD close × USD/CHF of the year', () => {
    const table = new RateTable([
      {
        kind: 'fx',
        asset: 'USD',
        currency: 'CHF',
        date: '2025-01-02',
        value: '0.9',
        source: 'ecb',
      },
      {
        kind: 'price',
        asset: 'ETH',
        currency: 'USD',
        date: '2025-01-02',
        value: '1000',
        source: 'binance',
      },
      {
        kind: 'price',
        asset: 'ETH',
        currency: 'USD',
        date: '2025-01-03',
        value: '2000',
        source: 'binance',
      },
      {
        kind: 'price',
        asset: 'ETH',
        currency: 'USD',
        date: '2024-12-31',
        value: '9999',
        source: 'binance',
      },
    ]);
    expect(yearlyAverageChf(table, chRules, 'ETH', 2025)?.toString()).toBe(
      '1350',
    );
    expect(yearlyAverageChf(table, chRules, 'XYZ', 2025)).toBeUndefined();
  });
});

const BOM = String.fromCharCode(0xfeff);

describe('ESTV Kursliste import', () => {
  it('reads the documented CSV with header, Swiss numbers and both date forms', () => {
    const result = parseKursliste(
      BOM +
        "asset;kurs_chf;datum\nBTC;85'000.50;2025-12-31\neth;3000,25;31.12.2025\nSOL;;\nADA;0.5\n",
      2025,
    );
    expect(result.entries).toEqual([
      {
        kind: 'price',
        asset: 'ADA',
        currency: 'CHF',
        date: '2025-12-31',
        value: '0.5',
        source: 'estv',
      },
      {
        kind: 'price',
        asset: 'BTC',
        currency: 'CHF',
        date: '2025-12-31',
        value: '85000.5',
        source: 'estv',
      },
      {
        kind: 'price',
        asset: 'ETH',
        currency: 'CHF',
        date: '2025-12-31',
        value: '3000.25',
        source: 'estv',
      },
    ]);
    expect(result.skipped).toBe(1);
  });

  it('reads an XML Kursliste tolerantly (symbol on the element, value on it or a child)', () => {
    const xml = `<?xml version="1.0"?>
      <kursliste year="2025">
        <cryptocurrency symbol="BTC" name="Bitcoin">
          <yearend date="2025-12-31" taxValueCHF="85000.12"/>
        </cryptocurrency>
        <cryptocurrency symbol="ETH" kurs="3000.5" />
        <cryptocurrency symbol="NOPE"><note text="none"/></cryptocurrency>
      </kursliste>`;
    const result = parseKursliste(xml, 2025);
    expect(result.entries.map((e) => [e.asset, e.value, e.date])).toEqual([
      ['BTC', '85000.12', '2025-12-31'],
      ['ETH', '3000.5', '2025-12-31'],
    ]);
    expect(result.skipped).toBe(1);
  });
});

describe('correction validation', () => {
  it('accepts the documented shapes and normalises assets', () => {
    expect(
      validateCorrectionData({
        type: 'price_override',
        asset: 'eth',
        date: '2025-12-31',
        priceChf: '2500.5',
      }),
    ).toEqual({
      ok: true,
      data: {
        type: 'price_override',
        asset: 'ETH',
        date: '2025-12-31',
        priceChf: '2500.5',
      },
    });
  });

  it('refuses numbers, unknown kinds and bad dates', () => {
    const result = validateCorrectionData({
      type: 'manual_booking',
      booking: {
        platform: 'x',
        timestamp: '2025-01-01',
        asset: 'BTC',
        quantity: 1,
        kind: 'gift',
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.issues.map((i) => i.path).sort()).toEqual([
        'booking.kind',
        'booking.quantity',
        'booking.timestamp',
      ]);
  });
});

describe('preferFetchedSources (price sources phase 2: the provider order of the user)', () => {
  const price = (
    source: RateEntry['source'],
    date: string,
    value: string,
    currency = 'USD',
  ): RateEntry => ({
    kind: 'price',
    asset: 'BTC',
    currency,
    date,
    value,
    source,
  });

  it('keeps per asset and day only the best-ranked fetched source, across currencies', () => {
    const rows = [
      price('coingecko', '2025-12-31', '80000', 'CHF'),
      price('binance', '2025-12-31', '100000'),
      price('kraken', '2025-12-31', '99000'),
    ];
    expect(
      preferFetchedSources(rows, ['kraken', 'binance']).map((r) => r.source),
    ).toEqual(['kraken']);
    expect(
      preferFetchedSources(rows, ['coingecko', 'kraken']).map((r) => r.source),
    ).toEqual(['coingecko']);
  });

  it('lets a lower-ranked source fill the days the preferred one lacks', () => {
    const rows = [
      price('binance', '2025-12-30', '1'),
      price('defillama', '2025-12-30', '2'),
      price('defillama', '2025-12-31', '3'),
    ];
    expect(
      preferFetchedSources(rows, ['binance', 'defillama']).map(
        (r) => `${r.source}:${r.date}`,
      ),
    ).toEqual(['binance:2025-12-30', 'defillama:2025-12-31']);
  });

  it('never touches overrides, ESTV values or exchange rates; unknown sources rank after the order', () => {
    const rows: RateEntry[] = [
      price('manual', '2025-12-31', '5', 'CHF'),
      price('estv', '2025-12-31', '6', 'CHF'),
      {
        kind: 'fx',
        asset: 'USD',
        currency: 'CHF',
        date: '2025-12-31',
        value: '0.8',
        source: 'ecb',
      },
      price('coinbase', '2025-12-31', '7'),
      price('bitfinex', '2025-12-31', '8'),
    ];
    expect(
      preferFetchedSources(rows, ['binance']).map((r) => r.source),
    ).toEqual(['manual', 'estv', 'ecb', 'bitfinex']);
  });

  it('is deterministic for the same rows in another input order', () => {
    const rows = [
      price('coinpaprika', '2025-06-01', '1'),
      price('coinmarketcap', '2025-06-01', '2'),
    ];
    const order = ['coinmarketcap', 'coinpaprika'];
    expect(preferFetchedSources(rows, order)).toEqual(
      preferFetchedSources([...rows].reverse(), order),
    );
  });
});
