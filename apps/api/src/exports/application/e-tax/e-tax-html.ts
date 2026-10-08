import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import type { ExportData } from '../export-data';
import { kitOf } from '../export-texts';
import { escapeHtml as e } from '../pdf/statement-html';
import { code128c } from './code128';
import {
  ECH0196_MINOR_VERSION,
  ETAX_ORGANISATION,
  type ETaxSecurity,
  type ETaxStatement,
} from './e-tax-statement';
import { macroPdf417, type Pdf417Symbol } from './pdf417';
import { monochromePng } from './png';

/**
 * F10.10: the E-Steuerauszug as PDF — readable pages (the securities list and totals), then the
 * **2D barcode sheets**: the ZLIB-compressed XML as PDF417 Structured Append (eCH-0196 Beilage 2
 * §2.2: 13 columns, 35 rows, EC level 4, one pixel per module in a 290 × 35 image scaled to
 * 0.042 × 0.08 cm per module, corrected for 97 % printing; ≤ 6 segments per sheet, segment 0 at
 * the top). Every page carries the 16-digit CODE128C page barcode (§2.4): form, version, an
 * organisation number, the page number, 2D flag, orientation, reading direction.
 *
 * The sheets are portrait pages with the segments turned (§1.3 allows portrait when the segments
 * are rotated 90° against the landscape layout) — orientation digit 1, reading direction 1. Form
 * number 196 on barcode sheets and 197 on readable pages, as in statements banks issue that the
 * cantonal software reads (the open-source generators found this by decoding accepted ones).
 */

/** eCH: 13 data columns × 35 rows, EC level 4, 450 bytes per segment. */
export const ETAX_PDF417 = {
  columns: 13,
  rows: 35,
  ecLevel: 4,
  segmentBytes: 450,
} as const;
const SEGMENTS_PER_SHEET = 6;
const PRINT_SCALE = 0.97;
const MODULE_W_CM = 0.042 / PRINT_SCALE;
const MODULE_H_CM = 0.08 / PRINT_SCALE;
const ROWS_FIRST_PAGE = 26;
const ROWS_PER_PAGE = 40;
/** Rows the totals and notes need on the last readable page. */
const ROWS_FOR_TOTALS = 14;

/** 16 digits: form (3) + version (2) + organisation (5) + page (3) + 2D + orientation + direction. */
export function pageBarcodeDigits(page: number, barcodeSheet: boolean): string {
  return `${barcodeSheet ? '196' : '197'}${ECH0196_MINOR_VERSION}${ETAX_ORGANISATION}${String(page).padStart(3, '0')}${barcodeSheet ? '1' : '0'}11`;
}

/** PDFMacroFileId: four codewords (0–899) from the statement id — the same statement, the same id. */
export function macroFileId(statementId: string): number[] {
  const digest = createHash('sha256').update(statementId).digest();
  return [0, 1, 2, 3].map((i) => digest.readUInt16BE(2 * i) % 900);
}

/** The XML as ZLIB (best compression) in PDF417 segments. */
export function eTaxSegments(statementId: string, xml: string): Pdf417Symbol[] {
  return macroPdf417(deflateSync(Buffer.from(xml, 'utf8'), { level: 9 }), {
    ...ETAX_PDF417,
    fileId: macroFileId(statementId),
    fileName: statementId,
  });
}

