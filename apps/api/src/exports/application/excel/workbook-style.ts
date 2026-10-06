import type ExcelJS from 'exceljs';

/**
 * The colour code of the statements (FACHREGELN, Auszug): blue = input, black = formula,
 * green = reference to Parameter. Statements have no "to check" colour — what needs checking is
 * in the internal report, whose lights use `LIGHT_FILLS`.
 */
export const INPUT_FONT: Partial<ExcelJS.Font> = {
  color: { argb: 'FF1F4FD8' },
};
export const FORMULA_FONT: Partial<ExcelJS.Font> = {
  color: { argb: 'FF000000' },
};
export const PARAMETER_FONT: Partial<ExcelJS.Font> = {
  color: { argb: 'FF1B7F3B' },
};
export const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE5E9F0' },
};
/** Traffic lights of the internal report only. */
export const LIGHT_FILLS: Readonly<Record<string, ExcelJS.Fill>> = {
  green: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB7E4C7' } },
  yellow: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2A8' } },
  red: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4B6B6' } },
  grey: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } },
};

export const CHF_FORMAT = '#,##0.00;-#,##0.00';
export const QUANTITY_FORMAT = '0.##########';
export const PRICE_FORMAT = '#,##0.00######';

/** A decimal string as an Excel number (Excel itself has 15 significant digits). */
export function num(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  return Number(value);
}

export function headerRow(sheet: ExcelJS.Worksheet, titles: string[]): void {
  const row = sheet.addRow(titles);
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
  });
  sheet.views = [{ state: 'frozen', ySplit: row.number }];
}

export function setWidths(sheet: ExcelJS.Worksheet, widths: number[]): void {
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
}

export function input(
  cell: ExcelJS.Cell,
  value: number | string | null,
  format?: string,
): void {
  cell.value = value;
  cell.font = INPUT_FONT;
  if (format) cell.numFmt = format;
}

export function formula(
  cell: ExcelJS.Cell,
  expression: string,
  result: number | string | null,
  format?: string,
  font: Partial<ExcelJS.Font> = FORMULA_FONT,
): void {
  cell.value = {
    formula: expression,
    result: result ?? undefined,
  } as ExcelJS.CellFormulaValue;
  cell.font = font;
  if (format) cell.numFmt = format;
}
