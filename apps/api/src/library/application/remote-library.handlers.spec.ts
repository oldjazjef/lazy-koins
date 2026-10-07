import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BadGatewayException,
  ConflictException,
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { CommandBus } from '@nestjs/cqrs';
import { MAPPING_VERSION } from '@lazykoins/engine';
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
  type RemoteEntry,
  type RemoteEntryDetail,
  RemoteLibraryError,
  RemoteLibraryPort,
  type RemoteMatchRequest,
  type RemotePage,
  type RemoteSearch,
} from '../../integrations/library/remote-library.port';
import { InMemoryImportMappingRepository } from '../../mappings/testing/in-memory-import-mapping.repository';
import { InMemoryProjectRepository } from '../../projects/testing/in-memory-project.repository';
import { InMemoryUserSettingsRepository } from '../../settings/testing/in-memory-user-settings.repository';
import { InMemoryRemoteLibrarySettingsRepository } from '../testing/in-memory-remote-library-settings.repository';
import { LibraryRuntime } from './library-runtime';
import { RemoteLibraryGate } from './remote-library-gate';
import {
  GetRemoteLibraryMappingHandler,
  GetRemoteLibraryMappingQuery,
  LibraryStatusHandler,
  LibraryStatusQuery,
  RemoteProjectLibraryMatchesHandler,
  RemoteProjectLibraryMatchesQuery,
  SaveRemoteLibrarySettingsCommand,
  SaveRemoteLibrarySettingsHandler,
  SearchRemoteLibraryHandler,
  SearchRemoteLibraryQuery,
  TakeRemoteLibraryMappingCommand,
  TakeRemoteLibraryMappingHandler,
  TestRemoteLibraryHandler,
  TestRemoteLibraryQuery,
} from './remote-library.handlers';

/** The engine's synthetic fixtures — never real data. */
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

const SERVER = 'https://lazykoins.example.ch';
const ID = '01890a5d-ac96-774b-bcce-b302099a8057';
const ENTRY: RemoteEntry = {
  id: ID,
  name: 'Kraken Ledger',
  platform: 'kraken',
  description: 'Synthetic',
  authorName: 'Krakenfan',
  version: 3,
  fingerprint: 'aclass|amount|asset|balance|fee|refid|subtype|time|txid|type',
  ratingAverage: 4,
  ratingCount: 1,
  usageCount: 9,
  publishedAt: '2026-10-08T10:00:00.000Z',
  updatedAt: '2026-10-08T10:00:00.000Z',
};

/** A scripted server: records every call, answers from `entries` / `spec`, or fails. */
class FakeRemote extends RemoteLibraryPort {
  readonly calls: { kind: string; baseUrl: string; payload: unknown }[] = [];
  spec: Record<string, unknown> = KRAKEN_SPEC;
  entries: RemoteEntry[] = [ENTRY];
  fail?: RemoteLibraryError;

  async search(baseUrl: string, search: RemoteSearch): Promise<RemotePage> {
    this.calls.push({ kind: 'search', baseUrl, payload: search });
    if (this.fail) throw this.fail;
    const offset = search.offset ?? 0;
    const limit = search.limit ?? 20;
    return {
      items: this.entries.slice(offset, offset + limit),
      total: this.entries.length,
      offset,
      limit,
    };
  }

  async get(baseUrl: string, id: string): Promise<RemoteEntryDetail> {
    this.calls.push({ kind: 'get', baseUrl, payload: id });
    if (this.fail) throw this.fail;
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) throw new RemoteLibraryError('notFound', 'HTTP 404');
    return { ...entry, spec: this.spec };
  }

  async match(
    baseUrl: string,
    request: RemoteMatchRequest,
  ): Promise<RemoteEntry[]> {
    this.calls.push({ kind: 'match', baseUrl, payload: request });
    if (this.fail) throw this.fail;
    return this.entries;
  }
}

