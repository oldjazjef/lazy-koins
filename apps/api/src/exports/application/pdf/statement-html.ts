import { INCOME_CATEGORIES } from '@lazykoins/engine';
import { methodLines } from '../excel/detailed-workbook';
import type { ExportData } from '../export-data';
import { type ExportKit, kitOf, metaLine } from '../export-texts';

/**
 * HTML of the statements, printed to PDF by Chromium (F10.1, F10.2). Self-contained: inline CSS,
 * no scripts, no external resources. Every value is escaped — names and assets come from files.
 * The statements go to the tax authority: only declared figures and their explanation — no open
 * items, check results or instructions (those are in the internal report, F10.2a). Texts in the
 * user's language (F11.2, `export-texts.ts`).
 */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const e = escapeHtml;

/** Notes under a table, each once (e.g. why a row is not in the total). */
export function footnotes(notes: readonly (string | null)[]): string {
  const distinct = [...new Set(notes.filter((n): n is string => !!n))];
  return distinct.map((n) => `<p class="footnote">${e(n)}</p>`).join('');
}

const STYLE = `
  * { box-sizing: border-box; }
  body { font-family: 'Inter', 'Segoe UI', Arial, sans-serif; font-size: 9.5pt; color: #1d2433; margin: 0; }
  h1 { font-size: 16pt; margin: 0 0 4pt; }
  h2 { font-size: 11.5pt; margin: 16pt 0 6pt; border-bottom: 1px solid #c9d1de; padding-bottom: 3pt; }
  .meta { color: #4a5568; margin: 0 0 2pt; }
  .note { color: #6b7280; font-style: italic; margin: 0 0 10pt; }
  .figures { display: flex; gap: 12pt; margin: 10pt 0; }
  .figure { flex: 1; border: 1px solid #c9d1de; border-radius: 6pt; padding: 8pt 10pt; }
  .figure .label { color: #4a5568; font-size: 9pt; }
  .figure .value { font-size: 15pt; font-weight: 600; margin-top: 2pt; }
  table { width: 100%; border-collapse: collapse; margin-top: 4pt; }
  th, td { text-align: left; padding: 3pt 5pt; border-bottom: 1px solid #e5e9f0; vertical-align: top; }
  th { background: #eef1f6; font-weight: 600; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.total td { font-weight: 600; border-top: 1.5px solid #1d2433; }
  h1.internal { color: #b42318; }
  .footnote { font-size: 8.5pt; color: #4a5568; font-style: italic; margin: 3pt 0 0; }
  .light { display: inline-block; padding: 0 6pt; border-radius: 8pt; }
  .light.green { background: #b7e4c7; } .light.yellow { background: #fff2a8; }
  .light.red { background: #f4b6b6; } .light.grey { background: #e0e0e0; }
  .small { font-size: 8.5pt; color: #4a5568; }
  footer { margin-top: 16pt; color: #6b7280; font-size: 8.5pt; }
`;

