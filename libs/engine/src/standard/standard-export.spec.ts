import type { Booking, Holding } from '../bookings/booking';
import type { Correction } from '../corrections/corrections';
import { csvSourceFile } from '../importers/text/csv';
import { parseDecimal, toDecimalString } from '../money/decimal';
import { chRules } from '../rules/country-rules';
import { standardExport } from './standard-export';
import { parseStandardFile } from './standard-importer';
import { toCsv } from './template';

/** Synthetic records only. */
const bookings: Booking[] = [
  {
    id: 'sha1:spot:2',
    sourceFileId: 'sha1',
    row: 2,
    platform: 'kraken',
    accountId: 'spot',
    timestamp: '2025-03-01T13:30:00.000Z',
    asset: 'BTC',
    quantity: parseDecimal('0.123456789012345678'),
    kind: 'trade',
    fee: parseDecimal('0.0001'),
    feeAsset: 'BTC',
    priceUsd: parseDecimal('80000'),
    group: 'T-1',
    note: 'Kauf, mit "Komma"',
    rawType: 'trade/buy',
  },
  {
    id: 'sha1:spot:3',
    sourceFileId: 'sha1',
    row: 3,
    platform: 'kraken',
    accountId: 'earn',
    timestamp: '2025-05-02T00:00:00.000Z',
    asset: 'DOT',
    quantity: parseDecimal('1.5'),
    kind: 'unknown',
    priceChf: parseDecimal('4.2'),
    rawType: 'earn/reward',
  },
];
const holdings: Holding[] = [
  {
    id: 'sha2::2',
    sourceFileId: 'sha2',
    row: 2,
    platform: 'ledger',
    accountId: 'main',
    asset: 'ETH',
    quantity: parseDecimal('2.5'),
    asOf: '2025-12-31',
    priceChf: parseDecimal('3000'),
    evidence: 'Screenshot',
  },
];
const corrections: Correction[] = [
  {
    id: 'c1',
    createdAt: '2025-06-01T00:00:00.000Z',
    reason: 'Staking',
    data: {
      type: 'reclassify',
      bookingId: 'sha1:spot:3',
      kind: 'income_staking',
    },
  },
];

const input = {
  rules: chRules,
  bookings,
  holdings,
  corrections,
  rates: [
    {
      kind: 'fx' as const,
      asset: 'USD',
      currency: 'CHF' as const,
      date: '2025-03-01',
      value: '0.9',
      source: 'ecb' as const,
    },
  ],
  fileNames: { sha1: 'kraken.csv', sha2: 'ledger.csv' },
};

function reimport(header: readonly string[], rows: readonly (readonly string[])[]) {
  const bytes = new TextEncoder().encode(toCsv([header, ...rows]));
  return parseStandardFile(
    csvSourceFile({ id: 'again', name: 'again.csv', bytes }),
  );
}

describe('standard export (F10.7)', () => {
  it('writes the template columns plus corrections, price used and origin', () => {
    const out = standardExport(input);
    expect(out.bookings.header.slice(0, 12)).toEqual([
      'Zeitpunkt',
      'Plattform',
      'Konto',
      'Art',
      'Asset',
      'Menge',
      'Gebühr',
      'Gebühr-Asset',
      'Preis CHF',
      'Preis USD',
      'Referenz',
      'Notiz',
    ]);
    const [trade, reward] = out.bookings.rows;
    expect(trade?.slice(12)).toEqual([
      'trade/buy',
      '',
      '72000',
      'recordUsd/record',
      '8888.888808888888816',
      'kraken.csv',
      '2',
    ]);
    // The reclassification is applied and named.
    expect(reward?.[3]).toBe('income_staking');
    expect(reward?.[13]).toBe('reclassify c1: unknown → income_staking');
  });

  it('filters by platform, account, asset, kind and date', () => {
    expect(
      standardExport({ ...input, filter: { asset: 'dot' } }).bookings.rows,
    ).toHaveLength(1);
    expect(
      standardExport({ ...input, filter: { kind: 'trade' } }).bookings.rows,
    ).toHaveLength(1);
    expect(
      standardExport({ ...input, filter: { from: '2025-04-01', to: '2025-12-31' } })
        .bookings.rows,
    ).toHaveLength(1);
    expect(
      standardExport({ ...input, filter: { platform: 'ledger' } }),
    ).toMatchObject({ bookings: { rows: [] }, holdings: { rows: [expect.anything()] } });
  });

  it('round trip: the export re-imports as the same records', () => {
    const out = standardExport({ ...input, corrections: [] });
    const again = reimport(out.bookings.header, out.bookings.rows);
    expect(again.errors).toEqual([]);
    const essence = (b: Booking) => ({
      platform: b.platform,
      accountId: b.accountId,
      timestamp: b.timestamp,
      asset: b.asset,
      quantity: toDecimalString(b.quantity),
      kind: b.kind === 'unknown' ? b.kind : b.kind,
      fee: b.fee ? toDecimalString(b.fee) : undefined,
      feeAsset: b.fee ? b.feeAsset : undefined,
      priceChf: b.priceChf ? toDecimalString(b.priceChf) : undefined,
      priceUsd: b.priceUsd ? toDecimalString(b.priceUsd) : undefined,
      group: b.group,
      note: b.note,
    });
    expect(again.bookings.map(essence)).toEqual(bookings.map(essence));

    const holdingsAgain = reimport(out.holdings.header, out.holdings.rows);
    expect(holdingsAgain.errors).toEqual([]);
    const h = holdingsAgain.holdings[0];
    expect(h).toMatchObject({
      platform: 'ledger',
      accountId: 'main',
      asset: 'ETH',
      asOf: '2025-12-31',
      evidence: 'Screenshot',
    });
    expect(h && toDecimalString(h.quantity)).toBe('2.5');
    expect(h?.priceChf && toDecimalString(h.priceChf)).toBe('3000');
  });
});
