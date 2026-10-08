import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  CreateMappingCommand,
  CreateMappingHandler,
} from '../../mappings/application/commands/mapping.commands';
import { InMemoryImportMappingRepository } from '../../mappings/testing/in-memory-import-mapping.repository';
import { InMemoryProjectRepository } from '../../projects/testing/in-memory-project.repository';
import { InMemoryProjectFileRepository } from '../testing/in-memory-project-file.repository';
import {
  UploadProjectFileCommand,
  UploadProjectFileHandler,
} from './commands/upload-project-file.command';
import { FileAnalysisService } from './file-analysis.service';
import {
  ChangeMyFileCommand,
  ChangeMyFileHandler,
  DeleteMyFileCommand,
  DeleteMyFileHandler,
  DuplicateUserFileException,
  GetMyFileContentHandler,
  GetMyFileContentQuery,
  ListFileCandidatesHandler,
  ListFileCandidatesQuery,
  ListMyFilesHandler,
  ListMyFilesQuery,
  PreviewMyFileHandler,
  PreviewMyFileQuery,
  SelectProjectFilesCommand,
  SelectProjectFilesHandler,
  suggestedForYear,
  UploadMyFileCommand,
  UploadMyFileHandler,
} from './my-files.handlers';
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

async function setup() {
  const projects = new InMemoryProjectRepository();
  const files = new InMemoryProjectFileRepository();
  const mappings = new InMemoryImportMappingRepository(files);
  const reader = new SourceFileReader();
  const analysis = new FileAnalysisService(reader, mappings);
  const base = { country: 'CH' as const, canton: 'ZH', notes: '' };
  const p2025 = await projects.create('anna', {
    ...base,
    name: 'Steuern 2025',
    taxYear: 2025,
  });
  const p2024 = await projects.create('anna', {
    ...base,
    name: 'Steuern 2024',
    taxYear: 2024,
  });
  return {
    projects,
    files,
    mappings,
    p2025,
    p2024,
    upload: (name: string, bytes: Uint8Array, user = 'anna') =>
      new UploadMyFileHandler(files, projects, mappings, analysis).execute(
        new UploadMyFileCommand(user, name, bytes),
      ),
    uploadToProject: (projectId: string, name: string, bytes: Uint8Array) =>
      new UploadProjectFileHandler(projects, files, analysis).execute(
        new UploadProjectFileCommand('anna', projectId, name, bytes),
      ),
    list: (user = 'anna') =>
      new ListMyFilesHandler(files, projects, mappings).execute(
        new ListMyFilesQuery(user),
      ),
    change: new ChangeMyFileHandler(files, projects, mappings, analysis),
    remove: new DeleteMyFileHandler(files, projects),
    content: new GetMyFileContentHandler(files),
    preview: new PreviewMyFileHandler(files, reader),
    candidates: new ListFileCandidatesHandler(files, projects, mappings),
    select: new SelectProjectFilesHandler(files, projects),
    createMapping: new CreateMappingHandler(mappings),
  };
}

