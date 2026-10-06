import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import ExcelJS from 'exceljs';
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import { InMemoryProjectRepository } from '../../projects/testing/in-memory-project.repository';
import {
  CreateMappingCommand,
  CreateMappingHandler,
  DeleteMappingCommand,
  DeleteMappingHandler,
  UpdateMappingCommand,
  UpdateMappingHandler,
} from '../../mappings/application/commands/mapping.commands';
import {
  ListProjectMappingsHandler,
  ListProjectMappingsQuery,
} from '../../mappings/application/queries/mapping.queries';
import { InMemoryImportMappingRepository } from '../../mappings/testing/in-memory-import-mapping.repository';
import { MAX_FILE_BYTES } from '../domain/project-file';
import { InMemoryHintStateRepository } from '../testing/in-memory-hint-state.repository';
import { InMemoryProjectFileRepository } from '../testing/in-memory-project-file.repository';
import {
  ListProjectHintsHandler,
  ListProjectHintsQuery,
  UpdateHintStateCommand,
  UpdateHintStateHandler,
} from './queries/project-hints.query';
import {
  FileRowErrorsHandler,
  FileRowErrorsQuery,
} from './queries/row-errors.query';
import {
  ChangeProjectFileCommand,
  ChangeProjectFileHandler,
} from './commands/change-project-file.command';
import {
  ReapplyMappingCommand,
  ReapplyMappingHandler,
} from './commands/reapply-mapping.command';
import {
  RemoveProjectFileCommand,
  RemoveProjectFileHandler,
} from './commands/remove-project-file.command';
import {
  DuplicateFileException,
  UploadProjectFileCommand,
  UploadProjectFileHandler,
} from './commands/upload-project-file.command';
import { FileAnalysisService } from './file-analysis.service';
import { FileViews } from './file-views';
import {
  GetFileContentHandler,
  GetFileContentQuery,
  PreviewFileHandler,
  PreviewFileQuery,
} from './queries/file-content.query';
import {
  ListProjectFilesHandler,
  ListProjectFilesQuery,
} from './queries/list-project-files.query';
import {
  PreviewMappingHandler,
  PreviewMappingQuery,
} from './queries/preview-mapping.query';
import { SourceFileReader } from './source-file-reader';

/** The engine's synthetic fixtures — never real data (CLAUDE.md, Private data). */
const ENGINE = resolve(__dirname, '../../../../../libs/engine/src');
const fixture = (path: string) =>
  new Uint8Array(readFileSync(resolve(ENGINE, path)));
const spec = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      resolve(ENGINE, `mapping/fixtures/${name}.mapping.json`),
      'utf8',
    ),
  );

const STANDARD = 'standard/fixtures/standard-buchungen.csv';
const KRAKEN = 'mapping/fixtures/kraken-ledger-2024.csv';
const KRAKEN_CLASSIC = 'mapping/fixtures/kraken-ledger-classic.csv';
const PDF = new TextEncoder().encode('%PDF-1.4\n% synthetic\n%%EOF\n');

