/**
 * Generated documents of a project (F10), stored with their date (F10.5).
 *
 * Statements for the tax authority — only what is declared and how it was computed, never open
 * items, check results or instructions:
 * - simple: Steuerwert, Ertrag, Wertschriftenverzeichnis (one line per platform), income table —
 *   PDF (1–2 pages) and Excel (F10.1);
 * - detailed: every sheet of the FACHREGELN workbook, with formulas — Excel and PDF (F10.2).
 *
 * Internal (F10.2a): the check report (lights, open items with ticks and notes, positions without
 * price, Earn-gap warnings, missing-file hints) — for the user and the Treuhänder, never attached
 * to the Treuhänder mail by default.
 */
export const STATEMENT_KINDS = [
  'simple_pdf',
  'simple_xlsx',
  'detailed_pdf',
  'detailed_xlsx',
] as const;
export const INTERNAL_KINDS = [
  'internal_report_pdf',
  'internal_report_xlsx',
] as const;
export const EXPORT_KINDS = [...STATEMENT_KINDS, ...INTERNAL_KINDS] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

/** The internal report is not a statement: it is kept apart and never attached by default. */
export function isInternalKind(kind: ExportKind): boolean {
  return (INTERNAL_KINDS as readonly string[]).includes(kind);
}

export const XLSX_MEDIA_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const PDF_MEDIA_TYPE = 'application/pdf';

export function mediaTypeOf(kind: ExportKind): string {
  return kind.endsWith('_pdf') ? PDF_MEDIA_TYPE : XLSX_MEDIA_TYPE;
}

export interface ProjectExportMeta {
  readonly id: string;
  readonly projectId: string;
  readonly kind: ExportKind;
  readonly fileName: string;
  readonly mediaType: string;
  readonly size: number;
  readonly snapshotId: string | null;
  readonly wealthChf: string;
  readonly incomeChf: string;
  readonly createdAt: string;
}

export interface ProjectExportContent extends ProjectExportMeta {
  readonly bytes: Uint8Array;
}

export interface NewProjectExport {
  readonly kind: ExportKind;
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly snapshotId: string | null;
  readonly wealthChf: string;
  readonly incomeChf: string;
}
