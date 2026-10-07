import {
  INCOME_CATEGORIES,
  parseDecimal,
  type Position,
} from '@lazykoins/engine';
import ExcelJS from 'exceljs';
import type { ExportData } from '../export-data';
import { type ExportKit, kitOf, metaLine } from '../export-texts';
import { DE_CH_EXPORT_TEXTS } from '../texts/export-texts.de-ch';
import {
  CHF_FORMAT,
  formula,
  headerRow,
  input,
  num,
  PARAMETER_FONT,
  PRICE_FORMAT,
  QUANTITY_FORMAT,
  setWidths,
} from './workbook-style';

/** The sheet names of the German workbook (the English one has its own, `ExportTexts.sheets`). */
export const SHEETS = DE_CH_EXPORT_TEXTS.sheets;

/**
 * The named Parameter cell of one exchange rate in the tax currency T (F4.1a): `USDCHF`,
 * `EURCHF` for a CHF project, `USDEUR`, `EUREUR` (= 1) for an EUR project. The formulas keep
 * their structure; only the names follow the currency.
 */
export function fxCellName(base: 'USD' | 'EUR', currency: string): string {
  return `${base}${currency}`;
}

/** The header of every statement (F10.4). */
export function headerLines(data: ExportData, variant: string): string[] {
  const k = kitOf(data);
  return [
    k.t.statementTitle(data.taxYear, variant),
    metaLine(data, k),
    data.rules.labels.noTaxAdvice,
  ];
}

function addHeader(
  sheet: ExcelJS.Worksheet,
  data: ExportData,
  variant: string,
): void {
  const [title, line, note] = headerLines(data, variant);
  sheet.addRow([title]).font = { bold: true, size: 14 };
  sheet.addRow([line]);
  sheet.addRow([note]).font = { italic: true, color: { argb: 'FF666666' } };
  sheet.addRow([]);
}

/** Notes under a table: one per status that keeps a row out of the total. */
function addFootnotes(
  sheet: ExcelJS.Worksheet,
  notes: readonly (string | null)[],
): void {
  const distinct = [...new Set(notes.filter((n): n is string => !!n))];
  if (distinct.length === 0) return;
  sheet.addRow([]);
  for (const note of distinct) {
    sheet.addRow([note]).font = { italic: true, color: { argb: 'FF666666' } };
  }
}

/**
 * The detailed statement (F10.2) as the FACHREGELN workbook: real formulas (values by the price
 * priority, totals by SUMIFS), inputs in blue, references to Parameter in green. Overriding a
 * price, the ESTV column or a parameter recalculates everything. It is handed to the tax
 * authority: no open items, checks or instructions — those are in the internal report (F10.2a).
 * Sheet names, titles and status texts in the user's language (F11.2) — the formulas refer to
 * them, so they come from the same `ExportTexts`.
 */
