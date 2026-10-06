import { tryParseDecimal } from '../money/decimal';
import type { RateEntry } from './rate-table';

/**
 * Import of the ESTV Kursliste (ICTax) the user downloaded (F7.4). The ESTV publishes it as XML;
 * its exact schema is not pinned here, so the reader is **tolerant** and also accepts the simple
 * CSV this app documents:
 *
 * ```
 * asset;kurs_chf;datum
 * BTC;85000.00;2025-12-31
 * ETH;3000.50;31.12.2025
 * ```
 *
 * - CSV: `;`, `,` or tab; a header row is optional; `datum` is optional (default 31.12. of the tax
 *   year), as `YYYY-MM-DD` or `DD.MM.YYYY`; Swiss grouping (`1'234.50`) and a decimal comma are
 *   accepted.
 * - XML: every element with a `symbol` (or `currency`/`shortName`) attribute names the asset; the
 *   first value attribute named like `taxValueCHF`, `taxValue`, `kurs`, `value`, `quotation` or
 *   `steuerwert` on it or on a descendant is its CHF value; a `date`/`datum`/`validFrom`
 *   attribute, when present, its day.
 *
 * Pure: text in, entries out. Values stay decimal strings.
 */

export interface KurslisteResult {
  readonly entries: readonly RateEntry[];
  /** Lines/elements that named an asset but carried no readable value. */
  readonly skipped: number;
}

function normaliseNumber(text: string): string | undefined {
  let cleaned = text.trim().replace(/['’\s]/g, '');
  if (cleaned.includes(',') && !cleaned.includes('.'))
    cleaned = cleaned.replace(',', '.');
  const value = tryParseDecimal(cleaned);
  return value === undefined || value.isNegative()
    ? undefined
    : value.toFixed();
}

function normaliseDate(text: string | undefined, fallback: string): string {
  if (!text) return fallback;
  const trimmed = text.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ch = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(trimmed);
  if (ch && ch[1] && ch[2])
    return `${ch[3]}-${ch[2].padStart(2, '0')}-${ch[1].padStart(2, '0')}`;
  return fallback;
}

function entry(asset: string, value: string, date: string): RateEntry {
  return {
    kind: 'price',
    asset: asset.trim().toUpperCase(),
    currency: 'CHF',
    date,
    value,
    source: 'estv',
  };
}

function parseCsv(text: string, fallbackDate: string): KurslisteResult {
  const entries: RateEntry[] = [];
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const delimiter = line.includes(';')
      ? ';'
      : line.includes('\t')
        ? '\t'
        : ',';
    const [asset = '', kurs = '', datum] = line
      .split(delimiter)
      .map((cell) => cell.trim().replace(/^"|"$/g, ''));
    if (asset === '') continue;
    const value = normaliseNumber(kurs);
    if (value === undefined) {
      // A header row (`asset;kurs_chf;datum`) or an unreadable value.
      if (!/^(asset|symbol|währung|waehrung|kürzel)$/i.test(asset))
        skipped += 1;
      continue;
    }
    entries.push(entry(asset, value, normaliseDate(datum, fallbackDate)));
  }
  return { entries, skipped };
}

const SYMBOL_ATTRS = ['symbol', 'currency', 'shortname'];
const VALUE_ATTRS = [
  'taxvaluechf',
  'taxvalue',
  'steuerwert',
  'kurs',
  'quotation',
  'value',
];
const DATE_ATTRS = ['date', 'datum', 'validfrom', 'referencedate'];

function attributes(text: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of text.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) {
    const name = match[1];
    const value = match[2];
    if (name !== undefined && value !== undefined)
      result.set(name.toLowerCase().replace(/^.*:/, ''), value);
  }
  return result;
}

function parseXml(text: string, fallbackDate: string): KurslisteResult {
  const entries: RateEntry[] = [];
  let skipped = 0;
  /** Open elements that named an asset, innermost last. */
  const stack: {
    tag: string;
    asset: string;
    date?: string;
    done: boolean;
  }[] = [];
  for (const match of text.matchAll(/<(\/?)([\w:.-]+)([^>]*?)(\/?)>/g)) {
    const [, closing, tag = '', rest = '', selfClosing] = match;
    if (closing) {
      const top = stack[stack.length - 1];
      if (top && top.tag === tag) {
        stack.pop();
        if (!top.done) skipped += 1;
      }
      continue;
    }
    const attrs = attributes(rest);
    const symbol = SYMBOL_ATTRS.map((name) => attrs.get(name)).find(
      (value) => value !== undefined && value.trim() !== '',
    );
    const dateText = DATE_ATTRS.map((name) => attrs.get(name)).find(
      (value) => value !== undefined,
    );
    const valueText = VALUE_ATTRS.map((name) => attrs.get(name)).find(
      (value) => value !== undefined && normaliseNumber(value) !== undefined,
    );
    let owner = stack[stack.length - 1];
    if (symbol !== undefined) {
      owner = {
        tag,
        asset: symbol,
        date: dateText ? normaliseDate(dateText, fallbackDate) : undefined,
        done: false,
      };
      if (!selfClosing) stack.push(owner);
    }
    if (owner && !owner.done && valueText !== undefined) {
      const value = normaliseNumber(valueText);
      if (value !== undefined) {
        const date = dateText
          ? normaliseDate(dateText, fallbackDate)
          : (owner.date ?? fallbackDate);
        entries.push(entry(owner.asset, value, date));
        owner.done = true;
      }
    } else if (symbol !== undefined && selfClosing && !owner?.done) {
      skipped += 1;
    }
  }
  return { entries, skipped };
}

/** Reads a Kursliste (XML or the documented CSV); values default to 31.12. of `taxYear`. */
/** A byte-order mark some exports start with. */
const BOM = String.fromCharCode(0xfeff);

export function parseKursliste(text: string, taxYear: number): KurslisteResult {
  const fallbackDate = `${taxYear}-12-31`;
  const body = (text.startsWith(BOM) ? text.slice(1) : text).trim();
  const result = body.startsWith('<')
    ? parseXml(body, fallbackDate)
    : parseCsv(body, fallbackDate);
  // Last value per asset and day wins; sorted for determinism.
  const unique = new Map<string, RateEntry>();
  for (const e of result.entries) unique.set(`${e.asset}|${e.date}`, e);
  return {
    entries: [...unique.values()].sort((a, b) =>
      a.asset === b.asset
        ? a.date < b.date
          ? -1
          : 1
        : a.asset < b.asset
          ? -1
          : 1,
    ),
    skipped: result.skipped,
  };
}
