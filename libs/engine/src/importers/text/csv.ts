import type { SourceFile } from '../importer';
import { decodeText, type TextEncoding } from './decode-text';

/** The delimiters exports use: comma (most), semicolon (Excel in de-CH), tab, pipe. */
export const CSV_DELIMITERS = [',', ';', '\t', '|'] as const;
export type CsvDelimiter = (typeof CSV_DELIMITERS)[number];

/**
 * Picks the delimiter that occurs most often outside quotes in the first non-empty line. Comma
 * wins a tie (and an empty file), because it is what nearly every exchange writes.
 */
export function detectDelimiter(text: string): CsvDelimiter {
  const firstLine = firstRecord(text);
  let best: CsvDelimiter = ',';
  let bestCount = 0;
  for (const delimiter of CSV_DELIMITERS) {
    let count = 0;
    let quoted = false;
    for (const char of firstLine) {
      if (char === '"') quoted = !quoted;
      else if (!quoted && char === delimiter) count += 1;
    }
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

function firstRecord(text: string): string {
  let quoted = false;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === '\n' || char === '\r')) {
      if (i > start) return text.slice(start, i);
      start = i + 1;
    }
  }
  return text.slice(start);
}

/**
 * RFC 4180 parsing: quoted fields with doubled quotes (`""`), delimiters and line breaks inside
 * quotes, CRLF / LF / CR line ends, a leading BOM. Cells stay **text** — never numbers — so
 * quantities can be read exactly. Trailing blank lines are dropped; blank lines in between stay
 * (as `['']`) so row numbers match what a spreadsheet shows.
 */
export function parseCsv(text: string, delimiter?: CsvDelimiter): string[][] {
  const source = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const sep = delimiter ?? detectDelimiter(source);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        cell += char;
      }
      i += 1;
      continue;
    }
    if (char === '"' && cell.length === 0) {
      quoted = true;
    } else if (char === sep) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (char === '\r' && source[i + 1] === '\n') i += 1;
    } else {
      cell += char;
    }
    i += 1;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  while (rows.length > 0 && isBlank(rows[rows.length - 1])) rows.pop();
  return rows;
}

function isBlank(row: readonly string[] | undefined): boolean {
  return !row || row.every((cell) => cell.trim() === '');
}

export interface CsvOptions {
  readonly encoding?: TextEncoding | 'auto';
  readonly delimiter?: CsvDelimiter;
}

/**
 * Original bytes of a CSV → the engine's `SourceFile` (one sheet named after the file). Encoding
 * and delimiter are detected unless given (a mapping spec may fix them).
 */
export function csvSourceFile(
  input: {
    readonly id: string;
    readonly name: string;
    readonly bytes: Uint8Array;
  },
  options: CsvOptions = {},
): SourceFile {
  const { text } = decodeText(input.bytes, options.encoding ?? 'auto');
  return {
    id: input.id,
    name: input.name,
    kind: 'csv',
    sheets: [{ name: input.name, rows: parseCsv(text, options.delimiter) }],
  };
}
