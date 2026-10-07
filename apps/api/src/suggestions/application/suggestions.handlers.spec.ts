import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { CommandBus } from '@nestjs/cqrs';
import { type MappingSpec, validateMappingSpec } from '@lazykoins/engine';
import {
  ChangeProjectFileCommand,
  ChangeProjectFileHandler,
} from '../../files/application/commands/change-project-file.command';
import {
  UploadProjectFileCommand,
  UploadProjectFileHandler,
} from '../../files/application/commands/upload-project-file.command';
import { FileAnalysisService } from '../../files/application/file-analysis.service';
import { SourceFileReader } from '../../files/application/source-file-reader';
import { InMemoryProjectFileRepository } from '../../files/testing/in-memory-project-file.repository';
import type { LibraryEntryView } from '../../library/domain/library-mapping';
import type { LibraryStatus } from '../../library/domain/remote-library';
import type { LibraryService } from '../../library/library.service';
import { InMemoryImportMappingRepository } from '../../mappings/testing/in-memory-import-mapping.repository';
import { InMemoryProjectRepository } from '../../projects/testing/in-memory-project.repository';
import { standardMappings } from '../domain/standard-mappings';
import {
  GetStandardMappingHandler,
  GetStandardMappingQuery,
  ListStandardMappingsHandler,
  ListStandardMappingsQuery,
  ProjectMappingSuggestionsHandler,
  ProjectMappingSuggestionsQuery,
  SuggestionPreviewHandler,
  SuggestionPreviewQuery,
  TakeStandardMappingCommand,
  TakeStandardMappingHandler,
} from './suggestions.handlers';

/** The standard mappings' SYNTHETIC samples (invented values) — never real data. */
const STANDARD = resolve(__dirname, '../../../../../mappings/standard');
const sample = (name: string) =>
  new Uint8Array(readFileSync(resolve(STANDARD, 'samples', name)));
const KRAKEN_CSV = sample('kraken-ledger.csv');

function specOf(json: unknown): MappingSpec {
  const result = validateMappingSpec(json);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.spec;
}

const KRAKEN = standardMappings().find((entry) => entry.id === 'kraken-ledger');
if (!KRAKEN) throw new Error('kraken-ledger missing from the catalogue');

/** Kraken's spec with one header the file lacks — a near match. */
const NEAR_KRAKEN = specOf({
  ...KRAKEN.spec,
  name: 'Mein Kraken',
  match: { headers: [...KRAKEN.spec.match.headers, 'nonexistent'] },
});

interface LibraryFake {
  status: LibraryStatus;
  matches: Map<string, LibraryEntryView[]>;
  fail: boolean;
  specs: Map<string, MappingSpec>;
}

function libraryService(fake: LibraryFake): LibraryService {
  return {
    status: () => Promise.resolve(fake.status),
    matchesForProject: () =>
      fake.fail
        ? Promise.reject(new Error('network'))
        : Promise.resolve(
            [...fake.matches].map(([projectFileId, matches]) => ({
              projectFileId,
              displayName: '',
              matches,
            })),
          ),
    get: (_user: string, id: string) => {
      const spec = fake.specs.get(id);
      if (!spec) return Promise.reject(new NotFoundException());
      return Promise.resolve({ spec });
    },
  } as unknown as LibraryService;
}

function entry(id: string, name: string, rating: number | null) {
  return {
    id,
    name,
    platform: 'kraken',
    description: null,
    fingerprint: 'a|b|c',
    version: 2,
    authorName: 'Krakenfan',
    ratingAverage: rating,
    ratingCount: rating === null ? 0 : 3,
    usageCount: 4,
    publishedAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    mine: false,
    myRating: null,
  } satisfies LibraryEntryView;
}

