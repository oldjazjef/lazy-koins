import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Booking } from '../bookings/booking';
import { type Decimal, toDecimalString } from '../money/decimal';
const str = (value: Decimal | undefined) =>
  value === undefined ? undefined : toDecimalString(value);

import { csvSourceFile } from '../importers/text/csv';
import type { SourceFile } from '../importers/importer';
import { defaultImporterRegistry } from '../importers/registry';
import {
  applyMapping,
  headerSignature,
  mappingConfidence,
  mappingFingerprint,
  mappingImporter,
} from './apply-mapping';
import { type MappingSpec, validateMappingSpec } from './mapping-spec';

/** The example mappings are test fixtures — synthetic, not shipped product code. */
function spec(name: string): MappingSpec {
  const json: unknown = JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(`./fixtures/${name}.mapping.json`, import.meta.url),
      ),
      'utf8',
    ),
  );
  const result = validateMappingSpec(json);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.spec;
}

function fixture(name: string, fileName = name): SourceFile {
  const bytes = readFileSync(
    fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)),
  );
  return csvSourceFile({
    id: 'sha-fixture',
    name: fileName,
    bytes: new Uint8Array(bytes),
  });
}

const q = (b: Booking | undefined) =>
  b ? toDecimalString(b.quantity) : undefined;
const byRow = (bookings: readonly Booking[], row: number) =>
  bookings.find((b) => b.row === row);

describe('mapping: Kraken ledger (2024+ layout with feecurrency)', () => {
  const kraken = spec('kraken-ledger');
  const file = fixture('kraken-ledger-2024.csv');
  const result = applyMapping(kraken, file);

  it('excludes the pending duplicate and books every other row, in file order', () => {
    expect(result.errors).toEqual([]);
    expect(result.notes).toEqual([{ code: 'excluded', row: 2 }]);
    expect(result.bookings.map((b) => b.row)).toEqual([
      3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ]);
  });

  it('maps type + subtype to kinds; unknown types stay as unknown', () => {
    const kinds = Object.fromEntries(
      result.bookings.map((b) => [b.row, b.kind]),
    );
    expect(kinds).toEqual({
      3: 'deposit',
      4: 'trade',
      5: 'trade',
      6: 'income_staking',
      7: 'income_interest',
      8: 'transfer',
      9: 'income_airdrop',
      10: 'trade',
      11: 'trade',
      12: 'withdrawal',
      13: 'transfer',
      14: 'unknown',
      15: 'income_staking',
    });
    expect(byRow(result.bookings, 7)?.rawType).toBe('earn/reward');
  });

  it('normalises assets and keeps the raw name', () => {
    expect(byRow(result.bookings, 5)).toMatchObject({
      asset: 'BTC',
      rawAsset: 'XXBT',
    });
    expect(byRow(result.bookings, 6)).toMatchObject({
      asset: 'DOT',
      rawAsset: 'DOT.S',
    });
    expect(byRow(result.bookings, 14)).toMatchObject({
      asset: 'EUR',
      rawAsset: 'EUR.HOLD',
    });
    expect(byRow(result.bookings, 15)).toMatchObject({
      asset: 'ETH',
      rawAsset: 'ETH2.S',
    });
    expect(byRow(result.bookings, 4)).toMatchObject({
      asset: 'CHF',
      rawAsset: 'ZCHF',
    });
  });

  it('keeps fees, honours feecurrency, and groups the legs of a trade', () => {
    const chfLeg = byRow(result.bookings, 4);
    expect(str(chfLeg?.fee)).toBe('1.3');
    expect(chfLeg?.feeAsset).toBeUndefined();
    const ethLeg = byRow(result.bookings, 10);
    expect(str(ethLeg?.fee)).toBe('0.65');
    expect(ethLeg?.feeAsset).toBe('CHF');
    expect(byRow(result.bookings, 5)?.fee).toBeUndefined();
    expect(ethLeg?.group).toBe('TSYN0002');
    expect(byRow(result.bookings, 11)?.group).toBe('TSYN0002');
    expect(str(byRow(result.bookings, 12)?.fee)).toBe('0.00005');
  });

  it('keeps 18 decimals, fractions of seconds and the raw extra columns', () => {
    expect(q(byRow(result.bookings, 7))).toBe('0.000000000000000001');
    expect(byRow(result.bookings, 10)?.timestamp).toBe(
      '2025-05-05T15:30:00.123Z',
    );
    expect(byRow(result.bookings, 4)?.raw).toMatchObject({
      amountusd: '-550.00',
      feecurrency: 'ZCHF',
      subclass: 'fiat',
    });
    expect(byRow(result.bookings, 7)?.accountId).toBe('earn / flexible');
  });

  it('turns the running balance into the latest balance per account and raw asset', () => {
    const holdings = result.holdings.map((h) => [
      h.accountId,
      h.asset,
      toDecimalString(h.quantity),
      h.asOf,
      h.row,
    ]);
    expect(holdings).toEqual([
      ['earn / bonded', 'ETH', '0.01', '2025-09-01', 15],
      ['earn / flexible', 'ETH', '0.000000000000000001', '2025-03-01', 7],
      ['earn / flexible', 'SOL', '0.5', '2025-04-01', 9],
      ['spot / main', 'DOT', '0', '2025-07-01', 13],
      ['spot / main', 'DOT', '0.123456789', '2025-02-01', 6],
      ['spot / main', 'EUR', '5', '2025-08-01', 14],
      ['spot / main', 'ETH', '0.1', '2025-05-05', 10],
      ['spot / main', 'BTC', '0.00195', '2025-06-10', 12],
      ['spot / main', 'CHF', '197.35', '2025-05-05', 11],
    ]);
    expect(result.holdings[0]?.evidence).toBe('Saldo laut Ledger');
    expect(result.period).toEqual({ from: '2024-12-20', to: '2025-09-01' });
  });

  it('reads the classic layout (no wallet column) with the same spec', () => {
    const classic = applyMapping(kraken, fixture('kraken-ledger-classic.csv'));
    expect(classic.errors).toEqual([]);
    expect(classic.bookings.map((b) => [b.asset, q(b), b.accountId])).toEqual([
      ['BTC', '0.01', 'spot / main'],
      ['EUR', '-80', 'spot / main'],
    ]);
  });
});

