import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  PdfRendererPort,
  PdfUnavailableError,
} from '../../exports/ports/project-export.repository.port';
import { IntegrationsModule } from '../integrations.module';
import { HostPdfRenderer, registerHostPdfPrinter } from './host-pdf.renderer';
import { PlaywrightPdfRenderer } from './playwright-pdf.renderer';
import {
  type PdfPrintOptions,
  PDF_PRINT_OPTIONS,
  printOptionsFor,
} from './print-options';
import { selectPdfRenderer } from './select-pdf-renderer';

const PDF = new TextEncoder().encode('%PDF-1.7 fake');

describe('PDF renderer selection', () => {
  afterEach(() => registerHostPdfPrinter(undefined));

  it('uses the host printer (desktop: Electron printToPDF) when one is given', async () => {
    const calls: [string, PdfPrintOptions][] = [];
    const renderer = selectPdfRenderer({
      hostPrinter: async (html, options) => {
        calls.push([html, options]);
        return PDF;
      },
      chromiumPath: '/usr/bin/chromium',
    });
    expect(renderer).toBeInstanceOf(HostPdfRenderer);
    expect(await renderer.available()).toBe(true);
    expect(await renderer.render('<p>x</p>')).toBe(PDF);
    expect(calls).toEqual([['<p>x</p>', PDF_PRINT_OPTIONS]]);
  });

  it('falls back to Playwright Chromium without a host printer (server, container)', () => {
    expect(
      selectPdfRenderer({ hostPrinter: undefined, chromiumPath: '' }),
    ).toBeInstanceOf(PlaywrightPdfRenderer);
  });

  it('turns a failing host print into PdfUnavailableError (the API answers 503)', async () => {
    const renderer = new HostPdfRenderer(async () => {
      throw new Error('window crashed\nstack');
    });
    await expect(renderer.render('<p/>')).rejects.toThrow(PdfUnavailableError);
  });

  it('binds the registered host printer in the module graph', async () => {
    registerHostPdfPrinter(async () => PDF);
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        IntegrationsModule,
      ],
    }).compile();
    expect(moduleRef.get(PdfRendererPort)).toBeInstanceOf(HostPdfRenderer);
    await moduleRef.close();
  });

  it('prints A4 with a page-number footer', () => {
    expect(PDF_PRINT_OPTIONS.format).toBe('A4');
    expect(PDF_PRINT_OPTIONS.footerTemplate).toContain('pageNumber');
    expect(PDF_PRINT_OPTIONS.footerTemplate).toContain('totalPages');
  });

  it('numbers the pages in the document language (F11.2)', () => {
    expect(printOptionsFor('<html lang="de-CH"><p>x</p></html>')).toBe(
      PDF_PRINT_OPTIONS,
    );
    expect(printOptionsFor('<p>x</p>')).toBe(PDF_PRINT_OPTIONS);
    const en = printOptionsFor(
      '<!doctype html><html lang="en"><p>x</p></html>',
    );
    expect(en.footerTemplate).toContain('Page <span class="pageNumber">');
    expect(en.footerTemplate).not.toContain('Seite');
  });
});
