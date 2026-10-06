import {
  columnNames,
  HOLDING_COLUMNS,
  StandardHoldingRowSchema,
  toCsv,
} from '@lazykoins/engine';
import { z } from 'zod';

/**
 * PDF account statements → standard-format **Bestände** via the AI (one-off conversion, no
 * mapping is stored). The model returns balances with the quantity **exactly as printed**; the
 * app normalises it textually (never through a JS number), checks that the printed string is in
 * the extracted text, and writes a derived standard-format CSV whose `Beleg` names the PDF page.
 */

/** F5.14: what is sent — the page texts, limited. */
export interface StatementPayload {
  readonly fileName: string;
  readonly pageCount: number;
  /** Only the first `MAX_STATEMENT_PAGES` pages, cut at `MAX_STATEMENT_CHARS` in total. */
  readonly pages: readonly { readonly page: number; readonly text: string }[];
  readonly truncated: boolean;
}

export const MAX_STATEMENT_PAGES = 12;
export const MAX_STATEMENT_CHARS = 40_000;

export function buildStatementPayload(
  fileName: string,
  pageTexts: readonly string[],
): StatementPayload {
  const pages: { page: number; text: string }[] = [];
  let budget = MAX_STATEMENT_CHARS;
  let truncated = pageTexts.length > MAX_STATEMENT_PAGES;
  for (const [index, text] of pageTexts
    .slice(0, MAX_STATEMENT_PAGES)
    .entries()) {
    if (budget <= 0) {
      truncated = true;
      break;
    }
    const kept = text.length > budget ? text.slice(0, budget) : text;
    if (kept.length < text.length) truncated = true;
    budget -= kept.length;
    pages.push({ page: index + 1, text: kept });
  }
  return { fileName, pageCount: pageTexts.length, pages, truncated };
}

const printed = z.string().trim().min(1).max(80);

/** What the model must return (its JSON Schema goes into the request). */
export const StatementExtractionSchema = z
  .object({
    holdings: z
      .array(
        z.object({
          asset: z
            .string()
            .trim()
            .min(1)
            .max(40)
            .describe('Ticker as printed, e.g. BTC.'),
          quantityAsPrinted: printed.describe(
            'The balance exactly as printed in the text, character for character.',
          ),
          asOf: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .describe('Date of the balance, YYYY-MM-DD.'),
          platform: z
            .string()
            .trim()
            .min(1)
            .max(40)
            .describe('Lower-case platform, e.g. kraken, binance.'),
          account: z
            .string()
            .trim()
            .max(40)
            .optional()
            .describe(
              'Account/wallet on the platform if the statement names one.',
            ),
          priceChfAsPrinted: printed
            .optional()
            .describe('Price per unit in CHF exactly as printed, if any.'),
          priceUsdAsPrinted: printed
            .optional()
            .describe('Price per unit in USD exactly as printed, if any.'),
          page: z
            .number()
            .int()
            .min(1)
            .describe('1-based page the balance is printed on.'),
        }),
      )
      .max(500),
  })
  .describe('Balances per asset read from an account statement.');

export type StatementExtraction = z.infer<typeof StatementExtractionSchema>;

export function statementJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(StatementExtractionSchema, { io: 'input' }) as Record<
    string,
    unknown
  >;
}

/** Problems the review table shows next to a record. */
export const HOLDING_ISSUES = [
  'notVerbatim',
  'pageMismatch',
  'invalidNumber',
  'ambiguousSeparator',
  'priceNotVerbatim',
  'pageOutOfRange',
  'invalidRecord',
] as const;
export type HoldingIssue = (typeof HOLDING_ISSUES)[number];

export interface ExtractedHolding {
  readonly asset: string;
  readonly quantityAsPrinted: string;
  /** Normalised decimal string (`.` decimal, no grouping); null when not a number. */
  readonly quantity: string | null;
  readonly asOf: string;
  readonly platform: string;
  readonly account: string;
  readonly priceChf: string | null;
  readonly priceUsd: string | null;
  readonly priceChfAsPrinted?: string;
  readonly priceUsdAsPrinted?: string;
  readonly page: number;
  /** The printed quantity appears verbatim in the extracted text. */
  readonly verbatim: boolean;
  readonly issues: readonly HoldingIssue[];
}

/**
 * A printed number → a plain decimal string, textually: grouping (`'`, `’`, spaces, `,` or `.`)
 * removed, the decimal separator made a `.`. `ambiguous` when a single `,` is followed by exactly
 * three digits (`1,234` — thousands in English statements, a decimal comma in German ones; read
 * as thousands and flagged).
 */