async function setup(options: { web?: boolean; online?: boolean } = {}) {
  const projects = new InMemoryProjectRepository();
  const files = new InMemoryProjectFileRepository();
  const mappings = new InMemoryImportMappingRepository(files);
  const reader = new SourceFileReader();
  const analysis = new FileAnalysisService(reader, mappings);
  const remote = new FakeRemote();
  const settings = new InMemoryRemoteLibrarySettingsRepository();
  const userSettings = new InMemoryUserSettingsRepository();
  const runtime = new LibraryRuntime(options.web ?? false, () => new Date(), {
    online: options.online ?? true,
  });
  const gate = new RemoteLibraryGate(settings, userSettings, remote, runtime);
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
  const other = await projects.create('bob', {
    name: 'Bob 2025',
    taxYear: 2025,
    country: 'CH',
    canton: 'BE',
    notes: '',
  });
  const upload = new UploadProjectFileHandler(projects, files, analysis);
  const matches = new RemoteProjectLibraryMatchesHandler(
    gate,
    projects,
    files,
    reader,
    runtime,
  );
  return {
    remote,
    settings,
    userSettings,
    mappings,
    files,
    project,
    other,
    link: (url = SERVER, enabled = true, suggestions = true) =>
      new SaveRemoteLibrarySettingsHandler(settings, runtime).execute(
        new SaveRemoteLibrarySettingsCommand('anna', {
          url,
          enabled,
          suggestions,
        }),
      ),
    status: () =>
      new LibraryStatusHandler(gate).execute(new LibraryStatusQuery('anna')),
    search: () =>
      new SearchRemoteLibraryHandler(gate, runtime).execute(
        new SearchRemoteLibraryQuery('anna', { query: 'kraken' }),
      ),
    get: (id = ID) =>
      new GetRemoteLibraryMappingHandler(gate, runtime).execute(
        new GetRemoteLibraryMappingQuery('anna', id),
      ),
    take: (target?: { projectId: string; projectFileId: string }) =>
      new TakeRemoteLibraryMappingHandler(
        gate,
        mappings,
        projects,
        files,
        runtime,
        bus,
      ).execute(new TakeRemoteLibraryMappingCommand('anna', ID, target)),
    test: (url?: string) =>
      new TestRemoteLibraryHandler(gate, runtime).execute(
        new TestRemoteLibraryQuery('anna', url),
      ),
    matches: (projectId = project.id) =>
      matches.execute(new RemoteProjectLibraryMatchesQuery('anna', projectId)),
    upload: (user = 'anna', projectId = project.id) =>
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

function codeOf(error: unknown): unknown {
  return error instanceof HttpException
    ? (error.getResponse() as { code?: string }).code
    : undefined;
}

describe('remote library settings (F5.18, desktop)', () => {
  it('is empty and off by default — nothing goes online', async () => {
    const t = await setup();
    expect(await t.status()).toEqual({
      mode: 'remote',
      available: false,
      readOnly: true,
      server: null,
      suggestions: false,
      reason: 'libraryNotConfigured',
    });
    const error = await t.search().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(codeOf(error)).toBe('libraryNotConfigured');
    await t.upload();
    expect(await t.matches()).toEqual([]);
    expect(t.remote.calls).toEqual([]);
  });

  it('normalises the address and refuses unsafe ones (422 libraryUrlInvalid + problem)', async () => {
    const t = await setup();
    expect((await t.link('  https://LazyKoins.example.ch/api/ ')).url).toBe(
      SERVER,
    );
    for (const [url, problem] of [
      ['http://lazykoins.example.ch', 'httpsRequired'],
      ['https://anna:pw@example.ch', 'credentialsInUrl'],
      ['ftp://example.ch', 'invalidUrl'],
    ] as const) {
      const error = await t.link(url).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(
        (error as UnprocessableEntityException).getResponse(),
      ).toMatchObject({ code: 'libraryUrlInvalid', problem });
    }
    // An empty address switches the link off.
    expect(await t.link('', true)).toMatchObject({ url: '', enabled: false });
  });

  it('switched off by the user: not configured, no network', async () => {
    const t = await setup();
    await t.link(SERVER, false);
    expect(codeOf(await t.search().catch((e: unknown) => e))).toBe(
      'libraryNotConfigured',
    );
    expect((await t.status()).server).toBe(SERVER);
    expect(t.remote.calls).toEqual([]);
  });

  it('F11.3: the online switch and RATES_ONLINE=false keep it offline', async () => {
    const t = await setup();
    await t.link();
    await t.userSettings.save('anna', { onlineRates: false });
    expect(await t.status()).toMatchObject({
      available: false,
      suggestions: false,
      reason: 'offline',
    });
    expect(codeOf(await t.search().catch((e: unknown) => e))).toBe('offline');
    expect(codeOf(await t.test().catch((e: unknown) => e))).toBe('offline');
    await t.upload();
    expect(await t.matches()).toEqual([]);
    const operator = await setup({ online: false });
    await operator.link();
    expect(codeOf(await operator.search().catch((e: unknown) => e))).toBe(
      'offline',
    );
    expect([...t.remote.calls, ...operator.remote.calls]).toEqual([]);
  });

  it('tests the unsaved address without storing it', async () => {
    const t = await setup();
    expect(await t.test('https://other.example.ch/')).toEqual({
      server: 'https://other.example.ch',
      total: 1,
    });
    expect(t.remote.calls[0]).toMatchObject({
      kind: 'search',
      baseUrl: 'https://other.example.ch',
      payload: { limit: 1 },
    });
    expect(await t.settings.find('anna')).toBeNull();
    t.remote.fail = new RemoteLibraryError('timeout', 'no answer');
    const error = await t.test(SERVER).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadGatewayException);
    expect((error as HttpException).getResponse()).toMatchObject({
      code: 'libraryTimeout',
      detail: 'no answer',
    });
  });

  it('is a 404 on the web (the settings exist only on the desktop)', async () => {
    const t = await setup({ web: true });
    await expect(t.link()).rejects.toBeInstanceOf(NotFoundException);
    await expect(t.search()).rejects.toBeInstanceOf(NotFoundException);
    expect((await t.status()).mode).toBe('web');
  });
});

describe('remote library reads and take (F5.18)', () => {
  it('searches the linked server as read-only entries (never mine, never rated)', async () => {
    const t = await setup();
    await t.link();
    expect(await t.search()).toEqual([
      expect.objectContaining({ id: ID, mine: false, myRating: null }),
    ]);
    expect(t.remote.calls[0]).toMatchObject({
      baseUrl: SERVER,
      payload: { search: 'kraken', offset: 0, limit: 50 },
    });
  });

  it('fetches at most two pages', async () => {
    const t = await setup();
    await t.link();
    t.remote.entries = Array.from({ length: 140 }, (_, i) => ({
      ...ENTRY,
      id: `01890a5d-ac96-774b-bcce-${String(i).padStart(12, '0')}`,
    }));
    expect(await t.search()).toHaveLength(100);
    expect(t.remote.calls).toHaveLength(2);
  });

  it('maps server failures to coded 502s and a gone entry to 404', async () => {
    const t = await setup();
    await t.link();
    for (const [code, expected] of [
      ['network', 'libraryNetwork'],
      ['badResponse', 'libraryBadResponse'],
      ['disabled', 'libraryDisabled'],
      ['rateLimited', 'libraryRateLimited'],
    ] as const) {
      t.remote.fail = new RemoteLibraryError(code, 'x');
      expect(codeOf(await t.search().catch((e: unknown) => e))).toBe(expected);
    }
    t.remote.fail = undefined;
    await expect(
      t.get('01890a5d-ac96-774b-bcce-000000000000'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('takes a private copy with the source server, entry and version — reused for the same version', async () => {
    const t = await setup();
    await t.link();
    const first = await t.take();
    expect(first.created).toBe(true);
    expect(first.mapping).toMatchObject({
      ownerId: 'anna',
      origin: 'library',
      library: { id: ID, version: 3, server: SERVER },
    });
    const again = await t.take();
    expect(again.created).toBe(false);
    expect(again.mapping.id).toBe(first.mapping.id);
    // A copy with the same id from another server is not reused.
    await t.link('https://other.example.ch');
    expect((await t.take()).created).toBe(true);
    expect(await t.mappings.findByOwner('anna')).toHaveLength(2);
  });

  it('refuses a spec this app cannot read faithfully (422 incompatibleSpec), stores nothing', async () => {
    const t = await setup();
    await t.link();
    t.remote.spec = { ...KRAKEN_SPEC, counter: { column: 'x' } };
    let error = await t.take().catch((e: unknown) => e);
    expect(codeOf(error)).toBe('incompatibleSpec');
    expect(
      (error as HttpException).getResponse() as { paths: string[] },
    ).toMatchObject({ paths: ['/counter'] });
    t.remote.spec = { ...KRAKEN_SPEC, version: MAPPING_VERSION + 1 };
    error = await t.get().catch((e: unknown) => e);
    expect(codeOf(error)).toBe('incompatibleSpec');
    t.remote.spec = { ...KRAKEN_SPEC, match: 'broken' };
    expect(codeOf(await t.take().catch((e: unknown) => e))).toBe(
      'incompatibleSpec',
    );
    expect(await t.mappings.findByOwner('anna')).toEqual([]);
  });

  it('suggests per file with only the header row + file name, and assigns on take', async () => {
    const t = await setup();
    await t.link();
    const file = await t.upload();
    expect(file.status).toBe('needs_mapping');
    const found = await t.matches();
    expect(found).toEqual([
      expect.objectContaining({
        projectFileId: file.id,
        matches: [expect.objectContaining({ id: ID, mine: false })],
      }),
    ]);
    const sent = t.remote.calls.filter((c) => c.kind === 'match');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.payload).toEqual({
      fileName: 'kraken-ledger.csv',
      headers: [
        'txid',
        'refid',
        'time',
        'type',
        'subtype',
        'aclass',
        'asset',
        'amount',
        'fee',
        'balance',
      ],
    });
    // Cached: the same file is not sent again within minutes.
    await t.matches();
    expect(t.remote.calls.filter((c) => c.kind === 'match')).toHaveLength(1);
    // Someone else's file: 404 before anything is fetched or copied.
    const callsBefore = t.remote.calls.length;
    await expect(
      t.take({ projectId: t.other.id, projectFileId: file.id }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(t.remote.calls.length).toBe(callsBefore);
    const taken = await t.take({
      projectId: t.project.id,
      projectFileId: file.id,
    });
    expect(taken.file).toMatchObject({ id: file.id, status: 'mapped' });
    expect(taken.file?.mappingId).toBe(taken.mapping.id);
    expect(await t.matches()).toEqual([]);
  });

  it('asks nothing with suggestions off; someone else’s project is a 404', async () => {
    const t = await setup();
    await t.link(SERVER, true, false);
    await t.upload();
    expect(await t.matches()).toEqual([]);
    expect(t.remote.calls).toEqual([]);
    await expect(t.matches(t.other.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
