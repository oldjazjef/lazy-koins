import { formatFixed, parseDecimal, toCsv } from '@lazykoins/engine';
import ExcelJS from 'exceljs';
import {
  evidenceModel,
  incomeListModel,
  securitiesModel,
} from '../documents-model';
import type { ExportData } from '../export-data';
import { type ExportKit, kitOf, metaLine } from '../export-texts';
import {
  CHF_FORMAT,
  formula,
  headerRow,
  input,
  num,
  PRICE_FORMAT,
  QUANTITY_FORMAT,
  setWidths,
} from './workbook-style';

/**
 * The further tax documents as Excel (F10.11–F10.13) and the Wertschriftenverzeichnis as CSV
 * for the tax software. Same colour code as the statements (blue = input, black = formula);
 * value = quantity × price as a formula where both are there, sums as formulas. Only declared
 * figures — a row without a price keeps its quantity and gets a neutral note.
 */

const NOTE_FONT: Partial<ExcelJS.Font> = {
  italic: true,
  color: { argb: 'FF666666' },
};

function newWorkbook(data: ExportData): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'lazy-koins';
  workbook.created = new Date(data.createdAt);
  workbook.calcProperties.fullCalcOnLoad = true;
  return workbook;
}

/** Title, meta line (F10.4), "keine Steuerberatung", an empty row. */
function addTitle(
  sheet: ExcelJS.Worksheet,
  data: ExportData,
  k: ExportKit,
  title: string,
): void {
  sheet.addRow([title]).font = { bold: true, size: 14 };
  sheet.addRow([metaLine(data, k)]);
  sheet.addRow([data.rules.labels.noTaxAdvice]).font = NOTE_FONT;
  sheet.addRow([]);
}

function addNotes(sheet: ExcelJS.Worksheet, notes: readonly string[]): void {
  if (notes.length === 0) return;
  sheet.addRow([]);
  for (const note of notes) sheet.addRow([note]).font = NOTE_FONT;
}

/** `=Bn*Cn` with the stored value as the cached result; an input when one side is missing. */
function valueCell(
  cell: ExcelJS.Cell,
  quantityRef: string,
  priceRef: string,
  hasPrice: boolean,
  value: string | null,
): void {
  if (hasPrice && value !== null) {
    formula(cell, `ABS(${quantityRef})*${priceRef}`, num(value), CHF_FORMAT);
  } else {
    input(cell, num(value), CHF_FORMAT);
  }
}

function sumCell(
  cell: ExcelJS.Cell,
  column: string,
  first: number,
  last: number,
  result: string,
): void {
  formula(
    cell,
    last >= first ? `SUM(${column}${first}:${column}${last})` : '0',
    num(result),
    CHF_FORMAT,
  );
}

