import {
  evidenceModel,
  incomeListModel,
  securitiesModel,
} from '../documents-model';
import type { ExportData } from '../export-data';
import { type ExportKit, kitOf, metaLine } from '../export-texts';
import { escapeHtml as e, footer, footnotes, page } from './statement-html';

/**
 * HTML of the further tax documents (F10.11–F10.13), printed to PDF like the statements: inline
 * CSS, no scripts, every value escaped. Only declared figures — no open items or instructions.
 */

function head(data: ExportData, k: ExportKit, title: string): string {
  return `
    <h1>${e(title)}</h1>
    <p class="meta">${e(metaLine(data, k))}</p>
    <p class="note">${e(data.rules.labels.noTaxAdvice)}</p>`;
}

const num = (text: string) => `<td class="num">${e(text)}</td>`;

export function securitiesHtml(data: ExportData): string {
  const k = kitOf(data);
  const d = k.t.documents.securities;
  const { col } = k.t;
  const t = data.rules.homeCurrency;
  const model = securitiesModel(data, k);
  const rows = model.rows
    .map(
      (r) =>
        `<tr><td>${e(r.platform)}<div class="small">${e(r.accountId)}</div></td><td>${e(r.asset)}</td>${num(k.quantity(r.quantity))}${num(r.price === null ? '–' : k.quantity(r.price))}<td class="small">${e(r.priceSource)}</td>${num(k.chf(r.value))}${num(k.chf(r.incomeWith))}${num(k.chf(r.incomeWithout))}</tr>`,
    )
    .join('');
  const title = d.title(data.taxYear);
  return page(
    title,
    `${head(data, k, title)}
    <p>${e(d.intro)}</p>
    <table>
      <thead><tr><th>${e(col.platformWallet)}</th><th>${e(col.asset)}</th><th class="num">${e(col.quantity)}</th><th class="num">${e(col.price(t))}</th><th>${e(col.priceSource)}</th><th class="num">${e(col.taxValue(t))}</th><th class="num">${e(d.incomeWith(t))}</th><th class="num">${e(d.incomeWithout(t))}</th></tr></thead>
      <tbody>${rows}
        <tr class="total"><td colspan="5">${e(d.totals)}</td>${num(k.chf(model.totalValue))}${num(k.chf('0'))}${num(k.chf(model.totalIncome))}</tr>
      </tbody>
    </table>
    ${footnotes([...model.notes, d.withholdingNote])}
    ${footer(data)}`,
    k.t.htmlLang,
  );
}

export function incomeListHtml(data: ExportData): string {
  const k = kitOf(data);
  const d = k.t.documents.incomeList;
  const { col } = k.t;
  const t = data.rules.homeCurrency;
  const model = incomeListModel(data, k);
  const lines = model.rows
    .map(
      ({ line, category, priceSource, origin }) =>
        `<tr><td>${e(k.date(line.date))}</td><td>${e(line.platform)}<div class="small">${e(line.accountId)}</div></td><td>${e(category)}</td><td>${e(line.asset)}</td>${num(k.quantity(line.quantityNet))}${num(line.priceChf === null ? '–' : k.quantity(line.priceChf))}<td class="small">${e(priceSource)}</td>${num(k.chf(line.valueChf))}<td class="small">${e(origin)}</td></tr>`,
    )
    .join('');
  const categories = model.byCategory
    .map(
      (c) =>
        `<tr><td>${e(c.category)}</td>${num(String(c.count))}${num(k.chf(c.value))}</tr>`,
    )
    .join('');
  const assets = model.byAsset
    .map(
      (a) =>
        `<tr><td>${e(a.asset)}</td>${num(k.quantity(a.quantity))}${num(k.chf(a.value))}</tr>`,
    )
    .join('');
  const gaps = data.result.earnGaps
    .filter((g) => g.valueChf !== null)
    .map(
      (g) =>
        `<tr><td>${e(`${g.platform} / ${g.accountId}`)}</td><td>${e(g.asset)}</td>${num(k.quantity(g.gapQuantity))}${num(g.averagePriceChf === null ? '–' : k.quantity(g.averagePriceChf))}${num(k.chf(g.valueChf))}</tr>`,
    )
    .join('');
  const title = d.title(data.taxYear);
  return page(
    title,
    `${head(data, k, title)}
    <h2>${e(d.lines)}</h2>
    ${
      model.rows.length === 0
        ? `<p>${e(d.none)}</p>`
        : `<table>
      <thead><tr><th>${e(col.date)}</th><th>${e(col.platform)}</th><th>${e(col.category)}</th><th>${e(col.asset)}</th><th class="num">${e(col.quantityNet)}</th><th class="num">${e(col.price(t))}</th><th>${e(col.priceSource)}</th><th class="num">${e(col.value(t))}</th><th>${e(d.origin)}</th></tr></thead>
      <tbody>${lines}<tr class="total"><td colspan="7">${e(col.totalIncome)}</td>${num(k.chf(model.total))}<td></td></tr></tbody>
    </table>`
    }
    ${footnotes(model.rows.map((r) => r.note))}
    <h2>${e(d.byCategory)}</h2>
    <table><thead><tr><th>${e(col.category)}</th><th class="num">${e(col.bookings)}</th><th class="num">${e(col.income(t))}</th></tr></thead><tbody>${categories}</tbody></table>
    <h2>${e(d.byAsset)}</h2>
    <table><thead><tr><th>${e(col.asset)}</th><th class="num">${e(col.quantityNet)}</th><th class="num">${e(col.income(t))}</th></tr></thead><tbody>${assets}</tbody></table>
    ${
      gaps
        ? `<h2>${e(k.t.earnGapTitle)}</h2><p class="small">${e(k.t.earnGapExplanation)}</p>
    <table><thead><tr><th>${e(col.platform)}</th><th>${e(col.asset)}</th><th class="num">${e(col.gap)}</th><th class="num">${e(col.averagePrice(t))}</th><th class="num">${e(col.value(t))}</th></tr></thead><tbody>${gaps}</tbody></table>`
        : ''
    }
    ${footer(data)}`,
    k.t.htmlLang,
  );
}

