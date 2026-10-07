import type { Period, Sheet, SourceFile } from './importer';

/**
 * Header cells compared loosely: case, surrounding whitespace/quotes/BOM, and the difference
 * between `User_ID`, `User ID` and `UserID` do not matter. Brackets stay (`Date(UTC)`).
 */
export function normaliseHeader(cell: string): string {
  return cell
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/^"|"$/g, '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

/** A located header row: the sheet, its 0-based index, and column name → index. */
export interface Table {
  readonly sheet: Sheet;
  /** 0-based index into `sheet.rows`; data starts on the next row. */
  readonly headerIndex: number;
  /** Normalised header → column index (the first one wins on duplicates). */
  readonly columns: ReadonlyMap<string, number>;
  /** The header cells as written (trimmed), for `raw`. */
  readonly header: readonly string[];
}

export interface FindTableOptions {
  /** Only these sheets (by name or 0-based index); all sheets when absent. */
  readonly sheet?: string | number;
  /** A fixed 1-based header row instead of searching. */
  readonly headerRow?: number;
  /** How many rows to search for the header (default 50). */
  readonly maxScan?: number;
}

function tableAt(sheet: Sheet, index: number): Table {
  const row = sheet.rows[index] ?? [];
  const columns = new Map<string, number>();
  row.forEach((cell, column) => {
    const key = normaliseHeader(cell);
    if (key && !columns.has(key)) columns.set(key, column);
  });
  return {
    sheet,
    headerIndex: index,
    columns,
    header: row.map((cell) => cell.replace(/^\uFEFF/, '').trim()),
  };
}

function sheetsOf(
  file: SourceFile,
  sheet: string | number | undefined,
): Sheet[] {
  if (file.kind === 'pdf') return [];
  if (sheet === undefined) return [...file.sheets];
  if (typeof sheet === 'number') {
    const found = file.sheets[sheet];
    return found ? [found] : [];
  }
  const wanted = normaliseHeader(sheet);
  return file.sheets.filter((s) => normaliseHeader(s.name) === wanted);
}

/**
 * The first row (within `maxScan` rows of the chosen sheets) holding every `required` column —
 * exports with a preamble (Binance's XLSX has about ten lines above its header) are found the same
 * way as plain ones. With `headerRow`, that row must hold them. Never throws.
 */
export function findTable(
  file: SourceFile,
  required: readonly string[],
  options: FindTableOptions = {},
): Table | undefined {
  const wanted = required.map(normaliseHeader);
  const matches = (table: Table) =>
    wanted.every((name) => table.columns.has(name));
  for (const sheet of sheetsOf(file, options.sheet)) {
    if (options.headerRow !== undefined) {
      if (options.headerRow < 1 || options.headerRow > sheet.rows.length)
        continue;
      const table = tableAt(sheet, options.headerRow - 1);
      if (matches(table)) return table;
      continue;
    }
    const limit = Math.min(sheet.rows.length, options.maxScan ?? 50);
    for (let index = 0; index < limit; index += 1) {
      const table = tableAt(sheet, index);
      if (matches(table)) return table;
    }
  }
  return undefined;
}

/**
 * The row (within `maxScan` rows of the chosen sheets, or exactly `headerRow`) that holds the
 * most of `wanted` columns — for near matches (F5.19 suggestions), where `findTable` needs all of
 * them. Earliest row wins a tie; `undefined` when no row holds any.
 */
export function bestHeaderRow(
  file: SourceFile,
  wanted: readonly string[],
  options: FindTableOptions = {},
): { readonly table: Table; readonly found: ReadonlySet<string> } | undefined {
  const names = [...new Set(wanted.map(normaliseHeader))];
  let best: { table: Table; found: Set<string> } | undefined;
  for (const sheet of sheetsOf(file, options.sheet)) {
    const indexes =
      options.headerRow !== undefined
        ? options.headerRow >= 1 && options.headerRow <= sheet.rows.length
          ? [options.headerRow - 1]
          : []
        : Array.from(
            { length: Math.min(sheet.rows.length, options.maxScan ?? 50) },
            (_, index) => index,
          );
    for (const index of indexes) {
      const table = tableAt(sheet, index);
      const found = new Set(names.filter((name) => table.columns.has(name)));
      if (found.size > (best?.found.size ?? 0)) best = { table, found };
    }
  }
  return best;
}

/** Whether the header row is exactly these columns (order included, loosely compared). */
export function headerIs(table: Table, columns: readonly string[]): boolean {
  const actual = table.header
    .filter((cell) => cell !== '')
    .map(normaliseHeader);
  const expected = columns.map(normaliseHeader);
  return (
    actual.length === expected.length &&
    actual.every((cell, index) => cell === expected[index])
  );
}

/** One data row with named access; `row` is 1-based as a spreadsheet shows it (F7.5). */
export interface TableRow {
  readonly row: number;
  readonly cells: readonly string[];
  /** The trimmed cell under `column` (loosely matched), `''` when absent. */
  get(column: string): string;
  has(column: string): boolean;
  raw(): Record<string, string>;
}

/** Every non-blank row below the header. */
export function tableRows(table: Table): TableRow[] {
  const out: TableRow[] = [];
  for (
    let index = table.headerIndex + 1;
    index < table.sheet.rows.length;
    index += 1
  ) {
    const cells = table.sheet.rows[index] ?? [];
    if (cells.every((cell) => cell.trim() === '')) continue;
    out.push({
      row: index + 1,
      cells,
      get: (column) => {
        const at = table.columns.get(normaliseHeader(column));
        return at === undefined ? '' : (cells[at] ?? '').trim();
      },
      has: (column) => table.columns.has(normaliseHeader(column)),
      raw: () => {
        const record: Record<string, string> = {};
        table.header.forEach((name, column) => {
          if (name !== '') record[name] = cells[column] ?? '';
        });
        return record;
      },
    });
  }
  return out;
}

/** The period covered by ISO timestamps or dates (their first 10 characters), `null` if none. */
export function periodOf(dates: Iterable<string>): Period | null {
  let from: string | undefined;
  let to: string | undefined;
  for (const value of dates) {
    const date = value.slice(0, 10);
    if (from === undefined || date < from) from = date;
    if (to === undefined || date > to) to = date;
  }
  return from && to ? { from, to } : null;
}

/** File name test on the name without directories. */
export function nameMatches(
  file: Pick<SourceFile, 'name'>,
  pattern: RegExp,
): boolean {
  const base = file.name.split(/[\\/]/).pop() ?? file.name;
  return pattern.test(base);
}
