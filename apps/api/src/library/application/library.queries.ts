import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { normaliseHeader } from '@lazykoins/engine';
import { readableOf } from '../../files/application/file-access';
import { FileAnalysisService } from '../../files/application/file-analysis.service';
import { ProjectFileRepositoryPort } from '../../files/ports/project-file.repository.port';
import { ImportMappingRepositoryPort } from '../../mappings/ports/import-mapping.repository.port';
import { loadOwnProject } from '../../projects/application/project-access';
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import {
  entryView,
  type LibraryEntryDetail,
  type LibraryEntryView,
  type LibraryMapping,
  type LibrarySort,
  LIBRARY_LIMITS,
  PUBLISHES_PER_10_MIN,
  type PublishQuota,
  type PublishReview,
  searchEntries,
} from '../domain/library-mapping';
import { LibraryRepositoryPort } from '../ports/library.repository.port';
import {
  buildReview,
  loadActiveEntry,
  type PublishRequest,
} from './library-access';
import { LibraryRuntime } from './library-runtime';

async function views(
  library: LibraryRepositoryPort,
  userId: string,
  entries: readonly LibraryMapping[],
): Promise<LibraryEntryView[]> {
  const mine = await library.ratingsBy(
    userId,
    entries.map((entry) => entry.id),
  );
  return entries.map((entry) =>
    entryView(entry, userId, mine.get(entry.id) ?? null),
  );
}

export interface LibrarySearch {
  readonly query?: string;
  readonly platform?: string;
  readonly sort?: LibrarySort;
  /** Only entries whose fingerprint (normalised headers) equals this one. */
  readonly fingerprint?: string;
}

export class SearchLibraryQuery {
  constructor(
    readonly userId: string,
    readonly search: LibrarySearch,
  ) {}
}

/** The library (F5.17): every entry that is not deleted — public to every signed-in user. */
@QueryHandler(SearchLibraryQuery)
export class SearchLibraryHandler implements IQueryHandler<
  SearchLibraryQuery,
  LibraryEntryView[]
> {
  constructor(
    private readonly library: LibraryRepositoryPort,
    private readonly runtime: LibraryRuntime,
  ) {}

  async execute({
    userId,
    search,
  }: SearchLibraryQuery): Promise<LibraryEntryView[]> {
    this.runtime.assertEnabled();
    const found = searchEntries(await this.library.listActive(), search).filter(
      (entry) =>
        search.fingerprint === undefined ||
        entry.fingerprint === search.fingerprint,
    );
    return views(this.library, userId, found);
  }
}

export class GetLibraryMappingQuery {
  constructor(
    readonly userId: string,
    readonly libraryId: string,
  ) {}
}

/** One entry with its JSON. A deleted entry is a 404 for everyone, its author included. */
@QueryHandler(GetLibraryMappingQuery)
export class GetLibraryMappingHandler implements IQueryHandler<
  GetLibraryMappingQuery,
  LibraryEntryDetail
> {
  constructor(
    private readonly library: LibraryRepositoryPort,
    private readonly runtime: LibraryRuntime,
  ) {}

  async execute({
    userId,
    libraryId,
  }: GetLibraryMappingQuery): Promise<LibraryEntryDetail> {
    this.runtime.assertEnabled();
    const entry = await loadActiveEntry(this.library, libraryId);
    const [view] = await views(this.library, userId, [entry]);
    return { ...(view as LibraryEntryView), spec: entry.spec };
  }
}

export class ReviewPublicationQuery {
  constructor(
    readonly userId: string,
    readonly request: PublishRequest,
  ) {}
}

/** The review step before publishing: the exact public JSON and the privacy findings. */
@QueryHandler(ReviewPublicationQuery)
export class ReviewPublicationHandler implements IQueryHandler<
  ReviewPublicationQuery,
  PublishReview
> {
  constructor(
    private readonly library: LibraryRepositoryPort,
    private readonly mappings: ImportMappingRepositoryPort,
    private readonly runtime: LibraryRuntime,
  ) {}

  async execute({
    userId,
    request,
  }: ReviewPublicationQuery): Promise<PublishReview> {
    this.runtime.assertEnabled();
    const { sourceMappingId: _internal, ...review } = await buildReview(
      { library: this.library, mappings: this.mappings },
      userId,
      request,
    );
    return review;
  }
}