async function setup() {
  const projects = new InMemoryProjectRepository();
  const files = new InMemoryProjectFileRepository();
  const mappings = new InMemoryImportMappingRepository(files);
  const analysis = new FileAnalysisService(new SourceFileReader(), mappings);
  const change = new ChangeProjectFileHandler(
    projects,
    files,
    mappings,
    analysis,
  );
  const bus = {
    execute: (command: ChangeProjectFileCommand) => change.execute(command),
  } as unknown as CommandBus;
  const fake: LibraryFake = {
    status: {
      mode: 'web',
      available: true,
      readOnly: false,
      server: null,
      suggestions: true,
      reason: null,
    },
    matches: new Map(),
    fail: false,
    specs: new Map(),
  };
  const library = libraryService(fake);
  const project = await projects.create('anna', {
    name: 'Steuern 2025',
    taxYear: 2025,
    country: 'CH',
    canton: 'ZH',
    notes: '',
  });
  const upload = new UploadProjectFileHandler(projects, files, analysis);
  return {
    projects,
    files,
    mappings,
    fake,
    project,
    upload: (name: string, bytes: Uint8Array, user = 'anna', p = project.id) =>
      upload.execute(new UploadProjectFileCommand(user, p, name, bytes)),
    suggestions: (user = 'anna', p = project.id) =>
      new ProjectMappingSuggestionsHandler(
        projects,
        files,
        mappings,
        analysis,
        library,
      ).execute(new ProjectMappingSuggestionsQuery(user, p)),
    take: (
      user: string,
      id: string,
      target?: { projectId: string; projectFileId: string },
    ) =>
      new TakeStandardMappingHandler(mappings, projects, files, bus).execute(
        new TakeStandardMappingCommand(user, id, target),
      ),
    preview: (
      fileId: string,
      source: 'own' | 'standard' | 'library',
      id: string,
      user = 'anna',
    ) =>
      new SuggestionPreviewHandler(
        projects,
        files,
        mappings,
        analysis,
        library,
      ).execute(
        new SuggestionPreviewQuery(user, project.id, fileId, source, id, 5),
      ),
  };
}