export function evidenceHtml(data: ExportData): string {
  const k = kitOf(data);
  const ev = k.t.documents.evidence;
  const { col } = k.t;
  const t = data.rules.homeCurrency;
  const model = evidenceModel(data, k);
  const transactions = model.transactions
    .map(
      (r) =>
        `<tr><td>${e(k.date(r.timestamp))}<div class="small">${e(r.timestamp.slice(11, 19))}</div></td><td>${e(r.platform)}<div class="small">${e(r.accountId)}</div></td><td>${e(r.kind)}${r.change ? `<div class="small">${e(r.change)}</div>` : ''}</td>${num(`${k.quantity(r.quantity)} ${r.asset}`)}${num(k.chf(r.value))}<td>${e(r.treatment)}${r.reason ? `<div class="small">${e(r.reason)}</div>` : ''}</td><td class="small">${e(r.origin)}</td></tr>`,
    )
    .join('');
  const holdings = model.holdings
    .map(
      (h) =>
        `<tr><td>${e(h.position.platform)}<div class="small">${e(h.position.accountId)}</div></td><td>${e(h.position.asset)}</td>${num(k.quantity(h.position.quantity))}${num(h.price === null ? '–' : k.quantity(h.price))}<td class="small">${e(h.priceSource)}</td>${num(k.chf(h.value))}<td class="small">${e(h.evidence)}</td></tr>`,
    )
    .join('');
  const title = ev.title(data.taxYear);
  return page(
    title,
    `${head(data, k, title)}
    <h2>${e(ev.holdings(data.taxYear))}</h2>
    <table>
      <thead><tr><th>${e(col.platform)}</th><th>${e(col.asset)}</th><th class="num">${e(col.quantity)}</th><th class="num">${e(col.price(t))}</th><th>${e(col.priceSource)}</th><th class="num">${e(col.value(t))}</th><th>${e(ev.evidence)}</th></tr></thead>
      <tbody>${holdings}<tr class="total"><td colspan="5">${e(col.totalWealth)}</td>${num(k.chf(data.result.totals.wealthChf))}<td></td></tr></tbody>
    </table>
    <h2>${e(ev.transactions(data.taxYear))}</h2>
    ${
      model.transactions.length === 0
        ? `<p>${e(ev.none)}</p>`
        : `<table>
      <thead><tr><th>${e(col.dateUtc)}</th><th>${e(col.platform)}</th><th>${e(col.kind)}</th><th class="num">${e(col.quantity)}</th><th class="num">${e(col.value(t))}</th><th>${e(ev.treatment)}</th><th>${e(k.t.documents.incomeList.origin)}</th></tr></thead>
      <tbody>${transactions}</tbody>
    </table>`
    }
    ${footnotes(model.notes)}
    ${footer(data)}`,
    k.t.htmlLang,
  );
}
