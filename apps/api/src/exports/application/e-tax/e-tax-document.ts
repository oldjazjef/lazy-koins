import type { ExportData } from '../export-data';
import { eTaxStatementHtml } from './e-tax-html';
import { eTaxStatement, eTaxStatementXml } from './e-tax-statement';

/** F10.10: the XML of a project's E-Steuerauszug (`data.eTax` is filled for these kinds only). */
export function eTaxXml(data: ExportData): string {
  if (!data.eTax) throw new Error('E-Steuerauszug without its data');
  return eTaxStatementXml(eTaxStatement(data, data.eTax));
}

/** F10.10: the PDF's HTML — readable pages, then the barcode sheets carrying the same XML. */
export function eTaxPdfHtml(data: ExportData): string {
  if (!data.eTax) throw new Error('E-Steuerauszug without its data');
  const statement = eTaxStatement(data, data.eTax);
  return eTaxStatementHtml(data, statement, eTaxStatementXml(statement));
}