async function setup() {
  const projects = new InMemoryProjectRepository();
  const files = new InMemoryProjectFileRepository();
  const mappings = new InMemoryImportMappingRepository(files);
  const analysis = new FileAnalysisService(new SourceFileReader(), mappings);
  const hintStates = new InMemoryHintStateRepository();
  const views = new FileViews(
    projects as ProjectRepositoryPort,
    mappings,
    files,
  );
  const base = {
    name: 'Steuern 2025',
    taxYear: 2025,
    country: 'CH' as const,
    canton: 'ZH',
    notes: '',
  };
  const p1 = await projects.create('anna', base);
  const p2 = await projects.create('anna', {
    ...base,
    name: 'Steuern 2024',
    taxYear: 2024,
  });
  return {
    projects,
    files,
    mappings,
    p1,
    p2,
    upload: (
      projectId: string,
      name: string,
      bytes: Uint8Array,
      user = 'anna',
    ) =>
      new UploadProjectFileHandler(projects, files, analysis).execute(
        new UploadProjectFileCommand(user, projectId, name, bytes),
      ),
    change: new ChangeProjectFileHandler(projects, files, mappings, analysis),
    remove: new RemoveProjectFileHandler(projects, files),
    reapply: new ReapplyMappingHandler(projects, files, mappings, analysis),
    list: new ListProjectFilesHandler(projects, files, views),
    content: new GetFileContentHandler(projects, files),
    preview: new PreviewFileHandler(projects, files, new SourceFileReader()),
    previewMapping: new PreviewMappingHandler(
      projects,
      files,
      mappings,
      analysis,
    ),
    createMapping: new CreateMappingHandler(mappings),
    updateMapping: new UpdateMappingHandler(mappings, files),
    deleteMapping: new DeleteMappingHandler(mappings, files, projects),
    projectMappings: new ListProjectMappingsHandler(projects, files, mappings),
    hints: new ListProjectHintsHandler(projects, files, hintStates),
    updateHint: new UpdateHintStateHandler(projects, hintStates),
    rowErrors: new FileRowErrorsHandler(projects, files, mappings, analysis),
  };
}

