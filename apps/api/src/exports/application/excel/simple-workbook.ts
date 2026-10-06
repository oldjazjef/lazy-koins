import { INCOME_CATEGORIES } from '@lazykoins/engine';
import ExcelJS from 'exceljs';
import type { ExportData } from '../export-data';
import {
  categoryLabel,
  CHECK_LABELS,
  describeItem,
  platformLine,
} from '../export-texts';
import { headerLines } from './detailed-workbook';
import {
  CHF_FORMAT,
  formula,
  HEADER_FILL,
  input,
  num,
  setWidths,
} from './workbook-style';

/**
 * The simple statement (F10.1) as one sheet: Steuerwert per 31.12., Ertrag, the securities list
 * with one line per platform/wallet (main positions, number of small positions, value), the
 * income table and the open points.
 */
export async function simpleWorkbook(data: ExportData): Promise<Uint8Array> {
  const { result, rules } = data;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'lazy-koins';
  workbook.created = new Date(data.createdAt);
  workbook.calcProperties.fullCalcOnLoad = true;
  const sheet = workbook.addWorksheet('Auszug');

  const [title, line, note] = headerLines(data, 'einfach');
  sheet.addRow([title]).font = { bold: true, size: 14 };
  sheet.addRow([line]);
  sheet.addRow([note]).font = { italic: true, color: { argb: 'FF666666' } };
  sheet.addRow([]);

  const section = (text: string) => {
    sheet.addRow([]);
    sheet.addRow([text]).font = { bold: true, size: 12 };
  };
  const header = (titles: string[]) => {
    const row = sheet.addRow(titles);
    row.font = { bold: true };
    row.eachCell((cell) => {
      cell.fill = HEADER_FILL;
    });
  };

  section(rules.labels.securitiesList);
  header([
    'Plattform / Wallet',
    'Hauptpositionen',
    'Kleinpositionen',
    'Steuerwert CHF',
  ]);
  const first = sheet.rowCount + 1;
  for (const platform of result.platforms) {
    const { main, smallCount } = platformLine(
      result.positions.filter((p) => p.platform === platform.platform),
    );
    const row = sheet.addRow([platform.platform, main, smallCount]);
    input(row.getCell(4), num(platform.valueChf), CHF_FORMAT);
  }
  const last = sheet.rowCount;
  const wealth = sheet.addRow([`${rules.labels.wealthTitle}${data.taxYear}`]);
  wealth.font = { bold: true };
  formula(
    wealth.getCell(4),
    last >= first ? `SUM(D${first}:D${last})` : '0',
    num(result.totals.wealthChf),
    CHF_FORMAT,
  );

  section(`${rules.labels.incomeTitle} ${data.taxYear}`);
  header(['Kategorie', '', '', 'Ertrag CHF']);
  const firstIncome = sheet.rowCount + 1;
  for (const category of INCOME_CATEGORIES) {
    const total = result.categories.find((c) => c.category === category);
    if (!total || (total.lines === 0 && total.valueChf === '0')) continue;
    const row = sheet.addRow([categoryLabel(rules, category)]);
    input(row.getCell(4), num(total.valueChf), CHF_FORMAT);
  }
  const lastIncome = sheet.rowCount;
  const incomeTotal = sheet.addRow(['Total Ertrag']);
  incomeTotal.font = { bold: true };
  formula(
    incomeTotal.getCell(4),
    lastIncome >= firstIncome ? `SUM(D${firstIncome}:D${lastIncome})` : '0',
    num(result.totals.incomeChf),
    CHF_FORMAT,
  );

  section('Offene Punkte');
  const open = data.items.filter((item) => !item.done);
  if (open.length === 0) sheet.addRow(['Keine offenen Punkte.']);
  else header(['Thema', 'Beschreibung', '', 'Auswirkung CHF (geschätzt)']);
  for (const item of open) {
    const row = sheet.addRow([CHECK_LABELS[item.check], describeItem(item)]);
    input(row.getCell(4), num(item.impactChf), CHF_FORMAT);
  }

  sheet.addRow([]);
  sheet.addRow([rules.labels.formReference(data.canton)]).font = {
    italic: true,
  };
  setWidths(sheet, [34, 70, 16, 22]);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
