import {
  BOOKING_COLUMNS,
  BOOKING_KINDS,
  TEMPLATE_EXPLANATION,
  TEMPLATE_SHEETS,
  type TemplateSheet,
} from '@lazykoins/engine';
import ExcelJS from 'exceljs';

/** Rows the `Art` validation list covers. */
const VALIDATED_ROWS = 5000;

/** Columns kept as text so Excel does not turn 18 decimals into a rounded double. */
const TEXT_COLUMNS = new Set([
  'Zeitpunkt',
  'Menge',
  'Gebühr',
  'Preis CHF',
  'Preis USD',
  'Stichtag',
]);

function columnLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rest = (n - 1) % 26;
    out = String.fromCharCode(65 + rest) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function addDataSheet(
  workbook: ExcelJS.Workbook,
  sheet: TemplateSheet,
): ExcelJS.Worksheet {
  const worksheet = workbook.addWorksheet(sheet.name, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  worksheet.columns = sheet.columns.map((column) => ({
    header: column.name,
    key: column.name,
    width: Math.max(14, column.name.length + 4),
    style: TEXT_COLUMNS.has(column.name) ? { numFmt: '@' } : {},
  }));
  worksheet.getRow(1).font = { bold: true };
  for (const example of sheet.examples) worksheet.addRow([...example]);
  return worksheet;
}

/**
 * The XLSX template of the standard format (the content comes from the engine): an explanation
 * sheet, `Buchungen` and `Bestände` with synthetic example rows, number columns formatted as text,
 * and a drop-down list for `Art`.
 */
export async function buildTemplateWorkbook(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'lazy-koins';

  const explanation = workbook.addWorksheet(TEMPLATE_SHEETS.explanationSheet);
  explanation.getColumn(1).width = 22;
  explanation.getColumn(2).width = 10;
  explanation.getColumn(3).width = 110;
  for (const line of TEMPLATE_EXPLANATION) explanation.addRow([line]);
  explanation.getRow(1).font = { bold: true, size: 14 };
  for (const sheet of [TEMPLATE_SHEETS.bookings, TEMPLATE_SHEETS.holdings]) {
    explanation.addRow([]);
    explanation.addRow([`Blatt "${sheet.name}"`]).font = { bold: true };
    explanation.addRow(['Spalte', 'Pflicht', 'Beschreibung']).font = {
      bold: true,
    };
    for (const column of sheet.columns) {
      explanation.addRow([
        column.name,
        column.required ? '*' : '',
        column.description,
      ]);
    }
  }

  const bookings = addDataSheet(workbook, TEMPLATE_SHEETS.bookings);
  addDataSheet(workbook, TEMPLATE_SHEETS.holdings);

  const kindColumn = columnLetter(
    Object.values(BOOKING_COLUMNS).findIndex(
      (column) => column.name === BOOKING_COLUMNS.kind.name,
    ),
  );
  const validations = (
    bookings as unknown as {
      dataValidations: {
        add(range: string, rule: ExcelJS.DataValidation): void;
      };
    }
  ).dataValidations;
  validations.add(`${kindColumn}2:${kindColumn}${VALIDATED_ROWS}`, {
    type: 'list',
    allowBlank: false,
    formulae: [`"${BOOKING_KINDS.join(',')}"`],
    showErrorMessage: true,
    errorTitle: 'Art',
    error: 'Bitte einen Wert aus der Liste wählen.',
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
