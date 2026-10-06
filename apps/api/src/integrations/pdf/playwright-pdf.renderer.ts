import { Logger, type OnApplicationShutdown } from '@nestjs/common';
import {
  PdfRendererPort,
  PdfUnavailableError,
} from '../../exports/ports/project-export.repository.port';

type Browser = import('playwright-core').Browser;

/**
 * HTML → PDF with headless Chromium through `playwright-core` (CLAUDE.md, Decisions: exports).
 * The browser is not bundled: `pnpm exec playwright-core install chromium` (dev, CI) or the
 * container's Chromium via `PDF_CHROMIUM_PATH`. Started lazily, reused, one page per document.
 * The HTML is our own template with no external resources; JavaScript is disabled anyway.
 */
export class PlaywrightPdfRenderer
  extends PdfRendererPort
  implements OnApplicationShutdown
{
  private readonly logger = new Logger(PlaywrightPdfRenderer.name);
  private browser: Promise<Browser> | undefined;

  constructor(private readonly executablePath: string) {
    super();
  }

  async available(): Promise<boolean> {
    try {
      await this.launch();
      return true;
    } catch {
      return false;
    }
  }

  async render(html: string): Promise<Uint8Array> {
    let browser: Browser;
    try {
      browser = await this.launch();
    } catch (error) {
      throw new PdfUnavailableError(
        error instanceof Error
          ? (error.message.split('\n')[0] ?? '')
          : 'unknown',
      );
    }
    const context = await browser.newContext({ javaScriptEnabled: false });
    try {
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' },
      });
      return new Uint8Array(pdf);
    } finally {
      await context.close();
    }
  }

  /** Closes the browser (app shutdown, tests). */
  async close(): Promise<void> {
    const browser = this.browser;
    this.browser = undefined;
    if (browser) await (await browser.catch(() => undefined))?.close();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.close();
  }

  private launch(): Promise<Browser> {
    if (!this.browser) {
      this.browser = import('playwright-core')
        .then(({ chromium }) =>
          chromium.launch({
            headless: true,
            executablePath: this.executablePath || undefined,
          }),
        )
        .catch((error: unknown) => {
          this.browser = undefined;
          this.logger.warn('Chromium could not be started for PDF exports');
          throw error;
        });
    }
    return this.browser;
  }
}
