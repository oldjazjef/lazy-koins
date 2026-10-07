import {
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  CommandBus,
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import { ChangeProjectFileCommand } from '../../files/application/commands/change-project-file.command';
import {
  assertOpen,
  loadOwnProjectFile,
  readableOf,
} from '../../files/application/file-access';
import { SourceFileReader } from '../../files/application/source-file-reader';
import type { ProjectFile } from '../../files/domain/project-file';
import { ProjectFileRepositoryPort } from '../../files/ports/project-file.repository.port';
import type { RemoteEntry } from '../../integrations/library/remote-library.port';
import { ImportMappingRepositoryPort } from '../../mappings/ports/import-mapping.repository.port';
import { loadOwnProject } from '../../projects/application/project-access';
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import type {
  LibraryEntryDetail,
  LibraryEntryView,
} from '../domain/library-mapping';
import { PUBLIC_LIBRARY_LIMITS } from '../domain/public-library';
import {
  headerMatchRequest,
  type LibraryStatus,
  normaliseRemoteUrl,
  type RemoteLibrarySettings,
  type SaveRemoteLibrarySettings,
  validateRemoteSpec,
} from '../domain/remote-library';
import { RemoteLibrarySettingsRepositoryPort } from '../ports/remote-library-settings.repository.port';
import type { TakenLibraryMapping } from './library.commands';
import type { LibraryFileMatches, LibrarySearch } from './library.queries';
import { LibraryRuntime } from './library-runtime';
import { incompatibleSpec, RemoteLibraryGate } from './remote-library-gate';

/**
 * F5.18, desktop (`AUTH_MODE=local`, the library's `remote` mode): search, show and take from
 * the mapping library of a linked web deployment, through its public read-only endpoint. The
 * other server's answers are **data**: texts are shown as texts, and a spec is validated again
 * (`validateRemoteSpec`) before it becomes the user's own mapping. Nothing is ever published,
 * rated or deleted from here.
 */

/** A remote entry as the app shows library entries (never mine, never rated by me). */
export function remoteView(entry: RemoteEntry): LibraryEntryView {
  return {
    id: entry.id,
    name: entry.name,
    platform: entry.platform,
    description: entry.description,
    fingerprint: entry.fingerprint,
    version: entry.version,
    authorName: entry.authorName,
    ratingAverage: entry.ratingAverage,
    ratingCount: entry.ratingCount,
    usageCount: entry.usageCount,
    publishedAt: entry.publishedAt,
    updatedAt: entry.updatedAt,
    mine: false,
    myRating: null,
  };
}

/** Entries one search fetches at most (two pages of the public endpoint). */
export const REMOTE_SEARCH_MAX = 100;

export class SearchRemoteLibraryQuery {
  constructor(
    readonly userId: string,
    readonly search: LibrarySearch,
  ) {}
}

@QueryHandler(SearchRemoteLibraryQuery)
export class SearchRemoteLibraryHandler implements IQueryHandler<
  SearchRemoteLibraryQuery,
  LibraryEntryView[]
> {
  constructor(
    private readonly gate: RemoteLibraryGate,
    private readonly runtime: LibraryRuntime,
  ) {}

  async execute({
    userId,
    search,
  }: SearchRemoteLibraryQuery): Promise<LibraryEntryView[]> {
    this.runtime.assertRemote();
    const server = await this.gate.server(userId);
    const out: RemoteEntry[] = [];
    let total = Infinity;
    while (out.length < Math.min(total, REMOTE_SEARCH_MAX)) {
      const page = await this.gate.call(() =>
        this.gate.remote.search(server, {
          search: search.query?.slice(0, PUBLIC_LIBRARY_LIMITS.maxSearchLength),
          platform: search.platform,
          sort: search.sort,
          offset: out.length,
          limit: PUBLIC_LIBRARY_LIMITS.maxPageSize,
        }),
      );
      out.push(...page.items);
      total = page.total;
      if (page.items.length === 0) break;
    }
    const seen = new Set<string>();
    return out
      .filter((entry) => !seen.has(entry.id) && seen.add(entry.id))
      .filter(
        (entry) =>
          search.fingerprint === undefined ||
          entry.fingerprint === search.fingerprint,
      )
      .slice(0, REMOTE_SEARCH_MAX)
      .map(remoteView);
  }
}

export class GetRemoteLibraryMappingQuery {
  constructor(
    readonly userId: string,
    readonly libraryId: string,
  ) {}
}

/** One remote entry with its spec — validated first (422 `incompatibleSpec` when too new). */
@QueryHandler(GetRemoteLibraryMappingQuery)
export class GetRemoteLibraryMappingHandler implements IQueryHandler<
  GetRemoteLibraryMappingQuery,
  LibraryEntryDetail
> {
  constructor(
    private readonly gate: RemoteLibraryGate,
    private readonly runtime: LibraryRuntime,
  ) {}

  async execute({
    userId,
    libraryId,
  }: GetRemoteLibraryMappingQuery): Promise<LibraryEntryDetail> {
    this.runtime.assertRemote();
    const server = await this.gate.server(userId);
    const entry = await this.gate.call(() =>
      this.gate.remote.get(server, libraryId),
    );
    const checked = validateRemoteSpec(entry.spec);
    if (!checked.ok) throw incompatibleSpec(checked.paths);
    return { ...remoteView(entry), spec: checked.spec };
  }
}

export class RemoteProjectLibraryMatchesQuery {
  constructor(
    readonly userId: string,
    readonly projectId: string,
  ) {}
}

/** Files of one project asked about per call at most (the public endpoint is rate-limited). */
const MAX_FILES = 20;
/** Answers are kept this long per server + header row + file name (in memory). */
const MATCH_CACHE_MS = 5 * 60_000;
const MATCH_CACHE_SIZE = 200;

/**
 * F5.16 on the desktop: for each file of my project that **needs a mapping**, the linked
 * library's entries that would read it. Only with suggestions switched on; what leaves the
 * device per file is its header row and base file name (`headerMatchRequest`) — never a data
 * row. Off / not linked / offline = an empty list, no network.
 */
@QueryHandler(RemoteProjectLibraryMatchesQuery)
export class RemoteProjectLibraryMatchesHandler implements IQueryHandler<
  RemoteProjectLibraryMatchesQuery,
  LibraryFileMatches[]
> {
  private readonly cache = new Map<
    string,
    { at: number; entries: RemoteEntry[] }
  >();

  constructor(
    private readonly gate: RemoteLibraryGate,
    private readonly projects: ProjectRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
    private readonly reader: SourceFileReader,
    private readonly runtime: LibraryRuntime,
  ) {}

  async execute({
    userId,
    projectId,
  }: RemoteProjectLibraryMatchesQuery): Promise<LibraryFileMatches[]> {
    this.runtime.assertRemote();
    const project = await loadOwnProject(this.projects, userId, projectId);
    const status = await this.gate.status(userId);
    if (!status.suggestions || status.server === null) return [];
    const server = status.server;
    const waiting = (await this.files.listByProject(project.id))
      .filter((file) => file.status === 'needs_mapping')
      .slice(0, MAX_FILES);
    const out: LibraryFileMatches[] = [];
    for (const file of waiting) {
      const { readable } = await readableOf(this.files, file);
      if (readable.kind === 'pdf') continue;
      let source;
      try {
        source = await this.reader.read(readable);
      } catch {
        continue; // unreadable: nothing to suggest
      }
      const request = headerMatchRequest(source, file.displayName);
      if (!request) continue;
      const entries = await this.matches(server, request);
      if (entries.length === 0) continue;
      out.push({
        projectFileId: file.id,
        displayName: file.displayName,
        matches: entries.map(remoteView),
      });
    }
    return out;
  }

  private async matches(
    server: string,
    request: { fileName: string; headers: readonly string[] },
  ): Promise<RemoteEntry[]> {
    const key = JSON.stringify([server, request.fileName, request.headers]);
    const now = this.runtime.now().getTime();
    const hit = this.cache.get(key);
    if (hit && now - hit.at < MATCH_CACHE_MS) return hit.entries;
    const entries = await this.gate.call(() =>
      this.gate.remote.match(server, request),
    );
    if (this.cache.size >= MATCH_CACHE_SIZE) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { at: now, entries });
    return entries;
  }
}