const STYLE = `
  @page { size: A4 portrait; }
  * { box-sizing: border-box; }
  body { font-family: 'Inter', 'Segoe UI', Arial, sans-serif; font-size: 9pt; color: #1d2433; margin: 0; }
  .page { position: relative; height: 266mm; overflow: hidden; break-after: page; padding-top: 16mm; }
  .page:last-child { break-after: auto; }
  .code128 { position: absolute; top: 0; left: 0; width: 41mm; }
  .code128 svg { display: block; width: 41mm; height: 7mm; }
  .code128 div { margin-top: 2mm; font-size: 8pt; line-height: 3mm; letter-spacing: 0.4mm; font-family: 'Courier New', monospace; }
  h1 { font-size: 15pt; margin: 0 0 4pt; }
  h2 { font-size: 11pt; margin: 10pt 0 4pt; }
  .meta { margin: 0 0 8pt; color: #4a5568; }
  .meta td { padding: 1pt 8pt 1pt 0; border: 0; }
  table.list { width: 100%; border-collapse: collapse; }
  table.list { table-layout: fixed; font-size: 8pt; }
  .list th, .list td { text-align: left; padding: 2.5pt 3pt; border-bottom: 1px solid #e5e9f0; vertical-align: bottom; }
  .list td { white-space: nowrap; }
  .list td.cut { overflow: hidden; text-overflow: ellipsis; }
  .list col.pos { width: 8mm; } .list col.valor { width: 16mm; } .list col.q { width: 32mm; }
  .list col.n { width: 22mm; } .list col.c { width: 15mm; }
  .list th { background: #eef1f6; font-weight: 600; }
  .list td.num, .list th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .list tr.depot td { font-weight: 600; background: #f6f8fb; }
  .totals { margin-top: 8pt; width: 100%; border-collapse: collapse; }
  .totals td { padding: 2pt 4pt; }
  .totals td.num { text-align: right; font-weight: 600; }
  .small { font-size: 8pt; color: #4a5568; }
  ul { margin: 2pt 0 0 12pt; padding: 0; }
  li { margin: 1pt 0; font-size: 8pt; color: #4a5568; }
  .sheet-title { position: absolute; top: 0; right: 0; text-align: right; font-size: 8pt; color: #4a5568; max-width: 120mm; }
  .segments { display: flex; flex-direction: column; align-items: center; gap: 9mm; margin-top: 8mm; }
  .segments img { display: block; width: ${(290 * MODULE_W_CM).toFixed(3)}cm; height: ${(35 * MODULE_H_CM).toFixed(3)}cm; image-rendering: pixelated; }
`;

function code128Svg(digits: string): string {
  const modules = code128c(digits);
  const bars: string[] = [];
  for (let i = 0; i < modules.length;) {
    if (!modules[i]) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < modules.length && modules[j]) j += 1;
    bars.push(`<rect x="${i}" y="0" width="${j - i}" height="1"/>`);
    i = j;
  }
  return `<div class="code128"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${modules.length} 1" preserveAspectRatio="none" shape-rendering="crispEdges" fill="#000">${bars.join('')}</svg><div>${digits}</div></div>`;
}

type Row =
  | { readonly kind: 'depot'; readonly label: string }
  | { readonly kind: 'security'; readonly security: ETaxSecurity };