describe('upload (F5.1–F5.4)', () => {
  it('reads a standard-format file directly, keeping the bytes', async () => {
    const t = await setup();
    const bytes = fixture(STANDARD);
    const file = await t.upload(t.p1.id, 'C:\\exports\\buchungen.csv', bytes);
    expect(file).toMatchObject({
      displayName: 'buchungen.csv',
      kind: 'csv',
      status: 'standard',
      importerId: 'standard-v1',
      mappingId: null,
      platform: 'ledger-nano',
      bookingCount: 4,
      holdingCount: 0,
      errorCount: 2,
      period: { from: '2024-12-31', to: '2025-12-31' },
      origin: 'uploaded',
    });
    expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    const content = await t.content.execute(
      new GetFileContentQuery('anna', t.p1.id, file.id),
    );
    expect(Buffer.from(content.bytes).equals(Buffer.from(bytes))).toBe(true);
    expect(content.mediaType).toBe('text/csv');
  });

  it('needs a mapping for an unknown layout, and uses a stored one by fingerprint', async () => {
    const t = await setup();
    const unknown = await t.upload(t.p1.id, 'ledgers.csv', fixture(KRAKEN));
    expect(unknown).toMatchObject({
      status: 'needs_mapping',
      bookingCount: 0,
      importerId: null,
    });

    const mapping = await t.createMapping.execute(
      new CreateMappingCommand('anna', spec('kraken-ledger'), 'copied'),
    );
    const mapped = await t.upload(
      t.p1.id,
      'old-ledgers.csv',
      fixture(KRAKEN_CLASSIC),
    );
    expect(mapped).toMatchObject({
      status: 'mapped',
      mappingId: mapping.id,
      importerId: `mapping:${mapping.id}`,
      platform: 'kraken',
      bookingCount: 2,
      period: { from: '2018-03-01', to: '2018-03-01' },
    });
  });

  it('picks one of two equally fitting mappings instead of leaving the file unread (regression)', async () => {
    const t = await setup();
    await t.createMapping.execute(
      new CreateMappingCommand('anna', spec('kraken-ledger'), 'copied'),
    );
    const newer = await t.createMapping.execute(
      new CreateMappingCommand('anna', spec('kraken-ledger'), 'copied'),
    );
    const file = await t.upload(t.p1.id, 'l.csv', fixture(KRAKEN_CLASSIC));
    expect(file).toMatchObject({ status: 'mapped', mappingId: newer.id });
  });

  it('refuses the same bytes twice in one project, and reuses them in another (F4.4)', async () => {
    const t = await setup();
    const first = await t.upload(t.p1.id, 'a.csv', fixture(STANDARD));
    await expect(
      t.upload(t.p1.id, 'renamed.csv', fixture(STANDARD)),
    ).rejects.toBeInstanceOf(DuplicateFileException);
    const second = await t.upload(t.p2.id, 'b.csv', fixture(STANDARD));
    expect(second.fileId).toBe(first.fileId);
    expect(second.origin).toBe(`from_project:${t.p1.id}`);
    expect(t.files.stored.size).toBe(1);
  });

  it('keeps PDFs as evidence and refuses what is not CSV, XLSX or PDF', async () => {
    const t = await setup();
    expect(await t.upload(t.p1.id, 'auszug.pdf', PDF)).toMatchObject({
      kind: 'pdf',
      status: 'evidence_only',
      mediaType: 'application/pdf',
    });
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
    ]);
    await expect(t.upload(t.p1.id, 'bild.csv', png)).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );
    const zip = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 0x61, 0x62,
    ]);
    await expect(t.upload(t.p1.id, 'x.xlsx', zip)).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );
    await expect(
      t.upload(t.p1.id, 'leer.csv', new Uint8Array()),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      t.upload(t.p1.id, '   ', fixture(STANDARD)),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      t.upload(
        t.p1.id,
        'big.csv',
        new Uint8Array(MAX_FILE_BYTES + 1).fill(0x41),
      ),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it("reads someone else's project as 404 and refuses a closed one (F4.5)", async () => {
    const t = await setup();
    await expect(
      t.upload(t.p1.id, 'a.csv', fixture(STANDARD), 'bruno'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await t.projects.update(t.p1.id, { status: 'closed' });
    await expect(
      t.upload(t.p1.id, 'a.csv', fixture(STANDARD)),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('reads an XLSX with a preamble, the time zone taken from the file name', async () => {
    const t = await setup();
    await t.createMapping.execute(
      new CreateMappingCommand(
        'anna',
        spec('binance-transaktionshistorie-xlsx'),
        'manual',
      ),
    );
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(['Binance Transaktionshistorie (synthetisch)']);
    for (let i = 0; i < 9; i += 1) sheet.addRow([]);
    sheet.addRow([
      'User ID',
      'Time',
      'Account',
      'Operation',
      'Coin',
      'Change',
      'Remark',
    ]);
    sheet.addRow([
      '10000001',
      '25-01-01 01:30:00',
      'Spot',
      'Simple Earn Flexible Interest',
      'USDT',
      '0.01234567',
      '',
    ]);
    sheet.addRow([
      10000001,
      new Date(Date.UTC(2025, 5, 1, 12, 0, 0)),
      'Spot',
      'Deposit',
      'BTC',
      0.5,
      '',
    ]);
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
    const file = await t.upload(
      t.p1.id,
      'Binance-Transaktionshistorie-202601011200_UTC_2_X.xlsx',
      bytes,
    );
    expect(file).toMatchObject({
      kind: 'xlsx',
      status: 'mapped',
      bookingCount: 2,
      errorCount: 0,
      period: { from: '2024-12-31', to: '2025-06-01' },
    });
    const preview = await t.previewMapping.execute(
      new PreviewMappingQuery(
        'anna',
        t.p1.id,
        file.id,
        { mappingId: file.mappingId ?? '' },
        10,
      ),
    );
    expect(preview.result.bookings.map((b) => b.timestamp)).toEqual([
      '2024-12-31T23:30:00.000Z',
      '2025-06-01T10:00:00.000Z',
    ]);
  });
});

describe('overview, preview, removal (F5.5–F5.8)', () => {
  it('lists files with names and missing-file hints for the tax year', async () => {
    const t = await setup();
    await t.createMapping.execute(
      new CreateMappingCommand('anna', spec('kraken-ledger'), 'copied'),
    );
    await t.upload(t.p1.id, 'ledgers.csv', fixture(KRAKEN));
    await t.upload(t.p2.id, 'buchungen.csv', fixture(STANDARD));
    await t.upload(t.p1.id, 'buchungen.csv', fixture(STANDARD));
    const overview = await t.list.execute(
      new ListProjectFilesQuery('anna', t.p1.id),
    );
    expect(overview.taxYear).toBe(2025);
    expect(
      overview.files.map((f) => [
        f.displayName,
        f.status,
        f.mappingName,
        f.originProjectName,
      ]),
    ).toEqual([
      ['ledgers.csv', 'mapped', 'Kraken Ledger', null],
      ['buchungen.csv', 'standard', null, 'Steuern 2024'],
    ]);
    expect(
      overview.missing.map((h) => `${h.platform}/${h.accountId}:${h.kind}`),
    ).toEqual([
      'kraken/earn / bonded:startsLate',
      'kraken/earn / bonded:endsEarly',
      'kraken/earn / flexible:startsLate',
      'kraken/earn / flexible:endsEarly',
      'kraken/spot / main:endsEarly',
      // One platform-level hint instead of one per sub-account.
      'kraken/:noYearEndBalance',
      'ledger-nano/main:noYearEndBalance',
    ]);
    await expect(
      t.list.execute(new ListProjectFilesQuery('bruno', t.p1.id)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists hints with file hints, keeps a dismissal across new uploads and reopens it', async () => {
    const t = await setup();
    const unread = await t.upload(t.p1.id, 'ledgers.csv', fixture(KRAKEN));
    const standard = await t.upload(t.p1.id, 'b.csv', fixture(STANDARD));
    const first = await t.hints.execute(
      new ListProjectHintsQuery('anna', t.p1.id),
    );
    expect(first.hints.map((h) => [h.key, h.severity, h.status])).toEqual([
      ['noYearEndBalance:ledger-nano', 'warning', 'open'],
      ['rowErrors:' + standard.id, 'warning', 'open'],
      ['unrecognisedFile:' + unread.id, 'error', 'open'],
    ]);
    expect(first.open).toBe(3);

    await t.updateHint.execute(
      new UpdateHintStateCommand(
        'anna',
        t.p1.id,
        'noYearEndBalance:ledger-nano',
        'done',
        '  Wallet ohne Auszug  ',
      ),
    );
    // A mapping reads the unknown file now: its hint goes, the dismissal stays.
    await t.createMapping.execute(
      new CreateMappingCommand('anna', spec('kraken-ledger'), 'copied'),
    );
    await t.change.execute(
      new ChangeProjectFileCommand('anna', t.p1.id, unread.id, {
        mode: 'automatic',
      }),
    );
    const second = await t.hints.execute(
      new ListProjectHintsQuery('anna', t.p1.id),
    );
    const nano = second.hints.find(
      (h) => h.key === 'noYearEndBalance:ledger-nano',
    );
    expect(nano).toMatchObject({
      status: 'done',
      note: 'Wallet ohne Auszug',
    });
    expect(second.hints.some((h) => h.kind === 'unrecognisedFile')).toBe(false);
    // Kraken: one platform-level year-end hint, not one per sub-account.
    expect(
      second.hints.filter(
        (h) => h.platform === 'kraken' && h.kind === 'noYearEndBalance',
      ),
    ).toHaveLength(1);

    await t.updateHint.execute(
      new UpdateHintStateCommand(
        'anna',
        t.p1.id,
        'noYearEndBalance:ledger-nano',
        'open',
        '',
      ),
    );
    const third = await t.hints.execute(
      new ListProjectHintsQuery('anna', t.p1.id),
    );
    expect(
      third.hints.find((h) => h.key === 'noYearEndBalance:ledger-nano')?.status,
    ).toBe('open');
    await expect(
      t.hints.execute(new ListProjectHintsQuery('bruno', t.p1.id)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists the row errors of a file with its own reader, none for an unread one', async () => {
    const t = await setup();
    const standard = await t.upload(t.p1.id, 'b.csv', fixture(STANDARD));
    const unread = await t.upload(t.p1.id, 'ledgers.csv', fixture(KRAKEN));
    const errors = await t.rowErrors.execute(
      new FileRowErrorsQuery('anna', t.p1.id, standard.id, 1),
    );
    expect(errors.total).toBe(2);
    expect(errors.errors).toHaveLength(1);
    expect(errors.errors[0]).toMatchObject({ row: expect.any(Number) });
    expect(
      await t.rowErrors.execute(
        new FileRowErrorsQuery('anna', t.p1.id, unread.id, 50),
      ),
    ).toEqual({ total: 0, errors: [] });
  });

  it('refuses to change a hint of a closed project', async () => {
    const t = await setup();
    await t.projects.update(t.p1.id, { status: 'closed' });
    await expect(
      t.updateHint.execute(
        new UpdateHintStateCommand('anna', t.p1.id, 'k', 'ignored', ''),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('previews a table (header + rows) and says "pdf" for a PDF', async () => {
    const t = await setup();
    const csv = await t.upload(t.p1.id, 'b.csv', fixture(STANDARD));
    const preview = await t.preview.execute(
      new PreviewFileQuery('anna', t.p1.id, csv.id, 2),
    );
    expect(preview.kind).toBe('table');
    if (preview.kind !== 'table') return;
    expect(preview.sheets[0]?.rows).toHaveLength(3);
    expect(preview.sheets[0]?.rows[0]?.[0]).toBe('Zeitpunkt');
    expect(preview.sheets[0]?.totalRows).toBe(7);
    const pdf = await t.upload(t.p1.id, 'a.pdf', PDF);
    expect(
      await t.preview.execute(new PreviewFileQuery('anna', t.p1.id, pdf.id, 2)),
    ).toEqual({ kind: 'pdf' });
  });

  it('deletes the bytes only with the last reference (F5.7), never in a closed project', async () => {
    const t = await setup();
    const a = await t.upload(t.p1.id, 'a.csv', fixture(STANDARD));
    const b = await t.upload(t.p2.id, 'a.csv', fixture(STANDARD));
    await t.remove.execute(new RemoveProjectFileCommand('anna', t.p1.id, a.id));
    expect(t.files.stored.size).toBe(1);
    await expect(
      t.remove.execute(new RemoveProjectFileCommand('anna', t.p1.id, b.id)),
    ).rejects.toBeInstanceOf(NotFoundException);
    await t.projects.update(t.p2.id, { status: 'closed' });
    await expect(
      t.remove.execute(new RemoveProjectFileCommand('anna', t.p2.id, b.id)),
    ).rejects.toBeInstanceOf(ConflictException);
    await t.projects.update(t.p2.id, { status: 'in_progress' });
    await t.remove.execute(new RemoveProjectFileCommand('anna', t.p2.id, b.id));
    expect(t.files.stored.size).toBe(0);
  });
});

describe('assigning and editing mappings', () => {
  it('previews an unsaved spec (with validation), then assigns a mapping, evidence only, automatic', async () => {
    const t = await setup();
    const file = await t.upload(t.p1.id, 'ledgers.csv', fixture(KRAKEN));
    await expect(
      t.previewMapping.execute(
        new PreviewMappingQuery(
          'anna',
          t.p1.id,
          file.id,
          { spec: { format: 'nope' } },
          5,
        ),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    const preview = await t.previewMapping.execute(
      new PreviewMappingQuery(
        'anna',
        t.p1.id,
        file.id,
        { spec: spec('kraken-ledger') },
        5,
      ),
    );
    expect(preview.result.bookings).toHaveLength(5);
    expect(preview.totals).toEqual({
      bookings: 13,
      holdings: 9,
      errors: 0,
      notes: 1,
    });

    const mapping = await t.createMapping.execute(
      new CreateMappingCommand('anna', spec('kraken-ledger'), 'manual'),
    );
    const mapped = await t.change.execute(
      new ChangeProjectFileCommand('anna', t.p1.id, file.id, {
        mode: 'mapping',
        mappingId: mapping.id,
      }),
    );
    expect(mapped).toMatchObject({
      status: 'mapped',
      bookingCount: 13,
      holdingCount: 9,
    });
    const evidence = await t.change.execute(
      new ChangeProjectFileCommand('anna', t.p1.id, file.id, {
        mode: 'evidenceOnly',
      }),
    );
    expect(evidence).toMatchObject({
      status: 'evidence_only',
      bookingCount: 0,
      mappingId: null,
    });
    const again = await t.change.execute(
      new ChangeProjectFileCommand('anna', t.p1.id, file.id, {
        mode: 'automatic',
      }),
    );
    expect(again).toMatchObject({ status: 'mapped', mappingId: mapping.id });

    const pdf = await t.upload(t.p1.id, 'a.pdf', PDF);
    await expect(
      t.change.execute(
        new ChangeProjectFileCommand('anna', t.p1.id, pdf.id, {
          mode: 'mapping',
          mappingId: mapping.id,
        }),
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    const brunoMapping = await t.createMapping.execute(
      new CreateMappingCommand('bruno', spec('kraken-ledger'), 'manual'),
    );
    await expect(
      t.change.execute(
        new ChangeProjectFileCommand('anna', t.p1.id, file.id, {
          mode: 'mapping',
          mappingId: brunoMapping.id,
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('re-applies an edited mapping to its files, skipping closed projects', async () => {
    const t = await setup();
    const mapping = await t.createMapping.execute(
      new CreateMappingCommand('anna', spec('kraken-ledger'), 'manual'),
    );
    const open = await t.upload(t.p1.id, 'l.csv', fixture(KRAKEN));
    await t.upload(t.p2.id, 'l.csv', fixture(KRAKEN));
    await t.projects.update(t.p2.id, { status: 'closed' });

    const edited = spec('kraken-ledger') as {
      filters: unknown[];
      name: string;
    };
    edited.filters = [];
    edited.name = 'Kraken Ledger (ohne Filter)';
    const updated = await t.updateMapping.execute(
      new UpdateMappingCommand('anna', mapping.id, edited),
    );
    expect(updated).toMatchObject({
      filesUsing: 2,
      mapping: { name: 'Kraken Ledger (ohne Filter)' },
    });
    expect(
      await t.reapply.execute(new ReapplyMappingCommand('anna', mapping.id)),
    ).toEqual({
      reapplied: 1,
      skippedClosed: 1,
    });
    // Without the filter, Kraken's pending duplicate is booked too (14 instead of 13).
    expect(await t.files.findById(open.id)).toMatchObject({
      bookingCount: 14,
      errorCount: 0,
    });

    const used = await t.projectMappings.execute(
      new ListProjectMappingsQuery('anna', t.p1.id),
    );
    expect(
      used.map((u) => [u.mapping.id, u.files.map((f) => f.displayName)]),
    ).toEqual([[mapping.id, ['l.csv']]]);

    await expect(
      t.deleteMapping.execute(new DeleteMappingCommand('anna', mapping.id)),
    ).rejects.toBeInstanceOf(ConflictException);
    await t.projects.update(t.p2.id, { status: 'in_progress' });
    expect(
      await t.deleteMapping.execute(
        new DeleteMappingCommand('anna', mapping.id),
      ),
    ).toBe(2);
    expect(await t.files.findById(open.id)).toMatchObject({
      status: 'needs_mapping',
      mappingId: null,
    });
  });

  it('refuses an invalid spec with every issue', async () => {
    const t = await setup();
    await expect(
      t.createMapping.execute(
        new CreateMappingCommand('anna', { format: 'x' }, 'manual'),
      ),
    ).rejects.toMatchObject({
      response: {
        message: 'The mapping spec is invalid',
        issues: expect.arrayContaining([
          expect.objectContaining({ path: 'format' }),
        ]),
      },
    });
  });
});
