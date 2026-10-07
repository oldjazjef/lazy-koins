import { describe, expect, it } from 'vitest';
import { csvSourceFile } from '../importers/text/csv';
import type { SourceFile } from '../importers/importer';
import { type MappingSpec, validateMappingSpec } from './mapping-spec';
import { isSuggestable, mappingSimilarity } from './similarity';

function csv(name: string, text: string): SourceFile {
  return csvSourceFile({
    id: 'sha',
    name,
    bytes: new TextEncoder().encode(text),
  });
}

function spec(
  headers: string[],
  extra: Partial<{ fileName: string; platform: string }> = {},
): MappingSpec {
  const result = validateMappingSpec({
    format: 'lazy-koins-mapping',
    version: 1,
    name: 'Test',
    platform: extra.platform ?? 'exampleex',
    match: { headers, ...(extra.fileName ? { fileName: extra.fileName } : {}) },
    bookings: {
      timestamp: { column: headers[0], format: 'iso', timeZone: 'UTC' },
      asset: { column: headers[1] },
      quantity: { mode: 'signed', column: headers[2] },
      kind: { columns: [headers[3]], rules: [] },
    },
  });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.spec;
}

const FULL = 'Time,Coin,Amount,Type,Note\n2025-01-01T00:00:00Z,BTC,1,buy,x\n';

describe('mappingSimilarity (F5.19)', () => {
  it('a spec that reads the file is a full match with coverage 1', () => {
    const similarity = mappingSimilarity(
      spec(['Time', 'Coin', 'Amount', 'Type']),
      csv('export.csv', FULL),
    );
    expect(similarity.confidence).toBeGreaterThan(0);
    expect(similarity.coverage).toBe(1);
    expect(similarity.missing).toEqual([]);
    expect(isSuggestable(similarity)).toBe(true);
  });

  it('a near match names the missing headers and never counts as readable', () => {
    const similarity = mappingSimilarity(
      spec(['Time', 'Coin', 'Amount', 'Type', 'Fee']),
      csv('export.csv', FULL),
    );
    expect(similarity.confidence).toBe(0);
    expect(similarity.coverage).toBe(0.8);
    expect(similarity.missing).toEqual(['Fee']);
    expect(isSuggestable(similarity)).toBe(true);
  });

  it('finds the header row below a preamble', () => {
    const similarity = mappingSimilarity(
      spec(['Time', 'Coin', 'Amount', 'Type', 'Fee']),
      csv('export.csv', `Report for someone\n\n${FULL}`),
    );
    expect(similarity.matched).toBe(4);
  });

  it('too little in common is not suggested', () => {
    const similarity = mappingSimilarity(
      spec(['Time', 'Asset', 'Qty', 'Kind', 'Fee']),
      csv('export.csv', FULL),
    );
    expect(similarity.matched).toBe(1);
    expect(isSuggestable(similarity)).toBe(false);
  });

  it('a file-name pattern that does not fit lowers the score and blocks a full match', () => {
    const headers = ['Time', 'Coin', 'Amount', 'Type'];
    const plain = mappingSimilarity(spec(headers), csv('a.csv', FULL));
    const named = mappingSimilarity(
      spec(headers, { fileName: '^ledger' }),
      csv('a.csv', FULL),
    );
    expect(named.fileNameMatches).toBe(false);
    expect(named.confidence).toBe(0);
    expect(named.score).toBeLessThan(plain.score);
    expect(isSuggestable(named)).toBe(true);
  });

  it('the platform in the file name ranks higher', () => {
    const headers = ['Time', 'Coin', 'Amount', 'Type'];
    const named = mappingSimilarity(
      spec(headers, { platform: 'kraken' }),
      csv('kraken-2025.csv', FULL),
    );
    const other = mappingSimilarity(
      spec(headers, { platform: 'kraken' }),
      csv('export.csv', FULL),
    );
    expect(named.platformInName).toBe(true);
    expect(named.score).toBeGreaterThan(other.score);
  });

  it('a PDF matches nothing', () => {
    const similarity = mappingSimilarity(
      spec(['Time', 'Coin', 'Amount', 'Type']),
      {
        id: 'x',
        name: 'a.pdf',
        kind: 'pdf',
      } as SourceFile,
    );
    expect(similarity.coverage).toBe(0);
    expect(isSuggestable(similarity)).toBe(false);
  });
});
