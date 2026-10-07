import ExcelJS from 'exceljs';
import type { ExportData } from '../export-data';
import { internalReport } from '../internal-report';
import { HEADER_FILL, LIGHT_FILLS, setWidths } from './workbook-style';

const WARNING_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  size: 14,
  color: { argb: 'FFB42318' },
};

/**
 * The internal check report (F10.2a) as Excel: a summary sheet with the figures, then one sheet
 * per section. Every sheet starts with the "not for the tax authority" title.
 */
export async function internalWorkbook(data: ExportData): Promise<Uint8Array> {
  const report = internalReport(data);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'lazy-koins';
  workbook.created = new Date(data.createdAt);

  const summary = workbook.addWorksheet(report.overviewSheet);
  summary.addRow([report.title]).font = WARNING_FONT;
  summary.addRow([report.meta]);
  summary.addRow([report.note]).font = {
    italic: true,
    color: { argb: 'FF666666' },
  };
  summary.addRow([]);
  for (const [label, value] of report.figures) {
    summary.addRow([label, value]).getCell(1).font = { bold: true };
  }
  setWidths(summary, [44, 36]);

  for (const section of report.sections) {
    const sheet = workbook.addWorksheet(section.title);
    sheet.addRow([report.title]).font = WARNING_FONT;
    sheet.addRow([]);
    const header = sheet.addRow([...section.columns]);
    header.font = { bold: true };
    header.eachCell((cell) => {
      cell.fill = HEADER_FILL;
    });
    sheet.views = [{ state: 'frozen', ySplit: header.number }];
    if (section.rows.length === 0) sheet.addRow([section.empty]);
    for (const cells of section.rows) {
      const row = sheet.addRow(cells.map((cell) => cell.text));
      cells.forEach((cell, index) => {
        if (cell.light) row.getCell(index + 1).fill = LIGHT_FILLS[cell.light];
        if (section.numeric.includes(index))
          row.getCell(index + 1).alignment = { horizontal: 'right' };
      });
    }
    setWidths(
      sheet,
      section.columns.map((_, index) =>
        section.wide.includes(index) ? 80 : 18,
      ),
    );
  }

  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
