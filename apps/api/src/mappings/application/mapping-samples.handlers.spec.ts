import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BadRequestException,
  PayloadTooLargeException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { standardTemplateCsv } from '@lazykoins/engine';
import { FileAnalysisService } from '../../files/application/file-analysis.service';
import { SourceFileReader } from '../../files/application/source-file-reader';
import { MAX_FILE_BYTES } from '../../files/domain/project-file';
import { InMemoryProjectFileRepository } from '../../files/testing/in-memory-project-file.repository';
import { sampleFromUpload } from '../dto/mapping-sample.dto';
import { InMemoryImportMappingRepository } from '../testing/in-memory-import-mapping.repository';
import {
  CreateMappingCommand,
  CreateMappingHandler,
} from './commands/mapping.commands';
import {
  InspectSampleHandler,
  InspectSampleQuery,
  PreviewSampleHandler,
  PreviewSampleQuery,
  verdictOf,
} from './queries/mapping-sample.queries';
import { sampleFileOf } from './sample-file';

/** The engine's synthetic fixtures — never real data. */
const FIXTURES = resolve(
  __dirname,
  '../../../../../libs/engine/src/mapping/fixtures',
);
const bytesOf = (name: string) =>
  new Uint8Array(readFileSync(resolve(FIXTURES, name)));
const specOf = (name: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(resolve(FIXTURES, `${name}.mapping.json`), 'utf8'),
  ) as Record<string, unknown>;

function setup() {
  const files = new InMemoryProjectFileRepository();
  const mappings = new InMemoryImportMappingRepository(files);
  const reader = new SourceFileReader();
  const analysis = new FileAnalysisService(reader, mappings);
  const create = new CreateMappingHandler(mappings);
  const inspect = new InspectSampleHandler(reader, mappings);
  const preview = new PreviewSampleHandler(reader, analysis, mappings);
  const kraken = sampleFileOf(
    'kraken-ledger-2024.csv',
    bytesOf('kraken-ledger-2024.csv'),
  );
  return {
    files,
    mappings,
    kraken,
    save: (spec: unknown, user = 'anna') =>
      create.execute(new CreateMappingCommand(user, spec, 'manual')),
    inspect: (file = kraken, user = 'anna') =>
      inspect.execute(new InspectSampleQuery(user, file)),
    preview: (
      spec: unknown,
      options: { file?: typeof kraken; mappingId?: string; user?: string } = {},
    ) =>
      preview.execute(
        new PreviewSampleQuery(
          options.user ?? 'anna',
          options.file ?? kraken,
          spec,
          5,
          options.mappingId,
        ),
      ),
  };
}

describe('sample file limits (same as an upload, tables only)', () => {
  it('accepts CSV/XLSX and refuses empty, PDF, binary and oversized files', () => {
    expect(
      sampleFileOf('a.csv', new TextEncoder().encode('a,b\n1,2')),
    ).toMatchObject({ name: 'a.csv', kind: 'csv' });
    expect(() => sampleFileOf('a.csv', new Uint8Array())).toThrow(
      BadRequestException,
    );
    expect(() =>
      sampleFileOf('a.pdf', new TextEncoder().encode('%PDF-1.7 …')),
    ).toThrow(UnprocessableEntityException);
    expect(() =>
      sampleFileOf('a.bin', new Uint8Array([0, 1, 2, 0, 0, 255, 0, 3])),
    ).toThrow(UnsupportedMediaTypeException);
    expect(() =>
      sampleFileOf('big.csv', new Uint8Array(MAX_FILE_BYTES + 1).fill(65)),
    ).toThrow(PayloadTooLargeException);
  });

  it('needs the file part; the UTF-8 name field wins over the part name', () => {
    expect(() => sampleFromUpload(undefined, 'a.csv')).toThrow(
      BadRequestException,
    );
    const file = sampleFromUpload(
      {
        originalname: 'BÃ¶rse.csv',
        buffer: Buffer.from('a,b\n1,2'),
        size: 7,
      },
      'Börse.csv',
    );
    expect(file.name).toBe('Börse.csv');
  });
});