export function page(title: string, body: string, lang = 'de-CH'): string {
  return `<!doctype html><html lang="${e(lang)}"><head><meta charset="utf-8"><title>${e(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
}

function header(data: ExportData, k: ExportKit, variant: string): string {
  return `
    <h1>${e(k.t.statementTitle(data.taxYear, variant))}</h1>
    <p class="meta">${e(metaLine(data, k))}</p>
    <p class="note">${e(data.rules.labels.noTaxAdvice)}</p>
    <div class="figures">
      <div class="figure"><div class="label">${e(`${data.rules.labels.wealthTitle}${data.taxYear}`)}</div><div class="value">${e(data.rules.homeCurrency)} ${e(k.chf(data.result.totals.wealthChf))}</div></div>
      <div class="figure"><div class="label">${e(`${data.rules.labels.incomeTitle} ${data.taxYear}`)}</div><div class="value">${e(data.rules.homeCurrency)} ${e(k.chf(data.result.totals.incomeChf))}</div></div>
    </div>`;
}

function securitiesList(data: ExportData, k: ExportKit): string {
  const { col } = k.t;
  const rows = data.result.platforms
    .map((platform) => {
      const { main, smallCount } = k.platformLine(
        data.result.positions.filter((p) => p.platform === platform.platform),
      );
      return `<tr><td>${e(platform.platform)}</td><td>${e(main)}</td><td class="num">${smallCount}</td><td class="num">${e(k.chf(platform.valueChf))}</td></tr>`;
    })
    .join('');
  return `
    <h2>${e(data.rules.labels.securitiesList)}</h2>
    <table><thead><tr><th>${e(col.platformWallet)}</th><th>${e(col.mainPositions)}</th><th class="num">${e(col.smallPositions)}</th><th class="num">${e(col.taxValue(data.rules.homeCurrency))}</th></tr></thead>
    <tbody>${rows}<tr class="total"><td colspan="3">${e(col.total)}</td><td class="num">${e(k.chf(data.result.totals.wealthChf))}</td></tr></tbody></table>${unpricedNote(data, k)}`;
}

/** The positions without a value, with their quantity, and why they are not in the total. */
function unpricedNote(data: ExportData, k: ExportKit): string {
  const unpriced = k.unpricedPositions(data.result.positions);
  return unpriced.length > 0
    ? footnotes([`${unpriced.join(', ')}: ${data.rules.labels.noPriceNote}`])
    : '';
}

function incomeTable(data: ExportData, k: ExportKit): string {
  const { col } = k.t;
  const rows = INCOME_CATEGORIES.map((category) => {
    const total = data.result.categories.find((c) => c.category === category);
    if (!total || (total.lines === 0 && total.valueChf === '0')) return '';
    return `<tr><td>${e(data.rules.labels.categories[category])}</td><td class="num">${total.lines}</td><td class="num">${e(k.chf(total.valueChf))}</td></tr>`;
  }).join('');
  return `
    <h2>${e(`${data.rules.labels.incomeTitle} ${data.taxYear}`)}</h2>
    <table><thead><tr><th>${e(col.category)}</th><th class="num">${e(col.bookings)}</th><th class="num">${e(col.income(data.rules.homeCurrency))}</th></tr></thead>
    <tbody>${rows}<tr class="total"><td colspan="2">${e(col.total)}</td><td class="num">${e(k.chf(data.result.totals.incomeChf))}</td></tr></tbody></table>`;
}

function footer(data: ExportData): string {
  return `<footer>${e(data.rules.labels.formReference(data.canton))}<br>${e(data.rules.labels.noTaxAdvice)}<br>${e(`lazy-koins ${data.appVersion}`)}</footer>`;
}

/** `<tr><th>…</th>…</tr>` with numeric columns right-aligned. */
function headRow(titles: readonly string[], numeric: readonly number[]) {
  return `<tr>${titles
    .map((title, index) =>
      numeric.includes(index)
        ? `<th class="num">${e(title)}</th>`
        : `<th>${e(title)}</th>`,
    )
    .join('')}</tr>`;
}

/** F10.1: one to two pages. */
export function simpleStatementHtml(data: ExportData): string {
  const k = kitOf(data);
  return page(
    k.t.pageTitleSimple(data.taxYear),
    header(data, k, k.t.variantSimple) +
      securitiesList(data, k) +
      incomeTable(data, k) +
      footer(data),
    k.t.htmlLang,
  );
}

/** F10.2: every section of the detailed workbook as tables. */
export function detailedStatementHtml(data: ExportData): string {
  const k = kitOf(data);
  const { t } = k;
  const { col } = t;
  const { result } = data;
  const T = data.rules.homeCurrency;
  const positions = result.positions
    .map(
      (p) =>
        `<tr><td>${e(p.platform)}</td><td>${e(p.accountId)}</td><td>${e(p.asset)}</td><td class="num">${e(k.quantity(p.quantity))}</td><td class="num">${e(p.priceChf === null ? '–' : k.quantity(p.priceChf))}</td><td class="num">${e(k.chf(p.valueChf))}</td><td>${e(t.statusLabels[p.status])}</td><td class="small">${e(t.quantitySourceLabels[p.quantitySource])}<br>${e(k.priceSourceText(p.priceOrigin, p.priceSource, p.priceDate, T))}</td></tr>`,
    )
    .join('');
  const income = result.income
    .filter((l) => l.status !== 'spam')
    .map(
      (l) =>
        `<tr><td>${e(k.date(l.date))}</td><td>${e(l.platform)}</td><td>${e(data.rules.labels.categories[l.category])}</td><td>${e(l.asset)}</td><td class="num">${e(k.quantity(l.quantityNet))}</td><td class="num">${e(k.chf(l.valueChf))}</td><td class="num small">${e(k.chf(l.grossValueChf))}</td><td class="small">${e(l.rawType)}</td></tr>`,
    )
    .join('');
  const gaps = result.earnGaps
    .map(
      (g) =>
        `<tr><td>${e(g.platform)}</td><td>${e(g.asset)}</td><td class="num">${e(k.quantity(g.startQuantity))}</td><td class="num">${e(k.quantity(g.endQuantity))}</td><td class="num">${e(k.quantity(g.bookedQuantity))}</td><td class="num">${e(k.quantity(g.gapQuantity))}</td><td class="num">${e(k.chf(g.valueChf))}</td><td>${e(g.status === 'income' ? t.gapIncome : g.status === 'negative' ? t.gapNegative : t.statusLabels.missingPrice)}</td></tr>`,
    )
    .join('');
  const events = result.oneOffEvents
    .map(
      (ev) =>
        `<tr><td>${e(k.date(ev.timestamp))}</td><td>${e(k.oneOffLabel(ev.kind))}</td><td>${e(ev.platform)}</td><td>${e(ev.asset)}</td><td class="num">${e(k.quantity(ev.quantity))}</td><td class="num">${e(k.chf(ev.valueChf))}</td></tr>`,
    )
    .join('');
  const params = `<p>${e(t.fxAtYearEnd('USD', T))}: <b>${e(result.parameters.usdChf ?? '–')}</b> (${e(result.parameters.usdChfSource ?? '–')}) · ${e(t.fxAtYearEnd('EUR', T))}: <b>${e(result.parameters.eurChf ?? '–')}</b> (${e(result.parameters.eurChfSource ?? '–')})</p>`;
  return page(
    t.pageTitleDetailed(data.taxYear),
    header(data, k, t.variantDetailed) +
      securitiesList(data, k) +
      incomeTable(data, k) +
      `<h2>${e(t.parametersTitle)}</h2>${params}` +
      `<h2>${e(t.holdingsTitle(data.taxYear))}</h2><table><thead>${headRow([col.platform, col.account, col.asset, col.quantity, col.price(T), col.value(T), col.status, col.source], [3, 4, 5])}</thead><tbody>${positions}</tbody></table>${footnotes(result.positions.map((p) => k.statusNote(data.rules, p.status)))}` +
      `<h2>${e(t.incomeDetailTitle)}</h2><table><thead>${headRow([col.date, col.platform, col.category, col.asset, col.quantityNet, col.value(T), col.gross, col.kind], [4, 5, 6])}</thead><tbody>${income}</tbody></table>${footnotes(result.income.filter((l) => l.status === 'missingPrice').map(() => `– = ${data.rules.labels.noPriceNote}`))}` +
      (gaps
        ? `<h2>${e(t.earnGapTitle)}</h2><p class="small">${e(t.earnGapExplanation)}</p><table><thead>${headRow([col.platform, col.asset, col.start, col.end, col.history, col.gap, col.value(T), col.status], [2, 3, 4, 5, 6])}</thead><tbody>${gaps}</tbody></table>${footnotes(result.earnGaps.filter((g) => g.status === 'missingPrice').map(() => k.statusNote(data.rules, 'missingPrice')))}`
        : '') +
      (events
        ? `<h2>${e(t.oneOffTitle)}</h2><table><thead>${headRow([col.date, col.event, col.platform, col.asset, col.quantity, col.value(T)], [4, 5])}</thead><tbody>${events}</tbody></table>${footnotes(result.oneOffEvents.filter((ev) => ev.valueChf === null).map(() => `– = ${data.rules.labels.noPriceNote}`))}`
        : '') +
      `<h2>${e(t.methodTitle)}</h2>${methodLines(data)
        .slice(2)
        .filter((l) => l !== '')
        .map((l) => `<p>${e(l)}</p>`)
        .join('')}` +
      footer(data),
    t.htmlLang,
  );
}