async function bytesOf(workbook: ExcelJS.Workbook): Promise<Uint8Array> {
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

// ---------------------------------------------------------------- F10.11

export async function securitiesWorkbook(
  data: ExportData,
): Promise<Uint8Array> {
  const k = kitOf(data);
  const d = k.t.documents.securities;
  const { col } = k.t;
  const t = data.rules.homeCurrency;
  const model = securitiesModel(data, k);
  const workbook = newWorkbook(data);
  const sheet = workbook.addWorksheet(d.sheet);
  addTitle(sheet, data, k, d.title(data.taxYear));
  sheet.addRow([d.intro]).font = NOTE_FONT;
  sheet.addRow([]);
  headerRow(sheet, [
    col.platformWallet,
    col.account,
    col.asset,
    col.quantity,
    col.price(t),
    col.priceSource,
    col.taxValue(t),
    d.incomeWith(t),
    d.incomeWithout(t),
    col.note,
  ]);
  const first = sheet.rowCount + 1;
  for (const row of model.rows) {
    const r = sheet.addRow([row.platform, row.accountId, row.asset]);
    input(r.getCell(4), num(row.quantity), QUANTITY_FORMAT);
    input(r.getCell(5), num(row.price), PRICE_FORMAT);
    r.getCell(6).value = row.priceSource;
    valueCell(
      r.getCell(7),
      `D${r.number}`,
      `E${r.number}`,
      row.price !== null,
      row.value,
    );
    input(r.getCell(8), 0, CHF_FORMAT);
    input(r.getCell(9), num(row.incomeWithout), CHF_FORMAT);
    r.getCell(10).value = row.note ?? '';
  }
  const last = sheet.rowCount;
  const total = sheet.addRow([d.totals]);
  total.font = { bold: true };
  sumCell(total.getCell(7), 'G', first, last, model.totalValue);
  sumCell(total.getCell(8), 'H', first, last, '0');
  sumCell(total.getCell(9), 'I', first, last, model.totalIncome);
  addNotes(sheet, [
    ...model.notes,
    d.withholdingNote,
    data.rules.labels.formReference(data.canton),
  ]);
  setWidths(sheet, [26, 16, 12, 18, 16, 30, 18, 16, 18, 40]);
  return bytesOf(workbook);
}

/** The same rows as CSV (UTF-8 with BOM, `.` decimals) for the tax software (F10.11). */
export function securitiesCsv(data: ExportData): Uint8Array {
  const k = kitOf(data);
  const d = k.t.documents.securities;
  const { col } = k.t;
  const t = data.rules.homeCurrency;
  const model = securitiesModel(data, k);
  const fixed = (value: string | null, places: number) =>
    value === null ? '' : formatFixed(parseDecimal(value), places, 'halfUp');
  const rows = [
    [
      col.platformWallet,
      col.account,
      col.asset,
      col.quantity,
      col.price(t),
      col.priceSource,
      col.taxValue(t),
      d.incomeWith(t),
      d.incomeWithout(t),
      col.note,
    ],
    ...model.rows.map((row) => [
      row.platform,
      row.accountId,
      row.asset,
      row.quantity,
      row.price ?? '',
      row.priceSource,
      fixed(row.value, 2),
      fixed(row.incomeWith, 2),
      fixed(row.incomeWithout, 2),
      row.note ?? '',
    ]),
    [
      d.totals,
      '',
      '',
      '',
      '',
      '',
      fixed(model.totalValue, 2),
      '0.00',
      fixed(model.totalIncome, 2),
      '',
    ],
  ];
  return new TextEncoder().encode(String.fromCharCode(0xfeff) + toCsv(rows));
}

// ---------------------------------------------------------------- F10.12

export async function incomeListWorkbook(
  data: ExportData,
): Promise<Uint8Array> {
  const k = kitOf(data);
  const d = k.t.documents.incomeList;
  const { col } = k.t;
  const t = data.rules.homeCurrency;
  const model = incomeListModel(data, k);
  const workbook = newWorkbook(data);

  const lines = workbook.addWorksheet(d.linesSheet);
  addTitle(lines, data, k, d.title(data.taxYear));
  headerRow(lines, [
    col.date,
    col.platform,
    col.account,
    col.category,
    col.asset,
    col.quantityNet,
    col.price(t),
    col.priceSource,
    col.value(t),
    d.origin,
    col.note,
  ]);
  const first = lines.rowCount + 1;
  for (const row of model.rows) {
    const { line } = row;
    const r = lines.addRow([
      k.date(line.date),
      line.platform,
      line.accountId,
      row.category,
      line.asset,
    ]);
    input(r.getCell(6), num(line.quantityNet), QUANTITY_FORMAT);
    input(r.getCell(7), num(line.priceChf), PRICE_FORMAT);
    r.getCell(8).value = row.priceSource;
    // A value from the platform's own USD figure is not quantity × price: keep it as input.
    valueCell(
      r.getCell(9),
      `F${r.number}`,
      `G${r.number}`,
      line.priceChf !== null && line.priceOrigin !== 'recordValueUsd',
      line.valueChf,
    );
    r.getCell(10).value = row.origin;
    r.getCell(11).value = row.note ?? '';
  }
  const last = lines.rowCount;
  const total = lines.addRow([col.totalIncome]);
  total.font = { bold: true };
  sumCell(total.getCell(9), 'I', first, last, model.total);
  if (model.rows.length === 0) lines.addRow([d.none]).font = NOTE_FONT;
  setWidths(lines, [12, 20, 14, 22, 10, 18, 16, 30, 16, 36, 30]);

  const summary = workbook.addWorksheet(d.summarySheet);
  summary.addRow([d.byCategory]).font = { bold: true, size: 12 };
  headerRow(summary, [col.category, col.bookings, col.income(t)]);
  for (const c of model.byCategory) {
    const r = summary.addRow([c.category, c.count]);
    input(r.getCell(3), num(c.value), CHF_FORMAT);
  }
  summary.addRow([]);
  summary.addRow([d.byAsset]).font = { bold: true, size: 12 };
  summary.addRow([col.asset, col.quantityNet, col.income(t)]).font = {
    bold: true,
  };
  for (const a of model.byAsset) {
    const r = summary.addRow([a.asset]);
    input(r.getCell(2), num(a.quantity), QUANTITY_FORMAT);
    input(r.getCell(3), num(a.value), CHF_FORMAT);
  }
  const gaps = data.result.earnGaps.filter((g) => g.valueChf !== null);
  if (gaps.length > 0) {
    summary.addRow([]);
    summary.addRow([k.t.earnGapTitle]).font = { bold: true, size: 12 };
    summary.addRow([k.t.earnGapExplanation]).font = NOTE_FONT;
    summary.addRow([
      col.platform,
      col.asset,
      col.gap,
      col.averagePrice(t),
      col.value(t),
    ]).font = { bold: true };
    for (const g of gaps) {
      const r = summary.addRow([`${g.platform} / ${g.accountId}`, g.asset]);
      input(r.getCell(3), num(g.gapQuantity), QUANTITY_FORMAT);
      input(r.getCell(4), num(g.averagePriceChf), PRICE_FORMAT);
      formula(
        r.getCell(5),
        `C${r.number}*D${r.number}`,
        num(g.valueChf),
        CHF_FORMAT,
      );
    }
  }
  setWidths(summary, [30, 18, 18, 18, 18]);
  return bytesOf(workbook);
}

// ---------------------------------------------------------------- F10.13

export async function evidenceWorkbook(data: ExportData): Promise<Uint8Array> {
  const k = kitOf(data);
  const ev = k.t.documents.evidence;
  const { col } = k.t;
  const t = data.rules.homeCurrency;
  const model = evidenceModel(data, k);
  const workbook = newWorkbook(data);

  const tx = workbook.addWorksheet(ev.transactionsSheet);
  addTitle(tx, data, k, ev.title(data.taxYear));
  tx.addRow([ev.transactions(data.taxYear)]).font = { bold: true, size: 12 };
  headerRow(tx, [
    col.dateUtc,
    col.platform,
    col.account,
    col.kind,
    col.asset,
    col.quantity,
    k.t.documents.incomeList.origin,
    col.value(t),
    ev.treatment,
    ev.change,
    ev.reason,
  ]);
  for (const row of model.transactions) {
    const r = tx.addRow([
      row.timestamp.replace('T', ' ').slice(0, 19),
      row.platform,
      row.accountId,
      row.kind,
      row.asset,
    ]);
    input(r.getCell(6), num(row.quantity), QUANTITY_FORMAT);
    r.getCell(7).value = row.origin;
    input(r.getCell(8), num(row.value), CHF_FORMAT);
    r.getCell(9).value = row.treatment;
    r.getCell(10).value = row.change;
    r.getCell(11).value = row.reason;
  }
  if (model.transactions.length === 0) tx.addRow([ev.none]).font = NOTE_FONT;
  setWidths(tx, [20, 20, 14, 18, 10, 18, 34, 16, 22, 28, 34]);

  const holdings = workbook.addWorksheet(ev.holdingsSheet);
  holdings.addRow([ev.holdings(data.taxYear)]).font = {
    bold: true,
    size: 12,
  };
  headerRow(holdings, [
    col.platform,
    col.account,
    col.asset,
    col.quantity,
    col.price(t),
    col.priceSource,
    col.value(t),
    ev.evidence,
    col.note,
  ]);
  const first = holdings.rowCount + 1;
  for (const h of model.holdings) {
    const p = h.position;
    const r = holdings.addRow([p.platform, p.accountId, p.asset]);
    input(r.getCell(4), num(p.quantity), QUANTITY_FORMAT);
    input(r.getCell(5), num(h.price), PRICE_FORMAT);
    r.getCell(6).value = h.priceSource;
    valueCell(
      r.getCell(7),
      `D${r.number}`,
      `E${r.number}`,
      h.price !== null,
      h.value,
    );
    r.getCell(8).value = h.evidence;
    r.getCell(9).value = h.note ?? '';
  }
  const last = holdings.rowCount;
  const total = holdings.addRow([col.totalWealth]);
  total.font = { bold: true };
  sumCell(total.getCell(7), 'G', first, last, data.result.totals.wealthChf);
  addNotes(holdings, model.notes);
  setWidths(holdings, [22, 14, 10, 18, 16, 30, 18, 40, 36]);
  return bytesOf(workbook);
}
