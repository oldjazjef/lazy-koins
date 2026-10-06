import { INCOME_CATEGORIES } from '@lazykoins/engine';
import { methodLines } from '../excel/detailed-workbook';
import type { ExportData } from '../export-data';
import {
  categoryLabel,
  chf,
  oneOffLabel,
  platformLine,
  priceSourceText,
  quantity,
  QUANTITY_SOURCE_LABELS,
  STATUS_LABELS,
  statusNote,
  swissDate,
  unpricedPositions,
} from '../export-texts';

/**
 * HTML of the statements, printed to PDF by Chromium (F10.1, F10.2). Self-contained: inline CSS,
 * no scripts, no external resources. Every value is escaped — names and assets come from files.
 * The statements go to the tax authority: only declared figures and their explanation — no open
 * items, check results or instructions (those are in the internal report, F10.2a).
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

export function page(title: string, body: string): string {
  return `<!doctype html><html lang="de-CH"><head><meta charset="utf-8"><title>${e(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
}

function header(data: ExportData, variant: string): string {
  return `
    <h1>${e(`Steuerauszug Kryptowährungen ${data.taxYear} (${variant})`)}</h1>
    <p class="meta">${e(`${data.ownerName} · Steuerjahr ${data.taxYear} · Kanton ${data.canton} · erstellt am ${swissDate(data.createdAt)} · berechnet am ${swissDate(data.calculatedAt)}`)}</p>
    <p class="note">${e(data.rules.labels.noTaxAdvice)}</p>
    <div class="figures">
      <div class="figure"><div class="label">${e(`${data.rules.labels.wealthTitle}${data.taxYear}`)}</div><div class="value">CHF ${e(chf(data.result.totals.wealthChf))}</div></div>
      <div class="figure"><div class="label">${e(`${data.rules.labels.incomeTitle} ${data.taxYear}`)}</div><div class="value">CHF ${e(chf(data.result.totals.incomeChf))}</div></div>
    </div>`;
}

function securitiesList(data: ExportData): string {
  const rows = data.result.platforms
    .map((platform) => {
      const { main, smallCount } = platformLine(
        data.result.positions.filter((p) => p.platform === platform.platform),
      );
      return `<tr><td>${e(platform.platform)}</td><td>${e(main)}</td><td class="num">${smallCount}</td><td class="num">${e(chf(platform.valueChf))}</td></tr>`;
    })
    .join('');
  return `
    <h2>${e(data.rules.labels.securitiesList)}</h2>
    <table><thead><tr><th>Plattform / Wallet</th><th>Hauptpositionen</th><th class="num">Kleinpositionen</th><th class="num">Steuerwert CHF</th></tr></thead>
    <tbody>${rows}<tr class="total"><td colspan="3">Total</td><td class="num">${e(chf(data.result.totals.wealthChf))}</td></tr></tbody></table>${unpricedNote(data)}`;
}

/** The positions without a value, with their quantity, and why they are not in the total. */
function unpricedNote(data: ExportData): string {
  const unpriced = unpricedPositions(data.result.positions);
  return unpriced.length > 0
    ? footnotes([`${unpriced.join(', ')}: ${data.rules.labels.noPriceNote}`])
    : '';
}

function incomeTable(data: ExportData): string {
  const rows = INCOME_CATEGORIES.map((category) => {
    const total = data.result.categories.find((c) => c.category === category);
    if (!total || (total.lines === 0 && total.valueChf === '0')) return '';
    return `<tr><td>${e(categoryLabel(data.rules, category))}</td><td class="num">${total.lines}</td><td class="num">${e(chf(total.valueChf))}</td></tr>`;
  }).join('');
  return `
    <h2>${e(`${data.rules.labels.incomeTitle} ${data.taxYear}`)}</h2>
    <table><thead><tr><th>Kategorie</th><th class="num">Buchungen</th><th class="num">Ertrag CHF</th></tr></thead>
    <tbody>${rows}<tr class="total"><td colspan="2">Total</td><td class="num">${e(chf(data.result.totals.incomeChf))}</td></tr></tbody></table>`;
}

function footer(data: ExportData): string {
  return `<footer>${e(data.rules.labels.formReference(data.canton))}<br>${e(data.rules.labels.noTaxAdvice)}</footer>`;
}

/** F10.1: one to two pages. */
export function simpleStatementHtml(data: ExportData): string {
  return page(
    `Steuerauszug ${data.taxYear}`,
    header(data, 'einfach') +
      securitiesList(data) +
      incomeTable(data) +
      footer(data),
  );
}

