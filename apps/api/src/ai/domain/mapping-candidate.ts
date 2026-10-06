import {
  type ImportResult,
  kindSummary,
  type MappingSample,
} from '@lazykoins/engine';

/**
 * Judging an AI-written mapping by what it does to the WHOLE file (dry run of `applyMapping`),
 * and the one repair round's message. Pure.
 */

/** Above these shares a spec goes back to the model once, with the concrete problems. */
export const MAX_ERROR_SHARE = 0.05;
export const MAX_UNKNOWN_SHARE = 0.2;

export interface SpecIssue {
  readonly path: string;
  readonly message: string;
}

export interface CandidateQuality {
  readonly records: number;
  readonly errors: number;
  readonly unknown: number;
  readonly kindCounts: Readonly<Record<string, number>>;
  /** Raw type values of the bookings left `unknown`, most frequent first. */
  readonly unknownValues: readonly {
    readonly value: string;
    readonly count: number;
  }[];
  /** Why a repair round is worth it; empty = good enough. */
  readonly problems: readonly string[];
}

export function judge(result: ImportResult): CandidateQuality {
  const { kindCounts, unknownValues } = kindSummary(result);
  const records = result.bookings.length + result.holdings.length;
  const errors = result.errors.length;
  const unknown = kindCounts['unknown'] ?? 0;
  const problems: string[] = [];
  if (result.errors.some((error) => error.code === 'headerNotFound')) {
    problems.push('headerNotFound');
  } else if (records === 0) {
    problems.push('noRecords');
  } else {
    if (errors / (records + errors) > MAX_ERROR_SHARE)
      problems.push('rowErrors');
    if (
      result.bookings.length > 0 &&
      unknown / result.bookings.length > MAX_UNKNOWN_SHARE
    ) {
      problems.push('unknownKinds');
    }
  }
  return {
    records,
    errors,
    unknown,
    kindCounts,
    unknownValues,
    problems,
  };
}

/**
 * The repair request: schema issues, or counts of row errors per code + column and the unknown
 * kind values. It quotes no cell of the file beyond what the sample already contained — unknown
 * values are named only when they appear in the sample (F5.14: nothing more than was shown).
 */
export function repairMessage(
  sample: MappingSample,
  issues: readonly SpecIssue[],
  result: ImportResult | undefined,
  quality: CandidateQuality | undefined,
): string {
  const lines: string[] = [
    'The mapping spec you wrote does not work yet. Fix these problems and answer with the complete corrected spec.',
  ];
  if (issues.length > 0) {
    lines.push('', 'Schema validation errors (path: message):');
    for (const issue of issues.slice(0, 30)) {
      lines.push(`- ${issue.path || '/'}: ${issue.message}`);
    }
  }
  if (result && quality) {
    if (quality.problems.includes('headerNotFound')) {
      lines.push(
        '',
        'The header row was not found: match.headers must be cells of ONE row of the file, written exactly as in the sample (check source.headerRow / source.sheet).',
      );
    }
    if (quality.problems.includes('noRecords')) {
      lines.push(
        '',
        'Applied to the file, the spec produced no records at all.',
      );
    }
    if (quality.problems.includes('rowErrors')) {
      lines.push(
        '',
        `Applied to the whole file (${sample.rowCount} rows), ${quality.errors} rows failed (code @ column: count, first rows):`,
      );
      for (const group of groupErrors(result).slice(0, 15)) {
        lines.push(
          `- ${group.code} @ ${group.column ?? '?'}: ${group.count} (rows ${group.rows.join(', ')})`,
        );
      }
    }
    if (quality.problems.includes('unknownKinds')) {
      const known = sampleValues(sample);
      const named = quality.unknownValues.filter((u) =>
        u.value.split('/').every((part) => known.has(part)),
      );
      lines.push(
        '',
        `${quality.unknown} of ${result.bookings.length} bookings got kind "unknown".`,
      );
      if (named.length > 0) {
        lines.push(
          'Unmapped kind values (value: count) — add rules for them:',
          ...named.map((u) => `- ${JSON.stringify(u.value)}: ${u.count}`),
        );
      } else {
        lines.push(
          'Check bookings.kind.columns and add rules for every value of those columns.',
        );
      }
    }
  }
  return lines.join('\n');
}

interface ErrorGroup {
  readonly code: string;
  readonly column?: string;
  readonly count: number;
  readonly rows: number[];
}

function groupErrors(result: ImportResult): ErrorGroup[] {
  const groups = new Map<
    string,
    { code: string; column?: string; count: number; rows: number[] }
  >();
  for (const error of result.errors) {
    const key = `${error.code}|${error.column ?? ''}`;
    const group = groups.get(key) ?? {
      code: error.code,
      column: error.column,
      count: 0,
      rows: [],
    };
    group.count += 1;
    if (group.rows.length < 3) group.rows.push(error.row);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

/** Every cell text the sample showed (rows + distinct values). */
function sampleValues(sample: MappingSample): Set<string> {
  const values = new Set<string>();
  for (const row of sample.rows)
    for (const cell of row) values.add(cell.trim());
  for (const column of sample.distinctValues) {
    for (const value of column.values) values.add(value);
  }
  return values;
}