describe('mapping: Binance', () => {
  it('maps every operation of the CSV, UTC_Time in UTC', () => {
    const result = applyMapping(
      spec('binance-transaction-history-csv'),
      fixture('binance-transaction-history.csv'),
    );
    expect(result.errors).toEqual([]);
    expect(result.bookings.map((b) => [b.row, b.kind, b.accountId])).toEqual([
      [2, 'deposit', 'Spot'],
      [3, 'trade', 'Spot'],
      [4, 'trade', 'Spot'],
      [5, 'fee', 'Spot'],
      [6, 'income_interest', 'Earn'],
      [7, 'transfer', 'Spot'],
      [8, 'transfer', 'Earn'],
      [9, 'income_launchpool', 'Spot'],
      [10, 'income_airdrop', 'Spot'],
      [11, 'income_staking', 'Earn'],
      [12, 'transfer', 'Spot'],
      [13, 'withdrawal', 'Spot'],
      [14, 'unknown', 'Spot'],
    ]);
    expect(byRow(result.bookings, 13)?.note).toBe('synthetic, quoted remark');
    expect(byRow(result.bookings, 2)?.timestamp).toBe(
      '2025-01-05T10:00:00.000Z',
    );
  });

  const xlsx = (name: string): SourceFile => ({
    id: 'sha-xlsx',
    name,
    kind: 'xlsx',
    sheets: [
      {
        name: 'Sheet1',
        rows: [
          ['Binance Transaktionshistorie'],
          ['User ID', '10000001'],
          ['Zeitraum', '2025-01-01 - 2025-12-31'],
          [],
          [],
          [],
          [],
          [],
          [],
          [],
          [
            'User ID',
            'Time',
            'Account',
            'Operation',
            'Coin',
            'Change',
            'Remark',
          ],
          [
            '10000001',
            '25-01-01 01:30:00',
            'Spot',
            'Simple Earn Flexible Airdrop',
            'ABC',
            '1',
            '',
          ],
          [
            '10000001',
            '2025-06-01 12:00:00',
            'Spot',
            'Deposit',
            'BTC',
            'viel',
            '',
          ],
        ],
      },
    ],
  });

  it('finds the header under the preamble and takes the zone from the file name', () => {
    const mapping = spec('binance-transaktionshistorie-xlsx');
    const result = applyMapping(
      mapping,
      xlsx('Binance-Transaktionshistorie-202601011200_UTC_2_SYNTH.xlsx'),
    );
    expect(result.bookings).toHaveLength(1);
    expect(result.bookings[0]).toMatchObject({
      row: 12,
      kind: 'income_airdrop',
      timestamp: '2024-12-31T23:30:00.000Z',
    });
    expect(result.errors).toEqual([
      { row: 13, code: 'invalidNumber', column: 'Change', sheet: 'Sheet1' },
    ]);
    expect(result.notes).toEqual([]);
  });

  it('falls back to the fixed zone with a note when the name has none', () => {
    const result = applyMapping(
      spec('binance-transaktionshistorie-xlsx'),
      xlsx('export.xlsx'),
    );
    expect(result.bookings[0]?.timestamp).toBe('2025-01-01T01:30:00.000Z');
    expect(result.notes).toEqual([{ code: 'timeZoneAssumed' }]);
  });

  it('tells the CSV and XLSX layouts apart', () => {
    const csvSpec = spec('binance-transaction-history-csv');
    const xlsxSpec = spec('binance-transaktionshistorie-xlsx');
    expect(mappingConfidence(csvSpec, xlsx('a.xlsx'))).toBe(0);
    expect(
      mappingConfidence(xlsxSpec, fixture('binance-transaction-history.csv')),
    ).toBe(0);
  });
});

