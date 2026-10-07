import type { ImportResult, Sheet, SourceFile } from '../importers/importer';

/**
 * A compact **sample** of a tabular file — never the whole file. Two users:
 *
 * - F5.14: **exactly** what is sent to the AI provider to write a mapping. The app shows this
 *   object to the user before anything is sent, and the request sends this same object
 *   (serialised as JSON) as the user message.
 * - The mapping editor's "Beispieldatei": the raw table (preamble visible), the header guess and
 *   the category-like columns that seed `specSkeleton`.
 *
 * Contents:
 *
 * - the file name and, for a CSV, the detected encoding and delimiter;
 * - the first rows **as they are** (preamble rows above the header included, so the model can
 *   find the header itself), at most `MAX_SAMPLE_ROWS`;
 * - the distinct values of low-cardinality text columns (type/operation columns decide the
 *   booking kind) — at most `MAX_DISTINCT` values per column, never amounts, dates or ids;
 * - how many rows the table has.
 */
export interface MappingSample {
  readonly fileName: string;
  readonly fileKind: 'csv' | 'xlsx';
  readonly encoding?: string;
  readonly delimiter?: string;
  /** XLSX: every sheet with its row count (only `sheet` is sampled). */
  readonly sheets?: readonly {
    readonly name: string;
    readonly rowCount: number;
  }[];
  readonly sheet?: string;
  /** Rows in the sampled table, preamble included. */
  readonly rowCount: number;
  /** 1-based row the sample thinks is the header (a guess; the model decides). */
  readonly headerRowGuess: number;
  /** `rows[0]` is row 1 of the file. */
  readonly rows: readonly (readonly string[])[];
  readonly distinctValues: readonly {
    readonly column: string;
    readonly values: readonly string[];
  }[];
}

export const MAX_SAMPLE_ROWS = 25;
/** With a long preamble, still show this many rows below the header. */
const MIN_DATA_ROWS = 10;
const HARD_ROW_CAP = 40;
export const MAX_DISTINCT = 40;
const MAX_DISTINCT_COLUMNS = 15;
const MAX_CELL = 200;
const MAX_VALUE = 100;
/** How far down the header is searched for. */
const HEADER_SEARCH = 50;

/**
 * The delimiter of a CSV over its first lines — not only the first: an export with a one-cell
 * preamble line ("Account statement") would otherwise read as comma-separated. The most frequent
 * candidate wins; comma on a tie.
 */
