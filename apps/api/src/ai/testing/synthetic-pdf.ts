import { PDFDocument, StandardFonts } from 'pdf-lib';

/**
 * A SYNTHETIC account statement as a real PDF (text layer, no scan), built in the test — never a
 * real statement (CLAUDE.md, Private data). Each inner array is one page, each string one line.
 */
export async function syntheticPdf(
  pages: readonly (readonly string[])[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([595, 842]);
    lines.forEach((line, index) => {
      page.drawText(line, { x: 50, y: 780 - index * 18, size: 11, font });
    });
  }
  return doc.save();
}

export const STATEMENT_PAGES = [
  [
    'Synthetic Exchange Ltd. - Account Statement',
    'Period: 01.01.2025 - 31.12.2025',
    'Crypto Holdings as of 31.12.2025',
    'Asset    Balance              Price (USD)',
    'BTC      0.123456789012345678   97,123.45',
    'ETH      1,234.5                3,400.10',
  ],
  ['Page 2', 'DOT      42.000000001', 'End of statement'],
];
