import {
  type MappingSpec,
  mappingConfidence,
  type SourceFile,
} from '@lazykoins/engine';
import {
  type LibraryMapping,
  type LibrarySort,
  ratingAverage,
  searchEntries,
} from './library-mapping';

/**
 * F5.18: the public, read-only face of the mapping library — what an installed desktop app may
 * read from a web deployment without signing in. An **allow-list**: never an author id, e-mail,
 * user id, the source mapping or anybody's own rating. Deleted entries do not exist here.
 */
export const PUBLIC_LIBRARY_LIMITS = {
  maxPageSize: 50,
  defaultPageSize: 20,
  maxOffset: 10_000,
  maxMatches: 10,
  maxHeaderCells: 200,
  maxHeaderCellLength: 200,
  maxFileNameLength: 255,
  maxSearchLength: 200,
} as const;

/** Exactly the keys a public entry has (the tests assert this set). */
export const PUBLIC_ENTRY_KEYS = [
  'id',
  'name',
  'platform',
  'description',
  'authorName',
  'version',
  'fingerprint',
  'ratingAverage',
  'ratingCount',
  'usageCount',
  'publishedAt',
  'updatedAt',
] as const;

export interface PublicLibraryEntry {
  readonly id: string;
  readonly name: string;
  readonly platform: string;
  readonly description: string | null;
  /** The pseudonym the author chose; `null` = "Anonym". */
  readonly authorName: string | null;
  readonly version: number;
  readonly fingerprint: string;
  readonly ratingAverage: number | null;
  readonly ratingCount: number;
  readonly usageCount: number;
  readonly publishedAt: string;
  readonly updatedAt: string;
}

export interface PublicLibraryEntryDetail extends PublicLibraryEntry {
  readonly spec: MappingSpec;
}

/** Built field by field — a new column on the entry never leaks by accident. */
export function publicEntry(entry: LibraryMapping): PublicLibraryEntry {
  return {
    id: entry.id,
    name: entry.name,
    platform: entry.platform,
    description: entry.description,
    authorName: entry.authorName,
    version: entry.version,
    fingerprint: entry.fingerprint,
    ratingAverage: ratingAverage(entry),
    ratingCount: entry.ratingCount,
    usageCount: entry.usageCount,
    publishedAt: entry.publishedAt,
    updatedAt: entry.updatedAt,
  };
}

export function publicEntryDetail(
  entry: LibraryMapping,
): PublicLibraryEntryDetail {
  return { ...publicEntry(entry), spec: entry.spec };
}

export interface PublicLibrarySearch {
  readonly search?: string;
  readonly platform?: string;
  readonly sort?: LibrarySort;
  readonly offset?: number;
  readonly limit?: number;
}

export interface PublicLibraryPage {
  readonly items: PublicLibraryEntry[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
}

/** One page of active entries, searched and sorted like the web's own list. */
export function publicPage(
  entries: readonly LibraryMapping[],
  criteria: PublicLibrarySearch,
): PublicLibraryPage {
  const found = searchEntries(entries, {
    query: criteria.search,
    platform: criteria.platform,
    sort: criteria.sort,
  });
  const limit = Math.min(
    Math.max(1, criteria.limit ?? PUBLIC_LIBRARY_LIMITS.defaultPageSize),
    PUBLIC_LIBRARY_LIMITS.maxPageSize,
  );
  const offset = Math.min(
    Math.max(0, criteria.offset ?? 0),
    PUBLIC_LIBRARY_LIMITS.maxOffset,
  );
  return {
    items: found.slice(offset, offset + limit).map(publicEntry),
    total: found.length,
    offset,
    limit,
  };
}

/** What a desktop app sends to find suggestions for one file — nothing else. */
export interface HeaderMatchRequest {
  /** The base file name (no folders). */
  readonly fileName: string;
  /** The file's header row. */
  readonly headers: readonly string[];
}

/**
 * Entries whose spec recognises a file with this header row and name: the engine's
 * `mappingConfidence` (as on upload) on a one-row stand-in file. Surest first, then the better
 * rated; at most `maxMatches`.
 */
export function matchEntries(
  entries: readonly LibraryMapping[],
  request: HeaderMatchRequest,
): LibraryMapping[] {
  const headers = request.headers
    .slice(0, PUBLIC_LIBRARY_LIMITS.maxHeaderCells)
    .map((cell) => cell.slice(0, PUBLIC_LIBRARY_LIMITS.maxHeaderCellLength));
  if (headers.length === 0) return [];
  const file: SourceFile = {
    id: 'header-match',
    name: request.fileName.slice(0, PUBLIC_LIBRARY_LIMITS.maxFileNameLength),
    kind: 'csv',
    sheets: [{ name: 'Sheet1', rows: [headers] }],
  };
  return entries
    .filter((entry) => entry.deletedAt === null)
    .map((entry) => ({
      entry,
      confidence: mappingConfidence(headerOnly(entry.spec), file),
    }))
    .filter((match) => match.confidence > 0)
    .sort(
      (a, b) =>
        b.confidence - a.confidence ||
        (ratingAverage(b.entry) ?? 0) - (ratingAverage(a.entry) ?? 0) ||
        compare(a.entry.id, b.entry.id),
    )
    .slice(0, PUBLIC_LIBRARY_LIMITS.maxMatches)
    .map((match) => match.entry);
}

/** A fixed sheet / header row is ignored: the caller sent the header row itself. */
function headerOnly(spec: MappingSpec): MappingSpec {
  const { sheet: _sheet, headerRow: _row, ...source } = spec.source;
  return { ...spec, source: source as MappingSpec['source'] };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