export function guessDelimiter(text: string): ',' | ';' | '\t' | '|' {
  const lines = text
    .split(/\r\n|\n|\r/)
    .filter((line) => line.trim() !== '')
    .slice(0, 30);
  let best: ',' | ';' | '\t' | '|' = ',';
  let bestCount = 0;
  for (const delimiter of [',', ';', '\t', '|'] as const) {
    let count = 0;
    for (const line of lines) {
      let quoted = false;
      for (const char of line) {
        if (char === '"') quoted = !quoted;
        else if (!quoted && char === delimiter) count += 1;
      }
    }
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

export interface CsvMeta {
  readonly encoding: string;
  readonly delimiter: string;
}

export function buildMappingSample(
  file: SourceFile,
  csv?: CsvMeta,
): MappingSample {
  if (file.kind === 'pdf') throw new Error('A mapping sample needs a table');
  const sheet = sampledSheet(file.sheets);
  const rows = sheet?.rows ?? [];
  const header = guessHeaderRow(rows);
  const take = Math.min(
    HARD_ROW_CAP,
    Math.max(MAX_SAMPLE_ROWS, header + 1 + MIN_DATA_ROWS),
  );
  return {
    fileName: file.name,
    fileKind: file.kind,
    ...(file.kind === 'csv' && csv
      ? { encoding: csv.encoding, delimiter: csv.delimiter }
      : {}),
    ...(file.kind === 'xlsx'
      ? {
          sheets: file.sheets.map((s) => ({
            name: s.name,
            rowCount: s.rows.length,
          })),
          sheet: sheet?.name,
        }
      : {}),
    rowCount: rows.length,
    headerRowGuess: header + 1,
    rows: rows.slice(0, take).map((row) => trimRow(row).map(cut(MAX_CELL))),
    distinctValues: distinctValues(rows, header),
  };
}

/** XLSX: the sheet with the most non-empty rows (exports put the data on one sheet). */
function sampledSheet(sheets: readonly Sheet[]): Sheet | undefined {
  let best: Sheet | undefined;
  let bestCount = -1;
  for (const sheet of sheets) {
    const count = sheet.rows.filter((row) => !isEmpty(row)).length;
    if (count > bestCount) {
      best = sheet;
      bestCount = count;
    }
  }
  return best;
}

/**
 * 0-based index of the likely header: within the first rows, the first row with the most
 * non-empty cells of which none looks like a number or a date.
 */
export function guessHeaderRow(rows: readonly (readonly string[])[]): number {
  let best = 0;
  let bestWidth = -1;
  rows.slice(0, HEADER_SEARCH).forEach((row, index) => {
    const cells = row.map((c) => c.trim()).filter((c) => c !== '');
    if (cells.length === 0 || cells.some(looksLikeData)) return;
    if (cells.length > bestWidth) {
      best = index;
      bestWidth = cells.length;
    }
  });
  return best;
}

function distinctValues(
  rows: readonly (readonly string[])[],
  header: number,
): MappingSample['distinctValues'] {
  const names = rows[header] ?? [];
  const data = rows.slice(header + 1).filter((row) => !isEmpty(row));
  const out: { column: string; values: string[] }[] = [];
  names.forEach((rawName, index) => {
    const column = rawName.trim();
    if (column === '' || out.length >= MAX_DISTINCT_COLUMNS) return;
    const seen = new Set<string>();
    for (const row of data) {
      const value = (row[index] ?? '').trim();
      if (value === '') continue;
      seen.add(value);
      if (seen.size > MAX_DISTINCT) return;
    }
    const values = [...seen];
    if (values.length === 0) return;
    // Amounts, timestamps and ids are not categories — and must not leave as "distinct values".
    if (values.filter(looksLikeData).length * 2 > values.length) return;
    // A column whose every row is different is an id/note, not a category.
    if (data.length > 3 && values.length === data.length) return;
    out.push({
      column,
      values: values.sort(compareText).map(cut(MAX_VALUE)),
    });
  });
  return out;
}

/** Numbers, dates/times, long hex/base58 strings (hashes, addresses). */
export function looksLikeData(value: string): boolean {
  const v = value.trim();
  if (/^[-+]?[\d\s'’.,]*\d[\d\s'’.,]*(e[-+]?\d+)?$/i.test(v)) return true;
  if (/^\d{1,4}[-./]\d{1,2}[-./]\d{1,4}/.test(v)) return true;
  if (/^\d{1,2}:\d{2}/.test(v)) return true;
  if (/^(0x)?[0-9a-f]{24,}$/i.test(v)) return true;
  if (/^[1-9A-HJ-NP-Za-km-z]{26,}$/.test(v)) return true;
  return false;
}

function isEmpty(row: readonly string[]): boolean {
  return row.every((cell) => cell.trim() === '');
}

/** Drops trailing empty cells (spreadsheets pad rows). */
function trimRow(row: readonly string[]): string[] {
  let end = row.length;
  while (end > 0 && (row[end - 1] ?? '').trim() === '') end -= 1;
  return row.slice(0, end);
}

function cut(max: number): (value: string) => string {
  return (value) => (value.length > max ? `${value.slice(0, max)}…` : value);
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** What a mapping made of a file, by kind — the review shown next to every preview. */
export interface KindSummary {
  readonly kindCounts: Readonly<Record<string, number>>;
  /** Raw type values of the bookings left `unknown`, most frequent first (at most 30). */
  readonly unknownValues: readonly {
    readonly value: string;
    readonly count: number;
  }[];
}

export function kindSummary(result: ImportResult): KindSummary {
  const kindCounts: Record<string, number> = {};
  const unknownCounts = new Map<string, number>();
  for (const booking of result.bookings) {
    kindCounts[booking.kind] = (kindCounts[booking.kind] ?? 0) + 1;
    if (booking.kind === 'unknown') {
      const value = booking.rawType;
      unknownCounts.set(value, (unknownCounts.get(value) ?? 0) + 1);
    }
  }
  return {
    kindCounts,
    unknownValues: [...unknownCounts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || compareText(a.value, b.value))
      .slice(0, 30),
  };
}