export class PublishQuotaQuery {
  constructor(readonly userId: string) {}
}

/**
 * F5.20: before a bulk publish the app says how many new entries are left today — the same
 * count the publish handler enforces (deleted entries count, new versions do not).
 */
@QueryHandler(PublishQuotaQuery)
export class PublishQuotaHandler implements IQueryHandler<
  PublishQuotaQuery,
  PublishQuota
> {
  constructor(
    private readonly library: LibraryRepositoryPort,
    private readonly runtime: LibraryRuntime,
  ) {}

  async execute({ userId }: PublishQuotaQuery): Promise<PublishQuota> {
    this.runtime.assertEnabled();
    const since = new Date(
      this.runtime.now().getTime() - 24 * 60 * 60 * 1000,
    ).toISOString();
    const usedToday = await this.library.countPublishedSince(userId, since);
    return {
      newPerDay: LIBRARY_LIMITS.publishesPerDay,
      usedToday,
      remainingToday: Math.max(0, LIBRARY_LIMITS.publishesPerDay - usedToday),
      publishesPer10Min: PUBLISHES_PER_10_MIN,
    };
  }
}

export class ProjectLibraryMatchesQuery {
  constructor(
    readonly userId: string,
    readonly projectId: string,
  ) {}
}

export interface LibraryFileMatches {
  readonly projectFileId: string;
  readonly displayName: string;
  /** Surest first. */
  readonly matches: readonly LibraryEntryView[];
}

/** Library entries checked per file at most (surest first after the cheap header filter). */
const MAX_MATCHES = 10;

/**
 * F5.16 in the files area: for each file of my project that **needs a mapping**, the library
 * entries that would read it (fingerprint + header detection as on upload). Files without a
 * match are left out. Only my project's files are read; the library is public.
 */
@QueryHandler(ProjectLibraryMatchesQuery)
export class ProjectLibraryMatchesHandler implements IQueryHandler<
  ProjectLibraryMatchesQuery,
  LibraryFileMatches[]
> {
  constructor(
    private readonly library: LibraryRepositoryPort,
    private readonly projects: ProjectRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
    private readonly analysis: FileAnalysisService,
    private readonly runtime: LibraryRuntime,
  ) {}

  async execute({
    userId,
    projectId,
  }: ProjectLibraryMatchesQuery): Promise<LibraryFileMatches[]> {
    this.runtime.assertEnabled();
    const project = await loadOwnProject(this.projects, userId, projectId);
    const waiting = (await this.files.listByProject(project.id)).filter(
      (file) => file.status === 'needs_mapping',
    );
    if (waiting.length === 0) return [];
    const entries = await this.library.listActive();
    if (entries.length === 0) return [];
    const out: LibraryFileMatches[] = [];
    for (const file of waiting) {
      const { readable } = await readableOf(this.files, file);
      if (readable.kind === 'pdf') continue;
      const matches = await this.analysis.matchingSpecs(
        readable,
        entries.filter((entry) => headersPresent(entry, readable.bytes)),
      );
      if (matches.length === 0) continue;
      const byId = new Map(entries.map((entry) => [entry.id, entry]));
      const found = matches
        .slice(0, MAX_MATCHES)
        .map((match) => byId.get(match.id))
        .filter((entry): entry is LibraryMapping => entry !== undefined);
      out.push({
        projectFileId: file.id,
        displayName: file.displayName,
        matches: await views(this.library, userId, found),
      });
    }
    return out;
  }
}

/**
 * Cheap pre-filter before the engine's detection: every plain-ASCII header of the entry's
 * fingerprint must occur in the file's first 64 KB. Anything it cannot judge passes (an XLSX is
 * ZIP-compressed, UTF-16 has NUL bytes, non-ASCII headers depend on the encoding) — the engine
 * decides.
 */
function headersPresent(entry: LibraryMapping, bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 64 * 1024);
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  if (isZip || head.includes(0)) return true;
  const text = normaliseHeader(Buffer.from(head).toString('latin1'));
  return entry.fingerprint
    .split('|')
    .every(
      (header) =>
        header === '' ||
        !/^[\x20-\x7e]+$/.test(header) ||
        text.includes(header),
    );
}
