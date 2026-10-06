import type { Booking } from '../bookings/booking';

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
 * no I/O). `id` is the file's SHA-256 — the same id bookings carry as `sourceFileId` (F5.3, F7.5).
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
      /** Extracted text per page; `pages[0]` is page 1. */
      readonly pages: readonly string[];
    };

/** The period a file covers (F5.5, F5.8), as ISO dates (`2025-01-01`), both inclusive. */
export interface Period {
  readonly from: string;
  readonly to: string;
}

export interface ImportResult {
  readonly bookings: readonly Booking[];
  /** `null` when the file holds no dated rows at all. */
  readonly period: Period | null;
}

/**
 * Detection confidence, 0 … 1. 0 = "not mine"; 1 = certain (e.g. an exact header row). Anything
 * in between is a partial match — the registry picks the best and reports near-ties.
 */
export type Confidence = number;

/**
 * Reads one export type of one platform (`kraken-ledger`, `binance-transaction-history`, …).
 * One module per export type under `importers/<platform>/` — see the `add-importer` skill.
 */
export interface Importer {
  /** Unique, stable: `<platform>-<export-type>`. */
  readonly id: string;
  readonly platform: string;
  readonly fileKind: FileKind;
  /**
   * How sure this importer is that the file is its export type — from headers and structure
   * alone, cheaply, and **never throwing** on a foreign file.
   */
  detect(file: SourceFile): Confidence;
  /**
   * Every row → bookings (with `sourceFileId` + `row`), plus the period the file covers. Only
   * called on files this importer detected; may throw on a malformed one.
   */
  parse(file: SourceFile): ImportResult;
}
