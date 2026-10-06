import type { Booking, Holding } from '../bookings/booking';

/** The file types F5.1 accepts. */
export const FILE_KINDS = ['csv', 'xlsx', 'pdf'] as const;
export type FileKind = (typeof FILE_KINDS)[number];

/**
 * One table of a file: the single table of a CSV, or one worksheet of an XLSX. Cells are the
 * **original text** — never numbers — so quantities can be parsed exactly (`parseDecimal`).
 * `rows[0]` is spreadsheet row 1.
 */
export interface Sheet {
  readonly name: string;
  readonly rows: readonly (readonly string[])[];
}

/**
 * An original file as the engine sees it: already read and split by the caller (the engine does
 * no I/O). `id` is the file's SHA-256 — the same id records carry as `sourceFileId` (F5.3, F7.5).
 */
export type SourceFile =
  | {
      readonly id: string;
      readonly name: string;
      readonly kind: 'csv' | 'xlsx';
      readonly sheets: readonly Sheet[];
    }
  | {
      readonly id: string;
      readonly name: string;
      readonly kind: 'pdf';
      /** Extracted text per page; `pages[0]` is page 1 (empty while there is no extraction). */
      readonly pages: readonly string[];
    };

/** The period a file covers (F5.5, F5.8), as ISO dates (`2025-01-01`), both inclusive. */
export interface Period {
  readonly from: string;
  readonly to: string;
}

/**
 * Why a row could not be read. `code` is stable (the app translates `files.rowErrors.<code>`);
 * `column` names the offending column as the file writes it; `sheet` for workbooks.
 */
export interface RowError {
  readonly row: number;
  readonly code: string;
  readonly column?: string;
  readonly sheet?: string;
}

/** An assumption the importer had to make (`timeZoneAssumedUtc`) or a row it skipped on purpose. */
export interface ImportNote {
  readonly code: string;
  readonly row?: number;
}

export interface ImportResult {
  readonly bookings: readonly Booking[];
  readonly holdings: readonly Holding[];
  /** Over bookings and holdings' dates; `null` when the file holds no dated record. */
  readonly period: Period | null;
  /** Rows that could not be read — the rest is still imported (unknown kinds are not errors). */
  readonly errors: readonly RowError[];
  readonly notes: readonly ImportNote[];
}

/**
 * Detection confidence, 0 … 1. 0 = "not mine"; 1 = certain (e.g. an exact header row). Anything
 * in between is a partial match — the registry picks the best and reports near-ties.
 */
export type Confidence = number;

/**
 * Reads one kind of file into standard records. There is no per-platform code: the built-in
 * standard-format importer (`standard/`) and one importer per stored mapping spec
 * (`mapping/mapping-importer.ts`) are the only implementations.
 */
export interface Importer {
  /** Unique, stable: `standard-v1`, `mapping:<id>`. */
  readonly id: string;
  /** The platform it produces records for; `''` when the file says so per row (standard). */
  readonly platform: string;
  readonly fileKinds: readonly FileKind[];
  /**
   * How sure this importer is that the file is its kind — from headers and structure alone,
   * cheaply, and **never throwing** on a foreign file.
   */
  detect(file: SourceFile): Confidence;
  /** Every row → records, with `sourceFileId` + `row`. Bad rows become `errors`, never a throw. */
  parse(file: SourceFile): ImportResult;
}
