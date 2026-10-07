import type { SourceFile } from '../importers/importer';
import {
  bestHeaderRow,
  nameMatches,
  normaliseHeader,
} from '../importers/table';
import { mappingConfidence } from './apply-mapping';
import type { MappingSpec } from './mapping-spec';

/**
 * F5.19: how close a spec comes to reading a file — for **suggestions** only. The upload keeps
 * using `mappingConfidence` (every header present, file-name pattern matching); nothing here
 * lowers that bar, so a near match is never assigned without the user's click.
 */
export interface MappingSimilarity {
  /** `mappingConfidence`: > 0 = the spec reads the file as it is (the upload would take it). */
  readonly confidence: number;
  /** Share of the spec's fingerprint headers found in the file's best header row, 0 … 1. */
  readonly coverage: number;
  readonly matched: number;
  readonly required: number;
  /** Fingerprint headers (as the spec writes them) the file lacks. */
  readonly missing: readonly string[];
  /** False when the spec's file-name pattern does not match (true without a pattern). */
  readonly fileNameMatches: boolean;
  /** The file name contains the spec's platform (e.g. `kraken` in `kraken-ledger-2025.csv`). */
  readonly platformInName: boolean;
  /** Ranking score 0 … 1 (1 = reads the file, the spec names every column, name fits). */
  readonly score: number;
}

/** Below this coverage (or with fewer than two shared headers) a spec is not suggested. */
export const SUGGESTION_MIN_COVERAGE = 0.6;
export const SUGGESTION_MIN_HEADERS = 2;

function compact(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function mappingSimilarity(
  spec: MappingSpec,
  file: SourceFile,
): MappingSimilarity {
  const unique = new Map<string, string>();
  for (const header of spec.match.headers) {
    const key = normaliseHeader(header);
    if (key && !unique.has(key)) unique.set(key, header);
  }
  const required = unique.size;
  const best =
    file.kind === 'pdf'
      ? undefined
      : bestHeaderRow(file, [...unique.keys()], {
          sheet: spec.source.sheet,
          headerRow: spec.source.headerRow,
        });
  const found = best?.found ?? new Set<string>();
  const missing = [...unique.entries()]
    .filter(([key]) => !found.has(key))
    .map(([, header]) => header);
  const matched = required - missing.length;
  const coverage = required === 0 ? 0 : matched / required;
  const present = best
    ? best.table.header.filter((cell) => cell !== '').length
    : 0;
  const fileShare = present === 0 ? 0 : Math.min(1, matched / present);
  const fileNameMatches =
    !spec.match.fileName ||
    nameMatches(file, new RegExp(spec.match.fileName, 'i'));
  const platform = compact(spec.platform);
  const platformInName =
    platform.length >= 3 && compact(file.name).includes(platform);
  const confidence = mappingConfidence(spec, file);
  const raw = 0.7 * coverage + 0.2 * fileShare + (platformInName ? 0.1 : 0);
  const score = Math.round((fileNameMatches ? raw : raw * 0.8) * 1000) / 1000;
  return {
    confidence,
    coverage,
    matched,
    required,
    missing,
    fileNameMatches,
    platformInName,
    score,
  };
}

/** Whether a similarity is worth suggesting: it reads the file, or comes close. */
export function isSuggestable(similarity: MappingSimilarity): boolean {
  return (
    similarity.confidence > 0 ||
    (similarity.coverage >= SUGGESTION_MIN_COVERAGE &&
      similarity.matched >=
        Math.min(SUGGESTION_MIN_HEADERS, similarity.required))
  );
}