describe('InspectSample (Beispieldatei)', () => {
  it('returns the raw table, the header guess and a skeleton — and stores nothing', async () => {
    const t = setup();
    const inspection = await t.inspect();
    expect(inspection).toMatchObject({
      name: 'kraken-ledger-2024.csv',
      kind: 'csv',
      recognisedBy: { standard: false, mapping: null },
    });
    expect(inspection.sample.headerRowGuess).toBe(1);
    expect(inspection.sample.rows[0]).toContain('refid');
    expect(inspection.skeleton.bookings?.timestamp.column).toBe('time');
    expect(inspection.skeleton.match.headers).toContain('amount');
    expect(t.files.stored.size).toBe(0);
    expect(t.files.entries.size).toBe(0);
  });

  it('names the mapping an upload would use today', async () => {
    const t = setup();
    const saved = await t.save(specOf('kraken-ledger'));
    expect((await t.inspect()).recognisedBy).toEqual({
      standard: false,
      mapping: {
        id: saved.id,
        name: 'Kraken Ledger',
        confidence: expect.any(Number),
      },
    });
    // Someone else's mappings are not mine.
    expect((await t.inspect(t.kraken, 'ben')).recognisedBy.mapping).toBeNull();
  });
});

describe('PreviewSample (live preview + fingerprint)', () => {
  it('returns the issues of an invalid spec instead of failing', async () => {
    const t = setup();
    const result = await t.preview({ format: 'lazy-koins-mapping' });
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.preview).toBeNull();
    expect(result.fingerprint).toBeNull();
  });

  it('applies the spec to the whole file: records, kind counts, unknowns, verdict "this"', async () => {
    const t = setup();
    const result = await t.preview(specOf('kraken-ledger'));
    expect(result.valid).toBe(true);
    expect(result.preview?.result.bookings).toHaveLength(5);
    expect(result.preview?.totals.bookings).toBeGreaterThan(5);
    expect(result.kindCounts['trade']).toBeGreaterThan(0);
    expect(result.fingerprint).toMatchObject({
      verdict: 'this',
      recognisedBy: { standard: false, mapping: null },
    });
    expect(t.files.stored.size).toBe(0);
  });

  it('lists the raw types left unknown, and row errors with their row', async () => {
    const t = setup();
    const spec = specOf('kraken-ledger');
    const bookings = spec['bookings'] as Record<string, unknown>;
    const unclassified = await t.preview({
      ...spec,
      bookings: {
        ...bookings,
        kind: { columns: ['type'], rules: [], default: 'unknown' },
      },
    });
    expect(unclassified.unknownValues.map((u) => u.value)).toContain('trade');
    expect(unclassified.kindCounts).toEqual({
      unknown: unclassified.preview?.totals.bookings,
    });

    const broken = await t.preview({
      ...spec,
      bookings: { ...bookings, asset: { column: 'subtype' } },
    });
    expect(broken.preview?.result.errors[0]).toMatchObject({
      code: 'required',
      column: 'subtype',
    });
    expect(broken.preview?.result.errors[0]?.row).toBeGreaterThan(1);
  });
  it('says when another mapping of mine would win, but not against itself', async () => {
    const t = setup();
    const full = await t.save(specOf('kraken-ledger'));
    const vague = {
      ...specOf('kraken-ledger'),
      name: 'Vague',
      match: { headers: ['txid', 'refid'] },
    };
    const other = await t.preview(vague);
    expect(other.fingerprint?.verdict).toBe('other');
    expect(other.fingerprint?.recognisedBy.mapping?.id).toBe(full.id);
    const self = await t.preview(specOf('kraken-ledger'), {
      mappingId: full.id,
    });
    expect(self.fingerprint?.verdict).toBe('this');
  });

  it('reports "none" for a spec that does not fit and "standard" for a standard file', async () => {
    const t = setup();
    const bitfinex = await t.preview(specOf('bitfinex-ledger'));
    expect(bitfinex.fingerprint?.verdict).toBe('none');
    expect(bitfinex.preview?.result.errors[0]?.code).toBe('headerNotFound');

    const standard = sampleFileOf(
      'vorlage.csv',
      new TextEncoder().encode(standardTemplateCsv('bookings')),
    );
    const result = await t.preview(specOf('kraken-ledger'), { file: standard });
    expect(result.fingerprint?.verdict).toBe('standard');
  });

  it('decides like the upload: a tie goes to the spec being saved', () => {
    const recognised = (confidence: number) => ({
      standard: false,
      mapping: { id: 'm1', name: 'A', confidence },
    });
    expect(verdictOf(0.8, recognised(0.8))).toBe('this');
    expect(verdictOf(0.7, recognised(0.8))).toBe('other');
    expect(verdictOf(0, { standard: false, mapping: null })).toBe('none');
  });
});
