import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { CommandBus } from '@nestjs/cqrs';
import { validateMappingSpec } from '@lazykoins/engine';
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
import {
  DeleteMappingCommand,
  DeleteMappingHandler,
} from '../../mappings/application/commands/mapping.commands';
import { InMemoryImportMappingRepository } from '../../mappings/testing/in-memory-import-mapping.repository';
import { InMemoryProjectRepository } from '../../projects/testing/in-memory-project.repository';
import { LIBRARY_LIMITS } from '../domain/library-mapping';
import { InMemoryLibraryRepository } from '../testing/in-memory-library.repository';
import {
  DeleteLibraryMappingCommand,
  DeleteLibraryMappingHandler,
  type PublishInput,
  PublishLibraryMappingCommand,
  PublishLibraryMappingHandler,
  RateLibraryMappingCommand,
  RateLibraryMappingHandler,
  TakeLibraryMappingCommand,
  TakeLibraryMappingHandler,
} from './library.commands';
import {
  GetLibraryMappingHandler,
  GetLibraryMappingQuery,
  ProjectLibraryMatchesHandler,
  ProjectLibraryMatchesQuery,
  ReviewPublicationHandler,
  ReviewPublicationQuery,
  SearchLibraryHandler,
  SearchLibraryQuery,
} from './library.queries';
import { LibraryRuntime } from './library-runtime';

/** The engine's synthetic fixtures — never real data (CLAUDE.md, Private data). */
const ENGINE = resolve(__dirname, '../../../../../libs/engine/src');
const KRAKEN_SPEC = JSON.parse(
  readFileSync(
    resolve(ENGINE, 'mapping/fixtures/kraken-ledger.mapping.json'),
    'utf8',
  ),
) as Record<string, unknown>;
const KRAKEN_CSV = new Uint8Array(
  readFileSync(resolve(ENGINE, 'mapping/fixtures/kraken-ledger-classic.csv')),
);

/** The Kraken spec with planted personal data (invented values). */
const PLANTED = {
  ...KRAKEN_SPEC,
  description: 'Mein Export, Fragen an anna.example@example.org',
  filters: [
    { column: 'txid', empty: true },
    { column: 'refid', equals: ['AB12345678'] },
  ],
};

async function setup(enabled = true) {
  const projects = new InMemoryProjectRepository();
  const files = new InMemoryProjectFileRepository();
  const mappings = new InMemoryImportMappingRepository(files);
  const library = new InMemoryLibraryRepository();
  const analysis = new FileAnalysisService(new SourceFileReader(), mappings);
  let now = new Date('2026-10-08T10:00:00.000Z');
  const runtime = new LibraryRuntime(enabled, () => now);
  const change = new ChangeProjectFileHandler(
    projects,
    files,
    mappings,
    analysis,
  );
  const bus = {
    execute: (command: ChangeProjectFileCommand) => change.execute(command),
  } as unknown as CommandBus;
  const project = await projects.create('anna', {
    name: 'Steuern 2025',
    taxYear: 2025,
    country: 'CH',
    canton: 'ZH',
    notes: '',
  });
  const bobProject = await projects.create('bob', {
    name: 'Bob 2025',
    taxYear: 2025,
    country: 'CH',
    canton: 'BE',
    notes: '',
  });
  const own = await mappings.create('anna', {
    spec: (validateMappingSpec(PLANTED) as { ok: true; spec: never }).spec,
    origin: 'manual',
  });
  const publish = new PublishLibraryMappingHandler(library, mappings, runtime);
  const upload = new UploadProjectFileHandler(projects, files, analysis);
  return {
    projects,
    files,
    mappings,
    library,
    runtime,
    project,
    bobProject,
    own,
    setNow: (iso: string) => {
      now = new Date(iso);
      library.now = iso;
    },
    publish: (user: string, input: PublishInput) =>
      publish.execute(new PublishLibraryMappingCommand(user, input)),
    review: (
      user: string,
      input: Parameters<ReviewPublicationHandler['execute']>[0]['request'],
    ) =>
      new ReviewPublicationHandler(library, mappings, runtime).execute(
        new ReviewPublicationQuery(user, input),
      ),
    search: (user: string) =>
      new SearchLibraryHandler(library, runtime).execute(
        new SearchLibraryQuery(user, {}),
      ),
    get: (user: string, id: string) =>
      new GetLibraryMappingHandler(library, runtime).execute(
        new GetLibraryMappingQuery(user, id),
      ),
    remove: (user: string, id: string) =>
      new DeleteLibraryMappingHandler(library, runtime).execute(
        new DeleteLibraryMappingCommand(user, id),
      ),
    rate: (user: string, id: string, stars: number | null) =>
      new RateLibraryMappingHandler(library, runtime).execute(
        new RateLibraryMappingCommand(user, id, stars),
      ),
    take: (
      user: string,
      id: string,
      target?: { projectId: string; projectFileId: string },
    ) =>
      new TakeLibraryMappingHandler(
        library,
        mappings,
        projects,
        files,
        runtime,
        bus,
      ).execute(new TakeLibraryMappingCommand(user, id, target)),
    matches: (user: string, projectId: string) =>
      new ProjectLibraryMatchesHandler(
        library,
        projects,
        files,
        analysis,
        runtime,
      ).execute(new ProjectLibraryMatchesQuery(user, projectId)),
    upload: (user: string, projectId: string) =>
      upload.execute(
        new UploadProjectFileCommand(
          user,
          projectId,
          'kraken-ledger.csv',
          KRAKEN_CSV,
        ),
      ),
  };
}