export async function detailedWorkbook(data: ExportData): Promise<Uint8Array> {
  const { result, rules } = data;
  const k = kitOf(data);
  const { t } = k;
  const { col } = t;
  const sheetNames = t.sheets;
  const H = `'${sheetNames.holdings}'`;
  const I = `'${sheetNames.income}'`;
  const G = `'${sheetNames.earnGap}'`;
  // F4.1a: every amount is in the project's tax currency T.
  const T = rules.homeCurrency;
  const usdName = fxCellName('USD', T);
  const eurName = fxCellName('EUR', T);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'lazy-koins';
  workbook.created = new Date(data.createdAt);
  workbook.calcProperties.fullCalcOnLoad = true;

  const overview = workbook.addWorksheet(sheetNames.overview);
  const parameters = workbook.addWorksheet(sheetNames.parameters);
  const holdings = workbook.addWorksheet(sheetNames.holdings);
  const income = workbook.addWorksheet(sheetNames.income);
  const earnGap = workbook.addWorksheet(sheetNames.earnGap);
  const oneOff = workbook.addWorksheet(sheetNames.oneOff);
  const method = workbook.addWorksheet(sheetNames.method);

  // --- Parameter ---
  parameters.addRow([t.parametersTitle]).font = { bold: true, size: 14 };
  parameters.addRow([]);
  const usdRow = parameters.addRow([
    `${t.fxAtYearEnd('USD', T)}${data.taxYear}`,
  ]);
  input(usdRow.getCell(2), num(result.parameters.usdChf), PRICE_FORMAT);
  usdRow.getCell(3).value = result.parameters.usdChfSource ?? '–';
  const eurRow = parameters.addRow([
    `${t.fxAtYearEnd('EUR', T)}${data.taxYear}`,
  ]);
  input(eurRow.getCell(2), num(result.parameters.eurChf), PRICE_FORMAT);
  eurRow.getCell(3).value = result.parameters.eurChfSource ?? '–';
  parameters.addRow([]);
  parameters.addRow([t.parametersNote(usdName, eurName)]);
  workbook.definedNames.add(
    `'${sheetNames.parameters}'!$B$${usdRow.number}`,
    usdName,
  );
  workbook.definedNames.add(
    `'${sheetNames.parameters}'!$B$${eurRow.number}`,
    eurName,
  );
  setWidths(parameters, [28, 16, 40]);

  // --- Bestand 31.12. ---
  headerRow(holdings, [
    col.year,
    col.platform,
    col.account,
    col.asset,
    col.quantity,
    col.priceUsd,
    col.fxPair(T),
    col.priceDirect(T),
    col.priceOverride(T),
    col.value(T),
    col.status,
    col.quantitySource,
    col.priceSource,
    col.quantityExact,
  ]);
  for (const position of result.positions) {
    addPositionRow(holdings, data.taxYear, position, T, k);
  }
  addFootnotes(
    holdings,
    result.positions.map((p) => k.statusNote(rules, p.status)),
  );
  setWidths(holdings, [6, 14, 16, 10, 18, 14, 10, 14, 14, 16, 12, 26, 40, 30]);

  // --- Ertrag Detail ---
  headerRow(income, [
    col.dateUtc,
    col.platform,
    col.kind,
    col.category,
    col.asset,
    col.quantityNet,
    col.priceUsd,
    col.valueUsd,
    col.fxPairDay(T),
    col.price(T),
    col.value(T),
    col.grossInfo(T),
    col.reference,
    col.status,
  ]);
  for (const line of result.income) {
    if (line.status === 'spam') continue;
    const row = income.addRow([
      line.timestamp.slice(0, 19).replace('T', ' '),
      line.platform,
      line.rawType,
      rules.labels.categories[line.category],
      line.asset,
    ]);
    const r = row.number;
    input(row.getCell(6), num(line.quantityNet), QUANTITY_FORMAT);
    if (line.priceOrigin === 'recordValueUsd') {
      input(row.getCell(8), num(line.valueUsd), CHF_FORMAT);
    } else {
      input(row.getCell(7), num(line.priceUsd), PRICE_FORMAT);
      formula(
        row.getCell(8),
        `IF(G${r}<>"",F${r}*G${r},"")`,
        num(line.valueUsd),
        CHF_FORMAT,
      );
      if (line.priceUsd === null)
        input(row.getCell(10), num(line.priceChf), PRICE_FORMAT);
    }
    input(row.getCell(9), num(line.usdChf), PRICE_FORMAT);
    formula(
      row.getCell(11),
      `IF(H${r}<>"",H${r}*I${r},IF(J${r}<>"",F${r}*J${r},""))`,
      num(line.valueChf),
      CHF_FORMAT,
    );
    input(row.getCell(12), num(line.grossValueChf), CHF_FORMAT);
    row.getCell(13).value = line.group ?? line.bookingId;
    row.getCell(14).value =
      line.status === 'ok'
        ? k.priceSourceText(line.priceOrigin, line.priceSource, null, T)
        : t.statusLabels.missingPrice;
  }
  addFootnotes(
    income,
    result.income
      .filter((l) => l.status === 'missingPrice')
      .map(() => k.statusNote(rules, 'missingPrice')),
  );
  setWidths(income, [20, 12, 26, 24, 9, 18, 14, 14, 11, 14, 14, 14, 24, 34]);

  // --- Earn-Lücke ---
  earnGap.addRow([`${t.earnGapMethodPrefix}${t.earnGapExplanation}`]);
  headerRow(earnGap, [
    col.platform,
    col.account,
    col.asset,
    col.startHolding,
    col.endHolding,
    col.history,
    col.gap,
    col.averagePrice(T),
    col.value(T),
    col.status,
  ]);
  for (const gap of result.earnGaps) {
    const row = earnGap.addRow([gap.platform, gap.accountId, gap.asset]);
    const r = row.number;
    input(row.getCell(4), num(gap.startQuantity), QUANTITY_FORMAT);
    input(row.getCell(5), num(gap.endQuantity), QUANTITY_FORMAT);
    input(row.getCell(6), num(gap.bookedQuantity), QUANTITY_FORMAT);
    formula(
      row.getCell(7),
      `E${r}-D${r}-F${r}`,
      num(gap.gapQuantity),
      QUANTITY_FORMAT,
    );
    input(row.getCell(8), num(gap.averagePriceChf), PRICE_FORMAT);
    formula(
      row.getCell(9),
      `IF(AND(G${r}>0,H${r}<>""),G${r}*H${r},0)`,
      num(gap.valueChf) ?? 0,
      CHF_FORMAT,
    );
    row.getCell(10).value =
      gap.status === 'income'
        ? t.gapIncome
        : gap.status === 'negative'
          ? t.gapNegative
          : t.statusLabels.missingPrice;
  }
  addFootnotes(
    earnGap,
    result.earnGaps
      .filter((g) => g.status === 'missingPrice')
      .map(() => k.statusNote(rules, 'missingPrice')),
  );
  setWidths(earnGap, [12, 16, 9, 16, 16, 16, 16, 14, 14, 18]);

  // --- Einmalereignisse ---
  headerRow(oneOff, [
    col.date,
    col.event,
    col.platform,
    col.asset,
    col.quantity,
    col.value(T),
    col.note,
  ]);
  for (const event of result.oneOffEvents) {
    const row = oneOff.addRow([
      k.date(event.timestamp),
      k.oneOffLabel(event.kind),
      event.platform,
      event.asset,
    ]);
    input(row.getCell(5), num(event.quantity), QUANTITY_FORMAT);
    if (event.valueChf === null) {
      row.getCell(6).value = '–';
      row.getCell(7).value = rules.labels.noPriceNote;
    } else {
      input(row.getCell(6), num(event.valueChf), CHF_FORMAT);
    }
  }
  setWidths(oneOff, [12, 12, 12, 9, 18, 14, 48]);

  // --- Methodik ---
  for (const line of methodLines(data)) method.addRow([line]);
  method.getRow(1).font = { bold: true, size: 14 };
  setWidths(method, [140]);

  // --- Übersicht (last: it refers to the other sheets) ---
  addHeader(overview, data, t.variantDetailed);
  overview.addRow([t.wealthByPlatform(data.taxYear)]).font = {
    bold: true,
  };
  headerRow(overview, [col.platform, col.taxValue(T)]);
  overview.views = [];
  const firstPlatform = overview.rowCount + 1;
  for (const platform of result.platforms) {
    const row = overview.addRow([platform.platform]);
    formula(
      row.getCell(2),
      `SUMIFS(${H}!J:J,${H}!B:B,A${row.number},${H}!K:K,"<>${t.statusLabels.spam}",${H}!K:K,"<>${t.statusLabels.negative}")`,
      num(platform.valueChf),
      CHF_FORMAT,
    );
  }
  const lastPlatform = overview.rowCount;
  const wealthRow = overview.addRow([col.totalWealth]);
  wealthRow.font = { bold: true };
  formula(
    wealthRow.getCell(2),
    lastPlatform >= firstPlatform
      ? `SUM(B${firstPlatform}:B${lastPlatform})`
      : '0',
    num(result.totals.wealthChf),
    CHF_FORMAT,
  );
  const missingRow = overview.addRow([
    t.unpricedCount(t.statusLabels.missingPrice),
  ]);
  formula(
    missingRow.getCell(2),
    `COUNTIFS(${H}!K:K,"${t.statusLabels.missingPrice}")`,
    result.positions.filter((p) => p.status === 'missingPrice').length,
  );
  overview.addRow([]);
  overview.addRow([t.incomeByCategory(data.taxYear)]).font = {
    bold: true,
  };
  const incomeHeader = overview.addRow([col.category, col.income(T)]);
  incomeHeader.font = { bold: true };
  const firstCategory = overview.rowCount + 1;
  for (const category of INCOME_CATEGORIES) {
    const total = result.categories.find((c) => c.category === category);
    const row = overview.addRow([rules.labels.categories[category]]);
    formula(
      row.getCell(2),
      category === 'earn_gap'
        ? `SUM(${G}!I:I)`
        : `SUMIFS(${I}!K:K,${I}!D:D,A${row.number})`,
      num(total?.valueChf ?? '0'),
      CHF_FORMAT,
    );
  }
  const incomeRow = overview.addRow([col.totalIncome]);
  incomeRow.font = { bold: true };
  formula(
    incomeRow.getCell(2),
    `SUM(B${firstCategory}:B${overview.rowCount - 1})`,
    num(result.totals.incomeChf),
    CHF_FORMAT,
  );
  overview.addRow([]);
  overview.addRow([t.hintsTitle]).font = { bold: true };
  overview.addRow([rules.labels.formReference(data.canton)]);
  const legend = overview.addRow([t.colourLegend]);
  legend.font = { italic: true };
  setWidths(overview, [44, 18]);

  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

function addPositionRow(
  sheet: ExcelJS.Worksheet,
  taxYear: number,
  position: Position,
  currency: string,
  k: ExportKit,
): void {
  const row = sheet.addRow([
    taxYear,
    position.platform,
    position.accountId,
    position.asset,
  ]);
  const r = row.number;
  input(row.getCell(5), num(position.quantity), QUANTITY_FORMAT);
  if (position.priceUsd !== null) {
    input(row.getCell(6), num(position.priceUsd), PRICE_FORMAT);
    formula(
      row.getCell(7),
      fxCellName('USD', currency),
      num(position.usdChf),
      PRICE_FORMAT,
      PARAMETER_FONT,
    );
  }
  if (position.chfDirect !== null) {
    if (position.priceOrigin === 'fx' && position.asset === 'EUR') {
      formula(
        row.getCell(8),
        fxCellName('EUR', currency),
        num(position.chfDirect),
        PRICE_FORMAT,
        PARAMETER_FONT,
      );
    } else {
      input(row.getCell(8), num(position.chfDirect), PRICE_FORMAT);
    }
  }
  if (position.estvChf !== null) {
    input(row.getCell(9), num(position.estvChf), PRICE_FORMAT);
  }
  formula(
    row.getCell(10),
    `IF(I${r}<>"",E${r}*I${r},IF(H${r}<>"",E${r}*H${r},IF(F${r}<>"",E${r}*F${r}*G${r},"")))`,
    num(position.valueChf),
    '#,##0.00',
  );
  row.getCell(11).value = k.t.statusLabels[position.status];
  row.getCell(12).value = k.t.quantitySourceLabels[position.quantitySource];
  row.getCell(13).value = k.priceSourceText(
    position.priceOrigin,
    position.priceSource,
    position.priceDate,
    currency,
  );
  row.getCell(14).value = position.quantity;
  if (position.status === 'spam') row.font = { color: { argb: 'FF999999' } };
  // Values are rounded only for display; the cell keeps the full product.
  if (position.valueChf !== null && parseDecimal(position.valueChf).isZero())
    row.getCell(10).numFmt = '0.00';
}

/** The "Methodik" sheet / section (FACHREGELN in short), in the document's language. */
export function methodLines(data: ExportData): string[] {
  const { rules } = data;
  const k = kitOf(data);
  return [
    ...k.t.methodLines({
      currency: rules.homeCurrency,
      taxYear: data.taxYear,
      dustThreshold: rules.dustThreshold,
      usdPegged: rules.usdPegged.join(', '),
      priceToleranceDays: rules.priceToleranceDays,
      earnGapExcluded: rules.earnGapExcluded.join(', '),
      appVersion: data.appVersion,
    }),
    '',
    rules.labels.noTaxAdvice,
  ];
}
