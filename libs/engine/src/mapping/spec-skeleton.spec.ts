import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { csvSourceFile } from '../importers/text/csv';
import { decodeText } from '../importers/text/decode-text';
import { applyMapping } from './apply-mapping';
import { validateMappingSpec } from './mapping-spec';
import { buildMappingSample, guessDelimiter } from './sample';
import {
  guessDateFormat,
  guessNumbers,
  platformFromFileName,
  type SkeletonSource,
  specSkeleton,
  suggestColumns,
} from './spec-skeleton';

/** A synthetic fixture read the way the API reads a sample file. */
function sampleOf(name: string) {
  const bytes = new Uint8Array(
    readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))),
  );
  const delimiter = guessDelimiter(decodeText(bytes).text);
  const source = csvSourceFile(
    { id: 'a'.repeat(64), name, bytes },
    { delimiter },
  );
  return {
    source,
    sample: buildMappingSample(source, { encoding: 'utf-8', delimiter }),
  };
}

function skeletonSource(name: string): SkeletonSource {
  const { sample } = sampleOf(name);
  const header = sample.headerRowGuess - 1;
  return {
    fileName: sample.fileName,
    fileKind: sample.fileKind,
    delimiter: sample.delimiter,
    headers: sample.rows[header] ?? [],
    rows: sample.rows.slice(header + 1),
    distinctValues: sample.distinctValues,
  };
}

describe('suggestColumns', () => {
  it('finds the roles of the Kraken ledger by their names', () => {
    expect(
      suggestColumns(
        [
          'txid',
          'refid',
          'time',
          'type',
          'subtype',
          'aclass',
          'asset',
          'wallet',
          'amount',
          'fee',
          'balance',
          'amountusd',
          'feeusd',
          'feecurrency',
        ],
        [{ column: 'type', values: ['deposit', 'trade'] }],
      ),
    ).toEqual({
      timestamp: 'time',
      asset: 'asset',
      quantity: 'amount',
      fee: 'fee',
      feeAsset: 'feecurrency',
      kind: 'type',
      account: 'wallet',
      group: 'refid',
    });
  });

  it('gives a column to one role only and leaves unknown roles out', () => {
    const columns = suggestColumns(['Datum', 'Betrag', 'Währung', 'Notiz']);
    expect(columns).toEqual({
      timestamp: 'Datum',
      quantity: 'Betrag',
      asset: 'Währung',
      note: 'Notiz',
    });
  });

  it('takes separate in/out columns', () => {
    expect(
      suggestColumns(['Date', 'Received Quantity', 'Sent Quantity', 'Coin']),
    ).toMatchObject({
      inColumn: 'Received Quantity',
      outColumn: 'Sent Quantity',
    });
  });

  it('prefers a category column for the kind; free text only when it repeats', () => {
    expect(
      suggestColumns(
        ['Description', 'Category'],
        [{ column: 'Category', values: ['a'] }],
      ).kind,
    ).toBe('Category');
    expect(
      suggestColumns(
        ['DESCRIPTION', 'CURRENCY'],
        [{ column: 'CURRENCY', values: ['BTC'] }],
      ).kind,
    ).toBeUndefined();
  });
});

describe('guessDateFormat / guessNumbers / platformFromFileName', () => {
  it('reads the date format from the cells', () => {
    expect(guessDateFormat(['2025-01-05 10:00:00'])).toBe('ymd');
    expect(guessDateFormat(['11-03-2025 08:00:00'])).toBe('dmy');
    expect(guessDateFormat(['05.01.2025'])).toBe('dmy');
    expect(guessDateFormat(['3/1/2025 1:00:00 PM'])).toBe('mdy');
    expect(guessDateFormat(['3/13/2025'])).toBe('mdy');
    expect(guessDateFormat(['13/3/2025'])).toBe('dmy');
    expect(guessDateFormat(['Jan 5, 2025, 10:12:13 AM'])).toBe('named');
    expect(guessDateFormat(['1736071200'])).toBe('unix');
    expect(guessDateFormat(['1736071200000'])).toBe('unixMs');
    expect(guessDateFormat([])).toBe('ymd');
  });

  it('reads decimal mark, grouping and currency text from the cells', () => {
    expect(guessNumbers(['0.005', '-475.00'])).toEqual({
      decimal: '.',
      thousands: [],
      stripText: false,
    });
    expect(guessNumbers(['CHF 60,000.00', 'CHF 0.90'])).toEqual({
      decimal: '.',
      thousands: [','],
      stripText: true,
    });
    expect(guessNumbers(['0,00500000', '1.234,5'])).toEqual({
      decimal: ',',
      thousands: ['.'],
      stripText: false,
    });
    expect(guessNumbers(["1'234.50"]).thousands).toEqual(["'"]);
  });

  it('names the platform after the first word of the file name', () => {
    expect(platformFromFileName('kraken-ledger-2024.csv')).toBe('kraken');
    expect(platformFromFileName('Binance_Transaktionen.xlsx')).toBe('binance');
    expect(platformFromFileName('2025 export.csv')).toBe('export');
    expect(platformFromFileName('.csv')).toBe('');
  });
});