/** The readable pages and the barcode sheets of one statement. */
export function eTaxStatementHtml(
  data: ExportData,
  statement: ETaxStatement,
  xml: string,
): string {
  const k = kitOf(data);
  const t = k.t.eTax;
  const rows: Row[] = statement.depots.flatMap((d) => [
    { kind: 'depot', label: d.depotNumber } as const,
    ...d.securities.map(
      (security) => ({ kind: 'security', security }) as const,
    ),
  ]);
  const chunks: Row[][] = [];
  let rest = rows;
  let capacity = ROWS_FIRST_PAGE;
  do {
    chunks.push(rest.slice(0, capacity));
    rest = rest.slice(capacity);
    capacity = ROWS_PER_PAGE;
  } while (rest.length > 0);
  const lastCapacity = chunks.length === 1 ? ROWS_FIRST_PAGE : ROWS_PER_PAGE;
  if (
    (chunks[chunks.length - 1]?.length ?? 0) >
    lastCapacity - ROWS_FOR_TOTALS
  ) {
    chunks.push([]);
  }
  const value = (v: string | null) =>
    v === null ? t.undefinedValue : k.chf(v);
  const row = (r: Row): string => {
    if (r.kind === 'depot') {
      return `<tr class="depot"><td class="cut" colspan="8">${e(`${t.depot}: ${r.label}`)}</td></tr>`;
    }
    const s = r.security;
    const tv = s.taxValue;
    return `<tr><td>${s.positionId}</td><td class="cut">${e(s.name)}</td><td>${e(s.valorNumber ?? '')}</td><td class="num">${tv ? e(k.quantity(tv.quantity)) : ''}</td><td class="num">${tv?.price ? e(k.quantity(tv.price)) : tv ? e(t.undefinedValue) : ''}</td><td class="num">${tv ? e(value(tv.value)) : ''}</td><td class="num">${s.payments.length > 0 ? e(value(s.revenue)) : ''}</td><td class="num">${s.payments.length || ''}</td></tr>`;
  };
  const head = `<tr><th>${e(t.pos)}</th><th>${e(t.name)}</th><th>${e(t.valor)}</th><th class="num">${e(t.quantity)}</th><th class="num">${e(t.price)}</th><th class="num">${e(t.taxValue)}</th><th class="num">${e(t.revenueB)}</th><th class="num">${e(t.payments)}</th></tr>`;
  const person = [statement.firstName, statement.lastName]
    .filter(Boolean)
    .join(' ');
  const segments = eTaxSegments(statement.id, xml);
  const sheets: Pdf417Symbol[][] = [];
  for (let i = 0; i < segments.length; i += SEGMENTS_PER_SHEET) {
    sheets.push(segments.slice(i, i + SEGMENTS_PER_SHEET));
  }
  let pageNo = 0;
  const readable = chunks.map((chunk, index) => {
    pageNo += 1;
    const first = index === 0;
    const last = index === chunks.length - 1;
    const intro = first
      ? `<h1>${e(t.title(statement.taxYear))}</h1>
        <p class="small">${e(t.intro)}</p>
        <table class="meta">
          <tr><td>${e(t.client)}</td><td>${e(person || statement.clientNumber)} · ${e(statement.clientNumber)}</td></tr>
          <tr><td>${e(t.canton)}</td><td>${e(statement.canton)} · ${statement.taxYear}</td></tr>
          <tr><td>${e(t.statementId)}</td><td>${e(statement.id)}</td></tr>
          <tr><td>${e(t.maker)}</td><td>${e(`${t.makerValue} (${data.appVersion})`)}</td></tr>
        </table>`
      : '';
    const table =
      chunk.length > 0
        ? `<table class="list"><colgroup><col class="pos"><col><col class="valor"><col class="q"><col class="n"><col class="n"><col class="n"><col class="c"></colgroup><thead>${head}</thead><tbody>${chunk.map(row).join('')}</tbody></table>`
        : '';
    const totals = last
      ? `<table class="totals">
          <tr><td>${e(t.totalTaxValue)}</td><td class="num">${e(k.chf(statement.totalTaxValue))}</td></tr>
          <tr><td>${e(t.totalRevenueA)}</td><td class="num">${e(k.chf('0'))}</td></tr>
          <tr><td>${e(t.totalRevenueB)}</td><td class="num">${e(k.chf(statement.totalRevenueB))}</td></tr>
          <tr><td>${e(t.totalWithholding)}</td><td class="num">${e(k.chf('0'))}</td></tr>
        </table>
        ${statement.undefinedCount > 0 ? `<p class="small">${e(t.undefinedNote)}</p>` : ''}
        <h2>${e(t.limitationsTitle)}</h2>
        <ul>${t.limitations.map((l) => `<li>${e(l)}</li>`).join('')}</ul>
        <p class="small">${e(data.rules.labels.noTaxAdvice)}</p>`
      : '';
    return `<section class="page">${code128Svg(pageBarcodeDigits(pageNo, false))}${intro}${table}${totals}</section>`;
  });
  const barcodePages = sheets.map((sheet, index) => {
    pageNo += 1;
    const images = sheet
      .map(
        (symbol) =>
          `<img alt="" src="data:image/png;base64,${monochromePng(symbol.matrix).toString('base64')}">`,
      )
      .join('');
    return `<section class="page">${code128Svg(pageBarcodeDigits(pageNo, true))}<div class="sheet-title">${e(t.barcodeSheet(index + 1, sheets.length))}<br>${e(statement.id)}<br>${e(t.barcodeNote)}</div><div class="segments">${images}</div></section>`;
  });
  return `<!doctype html><html lang="${e(k.t.htmlLang)}"><head><meta charset="utf-8"><title>${e(t.title(statement.taxYear))}</title><style>${STYLE}</style></head><body>${[...readable, ...barcodePages].join('')}</body></html>`;
}