/** Anna publishes her mapping with every finding removed. */
async function published(t: Awaited<ReturnType<typeof setup>>) {
  const review = await t.review('anna', { mappingId: t.own.id });
  return t.publish('anna', {
    mappingId: t.own.id,
    remove: review.findings.filter((f) => f.removable).map((f) => f.path),
    authorName: '  Krypto Anna ',
    confirmed: true,
  });
}

describe('publish (F5.15): review, privacy scan, confirmation', () => {
  it('reviews the exact public JSON with its privacy findings, removable on request', async () => {
    const t = await setup();
    const review = await t.review('anna', { mappingId: t.own.id });
    expect(review.findings.map((f) => [f.path, f.kind])).toEqual([
      ['/description', 'email'],
      ['/filters/1/equals/0', 'accountId'],
    ]);
    expect(review.target).toBeNull();
    expect(review.existing).toBeNull();
    const cleaned = await t.review('anna', {
      mappingId: t.own.id,
      remove: review.findings.map((f) => f.path),
    });
    expect(cleaned.findings).toEqual([]);
    expect(cleaned.spec.description).toBeUndefined();
    expect(cleaned.spec.filters).toEqual([{ column: 'txid', empty: true }]);
    // The review stores nothing.
    expect(t.library.rows.size).toBe(0);
  });

  it('refuses without confirmation, with remaining findings, and too large specs', async () => {
    const t = await setup();
    await expect(
      t.publish('anna', { mappingId: t.own.id, confirmed: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const refused = await t
      .publish('anna', { mappingId: t.own.id, confirmed: true })
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(UnprocessableEntityException);
    const body = (refused as UnprocessableEntityException).getResponse() as {
      code: string;
      findings: { path: string; kind: string }[];
    };
    expect(body.code).toBe('privacyFindings');
    // The refusal names paths and kinds — never the values.
    expect(JSON.stringify(body)).not.toContain('anna.example@example.org');
    // The texts next to the spec are scanned too (description, pseudonym).
    const typed = await t
      .publish('anna', {
        mappingId: t.own.id,
        remove: ['/description', '/filters/1/equals/0'],
        description: 'Fragen an anna.example@example.org',
        authorName: 'CH9300762011623852957',
        confirmed: true,
      })
      .catch((error: unknown) => error);
    expect(
      (
        (typed as UnprocessableEntityException).getResponse() as {
          findings: { path: string; kind: string }[];
        }
      ).findings,
    ).toEqual([
      { path: '/description', kind: 'email', removable: false },
      { path: '/authorName', kind: 'iban', removable: false },
    ]);
    const huge = {
      ...KRAKEN_SPEC,
      assets: {
        rewrites: [],
        aliases: Object.fromEntries(
          Array.from({ length: 6000 }, (_, i) => [`X${i}`, 'BTC']),
        ),
      },
    };
    const tooLarge = await t
      .publish('anna', { spec: huge, confirmed: true })
      .catch((error: unknown) => error);
    expect(
      (tooLarge as UnprocessableEntityException).getResponse(),
    ).toMatchObject({ code: 'specTooLarge' });
    expect(t.library.rows.size).toBe(0);
  });

  it('publishes under a pseudonym (never the profile), acknowledging kept findings explicitly', async () => {
    const t = await setup();
    const entry = await published(t);
    expect(entry).toMatchObject({
      name: 'Kraken Ledger',
      platform: 'kraken',
      version: 1,
      authorName: 'Krypto Anna',
      mine: true,
      ratingAverage: null,
    });
    expect(JSON.stringify(entry)).not.toContain('anna@');
    expect(entry).not.toHaveProperty('authorId');
    const kept = await t.publish('anna', {
      spec: PLANTED,
      confirmed: true,
      acknowledgeFindings: true,
    });
    expect(kept.authorName).toBeNull();
  });

  it('bumps the version of my own entry; the same spec twice is a 409', async () => {
    const t = await setup();
    const entry = await published(t);
    const again = await t
      .publish('anna', {
        mappingId: t.own.id,
        remove: ['/description', '/filters/1/equals/0'],
        confirmed: true,
      })
      .catch((error: unknown) => error);
    expect(again).toBeInstanceOf(ConflictException);
    const review = await t.review('anna', { mappingId: t.own.id });
    expect(review.existing).toEqual({ id: entry.id, version: 1 });
    const v2 = await t.publish('anna', {
      mappingId: t.own.id,
      libraryId: entry.id,
      remove: ['/description', '/filters/1/equals/0'],
      description: 'Jetzt mit Beschreibung',
      confirmed: true,
    });
    expect(v2).toMatchObject({
      id: entry.id,
      version: 2,
      description: 'Jetzt mit Beschreibung',
    });
  });

  it('caps new entries per author and day (spam guard)', async () => {
    const t = await setup();
    for (let i = 0; i < LIBRARY_LIMITS.publishesPerDay; i += 1) {
      await t.publish('anna', {
        spec: { ...KRAKEN_SPEC, name: `Kraken ${i}` },
        confirmed: true,
      });
    }
    const limited = await t
      .publish('anna', {
        spec: { ...KRAKEN_SPEC, name: 'One too many' },
        confirmed: true,
      })
      .catch((error: unknown) => error);
    expect((limited as HttpException).getStatus()).toBe(429);
    expect((limited as HttpException).getResponse()).toMatchObject({
      code: 'publishLimit',
    });
    t.setNow('2026-10-09T10:00:01.000Z');
    await expect(
      t.publish('anna', {
        spec: { ...KRAKEN_SPEC, name: 'Next day' },
        confirmed: true,
      }),
    ).resolves.toMatchObject({ name: 'Next day' });
  });

  it('publishes only my own mapping, and new versions only of my own entry (404, like missing)', async () => {
    const t = await setup();
    const entry = await published(t);
    await expect(
      t.publish('bob', { mappingId: t.own.id, confirmed: true }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      t.publish('bob', {
        spec: KRAKEN_SPEC,
        libraryId: entry.id,
        confirmed: true,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect((await t.get('anna', entry.id)).version).toBe(1);
  });
});

describe('delete (F5.15): only the author; soft delete; copies stay', () => {
  it('lets only the author delete; others get 404; the copy keeps working', async () => {
    const t = await setup();
    const entry = await published(t);
    const taken = await t.take('bob', entry.id);
    await expect(t.remove('bob', entry.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await t.remove('anna', entry.id);
    // Gone from the library for everyone, the row stays (audit).
    expect(await t.search('bob')).toEqual([]);
    await expect(t.get('anna', entry.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(t.library.rows.get(entry.id)?.deletedAt).toBe(
      '2026-10-08T10:00:00.000Z',
    );
    // Bob's copy is his own mapping and reads files as before.
    const copy = await t.mappings.findById(taken.mapping.id);
    expect(copy).toMatchObject({
      ownerId: 'bob',
      origin: 'library',
      library: { id: entry.id, version: 1 },
    });
    const file = await t.upload('bob', t.bobProject.id);
    expect(file.mappingId).toBe(taken.mapping.id);
    expect(file.status).toBe('mapped');
    // Deleting twice is a 404, as is taking a deleted entry.
    await expect(t.remove('anna', entry.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(t.take('bob', entry.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('take (F5.16): always a private copy', () => {
  it('copies into my mappings (origin library), reuses the same version, counts usage', async () => {
    const t = await setup();
    const entry = await published(t);
    const first = await t.take('bob', entry.id);
    expect(first.created).toBe(true);
    expect(first.mapping).toMatchObject({
      ownerId: 'bob',
      origin: 'library',
      library: { id: entry.id, version: 1 },
    });
    const second = await t.take('bob', entry.id);
    expect(second).toMatchObject({ created: false });
    expect(second.mapping.id).toBe(first.mapping.id);
    expect((await t.get('bob', entry.id)).usageCount).toBe(1);
    // Editing the library entry (a new version) leaves the copy untouched.
    await t.publish('anna', {
      spec: { ...KRAKEN_SPEC, name: 'Kraken Ledger v2' },
      libraryId: entry.id,
      confirmed: true,
    });
    expect((await t.mappings.findById(first.mapping.id))?.name).toBe(
      'Kraken Ledger',
    );
    const v2 = await t.take('bob', entry.id);
    expect(v2).toMatchObject({ created: true });
    expect(v2.mapping.library).toEqual({ id: entry.id, version: 2 });
  });

  it('copies and assigns to a file that needs a mapping; checks the file before copying', async () => {
    const t = await setup();
    const entry = await published(t);
    const file = await t.upload('bob', t.bobProject.id);
    expect(file.status).toBe('needs_mapping');
    const matches = await t.matches('bob', t.bobProject.id);
    expect(matches).toEqual([
      expect.objectContaining({
        projectFileId: file.id,
        matches: [expect.objectContaining({ id: entry.id, mine: false })],
      }),
    ]);
    // Someone else's project / file: 404 before anything is copied.
    await expect(
      t.take('bob', entry.id, {
        projectId: t.project.id,
        projectFileId: file.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await t.mappings.findByOwner('bob')).toEqual([]);
    const taken = await t.take('bob', entry.id, {
      projectId: t.bobProject.id,
      projectFileId: file.id,
    });
    expect(taken.file).toMatchObject({ id: file.id, status: 'mapped' });
    expect(taken.file?.mappingId).toBe(taken.mapping.id);
    expect(await t.matches('bob', t.bobProject.id)).toEqual([]);
    // Someone else's project for the matches: 404.
    await expect(t.matches('anna', t.bobProject.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('deleting my copy does not touch the library entry', async () => {
    const t = await setup();
    const entry = await published(t);
    const taken = await t.take('bob', entry.id);
    await new DeleteMappingHandler(t.mappings, t.files, t.projects).execute(
      new DeleteMappingCommand('bob', taken.mapping.id),
    );
    expect((await t.get('bob', entry.id)).version).toBe(1);
  });
});

describe('rating (F5.17)', () => {
  it('keeps one rating per user, changeable and removable, with the aggregate', async () => {
    const t = await setup();
    const entry = await published(t);
    expect(await t.rate('bob', entry.id, 4)).toMatchObject({
      ratingAverage: 4,
      ratingCount: 1,
      myRating: 4,
    });
    await t.rate('carla', entry.id, 5);
    expect(await t.rate('bob', entry.id, 2)).toMatchObject({
      ratingAverage: 3.5,
      ratingCount: 2,
      myRating: 2,
    });
    expect(await t.rate('bob', entry.id, null)).toMatchObject({
      ratingAverage: 5,
      ratingCount: 1,
      myRating: null,
    });
    expect((await t.search('carla'))[0]).toMatchObject({ myRating: 5 });
  });

  it('refuses the author’s own rating and invalid stars', async () => {
    const t = await setup();
    const entry = await published(t);
    const own = await t.rate('anna', entry.id, 5).catch((e: unknown) => e);
    expect((own as ConflictException).getResponse()).toMatchObject({
      code: 'ownEntry',
    });
    await expect(t.rate('bob', entry.id, 6)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(t.rate('bob', 'nope', 3)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('desktop (AUTH_MODE=local): the library does not exist', () => {
  it('answers 404 to every handler', async () => {
    const t = await setup(false);
    const attempts: Promise<unknown>[] = [
      t.search('anna'),
      t.get('anna', 'lib1'),
      t.review('anna', { mappingId: t.own.id }),
      t.publish('anna', { mappingId: t.own.id, confirmed: true }),
      t.remove('anna', 'lib1'),
      t.rate('anna', 'lib1', 3),
      t.take('anna', 'lib1'),
      t.matches('anna', t.project.id),
    ];
    for (const attempt of attempts) {
      await expect(attempt).rejects.toBeInstanceOf(NotFoundException);
    }
  });
});
