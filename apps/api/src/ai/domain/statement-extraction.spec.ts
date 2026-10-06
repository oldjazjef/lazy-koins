import { csvSourceFile, parseStandardFile } from '@lazykoins/engine';
import { PdfTextExtractor } from '../../files/application/pdf-text-extractor';
import { STATEMENT_PAGES, syntheticPdf } from '../testing/synthetic-pdf';
import {
  buildStatementPayload,
  containsVerbatim,
  derivedFileName,
  holdingsCsv,
  MAX_STATEMENT_CHARS,
  MAX_STATEMENT_PAGES,
  normalisePrinted,
  reviewHoldings,
  StatementExtractionSchema,
  statementJsonSchema,
} from './statement-extraction';

describe('PDF text extraction (pdfjs-dist, synthetic PDF)', () => {
  it('returns the text per page with line breaks', async () => {
    const pages = await new PdfTextExtractor().pages(
      await syntheticPdf(STATEMENT_PAGES),
    );
    expect(pages).toHaveLength(2);
    // pdf.js collapses runs of spaces into one.
    expect(pages[0]?.split('\n')).toContain(
      'BTC 0.123456789012345678 97,123.45',
    );
    expect(pages[1]?.split('\n')).toEqual([
      'Page 2',
      'DOT 42.000000001',
      'End of statement',
    ]);
  });

  it('refuses bytes that are not a PDF', async () => {
    await expect(
      new PdfTextExtractor().pages(new TextEncoder().encode('%PDF-1.4 broken')),
    ).rejects.toThrow('could not be read');
  });
});

describe('containsVerbatim', () => {
  it('matches whole numbers only', () => {
    const text = 'BTC 0.5 ETH 1,234.5\nDOT   42.000000001 X 11,234';
    expect(containsVerbatim(text, '0.5')).toBe(true);
    expect(containsVerbatim(text, '1,234.5')).toBe(true);
    expect(containsVerbatim(text, '42.000000001')).toBe(true);
    expect(containsVerbatim(text, '42.0')).toBe(false);
    expect(containsVerbatim(text, '1,234')).toBe(false);
    expect(containsVerbatim(text, '234.5')).toBe(false);
    expect(containsVerbatim(text, '')).toBe(false);
  });
});

describe('statement payload (F5.14)', () => {
  it('limits pages and characters', () => {
    const many = Array.from({ length: 20 }, (_, i) => `page ${i + 1}`);
    const payload = buildStatementPayload('s.pdf', many);
    expect(payload.pages).toHaveLength(MAX_STATEMENT_PAGES);
    expect(payload).toMatchObject({ pageCount: 20, truncated: true });

    const huge = buildStatementPayload('s.pdf', [
      'x'.repeat(MAX_STATEMENT_CHARS + 10),
    ]);
    expect(huge.pages[0]?.text.length).toBe(MAX_STATEMENT_CHARS);
    expect(huge.truncated).toBe(true);
  });
});

describe('normalisePrinted (textual, never through a JS number)', () => {
  it.each([
    ['0.123456789012345678', '0.123456789012345678', false],
    ['1,234.5', '1234.5', false],
    ["1'234.50", '1234.50', false],
    ['1.234,56', '1234.56', false],
    ['0,5', '0.5', false],
    ['1,234', '1234', true],
    ['12 345.000000000000000001', '12345.000000000000000001', false],
    ['-3.5', '-3.5', false],
    ['.5', '0.5', false],
  ])('%s → %s', (printed, value, ambiguous) => {
    expect(normalisePrinted(printed)).toEqual({ value, ambiguous });
  });

  it('rejects text that is not a number', () => {
    expect(normalisePrinted('n/a')).toBeUndefined();
    expect(normalisePrinted('1.2.3,4,5')).toBeUndefined();
  });
});

describe('reviewHoldings: verbatim check against the extracted text', () => {
  it('flags quantities that are not in the text, keeps 18 decimals exactly', async () => {
    const pages = await new PdfTextExtractor().pages(
      await syntheticPdf(STATEMENT_PAGES),
    );
    const reviewed = reviewHoldings(
      {
        holdings: [
          {
            asset: 'btc',
            quantityAsPrinted: '0.123456789012345678',
            asOf: '2025-12-31',
            platform: 'Synthetic Exchange',
            priceUsdAsPrinted: '97,123.45',
            page: 1,
          },
          {
            asset: 'ETH',
            quantityAsPrinted: '1,234.5',
            asOf: '2025-12-31',
            platform: 'synthetic',
            page: 1,
          },
          // Rounded by the model: not what is printed.
          {
            asset: 'DOT',
            quantityAsPrinted: '42.0',
            asOf: '2025-12-31',
            platform: 'synthetic',
            page: 2,
          },
          // Printed on page 2, claimed on page 1.
          {
            asset: 'DOT',
            quantityAsPrinted: '42.000000001',
            asOf: '2025-12-31',
            platform: 'synthetic',
            page: 1,
          },
        ],
      },
      pages,
    );
    expect(reviewed[0]).toMatchObject({
      asset: 'BTC',
      quantity: '0.123456789012345678',
      priceUsd: '97123.45',
      platform: 'synthetic-exchange',
      account: 'main',
      verbatim: true,
      issues: [],
    });
    expect(reviewed[1]).toMatchObject({ quantity: '1234.5', verbatim: true });
    expect(reviewed[2]).toMatchObject({
      verbatim: false,
      issues: ['notVerbatim'],
    });
    expect(reviewed[3]).toMatchObject({
      verbatim: true,
      issues: ['pageMismatch'],
    });

    const csv = holdingsCsv('Statement 2025.pdf', reviewed);
    expect(csv.ok).toBe(true);
    if (!csv.ok) return;
    // The derived CSV is a valid standard-format "Bestände" file, page in "Beleg".
    const parsed = parseStandardFile(
      csvSourceFile({
        id: 'c'.repeat(64),
        name: derivedFileName('Statement 2025.pdf'),
        bytes: new TextEncoder().encode(csv.csv),
      }),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.holdings).toHaveLength(4);
    expect(parsed.holdings[0]?.quantity.toFixed()).toBe('0.123456789012345678');
    expect(parsed.holdings[0]?.evidence).toBe('Statement 2025.pdf, S. 1');
    expect(parsed.holdings[2]?.evidence).toContain('nicht wörtlich');
    expect(derivedFileName('Statement 2025.pdf')).toBe(
      'Statement 2025.bestaende.csv',
    );
  });

  it('reports records the standard format refuses', () => {
    const csv = holdingsCsv('s.pdf', [
      {
        asset: 'BTC',
        quantityAsPrinted: 'n/a',
        quantity: null,
        asOf: '2025-12-31',
        platform: 'x',
        account: 'main',
        priceChf: null,
        priceUsd: null,
        page: 1,
        verbatim: true,
        issues: ['invalidNumber'],
      },
    ]);
    expect(csv).toEqual({
      ok: false,
      errors: [{ index: 0, column: 'Menge', code: 'required' }],
    });
  });

  it('exports a JSON Schema for the model and validates its answer', () => {
    expect(statementJsonSchema()).toMatchObject({ type: 'object' });
    expect(
      StatementExtractionSchema.safeParse({ holdings: [{ asset: 'BTC' }] })
        .success,
    ).toBe(false);
  });
});