describe('the standard catalogue (F5.19)', () => {
  it('ships every mapping in mappings/standard/', () => {
    const files = readdirSync(STANDARD)
      .filter((name) => name.endsWith('.mapping.json'))
      .map((name) => name.replace(/\.mapping\.json$/, ''))
      .sort();
    expect(
      standardMappings()
        .map((entry) => entry.id)
        .sort(),
    ).toEqual(files);
  });

  it('pins each entry to its revision — change the JSON, bump the revision and this hash', () => {
    expect(
      Object.fromEntries(
        standardMappings().map((entry) => [
          entry.id,
          `${entry.revision}:${entry.hash}`,
        ]),
      ),
    ).toMatchSnapshot();
  });

  it('lists my identical copy and reads one entry with its spec', async () => {
    const s = await setup();
    const before = await new ListStandardMappingsHandler(s.mappings).execute(
      new ListStandardMappingsQuery('anna'),
    );
    expect(before.every((view) => view.copyId === null)).toBe(true);
    const taken = await s.take('anna', 'kraken-ledger');
    const after = await new GetStandardMappingHandler(s.mappings).execute(
      new GetStandardMappingQuery('anna', 'kraken-ledger'),
    );
    expect(after.copyId).toBe(taken.mapping.id);
    expect(after.entry.spec.match.headers).toContain('txid');
    // Another user's copy is not mine.
    const bob = await new GetStandardMappingHandler(s.mappings).execute(
      new GetStandardMappingQuery('bob', 'kraken-ledger'),
    );
    expect(bob.copyId).toBeNull();
  });

  it('an unknown id is a 404', async () => {
    const s = await setup();
    await expect(s.take('anna', 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('take a standard mapping', () => {
  it('copies it (origin copied), assigns it, and reuses the copy the next time', async () => {
    const s = await setup();
    const file = await s.upload('kraken-ledger.csv', KRAKEN_CSV);
    expect(file.status).toBe('needs_mapping');
    const first = await s.take('anna', 'kraken-ledger', {
      projectId: s.project.id,
      projectFileId: file.id,
    });
    expect(first.created).toBe(true);
    expect(first.mapping.origin).toBe('copied');
    expect(first.revision).toBe(KRAKEN.revision);
    expect(first.file?.status).toBe('mapped');
    expect(first.file?.mappingId).toBe(first.mapping.id);
    const second = await s.take('anna', 'kraken-ledger');
    expect(second.created).toBe(false);
    expect(second.mapping.id).toBe(first.mapping.id);
    expect(await s.mappings.findByOwner('anna')).toHaveLength(1);
  });

  it('checks the target before copying: closed project 409, PDF 400, other user 404', async () => {
    const s = await setup();
    const file = await s.upload('kraken-ledger.csv', KRAKEN_CSV);
    await expect(
      s.take('bob', 'kraken-ledger', {
        projectId: s.project.id,
        projectFileId: file.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    const pdf = await s.upload(
      'statement.pdf',
      new TextEncoder().encode('%PDF-1.4 synthetic'),
    );
    await expect(
      s.take('anna', 'kraken-ledger', {
        projectId: s.project.id,
        projectFileId: pdf.id,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await s.projects.update(s.project.id, { status: 'closed' });
    await expect(
      s.take('anna', 'kraken-ledger', {
        projectId: s.project.id,
        projectFileId: file.id,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await s.mappings.findByOwner('anna')).toHaveLength(0);
    expect(await s.mappings.findByOwner('bob')).toHaveLength(0);
  });
});

describe('suggestions for files that need a mapping (F5.19)', () => {
  it('suggests the standard mapping that reads an unrecognised upload — nothing is assigned', async () => {
    const s = await setup();
    const file = await s.upload('kraken-ledger.csv', KRAKEN_CSV);
    const answer = await s.suggestions();
    expect(answer.library).toBe('used');
    expect(answer.files).toHaveLength(1);
    const [first] = answer.files[0]?.suggestions ?? [];
    expect(first).toMatchObject({
      source: 'standard',
      id: 'kraken-ledger',
      reads: true,
      coverage: 1,
      missing: [],
      platformInName: true,
    });
    expect((await s.files.findById(file.id))?.status).toBe('needs_mapping');
  });

  it('every standard sample is suggested its own mapping first', async () => {
    const s = await setup();
    const samples = readdirSync(resolve(STANDARD, 'samples'));
    for (const name of samples) {
      await s.upload(name, sample(name));
    }
    const answer = await s.suggestions();
    const firstOf = new Map(
      answer.files.map((file) => [file.displayName, file.suggestions[0]?.id]),
    );
    // Each sample is named after its mapping (binance's has a suffix).
    for (const name of samples) {
      const expected = standardMappings().find((entry) =>
        name.startsWith(entry.id),
      )?.id;
      expect([name, firstOf.get(name)]).toEqual([name, expected]);
    }
  });

  it('my near match comes with its missing headers, after what reads the file', async () => {
    const s = await setup();
    const near = await s.mappings.create('anna', {
      spec: NEAR_KRAKEN,
      origin: 'manual',
    });
    await s.upload('kraken-ledger.csv', KRAKEN_CSV);
    const suggestions = (await s.suggestions()).files[0]?.suggestions ?? [];
    const own = suggestions.find((candidate) => candidate.id === near.id);
    expect(own).toMatchObject({
      source: 'own',
      reads: false,
      missing: ['nonexistent'],
    });
    expect(suggestions[0]?.reads).toBe(true);
    expect(suggestions.indexOf(own as never)).toBeGreaterThan(0);
  });

  it('a mapping of mine saved after the upload reads the file and comes first; my copy hides the standard entry', async () => {
    const s = await setup();
    await s.upload('kraken-ledger.csv', KRAKEN_CSV);
    const copy = await s.take('anna', 'kraken-ledger');
    const suggestions = (await s.suggestions()).files[0]?.suggestions ?? [];
    expect(suggestions[0]).toMatchObject({
      source: 'own',
      id: copy.mapping.id,
      reads: true,
    });
    expect(
      suggestions.some(
        (candidate) =>
          candidate.source === 'standard' && candidate.id === 'kraken-ledger',
      ),
    ).toBe(false);
  });

  it('library matches join the ranking (after standard), ordered as the library gave them', async () => {
    const s = await setup();
    const file = await s.upload('kraken-ledger.csv', KRAKEN_CSV);
    s.fake.matches.set(file.id, [
      entry('lib-1', 'Kraken A', 4.5),
      entry('lib-2', 'Kraken B', null),
    ]);
    const suggestions = (await s.suggestions()).files[0]?.suggestions ?? [];
    expect(suggestions.map((c) => `${c.source}:${c.id}`).slice(0, 3)).toEqual([
      'standard:kraken-ledger',
      'library:lib-1',
      'library:lib-2',
    ]);
    expect(suggestions[1]?.library).toMatchObject({
      version: 2,
      authorName: 'Krakenfan',
      ratingAverage: 4.5,
    });
  });

  it('library switched off or failing: the other sources still answer', async () => {
    const s = await setup();
    await s.upload('kraken-ledger.csv', KRAKEN_CSV);
    s.fake.status = { ...s.fake.status, suggestions: false };
    expect((await s.suggestions()).library).toBe('off');
    s.fake.status = { ...s.fake.status, suggestions: true };
    s.fake.fail = true;
    const answer = await s.suggestions();
    expect(answer.library).toBe('unavailable');
    expect(answer.files[0]?.suggestions[0]?.id).toBe('kraken-ledger');
  });

  it('nothing for a closed project, a mapped file, a PDF — and someone else’s project is a 404', async () => {
    const s = await setup();
    await s.upload('statement.pdf', new TextEncoder().encode('%PDF-1.4 x'));
    expect((await s.suggestions()).files).toEqual([]);
    await s.upload('kraken-ledger.csv', KRAKEN_CSV);
    await expect(s.suggestions('bob')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await s.projects.update(s.project.id, { status: 'closed' });
    expect((await s.suggestions()).files).toEqual([]);
  });

  it('a file unrelated to every spec gets no suggestion', async () => {
    const s = await setup();
    await s.upload(
      'notes.csv',
      new TextEncoder().encode('Foo,Bar,Baz\n1,2,3\n'),
    );
    expect((await s.suggestions()).files).toEqual([]);
  });
});

describe('the preview of a suggestion', () => {
  it('kind counts, unknown values and the first records — nothing stored', async () => {
    const s = await setup();
    const file = await s.upload('kraken-ledger.csv', KRAKEN_CSV);
    const preview = await s.preview(file.id, 'standard', 'kraken-ledger');
    expect(preview.totals.bookings).toBeGreaterThan(0);
    expect(preview.result.bookings).toHaveLength(5);
    expect(preview.kindCounts['trade']).toBeGreaterThan(0);
    expect(preview.unknownValues).toEqual([]);
    expect(await s.mappings.findByOwner('anna')).toHaveLength(0);
    expect((await s.files.findById(file.id))?.status).toBe('needs_mapping');
  });

  it('own (only mine), library (through the library service)', async () => {
    const s = await setup();
    const file = await s.upload('kraken-ledger.csv', KRAKEN_CSV);
    const bobs = await s.mappings.create('bob', {
      spec: KRAKEN.spec,
      origin: 'manual',
    });
    await expect(s.preview(file.id, 'own', bobs.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    s.fake.specs.set('lib-1', KRAKEN.spec);
    const preview = await s.preview(file.id, 'library', 'lib-1');
    expect(preview.totals.errors).toBe(0);
    await expect(
      s.preview(file.id, 'standard', 'kraken-ledger', 'bob'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