describe('specSkeleton (Vorlage aus Datei)', () => {
  it('pre-fills the Kraken ledger: fingerprint, columns, one unknown rule per type', () => {
    const skeleton = specSkeleton(skeletonSource('kraken-ledger-2024.csv'));
    expect(skeleton.platform).toBe('kraken');
    expect(skeleton.match.headers).toContain('refid');
    expect(skeleton.source).toEqual({ encoding: 'auto', delimiter: ',' });
    expect(skeleton.bookings).toMatchObject({
      timestamp: { column: 'time', format: 'ymd', timeZone: 'UTC' },
      asset: { column: 'asset' },
      quantity: { mode: 'signed', column: 'amount' },
      fee: { column: 'fee', assetColumn: 'feecurrency' },
      account: { column: 'wallet', value: 'main' },
      group: { column: 'refid' },
      kind: { columns: ['type'], default: 'unknown' },
    });
    const rules = skeleton.bookings?.kind.rules ?? [];
    expect(rules.length).toBeGreaterThan(1);
    expect(rules.every((rule) => rule.kind === 'unknown')).toBe(true);
    expect(rules.map((rule) => rule.equals?.[0])).toContain('trade');
  });

  it('is a valid spec for a simple export: every row read, every kind unknown', () => {
    const { source } = sampleOf('revolut-crypto-statement.csv');
    const skeleton = specSkeleton(
      skeletonSource('revolut-crypto-statement.csv'),
    );
    expect(skeleton.numbers).toMatchObject({ stripText: true });
    expect(skeleton.bookings?.timestamp.format).toBe('named');
    const validation = validateMappingSpec(skeleton);
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    const result = applyMapping(validation.spec, source);
    expect(result.errors).toEqual([]);
    expect(result.bookings.length).toBeGreaterThan(0);
    expect(new Set(result.bookings.map((b) => b.kind))).toEqual(
      new Set(['unknown']),
    );
  });

  it('leaves a role without a fitting column empty, so validation names it', () => {
    const skeleton = specSkeleton({
      fileName: 'odd.csv',
      fileKind: 'csv',
      headers: ['Foo', 'Bar'],
      rows: [],
      distinctValues: [],
    });
    expect(skeleton.bookings?.asset.column).toBe('');
    const validation = validateMappingSpec(skeleton);
    expect(validation.ok).toBe(false);
    if (validation.ok) return;
    expect(validation.issues.map((issue) => issue.path)).toContain(
      'bookings.asset.column',
    );
  });

  it('names the sheet of a workbook and is deterministic', () => {
    const input: SkeletonSource = {
      fileName: 'binance.xlsx',
      fileKind: 'xlsx',
      sheet: 'Data',
      headers: ['UTC_Time', 'Operation', 'Coin', 'Change'],
      rows: [['2025-01-01 00:00:00', 'Deposit', 'BTC', '1']],
      distinctValues: [{ column: 'Operation', values: ['Deposit', 'Buy'] }],
    };
    const skeleton = specSkeleton(input);
    expect(skeleton.source).toEqual({ encoding: 'auto', sheet: 'Data' });
    expect(skeleton.bookings?.kind.rules).toEqual([
      { equals: ['Deposit'], kind: 'unknown' },
      { equals: ['Buy'], kind: 'unknown' },
    ]);
    expect(specSkeleton(input)).toEqual(skeleton);
  });
});
