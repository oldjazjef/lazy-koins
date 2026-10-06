import { CHECK_KINDS, INCOME_CATEGORIES } from '@lazykoins/engine';
import { methodLines } from '../excel/detailed-workbook';
import type { ExportData } from '../export-data';
import {
  categoryLabel,
  CHECK_LABELS,
  chf,
  describeItem,
  LIGHT_LABELS,
  platformLine,
  priceSourceText,
  quantity,
  QUANTITY_SOURCE_LABELS,
  STATUS_LABELS,
  swissDate,
} from '../export-texts';

/**
 * HTML of the statements, printed to PDF by Chromium (F10.1, F10.2). Self-contained: inline CSS,
 * no scripts, no external resources. Every value is escaped — names and assets come from files.
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
  .check { background: #fff2a8; }
  .light { display: inline-block; padding: 0 6pt; border-radius: 8pt; }
  .light.green { background: #b7e4c7; } .light.yellow { background: #fff2a8; }
  .light.red { background: #f4b6b6; } .light.grey { background: #e0e0e0; }
  .small { font-size: 8.5pt; color: #4a5568; }
  footer { margin-top: 16pt; color: #6b7280; font-size: 8.5pt; }
`;

function page(title: string, body: string): string {
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
    <tbody>${rows}<tr class="total"><td colspan="3">Total</td><td class="num">${e(chf(data.result.totals.wealthChf))}</td></tr></tbody></table>`;
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

function openItemsTable(data: ExportData): string {
  const open = data.items.filter((item) => !item.done);
  if (open.length === 0)
    return '<h2>Offene Punkte</h2><p>Keine offenen Punkte.</p>';
  const rows = open
    .map(
      (item) =>
        `<tr><td>${e(CHECK_LABELS[item.check])}</td><td>${e(describeItem(item))}${item.note ? `<div class="small">${e(item.note)}</div>` : ''}</td><td class="num">${e(chf(item.impactChf))}</td></tr>`,
    )
    .join('');
  return `<h2>Offene Punkte</h2><table><thead><tr><th>Thema</th><th>Beschreibung</th><th class="num">Auswirkung CHF</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function footer(data: ExportData): string {
  return `<footer>${e(data.rules.labels.formReference(data.canton))}<br>${e(data.rules.labels.noTaxAdvice)}<br>${e(`lazy-koins ${data.appVersion}`)}</footer>`;
}

/** F10.1: one to two pages. */
export function simpleStatementHtml(data: ExportData): string {
  return page(
    `Steuerauszug ${data.taxYear}`,
    header(data, 'einfach') +
      securitiesList(data) +
      incomeTable(data) +
      openItemsTable(data) +
      footer(data),
  );
}

