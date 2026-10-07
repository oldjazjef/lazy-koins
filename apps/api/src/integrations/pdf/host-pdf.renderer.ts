import {
  PdfRendererPort,
  PdfUnavailableError,
} from '../../exports/ports/project-export.repository.port';
import { type HostPdfPrinter, printOptionsFor } from './print-options';

/**
 * PDFs printed by the hosting process — in the desktop app Electron's own Chromium
 * (`webContents.printToPDF`), so a user's machine needs no separately installed browser.
 */
export class HostPdfRenderer extends PdfRendererPort {
  constructor(private readonly printer: HostPdfPrinter) {
    super();
  }

  async available(): Promise<boolean> {
    return true;
  }

  async render(html: string): Promise<Uint8Array> {
    try {
      return await this.printer(html, printOptionsFor(html));
    } catch (error) {
      throw new PdfUnavailableError(
        error instanceof Error
          ? (error.message.split('\n')[0] ?? '')
          : 'unknown',
      );
    }
  }
}

// --- The host printer, registered by bootstrap() before the module graph is created ---

let hostPrinter: HostPdfPrinter | undefined;

/** Called by `bootstrap({ pdfPrinter })`; `undefined` clears it (tests). */
export function registerHostPdfPrinter(
  printer: HostPdfPrinter | undefined,
): void {
  hostPrinter = printer;
}

export function registeredHostPdfPrinter(): HostPdfPrinter | undefined {
  return hostPrinter;
}
