/**
 * Generated documents of a project (F10), stored with their date (F10.5).
 *
 * Statements for the tax authority — only what is declared and how it was computed, never open
 * items, check results or instructions:
 * - simple: Steuerwert, Ertrag, Wertschriftenverzeichnis (one line per platform), income table —
 *   PDF (1–2 pages) and Excel (F10.1);
 * - detailed: every sheet of the FACHREGELN workbook, with formulas — Excel and PDF (F10.2).
 *
 * Further tax documents (F10.11–F10.13, same rules — declared figures only):
 * - securities: Wertschriftenverzeichnis — a line per asset and platform/wallet with quantity,
 *   tax value, the year's income (with / without withholding tax) — PDF, Excel, CSV;
 * - income_list: Ertrags- und Belegliste — every taxable inflow with price, value and origin,
 *   sums per category and asset, the Earn gap explained — PDF and Excel;
 * - evidence: Transaktions- und Bestandesnachweis — the year's transactions with their changes,
 *   the balances at 31.12. with price, source and evidence — PDF and Excel;
 * - etax: E-Steuerauszug after eCH-0196 2.2 (F10.10) — the XML for the cantonal tax software and
 *   the PDF with readable pages and the PDF417 barcode sheets that carry the same XML.
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
  'securities_pdf',
  'securities_xlsx',
  'securities_csv',
  'income_list_pdf',
  'income_list_xlsx',
  'evidence_pdf',
  'evidence_xlsx',
  'etax_pdf',
  'etax_xml',
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
export const CSV_MEDIA_TYPE = 'text/csv; charset=utf-8';
export const XML_MEDIA_TYPE = 'application/xml';

/** The file extension of a kind. */
export function extensionOf(kind: ExportKind): 'pdf' | 'xlsx' | 'csv' | 'xml' {
  return kind.endsWith('_pdf')
    ? 'pdf'
    : kind.endsWith('_csv')
      ? 'csv'
      : kind.endsWith('_xml')
        ? 'xml'
        : 'xlsx';
}

export function mediaTypeOf(kind: ExportKind): string {
  const media = {
    pdf: PDF_MEDIA_TYPE,
    csv: CSV_MEDIA_TYPE,
    xml: XML_MEDIA_TYPE,
    xlsx: XLSX_MEDIA_TYPE,
  } as const;
  return media[extensionOf(kind)];
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
