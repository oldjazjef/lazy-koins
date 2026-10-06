/**
 * The API's print options (apps/api/src/integrations/pdf/print-options.ts, passed to the desktop
 * printer with every document) → Electron's `printToPDF` options. Mirrors the API type: the
 * desktop must not import from apps/api.
 */
export interface PdfPrintOptions {
  readonly format: 'A4';
  readonly printBackground: boolean;
  readonly marginMm: {
    readonly top: number;
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
  };
  readonly headerTemplate: string;
  readonly footerTemplate: string;
}

export interface ElectronPrintOptions {
  pageSize: 'A4';
  printBackground: boolean;
  /** Inches — Electron's unit. */
  margins: { top: number; bottom: number; left: number; right: number };
  displayHeaderFooter: boolean;
  headerTemplate: string;
  footerTemplate: string;
  preferCSSPageSize: boolean;
}

const MM_PER_INCH = 25.4;
const inches = (mm: number) => Math.round((mm / MM_PER_INCH) * 10_000) / 10_000;

export function toElectronPrintOptions(
  options: PdfPrintOptions,
): ElectronPrintOptions {
  const m = options.marginMm;
  return {
    pageSize: options.format,
    printBackground: options.printBackground,
    margins: {
      top: inches(m.top),
      bottom: inches(m.bottom),
      left: inches(m.left),
      right: inches(m.right),
    },
    displayHeaderFooter:
      options.headerTemplate.length > 0 || options.footerTemplate.length > 0,
    headerTemplate: options.headerTemplate,
    footerTemplate: options.footerTemplate,
    preferCSSPageSize: false,
  };
}

/**
 * The only URL the hidden print window may load: the temporary HTML file itself. Everything
 * else (http(s), other files, data: images an attacker-controlled cell could smuggle in) is
 * cancelled — the statement HTML is self-contained, printing stays offline.
 */
export function allowPrintRequest(url: string, documentUrl: string): boolean {
  return url === documentUrl;
}
