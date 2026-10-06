/**
 * Generated statements of a project (F10), stored with their date (F10.5).
 *
 * - simple: Steuerwert, Ertrag, Wertschriftenverzeichnis (one line per platform), income table,
 *   open points — PDF (1–2 pages) and Excel (F10.1);
 * - detailed: every sheet of the FACHREGELN workbook, with formulas — Excel and PDF (F10.2).
 */
export const EXPORT_KINDS = [
  'simple_pdf',
  'simple_xlsx',
  'detailed_pdf',
  'detailed_xlsx',
] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

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