/** F10.2: every section of the detailed workbook as tables. */
export function detailedStatementHtml(data: ExportData): string {
  const { result } = data;
  const positions = result.positions
    .map(
      (p) =>
        `<tr><td>${e(p.platform)}</td><td>${e(p.accountId)}</td><td>${e(p.asset)}</td><td class="num">${e(quantity(p.quantity))}</td><td class="num">${e(p.priceChf === null ? '–' : quantity(p.priceChf))}</td><td class="num">${e(chf(p.valueChf))}</td><td>${e(STATUS_LABELS[p.status])}</td><td class="small">${e(QUANTITY_SOURCE_LABELS[p.quantitySource])}<br>${e(priceSourceText(p.priceOrigin, p.priceSource, p.priceDate))}</td></tr>`,
    )
    .join('');
  const income = result.income
    .filter((l) => l.status !== 'spam')
    .map(
      (l) =>
        `<tr><td>${e(swissDate(l.date))}</td><td>${e(l.platform)}</td><td>${e(categoryLabel(data.rules, l.category))}</td><td>${e(l.asset)}</td><td class="num">${e(quantity(l.quantityNet))}</td><td class="num">${e(chf(l.valueChf))}</td><td class="num small">${e(chf(l.grossValueChf))}</td><td class="small">${e(l.rawType)}</td></tr>`,
    )
    .join('');
  const gaps = result.earnGaps
    .map(
      (g) =>
        `<tr><td>${e(g.platform)}</td><td>${e(g.asset)}</td><td class="num">${e(quantity(g.startQuantity))}</td><td class="num">${e(quantity(g.endQuantity))}</td><td class="num">${e(quantity(g.bookedQuantity))}</td><td class="num">${e(quantity(g.gapQuantity))}</td><td class="num">${e(chf(g.valueChf))}</td><td>${e(g.status === 'income' ? 'Ertrag' : g.status === 'negative' ? 'negativ – kein Ertrag' : STATUS_LABELS.missingPrice)}</td></tr>`,
    )
    .join('');
  const events = result.oneOffEvents
    .map(
      (ev) =>
        `<tr><td>${e(swissDate(ev.timestamp))}</td><td>${e(oneOffLabel(ev.kind))}</td><td>${e(ev.platform)}</td><td>${e(ev.asset)}</td><td class="num">${e(quantity(ev.quantity))}</td><td class="num">${e(chf(ev.valueChf))}</td></tr>`,
    )
    .join('');
  const params = `<p>USD/CHF per 31.12.: <b>${e(result.parameters.usdChf ?? '–')}</b> (${e(result.parameters.usdChfSource ?? '–')}) · EUR/CHF per 31.12.: <b>${e(result.parameters.eurChf ?? '–')}</b> (${e(result.parameters.eurChfSource ?? '–')})</p>`;
  return page(
    `Steuerauszug ${data.taxYear} (ausführlich)`,
    header(data, 'ausführlich') +
      securitiesList(data) +
      incomeTable(data) +
      `<h2>Parameter</h2>${params}` +
      `<h2>Bestand per 31.12.${data.taxYear}</h2><table><thead><tr><th>Plattform</th><th>Konto</th><th>Asset</th><th class="num">Menge</th><th class="num">Kurs CHF</th><th class="num">Wert CHF</th><th>Status</th><th>Quelle</th></tr></thead><tbody>${positions}</tbody></table>${footnotes(result.positions.map((p) => statusNote(data.rules, p.status)))}` +
      `<h2>Ertrag Detail</h2><table><thead><tr><th>Datum</th><th>Plattform</th><th>Kategorie</th><th>Asset</th><th class="num">Menge netto</th><th class="num">Wert CHF</th><th class="num">Brutto</th><th>Art</th></tr></thead><tbody>${income}</tbody></table>${footnotes(result.income.filter((l) => l.status === 'missingPrice').map(() => `– = ${data.rules.labels.noPriceNote}`))}` +
      (gaps
        ? `<h2>Earn-Lücke (Differenzmethode)</h2><p class="small">Lücke = (Bestand Ende − Bestand Anfang) − Σ Historie (ohne interne Umbuchungen); nur positive Lücken sind Ertrag, bewertet zum Jahresmittel.</p><table><thead><tr><th>Plattform</th><th>Asset</th><th class="num">Anfang</th><th class="num">Ende</th><th class="num">Σ Historie</th><th class="num">Lücke</th><th class="num">Wert CHF</th><th>Status</th></tr></thead><tbody>${gaps}</tbody></table>${footnotes(result.earnGaps.filter((g) => g.status === 'missingPrice').map(() => statusNote(data.rules, 'missingPrice')))}`
        : '') +
      (events
        ? `<h2>Einmalereignisse</h2><table><thead><tr><th>Datum</th><th>Ereignis</th><th>Plattform</th><th>Asset</th><th class="num">Menge</th><th class="num">Wert CHF</th></tr></thead><tbody>${events}</tbody></table>${footnotes(result.oneOffEvents.filter((ev) => ev.valueChf === null).map(() => `– = ${data.rules.labels.noPriceNote}`))}`
        : '') +
      `<h2>Methodik</h2>${methodLines(data)
        .slice(2)
        .filter((l) => l !== '')
        .map((l) => `<p>${e(l)}</p>`)
        .join('')}` +
      footer(data),
  );
}
