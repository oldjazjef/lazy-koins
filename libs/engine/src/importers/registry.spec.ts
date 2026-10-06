import type { FileKind, Importer, SourceFile } from './importer';
import {
  defaultImporterRegistry,
  IMPORTERS,
  ImporterRegistry,
} from './registry';

/** A synthetic CSV — fixtures are always made up (CLAUDE.md, Private data). */
function csv(header: string[], name = 'export.csv'): SourceFile {
  return {
    id: 'sha-test',
    name,
    kind: 'csv',
    sheets: [{ name, rows: [header, header.map(() => 'x')] }],
  };
}

function importer(
  id: string,
  detect: (file: SourceFile) => number,
  fileKind: FileKind = 'csv',
): Importer {
  return {
    id,
    platform: id.split('-')[0] ?? id,
    fileKinds: [fileKind],
    detect,
    parse: () => ({
      bookings: [],
      holdings: [],
      period: null,
      errors: [],
      notes: [],
    }),
  };
}

/** Claims files whose first row starts with `header`. */
function byHeader(id: string, header: string, confidence = 1): Importer {
  return importer(id, (file) =>
    file.kind !== 'pdf' && file.sheets[0]?.rows[0]?.[0] === header
      ? confidence
      : 0,
  );
}

describe('ImporterRegistry.detect', () => {
  it('reports an unknown file when nobody claims it (and when nothing is registered)', () => {
    expect(new ImporterRegistry([]).detect(csv(['a']))).toEqual({
      status: 'unknown',
    });
    expect(
      new ImporterRegistry([byHeader('kraken-ledger', 'txid')]).detect(
        csv(['Date']),
      ),
    ).toEqual({ status: 'unknown' });
  });

  it('picks the single best match', () => {
    const kraken = byHeader('kraken-ledger', 'txid', 0.95);
    const vague = importer('generic-csv', () => 0.4);
    const detection = new ImporterRegistry([vague, kraken]).detect(
      csv(['txid']),
    );
    expect(detection).toEqual({
      status: 'match',
      importer: kraken,
      confidence: 0.95,
    });
  });

  it('reports ambiguity when two importers are (nearly) equally sure', () => {
    const a = importer('binance-history', () => 0.9);
    const b = importer('binance-statement', () => 0.85);
    const c = importer('other-thing', () => 0.3);
    const detection = new ImporterRegistry([c, b, a]).detect(csv(['x']));
    expect(detection.status).toBe('ambiguous');
    if (detection.status !== 'ambiguous') return;
    expect(detection.candidates.map((x) => x.importer.id)).toEqual([
      'binance-history',
      'binance-statement',
    ]);
  });

  it('treats an exact tie as ambiguous even with a zero margin', () => {
    const registry = new ImporterRegistry(
      [importer('a-x', () => 0.7), importer('b-x', () => 0.7)],
      { ambiguityMargin: 0 },
    );
    expect(registry.detect(csv(['x'])).status).toBe('ambiguous');
  });

  it('only asks importers of the file kind', () => {
    const pdfOnly = importer('revolut-statement', () => 1, 'pdf');
    expect(new ImporterRegistry([pdfOnly]).detect(csv(['x']))).toEqual({
      status: 'unknown',
    });
    const pdf: SourceFile = {
      id: 'sha',
      name: 'statement.pdf',
      kind: 'pdf',
      pages: ['Revolut'],
    };
    expect(new ImporterRegistry([pdfOnly]).detect(pdf)).toMatchObject({
      status: 'match',
      importer: pdfOnly,
    });
  });

  it('survives an importer that throws or answers nonsense', () => {
    const throws = importer('broken-one', () => {
      throw new Error('boom');
    });
    const nan = importer('nan-one', () => Number.NaN);
    const negative = importer('negative-one', () => -1);
    const tooSure = importer('too-sure', () => 7);
    const detection = new ImporterRegistry([
      throws,
      nan,
      negative,
      tooSure,
    ]).detect(csv(['x']));
    expect(detection).toEqual({
      status: 'match',
      importer: tooSure,
      confidence: 1,
    });
  });

  it('is independent of registration order', () => {
    const a = importer('a-x', () => 0.5);
    const b = importer('b-x', () => 0.5);
    const one = new ImporterRegistry([a, b]).candidates(csv(['x']));
    const two = new ImporterRegistry([b, a]).candidates(csv(['x']));
    expect(one.map((c) => c.importer.id)).toEqual(['a-x', 'b-x']);
    expect(two.map((c) => c.importer.id)).toEqual(['a-x', 'b-x']);
  });
});

describe('ImporterRegistry construction', () => {
  it('refuses duplicate ids and a nonsensical margin', () => {
    const a = importer('kraken-ledger', () => 1);
    expect(() => new ImporterRegistry([a, a])).toThrow(/Duplicate/);
    expect(() => new ImporterRegistry([], { ambiguityMargin: -0.1 })).toThrow(
      RangeError,
    );
    expect(() => new ImporterRegistry([], { ambiguityMargin: 1 })).toThrow(
      RangeError,
    );
  });

  it('looks importers up by id and lists them sorted', () => {
    const b = importer('b-x', () => 1);
    const a = importer('a-x', () => 1);
    const registry = new ImporterRegistry([b, a]);
    expect(registry.get('a-x')).toBe(a);
    expect(registry.get('missing')).toBeUndefined();
    expect(registry.importers.map((x) => x.id)).toEqual(['a-x', 'b-x']);
  });

  it('has the standard format built in, and nothing platform-specific', () => {
    expect(IMPORTERS.map((x) => x.id)).toEqual(['standard-v1']);
    expect(defaultImporterRegistry().detect(csv(['txid']))).toEqual({
      status: 'unknown',
    });
    const extra = importer('mapping:k', () => 0.9);
    expect(
      defaultImporterRegistry([extra]).detect(csv(['txid'])),
    ).toMatchObject({ status: 'match', importer: extra });
  });
});
