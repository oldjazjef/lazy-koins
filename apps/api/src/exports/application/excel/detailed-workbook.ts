import {
  CHECK_KINDS,
  INCOME_CATEGORIES,
  parseDecimal,
  type Position,
} from '@lazykoins/engine';
import ExcelJS from 'exceljs';
import type { ExportData } from '../export-data';
import {
  categoryLabel,
  CHECK_LABELS,
  describeItem,
  LIGHT_LABELS,
  priceSourceText,
  QUANTITY_SOURCE_LABELS,
  STATUS_LABELS,
  swissDate,
} from '../export-texts';
import {
  CHECK_FILL,
  CHF_FORMAT,
  formula,
  headerRow,
  input,
  LIGHT_FILLS,
  num,
  PARAMETER_FONT,
  PRICE_FORMAT,
  QUANTITY_FORMAT,
  setWidths,
} from './workbook-style';

export const SHEETS = {
  overview: 'Übersicht',
  parameters: 'Parameter',
  holdings: 'Bestand 31.12.',
  income: 'Ertrag Detail',
  earnGap: 'Earn-Lücke',
  oneOff: 'Einmalereignisse',
  checks: 'Prüfungen',
  openItems: 'Offene Punkte',
  method: 'Methodik',
} as const;

const H = `'${SHEETS.holdings}'`;
const I = `'${SHEETS.income}'`;
const G = `'${SHEETS.earnGap}'`;