export class TakeRemoteLibraryMappingCommand {
  constructor(
    readonly userId: string,
    readonly libraryId: string,
    readonly target?: {
      readonly projectId: string;
      readonly projectFileId: string;
    },
  ) {}
}

/**
 * Taking from the linked library (F5.16 on the desktop): the entry's spec is validated again and
 * stored as **my own mapping** (origin `library`, reference = server + entry id + version). With
 * a target the file's ownership, the open project and the table kind are checked first, then the
 * copy is assigned. A copy of the same version from the same server is reused. Nothing is
 * reported back to the server.
 */
@CommandHandler(TakeRemoteLibraryMappingCommand)
export class TakeRemoteLibraryMappingHandler implements ICommandHandler<
  TakeRemoteLibraryMappingCommand,
  TakenLibraryMapping
> {
  constructor(
    private readonly gate: RemoteLibraryGate,
    private readonly mappings: ImportMappingRepositoryPort,
    private readonly projects: ProjectRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
    private readonly runtime: LibraryRuntime,
    private readonly commands: CommandBus,
  ) {}

  async execute({
    userId,
    libraryId,
    target,
  }: TakeRemoteLibraryMappingCommand): Promise<TakenLibraryMapping> {
    this.runtime.assertRemote();
    if (target) {
      const { project, file } = await loadOwnProjectFile(
        this.projects,
        this.files,
        userId,
        target.projectId,
        target.projectFileId,
      );
      assertOpen(project);
      const { readable } = await readableOf(this.files, file);
      if (readable.kind === 'pdf') {
        throw new BadRequestException(
          'A mapping reads tables (CSV, XLSX), not PDFs',
        );
      }
    }
    const server = await this.gate.server(userId);
    const entry = await this.gate.call(() =>
      this.gate.remote.get(server, libraryId),
    );
    if (entry.id !== libraryId) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'The server answered with another entry',
        code: 'libraryBadResponse',
      });
    }
    const checked = validateRemoteSpec(entry.spec);
    if (!checked.ok) throw incompatibleSpec(checked.paths);
    const reuse = (await this.mappings.findByLibrary(userId, entry.id)).find(
      (mapping) =>
        mapping.library?.version === entry.version &&
        mapping.library.server === server,
    );
    const mapping =
      reuse ??
      (await this.mappings.create(userId, {
        spec: checked.spec,
        origin: 'library',
        library: { id: entry.id, version: entry.version, server },
      }));
    let file: ProjectFile | null = null;
    if (target) {
      file = await this.commands.execute<ChangeProjectFileCommand, ProjectFile>(
        new ChangeProjectFileCommand(
          userId,
          target.projectId,
          target.projectFileId,
          { mode: 'mapping', mappingId: mapping.id },
        ),
      );
    }
    return { mapping, created: !reuse, file };
  }
}

