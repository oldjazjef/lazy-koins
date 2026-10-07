import ExcelJS from 'exceljs';
import { BOOKING_COLUMNS, HOLDING_COLUMNS } from '@lazykoins/engine';
import { buildTemplateWorkbook } from './template-workbook';

async function open(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  return workbook;
}

function texts(sheet: ExcelJS.Worksheet | undefined): string[] {
  const out: string[] = [];
  sheet?.eachRow((row) => {
    row.eachCell((cell) => out.push(String(cell.value ?? '')));
  });
  return out;
}

function header(sheet: ExcelJS.Worksheet | undefined): string[] {
  const values = (sheet?.getRow(1).values ?? []) as unknown[];
  return values.slice(1).map(String);
}

describe('standard-format template workbook (F5.1, F11.2)', () => {
  it('is German by default', async () => {
    const workbook = await open(await buildTemplateWorkbook());
    expect(workbook.worksheets.map((s) => s.name)).toEqual([
      'Erklärung',
      'Buchungen',
      'Bestände',
    ]);
    expect(texts(workbook.getWorksheet('Erklärung'))[0]).toMatch(/^Vorlage /);
    expect(texts(workbook.getWorksheet('Buchungen'))).toContain('Kauf BTC');
  });

  it('in English: explanation, labels and example notes translated, the format German', async () => {
    const workbook = await open(await buildTemplateWorkbook('en'));
    // The data sheets keep their German names and headers — the file stays re-importable.
    expect(workbook.worksheets.map((s) => s.name)).toEqual([
      'Explanation',
      'Buchungen',
      'Bestände',
    ]);
    expect(header(workbook.getWorksheet('Buchungen'))).toEqual(
      Object.values(BOOKING_COLUMNS).map((c) => c.name),
    );
    expect(header(workbook.getWorksheet('Bestände'))).toEqual(
      Object.values(HOLDING_COLUMNS).map((c) => c.name),
    );

    const explanation = texts(workbook.getWorksheet('Explanation'));
    expect(explanation[0]).toMatch(/^Template lazy-koins Buchungen v1/);
    expect(explanation.join('\n')).toMatch(
      /column headers and the sheet names .* stay German/,
    );
    expect(explanation).toEqual(
      expect.arrayContaining([
        'Sheet "Buchungen"',
        'Column',
        'Required',
        'Description',
      ]),
    );
    // No German sentence left: umlauts only in the German column/sheet names and (terms).
    const german = explanation.filter(
      (text) =>
        /[äöü]/.test(text.replace(/\([^)]*\)|"[^"]*"/g, '')) &&
        !Object.values(BOOKING_COLUMNS).some((c) => c.name === text) &&
        !Object.values(HOLDING_COLUMNS).some((c) => c.name === text),
    );
    expect(german).toEqual([]);

    const bookings = texts(workbook.getWorksheet('Buchungen'));
    expect(bookings).toContain('Buy BTC');
    expect(bookings).not.toContain('Kauf BTC');
    expect(texts(workbook.getWorksheet('Bestände'))).toContain(
      'Kraken account statement 31.12.2025',
    );
  });
});
