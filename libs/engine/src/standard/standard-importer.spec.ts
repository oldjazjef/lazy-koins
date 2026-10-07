import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Decimal, toDecimalString } from '../money/decimal';
const str = (value: Decimal | undefined) =>
  value === undefined ? undefined : toDecimalString(value);

import { csvSourceFile, parseCsv } from '../importers/text/csv';
import type { SourceFile } from '../importers/importer';
import { defaultImporterRegistry } from '../importers/registry';
import { standardImporter } from './standard-importer';
import {
  BOOKING_COLUMNS,
  columnNames,
  HOLDING_COLUMNS,
} from './standard-format';
import {
  standardTemplateCsv,
  TEMPLATE_SHEETS,
  templateContent,
} from './template';

function fixture(name: string): SourceFile {
  const bytes = readFileSync(
    fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)),
  );
  return csvSourceFile({ id: 'sha-std', name, bytes: new Uint8Array(bytes) });
}

describe('standard format importer', () => {
  it('detects both record types and nothing else', () => {
    expect(standardImporter.detect(fixture('standard-buchungen.csv'))).toBe(1);
    expect(standardImporter.detect(fixture('standard-bestaende.csv'))).toBe(1);
    const lookalike: SourceFile = {
      id: 'x',
      name: 'x.csv',
      kind: 'csv',
      sheets: [
        { name: 'x', rows: [['Zeitpunkt', 'Plattform', 'Asset', 'Menge']] },
      ],
    };
    expect(standardImporter.detect(lookalike)).toBe(0);
    expect(
      defaultImporterRegistry().detect(fixture('standard-buchungen.csv')),
    ).toMatchObject({
      status: 'match',
      importer: standardImporter,
    });
  });

  it('reads Buchungen: UTC, every column, 18 decimals, rows; bad rows become errors', () => {
    const result = standardImporter.parse(fixture('standard-buchungen.csv'));
    expect(result.bookings.map((b) => b.row)).toEqual([2, 3, 4, 7]);
    const [deposit, withdrawal, staking, spam] = result.bookings;
    expect(deposit).toMatchObject({
      platform: 'ledger-nano',
      accountId: 'main',
      timestamp: '2024-12-31T23:00:00.000Z',
      kind: 'deposit',
      asset: 'BTC',
      note: 'Anfangsbestand (synthetisch)',
      sourceFileId: 'sha-std',
      rawType: 'deposit',
    });
    expect(str(withdrawal?.quantity)).toBe('-0.1');
    expect(str(withdrawal?.fee)).toBe('0.0001');
    expect(str(staking?.quantity)).toBe('0.123456789012345678');
    expect(str(staking?.priceChf)).toBe('4.2');
    expect(spam?.kind).toBe('spam');
    expect(deposit?.raw?.['Notiz']).toBe('Anfangsbestand (synthetisch)');
    expect(result.errors).toEqual([
      { row: 5, code: 'timeZoneMissing', column: 'Zeitpunkt' },
      { row: 6, code: 'invalidKind', column: 'Art' },
    ]);
    expect(result.period).toEqual({ from: '2024-12-31', to: '2025-12-31' });
  });

  it('reads Bestände, accepting a comma decimal', () => {
    const result = standardImporter.parse(fixture('standard-bestaende.csv'));
    expect(result.errors).toEqual([]);
    expect(result.holdings).toHaveLength(2);
    expect(result.holdings[0]).toMatchObject({
      asset: 'BTC',
      asOf: '2025-12-31',
      row: 2,
    });
    expect(str(result.holdings[1]?.quantity)).toBe('0.123456789012345678');
  });

  it('reads both sheets of a workbook and reports the sheet with an error', () => {
    const file: SourceFile = {
      id: 'wb',
      name: 'vorlage.xlsx',
      kind: 'xlsx',
      sheets: [
        { name: 'Erklärung', rows: [['Text']] },
        {
          name: 'Buchungen',
          rows: [
            columnNames(BOOKING_COLUMNS),
            [
              '2025-01-01T00:00:00Z',
              'kraken',
              '',
              'trade',
              'btc',
              '0.1',
              '',
              '',
              '',
              '',
              'T1',
              '',
            ],
            [
              '2025-01-01T00:00:00Z',
              'kraken',
              '',
              'trade',
              'CHF',
              'zehn',
              '',
              '',
              '',
              '',
              'T1',
              '',
            ],
          ],
        },
        {
          name: 'Bestände',
          rows: [
            columnNames(HOLDING_COLUMNS),
            ['kraken', '', 'BTC', '0.1', '31.12.2025', '', '', ''],
          ],
        },
      ],
    };
    const result = standardImporter.parse(file);
    expect(result.bookings).toHaveLength(1);
    expect(result.bookings[0]).toMatchObject({
      asset: 'BTC',
      accountId: 'main',
      group: 'T1',
    });
    expect(result.errors).toEqual([
      { row: 3, code: 'invalidNumber', column: 'Menge', sheet: 'Buchungen' },
      { row: 2, code: 'invalidDate', column: 'Stichtag', sheet: 'Bestände' },
    ]);
  });
});

describe('template', () => {
  it('is a valid standard file itself (examples included)', () => {
    for (const type of ['bookings', 'holdings'] as const) {
      const text = standardTemplateCsv(type);
      const file: SourceFile = {
        id: 't',
        name: 't.csv',
        kind: 'csv',
        sheets: [{ name: 't', rows: parseCsv(text) }],
      };
      const result = standardImporter.parse(file);
      expect(result.errors).toEqual([]);
      const records = type === 'bookings' ? result.bookings : result.holdings;
      expect(records).toHaveLength(TEMPLATE_SHEETS[type].examples.length);
    }
  });

  it('in English: German headers (the format), English notes, the same records (F11.2)', () => {
    const read = (text: string) =>
      standardImporter.parse({
        id: 't',
        name: 't.csv',
        kind: 'csv',
        sheets: [{ name: 't', rows: parseCsv(text) }],
      });
    for (const type of ['bookings', 'holdings'] as const) {
      const german = standardTemplateCsv(type);
      const english = standardTemplateCsv(type, 'en');
      expect(english.split('\r\n')[0]).toBe(german.split('\r\n')[0]);
      const de = read(german);
      const en = read(english);
      expect(en.errors).toEqual([]);
      const facts = (records: readonly object[]) =>
        records.map((record) => {
          const r = record as Record<string, unknown>;
          return [
            r['timestamp'] ?? r['asOf'],
            r['kind'],
            r['asset'],
            r['quantity'],
          ];
        });
      expect(facts(en.bookings)).toEqual(facts(de.bookings));
      expect(facts(en.holdings)).toEqual(facts(de.holdings));
      expect(en.bookings.length + en.holdings.length).toBeGreaterThan(0);
    }
    expect(standardTemplateCsv('bookings', 'en')).toContain('Buy BTC');
    expect(standardTemplateCsv('bookings', 'en')).not.toContain('Kauf BTC');

    const content = templateContent('en');
    expect(content.explanationSheet).toBe('Explanation');
    expect(content.explanation.join(' ')).toMatch(/stay German/);
    expect(content.bookings.name).toBe('Buchungen');
    expect(content.holdings.name).toBe('Bestände');
    expect(content.bookings.columns.map((c) => c.name)).toEqual(
      TEMPLATE_SHEETS.bookings.columns.map((c) => c.name),
    );
    expect(
      content.bookings.columns.every(
        (c) => !/[äöü]/.test(c.description.replace(/\([^)]*\)/g, '')),
      ),
    ).toBe(true);
  });
});
