import type { MappingSimilarity } from '@lazykoins/engine';

/**
 * F5.19 "Mapping beim Upload vorschlagen": for a file that **needs a mapping**, the mappings that
 * read it or come close, ranked. Nothing here assigns anything — the user clicks "Übernehmen".
 *
 * - `own`: one of my mappings (it reads the file only when it was saved after the upload; else a
 *   near match → "Als Vorlage anpassen");
 * - `standard`: a bundled standard mapping (`mappings/standard/`, read-only; taking it copies);
 * - `library`: the mapping library (web; desktop only when linked, F5.18) — entries that read
 *   the file (`mappingConfidence`, as F5.16's matches).
 */
export const SUGGESTION_SOURCES = ['own', 'standard', 'library'] as const;
export type SuggestionSource = (typeof SUGGESTION_SOURCES)[number];

/** Per file, at most this many suggestions (the best first). */
export const MAX_SUGGESTIONS = 6;
/** Files looked at per request (the newest ones needing a mapping). */
export const MAX_SUGGESTION_FILES = 50;

export interface MappingSuggestion {
  readonly source: SuggestionSource;
  /** Mapping id (own), catalogue id (standard) or entry id (library). */
  readonly id: string;
  readonly name: string;
  readonly platform: string;
  readonly description: string | null;
  /** The mapping reads the file as it is — "Übernehmen" assigns it in one click. */
  readonly reads: boolean;
  /** Share of its fingerprint headers the file has, 0 … 1 ("Übereinstimmung"). */
  readonly coverage: number;
  readonly matched: number;
  readonly required: number;
  /** Fingerprint headers the file lacks (near matches). */
  readonly missing: readonly string[];
  readonly fileNameMatches: boolean;
  readonly platformInName: boolean;
  readonly score: number;
  /** Standard: the catalogue revision. */
  readonly revision: number | null;
  /** Standard: my identical copy, if I already took it (assigned instead of copied again). */
  readonly copyId: string | null;
  /** Library: the public facts shown next to it. */
  readonly library: {
    readonly version: number;
    readonly authorName: string | null;
    readonly ratingAverage: number | null;
    readonly ratingCount: number;
    readonly usageCount: number;
  } | null;
}

export interface FileSuggestions {
  readonly projectFileId: string;
  readonly displayName: string;
  readonly suggestions: readonly MappingSuggestion[];
}

/**
 * Whether the library took part: `used`; `off` (desktop without a link, or suggestions switched
 * off); `unavailable` (it failed this time — the other sources still answer).
 */
export type LibrarySuggestionState = 'used' | 'off' | 'unavailable';

export interface ProjectSuggestions {
  readonly files: readonly FileSuggestions[];
  readonly library: LibrarySuggestionState;
}

/** A local candidate (own or standard) from its similarity. */
export function fromSimilarity(
  base: Pick<
    MappingSuggestion,
    'source' | 'id' | 'name' | 'platform' | 'description'
  > &
    Partial<Pick<MappingSuggestion, 'revision' | 'copyId'>>,
  similarity: MappingSimilarity,
): MappingSuggestion {
  return {
    ...base,
    reads: similarity.confidence > 0,
    coverage: Math.round(similarity.coverage * 1000) / 1000,
    matched: similarity.matched,
    required: similarity.required,
    missing: similarity.missing,
    fileNameMatches: similarity.fileNameMatches,
    platformInName: similarity.platformInName,
    score: similarity.score,
    revision: base.revision ?? null,
    copyId: base.copyId ?? null,
    library: null,
  };
}

const SOURCE_ORDER: Record<SuggestionSource, number> = {
  own: 0,
  standard: 1,
  library: 2,
};

/**
 * Best first: what reads the file before near matches; among those my own, then the standard
 * catalogue, then the library; then the score; a library entry by its rating. Deterministic.
 */
export function rankSuggestions(
  candidates: readonly MappingSuggestion[],
): MappingSuggestion[] {
  return [...candidates]
    .sort(
      (a, b) =>
        Number(b.reads) - Number(a.reads) ||
        (a.reads ? SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] : 0) ||
        b.score - a.score ||
        SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] ||
        (b.library?.ratingAverage ?? 0) - (a.library?.ratingAverage ?? 0) ||
        compare(a.name, b.name) ||
        compare(a.id, b.id),
    )
    .slice(0, MAX_SUGGESTIONS);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