/** The header of every statement (F10.4). */
export function headerLines(data: ExportData, variant: string): string[] {
  return [
    `Steuerauszug Kryptowährungen ${data.taxYear} (${variant})`,
    `${data.ownerName} · Steuerjahr ${data.taxYear} · Kanton ${data.canton} · erstellt am ${swissDate(data.createdAt)} · berechnet am ${swissDate(data.calculatedAt)}`,
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

/**
 * The detailed statement (F10.2) as the FACHREGELN workbook: real formulas (values by the price
 * priority, totals by SUMIFS), inputs in blue, references to Parameter in green, things to check
 * in yellow. Overriding a price, the ESTV column or a parameter recalculates everything.
 */
export async function detailedWorkbook(data: ExportData): Promise<Uint8Array> {
  const { result, rules } = data;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'lazy-koins';
  workbook.created = new Date(data.createdAt);
  workbook.calcProperties.fullCalcOnLoad = true;

  const overview = workbook.addWorksheet(SHEETS.overview);
  const parameters = workbook.addWorksheet(SHEETS.parameters);
  const holdings = workbook.addWorksheet(SHEETS.holdings);
  const income = workbook.addWorksheet(SHEETS.income);
  const earnGap = workbook.addWorksheet(SHEETS.earnGap);
  const oneOff = workbook.addWorksheet(SHEETS.oneOff);
  const checks = workbook.addWorksheet(SHEETS.checks);
  const openItems = workbook.addWorksheet(SHEETS.openItems);
  const method = workbook.addWorksheet(SHEETS.method);

  // --- Parameter ---
  parameters.addRow(['Parameter']).font = { bold: true, size: 14 };
  parameters.addRow([]);
  const usdRow = parameters.addRow([`USD/CHF per 31.12.${data.taxYear}`]);
  input(usdRow.getCell(2), num(result.parameters.usdChf), PRICE_FORMAT);
  usdRow.getCell(3).value = result.parameters.usdChfSource ?? 'fehlt';
  if (result.parameters.usdChf === null) usdRow.getCell(2).fill = CHECK_FILL;
  const eurRow = parameters.addRow([`EUR/CHF per 31.12.${data.taxYear}`]);
  input(eurRow.getCell(2), num(result.parameters.eurChf), PRICE_FORMAT);
  eurRow.getCell(3).value = result.parameters.eurChfSource ?? 'fehlt';
  if (result.parameters.eurChf === null) eurRow.getCell(2).fill = CHECK_FILL;
  parameters.addRow([]);
  parameters.addRow([
    'Ersatz durch ESTV-Werte: Wert in Spalte B überschreiben – alle Formeln rechnen neu.',
  ]);
  workbook.definedNames.add(
    `'${SHEETS.parameters}'!$B$${usdRow.number}`,
    'USDCHF',
  );
  workbook.definedNames.add(
    `'${SHEETS.parameters}'!$B$${eurRow.number}`,
    'EURCHF',
  );
  setWidths(parameters, [28, 16, 40]);

  // --- Bestand 31.12. ---
  headerRow(holdings, [
    'Jahr',
    'Plattform',
    'Konto',
    'Asset',
    'Menge',
    'Kurs USD',
    'USD/CHF',
    'Kurs CHF direkt',
    'ESTV-Kurs (Override)',
    'Wert CHF',
    'Status',
    'Quelle Menge',
    'Quelle Kurs',
    'Menge exakt',
  ]);
  for (const position of result.positions) {
    addPositionRow(holdings, data.taxYear, position);
  }
  setWidths(holdings, [6, 14, 16, 10, 18, 14, 10, 14, 14, 16, 12, 26, 40, 30]);

  // --- Ertrag Detail ---
  headerRow(income, [
    'Datum (UTC)',
    'Plattform',
    'Art',
    'Kategorie',
    'Asset',
    'Menge netto',
    'Kurs USD',
    'Wert USD',
    'USD/CHF Tag',
    'Kurs CHF',
    'Wert CHF',
    'Brutto CHF (Info)',
    'Referenz',
    'Status',
  ]);
  for (const line of result.income) {
    if (line.status === 'spam') continue;
    const row = income.addRow([
      line.timestamp.slice(0, 19).replace('T', ' '),
      line.platform,
      line.rawType,
      categoryLabel(rules, line.category),
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
        ? priceSourceText(line.priceOrigin, line.priceSource, null)
        : 'Kurs fehlt';
    if (line.status === 'missingPrice') {
      for (const c of [7, 10, 14]) row.getCell(c).fill = CHECK_FILL;
    }
  }
  setWidths(income, [20, 12, 26, 24, 9, 18, 14, 14, 11, 14, 14, 14, 24, 34]);

  // --- Earn-Lücke ---
  earnGap.addRow([
    'Differenzmethode: Lücke = (Bestand Ende − Bestand Anfang) − Σ Historie (ohne interne Umbuchungen); nur positive Lücken sind Ertrag, bewertet zum Jahresmittel.',
  ]);
  headerRow(earnGap, [
    'Plattform',
    'Konto',
    'Asset',
    'Bestand Anfang',
    'Bestand Ende',
    'Σ Historie',
    'Lücke',
    'Ø Kurs CHF',
    'Wert CHF',
    'Status',
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
        ? 'Ertrag'
        : gap.status === 'negative'
          ? 'negativ – prüfen'
          : 'Kurs fehlt';
    if (gap.status !== 'income') row.getCell(10).fill = CHECK_FILL;
  }
  setWidths(earnGap, [12, 16, 9, 16, 16, 16, 16, 14, 14, 18]);

  // --- Einmalereignisse ---
  headerRow(oneOff, [
    'Datum',
    'Ereignis',
    'Plattform',
    'Asset',
    'Menge',
    'Wert CHF',
    'Hinweis',
  ]);
  for (const event of result.oneOffEvents) {
    const row = oneOff.addRow([
      swissDate(event.timestamp),
      event.kind === 'loss'
        ? 'Verlust'
        : event.kind === 'income_hardfork'
          ? 'Hardfork'
          : 'Airdrop',
      event.platform,
      event.asset,
    ]);
    input(row.getCell(5), num(event.quantity), QUANTITY_FORMAT);
    input(row.getCell(6), num(event.valueChf) ?? 0, CHF_FORMAT);
    if (event.valueChf === null) {
      row.getCell(6).fill = CHECK_FILL;
      row.getCell(7).value = 'ESTV-Kurs nachtragen';
      row.getCell(7).fill = CHECK_FILL;
    }
  }
  setWidths(oneOff, [12, 12, 12, 9, 18, 14, 24]);

  // --- Prüfungen ---
  headerRow(checks, ['Prüfung', 'Ampel', 'Offene Punkte', 'Auswirkung CHF']);
  for (const kind of CHECK_KINDS) {
    const check = result.checks.find((c) => c.kind === kind);
    if (!check) continue;
    const row = checks.addRow([
      CHECK_LABELS[kind],
      LIGHT_LABELS[check.light],
      check.items,
    ]);
    row.getCell(2).fill = LIGHT_FILLS[check.light] ?? CHECK_FILL;
    input(row.getCell(4), num(check.impactChf), CHF_FORMAT);
  }
  setWidths(checks, [52, 16, 14, 16]);

  // --- Offene Punkte ---
  headerRow(openItems, [
    'Thema',
    'Beschreibung',
    'Geschätzte Auswirkung CHF',
    'Erledigt',
    'Notiz',
  ]);
  for (const item of data.items) {
    const row = openItems.addRow([
      CHECK_LABELS[item.check],
      describeItem(item),
    ]);
    input(row.getCell(3), num(item.impactChf), CHF_FORMAT);
    row.getCell(4).value = item.done ? 'ja' : 'nein';
    row.getCell(5).value = item.note;
    if (!item.done) row.getCell(2).fill = CHECK_FILL;
  }
  setWidths(openItems, [36, 80, 18, 10, 40]);

  // --- Methodik ---
  for (const line of methodLines(data)) method.addRow([line]);
  method.getRow(1).font = { bold: true, size: 14 };
  setWidths(method, [140]);

  // --- Übersicht (last: it refers to the other sheets) ---
  addHeader(overview, data, 'ausführlich');
  overview.addRow([`Vermögen per 31.12.${data.taxYear} je Plattform`]).font = {
    bold: true,
  };
  headerRow(overview, ['Plattform', 'Steuerwert CHF']);
  overview.views = [];
  const firstPlatform = overview.rowCount + 1;
  for (const platform of result.platforms) {
    const row = overview.addRow([platform.platform]);
    formula(
      row.getCell(2),
      `SUMIFS(${H}!J:J,${H}!B:B,A${row.number},${H}!K:K,"<>${STATUS_LABELS.spam}",${H}!K:K,"<>${STATUS_LABELS.negative}")`,
      num(platform.valueChf),
      CHF_FORMAT,
    );
  }
  const lastPlatform = overview.rowCount;
  const wealthRow = overview.addRow(['Total Vermögen']);
  wealthRow.font = { bold: true };
  formula(
    wealthRow.getCell(2),
    lastPlatform >= firstPlatform
      ? `SUM(B${firstPlatform}:B${lastPlatform})`
      : '0',
    num(result.totals.wealthChf),
    CHF_FORMAT,
  );
  const missingRow = overview.addRow(['Positionen ohne Kurs']);
  formula(
    missingRow.getCell(2),
    `COUNTIFS(${H}!K:K,"${STATUS_LABELS.missingPrice}")`,
    result.positions.filter((p) => p.status === 'missingPrice').length,
  );
  overview.addRow([]);
  overview.addRow([`Ertrag ${data.taxYear} je Kategorie`]).font = {
    bold: true,
  };
  const incomeHeader = overview.addRow(['Kategorie', 'Ertrag CHF']);
  incomeHeader.font = { bold: true };
  const firstCategory = overview.rowCount + 1;
  for (const category of INCOME_CATEGORIES) {
    const total = result.categories.find((c) => c.category === category);
    const row = overview.addRow([categoryLabel(rules, category)]);
    formula(
      row.getCell(2),
      category === 'earn_gap'
        ? `SUM(${G}!I:I)`
        : `SUMIFS(${I}!K:K,${I}!D:D,A${row.number})`,
      num(total?.valueChf ?? '0'),
      CHF_FORMAT,
    );
  }
  const incomeRow = overview.addRow(['Total Ertrag']);
  incomeRow.font = { bold: true };
  formula(
    incomeRow.getCell(2),
    `SUM(B${firstCategory}:B${overview.rowCount - 1})`,
    num(result.totals.incomeChf),
    CHF_FORMAT,
  );
  overview.addRow([]);
  overview.addRow(['Hinweise']).font = { bold: true };
  const open = data.items.filter((i) => !i.done).length;
  overview.addRow([`Offene Punkte: ${open} (Blatt „${SHEETS.openItems}“)`]);
  overview.addRow([rules.labels.formReference(data.canton)]);
  const legend = overview.addRow([
    'Farben: blau = Eingabe, schwarz = Formel, grün = Verweis auf Parameter, gelb = zu prüfen / nachzutragen.',
  ]);
  legend.font = { italic: true };
  setWidths(overview, [44, 18]);

  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

function addPositionRow(
  sheet: ExcelJS.Worksheet,
  taxYear: number,
  position: Position,
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
      'USDCHF',
      num(position.usdChf),
      PRICE_FORMAT,
      PARAMETER_FONT,
    );
  }
  if (position.chfDirect !== null) {
    if (position.priceOrigin === 'fx' && position.asset === 'EUR') {
      formula(
        row.getCell(8),
        'EURCHF',
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
  row.getCell(11).value = STATUS_LABELS[position.status];
  row.getCell(12).value = QUANTITY_SOURCE_LABELS[position.quantitySource];
  row.getCell(13).value = priceSourceText(
    position.priceOrigin,
    position.priceSource,
    position.priceDate,
  );
  row.getCell(14).value = position.quantity;
  if (position.status === 'missingPrice' || position.status === 'negative') {
    for (const c of [9, 10, 11]) row.getCell(c).fill = CHECK_FILL;
  }
  if (position.status === 'spam') row.font = { color: { argb: 'FF999999' } };
  // Values in CHF are rounded only for display; the cell keeps the full product.
  if (position.valueChf !== null && parseDecimal(position.valueChf).isZero())
    row.getCell(10).numFmt = '0.00';
}

/** The "Methodik" sheet / section (FACHREGELN in short). */
export function methodLines(data: ExportData): string[] {
  const { rules } = data;
  return [
    'Methodik',
    '',
    `Vermögen: Bestand per 31.12.${data.taxYear} je Plattform/Konto und Asset. Hat ein Konto einen Kontoauszug per Stichtag, gilt dieser; sonst der Saldo aus dem Ledger (Σ Menge − Σ Gebühr aller Buchungen bis Jahresende). Positionen mit |Menge| < ${rules.dustThreshold} entfallen.`,
    'Kurse (erste vorhandene gilt): 1. ESTV-Kurs bzw. Override, 2. Kurs CHF direkt (z. B. aus dem Kontoauszug), 3. Kurs USD × USD/CHF des Stichtags.',
    `Stablecoins (${rules.usdPegged.join(', ')}) = 1 USD; CHF = 1; EUR über EUR/CHF. USD-Kurse: Tagesschluss (Binance, UTC), höchstens ${rules.priceToleranceDays} Tage alt, sonst erster Kurs danach (≤ ${rules.priceToleranceDays} Tage). Devisen: EZB-Referenzkurse, letztes Fixing.`,
    'Ertrag: zum Zuflusszeitpunkt (Tag in UTC) bewertet, netto nach Gebühr im gleichen Asset; Brutto als Information. Liefert die Plattform einen USD-Wert (z. B. Kraken amountusd − feeusd), gilt dieser × USD/CHF des Tages.',
    `Earn-Lücke (Differenzmethode): (Bestand Ende − Bestand Anfang) − Σ Historie ohne interne Umbuchungen, je Konto und Asset; nur positive Lücken sind Ertrag, bewertet zum Jahresmittel. Ausgenommen: ${rules.earnGapExcluded.join(', ')}.`,
    'Einmalereignisse (Hardforks, Airdrops, Verluste) werden separat ausgewiesen; ohne Kurs mit Hinweis „ESTV-Kurs nachtragen“.',
    'Spam-/Scam-Token (z. B. mit „Claim“ im Namen) sind ausgeblendet; manuell überschreibbar.',
    'Annahmen (konservativ): Launchpool-/HODLer-Airdrops sind Ertrag; Kraken-Erträge netto nach Gebühr.',
    'Jede Zahl ist bis zur Buchung in der Originaldatei rückverfolgbar (lazy-koins: Klick auf den Betrag).',
    '',
    rules.labels.noTaxAdvice,
  ];
}
