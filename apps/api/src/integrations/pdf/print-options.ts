/**
 * How a statement is printed — one definition for both renderers (Playwright in the server,
 * Electron's `printToPDF` in the desktop app), so a PDF looks the same wherever it was made.
 * Plain data: the desktop shell receives it through `HostPdfPrinter` and maps it to Electron's
 * option names.
 */
export interface PdfPrintOptions {
  readonly format: 'A4';
  readonly printBackground: true;
  /** Millimetres. */
  readonly marginMm: {
    readonly top: number;
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
  };
  /** Chromium header/footer templates (`pageNumber`, `totalPages` classes are filled in). */
  readonly headerTemplate: string;
  readonly footerTemplate: string;
}

export const PDF_PRINT_OPTIONS: PdfPrintOptions = {
  format: 'A4',
  printBackground: true,
  marginMm: { top: 14, bottom: 16, left: 12, right: 12 },
  // Chromium needs a non-empty header when footers are on; an empty element prints nothing.
  headerTemplate: '<span></span>',
  footerTemplate:
    '<div style="width:100%;font-size:7.5pt;color:#6b7280;text-align:center;font-family:sans-serif;">' +
    'Seite <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
};

/**
 * A printer supplied by the process that hosts the API — the desktop app passes one built on
 * Electron's `webContents.printToPDF` (see `bootstrap({ pdfPrinter })`). Takes our own HTML (no
 * external resources) and returns the PDF bytes.
 */
export type HostPdfPrinter = (
  html: string,
  options: PdfPrintOptions,
) => Promise<Uint8Array>;