/** F10.2: every section of the detailed workbook as tables. */
export function detailedStatementHtml(data: ExportData): string {
  const { result } = data;
  const positions = result.positions
    .map(
      (p) =>
        `<tr${p.status === 'missingPrice' || p.status === 'negative' ? ' class="check"' : ''}><td>${e(p.platform)}</td><td>${e(p.accountId)}</td><td>${e(p.asset)}</td><td class="num">${e(quantity(p.quantity))}</td><td class="num">${e(p.priceChf === null ? '–' : quantity(p.priceChf))}</td><td class="num">${e(chf(p.valueChf))}</td><td>${e(STATUS_LABELS[p.status])}</td><td class="small">${e(QUANTITY_SOURCE_LABELS[p.quantitySource])}<br>${e(priceSourceText(p.priceOrigin, p.priceSource, p.priceDate))}</td></tr>`,
    )
    .join('');
  const income = result.income
    .filter((l) => l.status !== 'spam')
    .map(
      (l) =>
        `<tr${l.status === 'missingPrice' ? ' class="check"' : ''}><td>${e(swissDate(l.date))}</td><td>${e(l.platform)}</td><td>${e(categoryLabel(data.rules, l.category))}</td><td>${e(l.asset)}</td><td class="num">${e(quantity(l.quantityNet))}</td><td class="num">${e(chf(l.valueChf))}</td><td class="num small">${e(chf(l.grossValueChf))}</td><td class="small">${e(l.rawType)}</td></tr>`,
    )
    .join('');
  const gaps = result.earnGaps
    .map(
      (g) =>
        `<tr${g.status !== 'income' ? ' class="check"' : ''}><td>${e(g.platform)}</td><td>${e(g.asset)}</td><td class="num">${e(quantity(g.startQuantity))}</td><td class="num">${e(quantity(g.endQuantity))}</td><td class="num">${e(quantity(g.bookedQuantity))}</td><td class="num">${e(quantity(g.gapQuantity))}</td><td class="num">${e(chf(g.valueChf))}</td></tr>`,
    )
    .join('');
  const events = result.oneOffEvents
    .map(
      (ev) =>
        `<tr${ev.valueChf === null ? ' class="check"' : ''}><td>${e(swissDate(ev.timestamp))}</td><td>${e(ev.kind === 'loss' ? 'Verlust' : ev.kind === 'income_hardfork' ? 'Hardfork' : 'Airdrop')}</td><td>${e(ev.platform)}</td><td>${e(ev.asset)}</td><td class="num">${e(quantity(ev.quantity))}</td><td class="num">${e(ev.valueChf === null ? 'ESTV-Kurs nachtragen' : chf(ev.valueChf))}</td></tr>`,
    )
    .join('');
  const checks = CHECK_KINDS.map((kind) => {
    const check = result.checks.find((c) => c.kind === kind);
    if (!check) return '';
    return `<tr><td>${e(CHECK_LABELS[kind])}</td><td><span class="light ${check.light}">${e(LIGHT_LABELS[check.light])}</span></td><td class="num">${check.items}</td><td class="num">${e(chf(check.impactChf))}</td></tr>`;
  }).join('');
  const params = `<p>USD/CHF per 31.12.: <b>${e(result.parameters.usdChf ?? 'fehlt')}</b> (${e(result.parameters.usdChfSource ?? '–')}) · EUR/CHF per 31.12.: <b>${e(result.parameters.eurChf ?? 'fehlt')}</b> (${e(result.parameters.eurChfSource ?? '–')})</p>`;
  return page(
    `Steuerauszug ${data.taxYear} (ausführlich)`,
    header(data, 'ausführlich') +
      securitiesList(data) +
      incomeTable(data) +
      `<h2>Parameter</h2>${params}` +
      `<h2>Bestand per 31.12.${data.taxYear}</h2><table><thead><tr><th>Plattform</th><th>Konto</th><th>Asset</th><th class="num">Menge</th><th class="num">Kurs CHF</th><th class="num">Wert CHF</th><th>Status</th><th>Quelle</th></tr></thead><tbody>${positions}</tbody></table>` +
      `<h2>Ertrag Detail</h2><table><thead><tr><th>Datum</th><th>Plattform</th><th>Kategorie</th><th>Asset</th><th class="num">Menge netto</th><th class="num">Wert CHF</th><th class="num">Brutto</th><th>Art</th></tr></thead><tbody>${income}</tbody></table>` +
      (gaps
        ? `<h2>Earn-Lücke (Differenzmethode)</h2><table><thead><tr><th>Plattform</th><th>Asset</th><th class="num">Anfang</th><th class="num">Ende</th><th class="num">Σ Historie</th><th class="num">Lücke</th><th class="num">Wert CHF</th></tr></thead><tbody>${gaps}</tbody></table>`
        : '') +
      (events
        ? `<h2>Einmalereignisse</h2><table><thead><tr><th>Datum</th><th>Ereignis</th><th>Plattform</th><th>Asset</th><th class="num">Menge</th><th class="num">Wert CHF</th></tr></thead><tbody>${events}</tbody></table>`
        : '') +
      `<h2>Prüfungen</h2><table><thead><tr><th>Prüfung</th><th>Ampel</th><th class="num">Punkte</th><th class="num">Auswirkung CHF</th></tr></thead><tbody>${checks}</tbody></table>` +
      openItemsTable(data) +
      `<h2>Methodik</h2>${methodLines(data)
        .slice(2)
        .filter((l) => l !== '')
        .map((l) => `<p>${e(l)}</p>`)
        .join('')}` +
      footer(data),
  );
}