describe('my files (F5.21)', () => {
  it('uploads outside any project, reads it, and lists it with the projects that use it', async () => {
    const t = await setup();
    const file = await t.upload('buchungen.csv', fixture(STANDARD));
    expect(file).toMatchObject({
      originalName: 'buchungen.csv',
      status: 'standard',
      platform: 'ledger-nano',
      bookingCount: 4,
      source: 'uploaded',
      usedIn: [],
    });
    await expect(
      t.upload('again.csv', fixture(STANDARD)),
    ).rejects.toBeInstanceOf(DuplicateUserFileException);

    await t.select.execute(
      new SelectProjectFilesCommand('anna', t.p2024.id, [file.id]),
    );
    await t.select.execute(
      new SelectProjectFilesCommand('anna', t.p2025.id, [file.id]),
    );
    const [listed] = await t.list();
    expect(listed?.usedIn.map((u) => [u.projectName, u.active])).toEqual([
      ['Steuern 2025', true],
      ['Steuern 2024', true],
    ]);
    expect(await t.list('bruno')).toEqual([]);

    const content = await t.content.execute(
      new GetMyFileContentQuery('anna', file.id),
    );
    expect(
      Buffer.from(content.bytes).equals(Buffer.from(fixture(STANDARD))),
    ).toBe(true);
    const preview = await t.preview.execute(
      new PreviewMyFileQuery('anna', file.id, 2),
    );
    expect(preview.kind).toBe('table');
    await expect(
      t.content.execute(new GetMyFileContentQuery('bruno', file.id)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('changes how a file is read for every project, refused while a closed project uses it', async () => {
    const t = await setup();
    const file = await t.upload('ledgers.csv', fixture(KRAKEN));
    expect(file.status).toBe('needs_mapping');
    await t.select.execute(
      new SelectProjectFilesCommand('anna', t.p2025.id, [file.id]),
    );
    const mapping = await t.createMapping.execute(
      new CreateMappingCommand('anna', spec('kraken-ledger'), 'manual'),
    );
    const read = await t.change.execute(
      new ChangeMyFileCommand('anna', file.id, {
        mode: 'mapping',
        mappingId: mapping.id,
      }),
    );
    expect(read).toMatchObject({
      status: 'mapped',
      mappingName: mapping.name,
      bookingCount: 13,
    });
    expect((await t.files.listByProject(t.p2025.id))[0]?.status).toBe('mapped');

    await t.select.execute(
      new SelectProjectFilesCommand('anna', t.p2024.id, [file.id]),
    );
    await t.projects.update(t.p2024.id, { status: 'closed' });
    await expect(
      t.change.execute(
        new ChangeMyFileCommand('anna', file.id, { mode: 'evidenceOnly' }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      t.remove.execute(new DeleteMyFileCommand('anna', file.id)),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      t.change.execute(
        new ChangeMyFileCommand('bruno', file.id, { mode: 'evidenceOnly' }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deletes the bytes and takes the file out of every open project (F5.23)', async () => {
    const t = await setup();
    const entry = await t.uploadToProject(
      t.p2025.id,
      'buchungen.csv',
      fixture(STANDARD),
    );
    await t.remove.execute(new DeleteMyFileCommand('anna', entry.fileId));
    expect(await t.files.listByProject(t.p2025.id)).toEqual([]);
    expect(await t.list()).toEqual([]);
    await expect(
      t.remove.execute(new DeleteMyFileCommand('anna', entry.fileId)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('Dateien auswählen (F5.22)', () => {
  it('offers every file of mine, suggests those touching the tax year, and adds them once', async () => {
    const t = await setup();
    const touching = await t.upload('buchungen.csv', fixture(STANDARD));
    const pdf = await t.upload(
      'beleg.pdf',
      new TextEncoder().encode('%PDF-1.4\n% synthetic\n%%EOF\n'),
    );
    const offered = await t.candidates.execute(
      new ListFileCandidatesQuery('anna', t.p2025.id),
    );
    expect(
      offered.map((c) => [c.originalName, c.selected, c.suggested]).sort(),
    ).toEqual([
      ['beleg.pdf', false, false],
      ['buchungen.csv', false, true],
    ]);
    expect(
      await t.select.execute(
        new SelectProjectFilesCommand('anna', t.p2025.id, [
          touching.id,
          pdf.id,
          touching.id,
        ]),
      ),
    ).toEqual({ added: 2, alreadySelected: 0 });
    expect(
      await t.select.execute(
        new SelectProjectFilesCommand('anna', t.p2025.id, [touching.id]),
      ),
    ).toEqual({ added: 0, alreadySelected: 1 });
    const after = await t.candidates.execute(
      new ListFileCandidatesQuery('anna', t.p2025.id),
    );
    expect(after.every((c) => c.selected)).toBe(true);
    // Someone else's file or a closed project: nothing is linked.
    await expect(
      t.select.execute(
        new SelectProjectFilesCommand('bruno', t.p2025.id, [touching.id]),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await t.projects.update(t.p2024.id, { status: 'closed' });
    await expect(
      t.select.execute(
        new SelectProjectFilesCommand('anna', t.p2024.id, [touching.id]),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('suggests by period overlap or a balance at 31.12. of the year', () => {
    const at = (from: string, to: string, holdingDates: string[] = []) => ({
      period: { from, to },
      coverage: [
        {
          platform: 'kraken',
          accountId: 'main',
          from,
          to,
          bookings: 1,
          holdingDates,
        },
      ],
    });
    expect(suggestedForYear(at('2023-01-01', '2026-06-30'), 2025)).toBe(true);
    expect(suggestedForYear(at('2025-12-31', '2025-12-31'), 2025)).toBe(true);
    expect(suggestedForYear(at('2020-01-01', '2024-12-31'), 2025)).toBe(false);
    expect(suggestedForYear(at('2026-01-01', '2026-03-01'), 2025)).toBe(false);
    expect(suggestedForYear({ period: null, coverage: [] }, 2025)).toBe(false);
  });
});
