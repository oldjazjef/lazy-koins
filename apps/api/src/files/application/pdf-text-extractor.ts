import { Injectable } from '@nestjs/common';

/** Guards against a huge PDF: pages beyond this are not read. */
const MAX_PAGES = 50;

interface TextItem {
  readonly str?: string;
  readonly hasEOL?: boolean;
  readonly transform?: readonly number[];
}

export class UnreadablePdfError extends Error {
  constructor() {
    super('The PDF could not be read');
    this.name = 'UnreadablePdfError';
  }
}

/**
 * PDF → text per page with `pdfjs-dist` (legacy build, the one meant for Node). Lines are
 * rebuilt from the text items: a new line where pdf.js marks an end of line or where the baseline
 * moves. No OCR — a scanned statement yields empty pages. Never logs the text.
 *
 * pdfjs-dist is ESM-only; it is loaded with a dynamic `import()` on first use, so the API boots
 * without it and the cost is paid only by PDF features (the AI statement reader).
 */
@Injectable()
export class PdfTextExtractor {
  async pages(bytes: Uint8Array): Promise<string[]> {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    // pdf.js may transfer (detach) the buffer it gets — hand it a copy.
    const task = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      disableFontFace: true,
      useSystemFonts: false,
      verbosity: 0,
    });
    try {
      let document;
      try {
        document = await task.promise;
      } catch {
        throw new UnreadablePdfError();
      }
      const pages: string[] = [];
      const count = Math.min(document.numPages, MAX_PAGES);
      for (let number = 1; number <= count; number += 1) {
        const page = await document.getPage(number);
        const content = await page.getTextContent();
        pages.push(linesOf(content.items as readonly TextItem[]));
        page.cleanup();
      }
      return pages;
    } finally {
      await task.destroy();
    }
  }
}

/** Text items in reading order → lines (`\n`), cells of one line separated by their own spaces. */
export function linesOf(items: readonly TextItem[]): string {
  const lines: string[] = [];
  let current = '';
  let baseline: number | undefined;
  for (const item of items) {
    const text = item.str ?? '';
    const y = item.transform?.[5];
    if (
      baseline !== undefined &&
      y !== undefined &&
      Math.abs(y - baseline) > 2 &&
      current !== ''
    ) {
      lines.push(current.trimEnd());
      current = '';
    }
    if (y !== undefined && text !== '') baseline = y;
    current += text;
    if (item.hasEOL) {
      lines.push(current.trimEnd());
      current = '';
      baseline = undefined;
    }
  }
  if (current.trim() !== '') lines.push(current.trimEnd());
  return lines.join('\n');
}