// --- Settings (Einstellungen › Bibliothek, desktop only) ---

export class LibraryStatusQuery {
  constructor(readonly userId: string) {}
}

/** `GET /api/library/status` — web and desktop. */
@QueryHandler(LibraryStatusQuery)
export class LibraryStatusHandler implements IQueryHandler<
  LibraryStatusQuery,
  LibraryStatus
> {
  constructor(private readonly gate: RemoteLibraryGate) {}

  execute({ userId }: LibraryStatusQuery): Promise<LibraryStatus> {
    return this.gate.status(userId);
  }
}

export class GetRemoteLibrarySettingsQuery {
  constructor(readonly userId: string) {}
}

@QueryHandler(GetRemoteLibrarySettingsQuery)
export class GetRemoteLibrarySettingsHandler implements IQueryHandler<
  GetRemoteLibrarySettingsQuery,
  RemoteLibrarySettings
> {
  constructor(
    private readonly gate: RemoteLibraryGate,
    private readonly runtime: LibraryRuntime,
  ) {}

  async execute({
    userId,
  }: GetRemoteLibrarySettingsQuery): Promise<RemoteLibrarySettings> {
    this.runtime.assertRemote();
    return this.gate.settingsOf(userId);
  }
}

export class SaveRemoteLibrarySettingsCommand {
  constructor(
    readonly userId: string,
    readonly settings: SaveRemoteLibrarySettings,
  ) {}
}

/** 422 `libraryUrlInvalid` with the `problem` (https only, no credentials, …). */
export function checkedRemoteUrl(raw: string): string {
  if (raw.trim() === '') return '';
  const normalised = normaliseRemoteUrl(raw);
  if (!normalised.ok) {
    throw new UnprocessableEntityException({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: 'This address cannot be used for the mapping library',
      code: 'libraryUrlInvalid',
      problem: normalised.problem,
    });
  }
  return normalised.url;
}

/** Saves the link. No network: "Verbindung testen" is its own request. Empty URL = off. */
@CommandHandler(SaveRemoteLibrarySettingsCommand)
export class SaveRemoteLibrarySettingsHandler implements ICommandHandler<
  SaveRemoteLibrarySettingsCommand,
  RemoteLibrarySettings
> {
  constructor(
    private readonly settings: RemoteLibrarySettingsRepositoryPort,
    private readonly runtime: LibraryRuntime,
  ) {}

  async execute({
    userId,
    settings,
  }: SaveRemoteLibrarySettingsCommand): Promise<RemoteLibrarySettings> {
    this.runtime.assertRemote();
    const url = checkedRemoteUrl(settings.url);
    return this.settings.save(userId, {
      url,
      enabled: url !== '' && settings.enabled,
      suggestions: settings.suggestions,
    });
  }
}

export class TestRemoteLibraryQuery {
  constructor(
    readonly userId: string,
    /** The form's unsaved address; absent = the saved one. */
    readonly url?: string,
  ) {}
}

export interface RemoteLibraryTest {
  readonly server: string;
  /** Entries the server's library has. */
  readonly total: number;
}

/**
 * "Verbindung testen": one list request (one entry) against the given or saved address. Needs
 * the online switch (F11.3), not the saved on/off — the user is about to switch it on.
 */
@QueryHandler(TestRemoteLibraryQuery)
export class TestRemoteLibraryHandler implements IQueryHandler<
  TestRemoteLibraryQuery,
  RemoteLibraryTest
> {
  constructor(
    private readonly gate: RemoteLibraryGate,
    private readonly runtime: LibraryRuntime,
  ) {}

  async execute({
    userId,
    url,
  }: TestRemoteLibraryQuery): Promise<RemoteLibraryTest> {
    this.runtime.assertRemote();
    const typed = url === undefined ? undefined : checkedRemoteUrl(url);
    const saved = (await this.gate.settingsOf(userId)).url;
    const server = await this.gate.server(userId, typed ?? saved);
    const page = await this.gate.call(() =>
      this.gate.remote.search(server, { limit: 1 }),
    );
    return { server, total: page.total };
  }
}
