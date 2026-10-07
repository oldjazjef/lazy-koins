import type { MappingSpec, PrivacyFinding } from '@lazykoins/engine';

/**
 * F5.15–F5.17: the global mapping library (web only). Hand-written domain types — never a
 * re-export of a Prisma model.
 *
 * An entry is a **published copy** of a mapping spec: the author's own mapping (or an uploaded
 * `.json`) after the privacy review. Using it ("übernehmen") always makes a private copy in the
 * user's own mappings (origin `library:<id>@<version>`), so deleting the entry — a soft delete,
 * only by its author — never touches anyone's projects.
 *
 * The author's identity never leaves the API: views carry `authorName` (the pseudonym chosen when
 * publishing, `null` = "Anonym") and `mine` (whether the caller is the author).
 */

/** Limits against abuse (also mirrored by CHECKs where they concern a column). */
export const LIBRARY_LIMITS = {
  /** Canonical JSON of the spec. */
  maxSpecBytes: 65_536,
  maxDescription: 1000,
  maxAuthorName: 40,
  /** New entries per author within 24 h (spam guard; new versions are rate-limited by HTTP). */
  publishesPerDay: 10,
} as const;

export const LIBRARY_SORTS = ['rating', 'usage', 'newest', 'name'] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number];

export interface LibraryMapping {
  readonly id: string;
  /** Internal only — never in a view, a DTO or a tool output. */
  readonly authorId: string;
  readonly authorName: string | null;
  /** The author's mapping it was published from (internal; for "Neue Version"). */
  readonly sourceMappingId: string | null;
  readonly name: string;
  readonly platform: string;
  readonly description: string | null;
  readonly spec: MappingSpec;
  readonly fingerprint: string;
  readonly version: number;
  readonly ratingCount: number;
  readonly ratingSum: number;
  readonly usageCount: number;
  readonly publishedAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
}

/** What a publish stores (a new entry or a new version of one). */
export interface LibraryPublication {
  readonly authorName: string | null;
  readonly sourceMappingId: string | null;
  readonly description: string | null;
  readonly spec: MappingSpec;
}

/** Average stars, two decimals; `null` without ratings. */
export function ratingAverage(entry: {
  readonly ratingCount: number;
  readonly ratingSum: number;
}): number | null {
  if (entry.ratingCount === 0) return null;
  return Math.round((entry.ratingSum / entry.ratingCount) * 100) / 100;
}

/** The public face of an entry, as the caller sees it. */
export interface LibraryEntryView {
  readonly id: string;
  readonly name: string;
  readonly platform: string;
  readonly description: string | null;
  readonly fingerprint: string;
  readonly version: number;
  /** The pseudonym; `null` = "Anonym". Never the e-mail or the profile name. */
  readonly authorName: string | null;
  readonly ratingAverage: number | null;
  readonly ratingCount: number;
  readonly usageCount: number;
  readonly publishedAt: string;
  readonly updatedAt: string;
  /** The caller is the author (may publish a new version / delete; may not rate). */
  readonly mine: boolean;
  /** The caller's own stars, or null. */
  readonly myRating: number | null;
}

export interface LibraryEntryDetail extends LibraryEntryView {
  readonly spec: MappingSpec;
}

export function entryView(
  entry: LibraryMapping,
  userId: string,
  myRating: number | null,
): LibraryEntryView {
  return {
    id: entry.id,
    name: entry.name,
    platform: entry.platform,
    description: entry.description,
    fingerprint: entry.fingerprint,
    version: entry.version,
    authorName: entry.authorName,
    ratingAverage: ratingAverage(entry),
    ratingCount: entry.ratingCount,
    usageCount: entry.usageCount,
    publishedAt: entry.publishedAt,
    updatedAt: entry.updatedAt,
    mine: entry.authorId === userId,
    myRating,
  };
}

/** The review before publishing: exactly what becomes public, and what looks personal. */
export interface PublishReview {
  /** The spec as it would be published (after the requested removals). */
  readonly spec: MappingSpec;
  readonly name: string;
  readonly platform: string;
  readonly fingerprint: string;
  /** Size of the canonical JSON in bytes (limit `LIBRARY_LIMITS.maxSpecBytes`). */
  readonly size: number;
  readonly findings: readonly PrivacyFinding[];
  /** Publishing a new version of this entry (`null` = a new entry). */
  readonly target: { readonly id: string; readonly nextVersion: number } | null;
  /** My active entry already published from this mapping, if any (offer "neue Version"). */
  readonly existing: { readonly id: string; readonly version: number } | null;
  /** The pseudonym used last time (prefill), `null` = none / Anonym. */
  readonly lastAuthorName: string | null;
  /**
   * The source is a copy taken from the library (origin `library`): it cannot become a new
   * entry (409 `libraryCopy`) — only a new version of an entry of mine.
   */
  readonly libraryCopy: boolean;
}

/**
 * F5.20 (several at once): how many **new** entries I may still publish today — new versions do
 * not count. The HTTP budget (`publishesPer10Min`) counts every publish, versions included.
 */
export interface PublishQuota {
  readonly newPerDay: number;
  readonly usedToday: number;
  readonly remainingToday: number;
  readonly publishesPer10Min: number;
}

/** Per account: publishing (new entries and versions) within 10 minutes (HTTP budget). */
export const PUBLISHES_PER_10_MIN = 10;

/** A trimmed pseudonym, or `null` for "Anonym". */
export function cleanAuthorName(
  name: string | null | undefined,
): string | null {
  const trimmed = (name ?? '').replace(/\s+/g, ' ').trim();
  return trimmed === '' ? null : trimmed.slice(0, LIBRARY_LIMITS.maxAuthorName);
}

export function cleanDescription(
  text: string | null | undefined,
): string | null {
  const trimmed = (text ?? '').trim();
  return trimmed === ''
    ? null
    : trimmed.slice(0, LIBRARY_LIMITS.maxDescription);
}

/** Search and sort over active entries — pure, so the list and the tools agree. */
export function searchEntries(
  entries: readonly LibraryMapping[],
  criteria: {
    readonly query?: string;
    readonly platform?: string;
    readonly sort?: LibrarySort;
  },
): LibraryMapping[] {
  const needle = (criteria.query ?? '').trim().toLocaleLowerCase('de-CH');
  const platform = (criteria.platform ?? '').trim().toLowerCase();
  const matching = entries.filter(
    (entry) =>
      entry.deletedAt === null &&
      (platform === '' || entry.platform === platform) &&
      (needle === '' ||
        entry.name.toLocaleLowerCase('de-CH').includes(needle) ||
        entry.platform.includes(needle) ||
        (entry.description ?? '').toLocaleLowerCase('de-CH').includes(needle)),
  );
  const byName = (a: LibraryMapping, b: LibraryMapping) =>
    a.name.localeCompare(b.name, 'de') || compare(a.id, b.id);
  const sorted = [...matching];
  switch (criteria.sort ?? 'rating') {
    case 'name':
      return sorted.sort(byName);
    case 'newest':
      return sorted.sort(
        (a, b) => compare(b.publishedAt, a.publishedAt) || byName(a, b),
      );
    case 'usage':
      return sorted.sort((a, b) => b.usageCount - a.usageCount || byName(a, b));
    default:
      return sorted.sort(
        (a, b) =>
          (ratingAverage(b) ?? 0) - (ratingAverage(a) ?? 0) ||
          b.ratingCount - a.ratingCount ||
          b.usageCount - a.usageCount ||
          byName(a, b),
      );
  }
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
