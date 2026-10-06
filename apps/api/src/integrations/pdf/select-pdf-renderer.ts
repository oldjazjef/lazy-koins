import type { PdfRendererPort } from '../../exports/ports/project-export.repository.port';
import { HostPdfRenderer } from './host-pdf.renderer';
import { PlaywrightPdfRenderer } from './playwright-pdf.renderer';
import type { HostPdfPrinter } from './print-options';

/**
 * Which renderer backs `PdfRendererPort`: the host's printer when the process that runs the API
 * supplied one (the desktop app — Electron's Chromium, nothing to install), else headless
 * Chromium through Playwright (server, container: `PDF_CHROMIUM_PATH` or Playwright's download).
 */
export function selectPdfRenderer(options: {
  hostPrinter: HostPdfPrinter | undefined;
  chromiumPath: string;
}): PdfRendererPort {
  return options.hostPrinter
    ? new HostPdfRenderer(options.hostPrinter)
    : new PlaywrightPdfRenderer(options.chromiumPath);
}