export function normalisePrinted(
  text: string,
): { value: string; ambiguous: boolean } | undefined {
  let v = text.replace(/[\s\u00a0\u202f'’]/g, '').replace(/[^\d.,+-]/g, '');
  const negative = v.startsWith('-');
  v = v.replace(/^[+-]/, '');
  if (!/^[\d.,]+$/.test(v) || !/\d/.test(v)) return undefined;
  let ambiguous = false;
  const commas = (v.match(/,/g) ?? []).length;
  const dots = (v.match(/\./g) ?? []).length;
  if (commas > 0 && dots > 0) {
    const decimal = v.lastIndexOf(',') > v.lastIndexOf('.') ? ',' : '.';
    const group = decimal === ',' ? '.' : ',';
    v = v.split(group).join('');
    if (decimal === ',') v = v.replace(',', '.');
  } else if (commas > 1) {
    v = v.split(',').join('');
  } else if (commas === 1) {
    const after = v.length - v.indexOf(',') - 1;
    if (after === 3) {
      ambiguous = true;
      v = v.replace(',', '');
    } else {
      v = v.replace(',', '.');
    }
  } else if (dots > 1) {
    v = v.split('.').join('');
  }
  if (!/^\d+(\.\d+)?$/.test(v) && !/^\d*\.\d+$/.test(v)) return undefined;
  if (v.startsWith('.')) v = `0${v}`;
  return { value: negative ? `-${v}` : v, ambiguous };
}

/**
 * `needle` in `haystack` as a whole number: exactly, or with runs of whitespace collapsed, and
 * never as part of a longer number (`42.0` is not in `42.000000001`, `1,234` not in `11,234`).
 */
export function containsVerbatim(haystack: string, needle: string): boolean {
  const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();
  const target = collapse(needle);
  if (target === '') return false;
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const whole = new RegExp(`(?<![\\d.,'’])${escaped}(?![\\d]|[.,'’]\\d)`);
  return whole.test(haystack) || whole.test(collapse(haystack));
}

/** Checks and normalises the model's records against the extracted page texts. */
export function reviewHoldings(
  extraction: StatementExtraction,
  pageTexts: readonly string[],
): ExtractedHolding[] {
  const all = pageTexts.join('\n');
  return extraction.holdings.map((record) => {
    const issues: HoldingIssue[] = [];
    const pageText = pageTexts[record.page - 1];
    if (pageText === undefined) issues.push('pageOutOfRange');
    const onPage =
      pageText !== undefined &&
      containsVerbatim(pageText, record.quantityAsPrinted);
    const anywhere = onPage || containsVerbatim(all, record.quantityAsPrinted);
    if (!anywhere) issues.push('notVerbatim');
    else if (!onPage && pageText !== undefined) issues.push('pageMismatch');
    const quantity = normalisePrinted(record.quantityAsPrinted);
    if (!quantity) issues.push('invalidNumber');
    else if (quantity.ambiguous) issues.push('ambiguousSeparator');
    const price = (printedPrice: string | undefined): string | null => {
      if (printedPrice === undefined || printedPrice === '') return null;
      if (!containsVerbatim(all, printedPrice)) issues.push('priceNotVerbatim');
      return normalisePrinted(printedPrice)?.value ?? null;
    };
    const priceChf = price(record.priceChfAsPrinted);
    const priceUsd = price(record.priceUsdAsPrinted);
    return {
      asset: record.asset.toUpperCase(),
      quantityAsPrinted: record.quantityAsPrinted,
      quantity: quantity?.value ?? null,
      asOf: record.asOf,
      platform: platformName(record.platform),
      account: record.account?.trim() || 'main',
      priceChf,
      priceUsd,
      ...(record.priceChfAsPrinted
        ? { priceChfAsPrinted: record.priceChfAsPrinted }
        : {}),
      ...(record.priceUsdAsPrinted
        ? { priceUsdAsPrinted: record.priceUsdAsPrinted }
        : {}),
      page: record.page,
      verbatim: anywhere,
      issues,
    };
  });
}

export function platformName(raw: string): string {
  const name = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return name || 'unbekannt';
}

/**
 * The derived standard-format CSV ("Bestände") from reviewed records: every row validated with
 * the standard format's own row schema, `Beleg` = the PDF and page (F7.5), with a warning when
 * the quantity was not found verbatim. Returns the invalid rows instead when any.
 */
export function holdingsCsv(
  pdfName: string,
  records: readonly ExtractedHolding[],
):
  | { ok: true; csv: string }
  | { ok: false; errors: { index: number; column: string; code: string }[] } {
  const H = HOLDING_COLUMNS;
  const rows: string[][] = [];
  const errors: { index: number; column: string; code: string }[] = [];
  records.forEach((record, index) => {
    const row: Record<string, string> = {
      [H.platform.name]: platformName(record.platform),
      [H.account.name]: record.account,
      [H.asset.name]: record.asset,
      [H.quantity.name]: record.quantity ?? '',
      [H.asOf.name]: record.asOf.trim(),
      [H.priceChf.name]: record.priceChf ?? '',
      [H.priceUsd.name]: record.priceUsd ?? '',
      [H.evidence.name]: record.verbatim
        ? `${pdfName}, S. ${record.page}`
        : `${pdfName}, S. ${record.page} (Menge nicht wörtlich im Text gefunden – prüfen)`,
    };
    const parsed = StandardHoldingRowSchema.safeParse(row);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({
          index,
          column: String(issue.path[0] ?? ''),
          code: issue.message,
        });
      }
      return;
    }
    rows.push(columnNames(H).map((name) => row[name] ?? ''));
  });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, csv: toCsv([columnNames(H), ...rows]) };
}

/** `Kontoauszug 2025.pdf` → `Kontoauszug 2025.bestaende.csv`. */
export function derivedFileName(pdfName: string): string {
  return `${pdfName.replace(/\.pdf$/i, '')}.bestaende.csv`;
}