describe('mapping: Bitfinex ledger', () => {
  const result = applyMapping(
    spec('bitfinex-ledger'),
    fixture('bitfinex-ledger.csv'),
  );

  it('maps kinds from the description, dd-mm-YYYY dates, aliases', () => {
    expect(result.errors).toEqual([]);
    expect(result.bookings.map((b) => [b.row, b.kind])).toEqual([
      [2, 'unknown'],
      [3, 'withdrawal'],
      [4, 'fee'],
      [5, 'transfer'],
      [6, 'income_staking'],
      [7, 'fee'],
      [8, 'trade'],
      [9, 'trade'],
      [10, 'deposit'],
    ]);
    expect(byRow(result.bookings, 10)?.timestamp).toBe(
      '2025-01-03T09:00:00.000Z',
    );
    expect(byRow(result.bookings, 5)).toMatchObject({
      asset: 'USDT',
      rawAsset: 'UST',
      accountId: 'funding',
    });
  });

  it('takes the balance of the latest row per asset (newest-first file)', () => {
    const btc = result.holdings.find((h) => h.asset === 'BTC');
    expect(btc && toDecimalString(btc.quantity)).toBe('0.00960001');
    expect(btc?.asOf).toBe('2025-03-11');
  });
});

describe('mapping: Revolut crypto statement', () => {
  const result = applyMapping(
    spec('revolut-crypto-statement'),
    fixture('revolut-crypto-statement.csv'),
  );

  it('signs by side, reads named dates in Europe/Zurich and prices with currency text', () => {
    expect(result.errors).toEqual([]);
    expect(result.bookings.map((b) => [b.asset, q(b), b.kind])).toEqual([
      ['BTC', '0.001', 'trade'],
      ['ETH', '0.05', 'trade'],
      ['BTC', '-0.0004', 'trade'],
      ['DOT', '0.01234', 'income_staking'],
      ['ETH', '-0.01', 'withdrawal'],
    ]);
    expect(result.bookings[0]?.timestamp).toBe('2025-01-05T09:12:13.000Z');
    expect(result.bookings[2]?.timestamp).toBe('2025-07-01T07:00:00.000Z');
    expect(str(result.bookings[0]?.priceChf)).toBe('60000');
    expect(result.bookings[4]?.priceChf).toBeUndefined();
  });
});

describe('matching', () => {
  it('scores the right spec highest, and specs never claim foreign files', () => {
    const files = {
      kraken: fixture('kraken-ledger-2024.csv'),
      binance: fixture('binance-transaction-history.csv'),
      bitfinex: fixture('bitfinex-ledger.csv'),
      revolut: fixture('revolut-crypto-statement.csv'),
    };
    const specs = {
      kraken: spec('kraken-ledger'),
      binance: spec('binance-transaction-history-csv'),
      bitfinex: spec('bitfinex-ledger'),
      revolut: spec('revolut-crypto-statement'),
    };
    for (const [fileKey, file] of Object.entries(files)) {
      for (const [specKey, s] of Object.entries(specs)) {
        const confidence = mappingConfidence(s, file);
        if (fileKey === specKey) expect(confidence).toBeGreaterThan(0.5);
        else expect(confidence).toBe(0);
      }
    }
    // The 2024 Kraken layout has more columns than the spec names: still a match, below 1.
    expect(mappingConfidence(specs.kraken, files.kraken)).toBeCloseTo(
      0.5 + 0.5 * (10 / 16),
    );
    expect(
      mappingConfidence(specs.kraken, fixture('kraken-ledger-classic.csv')),
    ).toBe(1);
  });

  it('respects a file-name pattern, and works through the registry', () => {
    const withName = {
      ...spec('kraken-ledger'),
      match: { ...spec('kraken-ledger').match, fileName: '^ledgers' },
    };
    expect(mappingConfidence(withName, fixture('kraken-ledger-2024.csv'))).toBe(
      0,
    );
    expect(
      mappingConfidence(
        withName,
        fixture('kraken-ledger-2024.csv', 'ledgers.csv'),
      ),
    ).toBeGreaterThan(0);
    const registry = defaultImporterRegistry([
      mappingImporter('m1', spec('kraken-ledger')),
    ]);
    expect(registry.detect(fixture('kraken-ledger-classic.csv'))).toMatchObject(
      {
        status: 'match',
        importer: { id: 'mapping:m1', platform: 'kraken' },
      },
    );
  });

  it('fingerprints specs and files', () => {
    expect(mappingFingerprint(spec('kraken-ledger'))).toBe(
      'aclass|amount|asset|balance|fee|refid|subtype|time|txid|type',
    );
    expect(headerSignature(fixture('bitfinex-ledger.csv'))).toEqual([
      '#',
      'DESCRIPTION',
      'CURRENCY',
      'AMOUNT',
      'BALANCE',
      'DATE',
      'WALLET',
    ]);
  });

  it('reports a file without the header instead of throwing', () => {
    expect(
      applyMapping(spec('kraken-ledger'), fixture('bitfinex-ledger.csv'))
        .errors,
    ).toEqual([{ row: 0, code: 'headerNotFound' }]);
  });
});
