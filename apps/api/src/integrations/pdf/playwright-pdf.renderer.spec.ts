import { PlaywrightPdfRenderer } from './playwright-pdf.renderer';

/**
 * The real Chromium print. Skipped where no browser is installed (CI without
 * `pnpm exec playwright-core install chromium`); the HTML itself is tested in the exports specs.
 */
describe('PlaywrightPdfRenderer', () => {
  const renderer = new PlaywrightPdfRenderer(
    process.env['PDF_CHROMIUM_PATH'] ?? '',
  );
  let browser = false;

  beforeAll(async () => {
    browser = await renderer.available();
  }, 30_000);

  afterAll(() => renderer.close());

  it('prints HTML to a PDF', async (context) => {
    if (!browser) context.skip();
    const pdf = await renderer.render(
      '<!doctype html><html><body><h1>Steuerauszug</h1><p>CHF 1’234.50</p></body></html>',
    );
    expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe('%PDF-');
    expect(pdf.byteLength).toBeGreaterThan(500);
  }, 30_000);
});
