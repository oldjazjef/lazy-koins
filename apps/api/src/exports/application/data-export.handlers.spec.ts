import ExcelJS from 'exceljs';
import { CreateCorrectionCommand } from '../../calculation/application/calculation.handlers';
import { calculationSetup } from '../../calculation/testing/calculation-fixture';
import { FileAnalysisService } from '../../files/application/file-analysis.service';
import {
  SetFileActiveCommand,
  SetFileActiveHandler,
} from '../../files/application/commands/set-file-active.command';
import {
  UploadProjectFileCommand,
  UploadProjectFileHandler,
} from '../../files/application/commands/upload-project-file.command';
import { SourceFileReader } from '../../files/application/source-file-reader';
import { InMemoryImportMappingRepository } from '../../mappings/testing/in-memory-import-mapping.repository';
import { DataExportHandler, DataExportQuery } from './data-export.handlers';

async function setup() {
  const t = await calculationSetup();
  return { ...t, dataExport: new DataExportHandler(t.projects, t.inputs) };
}

describe('data export (F10.7)', () => {
  it('writes bookings as standard CSV with the applied correction, price and origin', async () => {
    const t = await setup();
    await t.createCorrection.execute(
      new CreateCorrectionCommand(
        'anna',
        t.project.id,
        {
          type: 'reclassify',
          bookingId: `${t.bookingsFile.sha256}::6`,
          kind: 'income_airdrop',
        },
        'Airdrop',
      ),
    );
    const file = await t.dataExport.execute(
      new DataExportQuery('anna', t.project.id, 'csv', 'bookings', {}),
    );
    expect(file.fileName).toBe('steuern-2025-2025-buchungen.csv');
    expect(file.rows).toBe(5);
    const text = new TextDecoder().decode(file.bytes);
    const lines = text
      .replace(String.fromCharCode(0xfeff), '')
      .trim()
      .split('\r\n');
    expect(lines[0]).toContain('Zeitpunkt,Plattform,Konto,Art');
    expect(lines[0]).toContain('Kurs CHF verwendet,Kursquelle');
    const airdrop = lines.find((l) => l.includes('ETH'));
    expect(airdrop).toContain('income_airdrop');
    expect(airdrop).toContain('reclassify');
    expect(airdrop).toContain('buchungen.csv');
  });

  it('holds only the active files — a deactivated file is not in it (F5.7a)', async () => {
    const t = await setup();
    await new SetFileActiveHandler(t.projects, t.files).execute(
      new SetFileActiveCommand('anna', t.project.id, t.bookingsFile.id, false),
    );
    const bookings = await t.dataExport.execute(
      new DataExportQuery('anna', t.project.id, 'csv', 'bookings', {}),
    );
    expect(bookings.rows).toBe(0);
    // The other (active) file is still exported.
    const holdings = await t.dataExport.execute(
      new DataExportQuery('anna', t.project.id, 'csv', 'holdings', {}),
    );
    expect(holdings.rows).toBe(4);
  });

  it('round trip: the CSV re-imports as the standard format with the same records', async () => {
    const t = await setup();
    const file = await t.dataExport.execute(
      new DataExportQuery('anna', t.project.id, 'csv', 'bookings', {}),
    );
    const other = await t.projects.create('anna', {
      name: 'Kontrolle',
      taxYear: 2025,
      country: 'CH',
      canton: 'ZH',
      notes: '',
    });
    const upload = new UploadProjectFileHandler(
      t.projects,
      t.files,
      new FileAnalysisService(
        new SourceFileReader(),
        new InMemoryImportMappingRepository(t.files),
      ),
    );
    const again = await upload.execute(
      new UploadProjectFileCommand('anna', other.id, 'export.csv', file.bytes),
    );
    expect(again).toMatchObject({
      status: 'standard',
      bookingCount: 5,
      errorCount: 0,
    });
    const original = await t.inputs.build(t.project);
    const reread = await t.inputs.build(other);
    const essence = (b: (typeof original.input.bookings)[number]) =>
      [
        b.timestamp,
        b.platform,
        b.accountId,
        b.kind,
        b.asset,
        b.quantity.toFixed(),
        b.fee?.toFixed() ?? '',
        b.priceUsd?.toFixed() ?? '',
        b.group ?? '',
      ].join('|');
    expect(reread.input.bookings.map(essence)).toEqual(
      original.input.bookings.map(essence),
    );
  });

  it('filters, and writes both sheets as text cells in XLSX', async () => {
    const t = await setup();
    const csv = await t.dataExport.execute(
      new DataExportQuery('anna', t.project.id, 'csv', 'bookings', {
        asset: 'chf',
        from: '2025-01-01',
        to: '2025-01-31',
      }),
    );
    expect(csv.rows).toBe(2);
    const xlsx = await t.dataExport.execute(
      new DataExportQuery('anna', t.project.id, 'xlsx', 'bookings', {}),
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsx.bytes as unknown as ArrayBuffer);
    expect(workbook.worksheets.map((s) => s.name)).toEqual([
      'Buchungen',
      'Bestände',
    ]);
    expect(workbook.getWorksheet('Bestände')?.rowCount).toBe(5);
    const quantity = workbook.getWorksheet('Buchungen')?.getRow(2).getCell(6);
    expect(typeof quantity?.value).toBe('string');
  });
});
