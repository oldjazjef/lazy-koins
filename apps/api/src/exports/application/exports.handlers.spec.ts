import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import ExcelJS from 'exceljs';
import { CalculateProjectCommand } from '../../calculation/application/calculation.handlers';
import type { CalculationService } from '../../calculation/calculation.service';
import { calculationSetup } from '../../calculation/testing/calculation-fixture';
import type { Env } from '../../config/env';
import {
  SettingsReader,
  SettingsSecrets,
} from '../../settings/application/settings.handlers';
import { InMemoryUserSettingsRepository } from '../../settings/testing/in-memory-user-settings.repository';
import type { UserRepositoryPort } from '../../users/ports/user.repository.port';
import {
  FakePdfRenderer,
  InMemoryProjectExportRepository,
} from '../testing/in-memory-project-export.repository';
import { SHEETS } from './excel/detailed-workbook';
import {
  CreateExportCommand,
  CreateExportHandler,
  ExportDataService,
  GetExportContentHandler,
  GetExportContentQuery,
  GetMailDraftHandler,
  GetMailDraftQuery,
  ListExportsHandler,
  ListExportsQuery,
} from './exports.handlers';
import { escapeHtml } from './pdf/statement-html';

async function setup(pdfAvailable = true) {
  const t = await calculationSetup();
  const settingsRepo = new InMemoryUserSettingsRepository();
  await settingsRepo.save('anna', {
    displayName: 'Anna Muster',
    advisorName: 'Treuhand Beispiel AG',
    advisorEmail: 'treuhand@example.ch',
  });
  const config = { get: () => '' } as unknown as ConfigService<Env, true>;
  const settings = new SettingsReader(
    settingsRepo,
    new SettingsSecrets(config),
  );
  const users = {
    findById: async () => ({ displayName: 'Anna' }),
  } as unknown as UserRepositoryPort;
  const calculation = {
    calculate: (userId: string, projectId: string) =>
      t.calculate.execute(new CalculateProjectCommand(userId, projectId)),
  } as unknown as CalculationService;
  const exports = new InMemoryProjectExportRepository();
  const pdf = new FakePdfRenderer(pdfAvailable);
  const data = new ExportDataService(
    t.snapshots,
    t.states,
    settings,
    users,
    t.inputs,
    calculation,
  );
  return {
    ...t,
    exports,
    pdf,
    create: new CreateExportHandler(t.projects, exports, data, pdf),
    list: new ListExportsHandler(t.projects, exports),
    content: new GetExportContentHandler(t.projects, exports),
    mail: new GetMailDraftHandler(t.projects, t.snapshots, exports, data),
  };
}

async function workbookOf(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as never);
  return workbook;
}

function sheetOf(workbook: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const sheet = workbook.getWorksheet(name);
  if (!sheet) throw new Error(`no sheet ${name}`);
  return sheet;
}

function formulaOf(cell: ExcelJS.Cell): string | undefined {
  const value = cell.value as { formula?: string } | null;
  return value && typeof value === 'object' ? value.formula : undefined;
}

describe('exports (F10)', () => {
  it('calculates first when needed and writes the detailed workbook with real formulas (F10.2)', async () => {
    const t = await setup();
    const meta = await t.create.execute(
      new CreateExportCommand('anna', t.project.id, 'detailed_xlsx'),
    );
    expect(meta).toMatchObject({
      kind: 'detailed_xlsx',
      wealthChf: '858.7',
      incomeChf: '6.75',
      mediaType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    expect(meta.fileName).toMatch(
      /^Steuern-2025_ausfuehrlich_\d{4}-\d{2}-\d{2}\.xlsx$/,
    );
    expect(t.snapshots.rows).toHaveLength(1);

    const content = await t.content.execute(
      new GetExportContentQuery('anna', t.project.id, meta.id),
    );
    const workbook = await workbookOf(content.bytes);
    expect(workbook.worksheets.map((s) => s.name)).toEqual(
      Object.values(SHEETS),
    );

    const overview = sheetOf(workbook, SHEETS.overview);
    expect(String(overview.getCell('A1').value)).toContain('Steuerauszug');
    expect(String(overview.getCell('A2').value)).toContain('Anna Muster');
    expect(String(overview.getCell('A2').value)).toContain('Kanton ZH');
    expect(String(overview.getCell('A3').value)).toContain(
      'Keine Steuerberatung',
    );
    const formulas: string[] = [];
    overview.eachRow((row) =>
      row.eachCell((cell) => {
        const f = formulaOf(cell);
        if (f) formulas.push(f);
      }),
    );
    expect(
      formulas.some((f) => f.startsWith("SUMIFS('Bestand 31.12.'!J:J")),
    ).toBe(true);
    expect(
      formulas.some((f) => f.startsWith("SUMIFS('Ertrag Detail'!K:K")),
    ).toBe(true);
    expect(formulas).toContain("SUM('Earn-Lücke'!I:I)");

    const holdings = sheetOf(workbook, SHEETS.holdings);
    const btc = holdings.getRow(2);
    expect(btc.getCell(4).value).toBe('BTC');
    expect(formulaOf(btc.getCell(10))).toBe(
      'IF(I2<>"",E2*I2,IF(H2<>"",E2*H2,IF(F2<>"",E2*F2*G2,"")))',
    );
    // USD/CHF refers to the parameter (green); the price is an input (blue).
    expect(formulaOf(btc.getCell(7))).toBe('USDCHF');
    expect(btc.getCell(7).font?.color?.argb).toBe('FF1B7F3B');
    expect(btc.getCell(6).font?.color?.argb).toBe('FF1F4FD8');
    // A position without price is marked yellow.
    const dot = holdings.getRow(4);
    expect(dot.getCell(11).value).toBe('Kurs fehlt');
    expect((dot.getCell(9).fill as ExcelJS.FillPattern).fgColor?.argb).toBe(
      'FFFFF2A8',
    );

    const income = sheetOf(workbook, SHEETS.income);
    expect(formulaOf(income.getRow(2).getCell(11))).toBe(
      'IF(H2<>"",H2*I2,IF(J2<>"",F2*J2,""))',
    );
    expect(income.getRow(2).getCell(6).value).toBe(1.5);

    const names = workbook.definedNames.model.map((n) => n.name);
    expect(names).toEqual(expect.arrayContaining(['USDCHF', 'EURCHF']));
  });

  it('writes the simple statement as Excel and PDF, lists and serves them (F10.1, F10.5)', async () => {
    const t = await setup();
    const xlsx = await t.create.execute(
      new CreateExportCommand('anna', t.project.id, 'simple_xlsx'),
    );
    const pdf = await t.create.execute(
      new CreateExportCommand('anna', t.project.id, 'simple_pdf'),
    );
    expect(pdf).toMatchObject({
      kind: 'simple_pdf',
      mediaType: 'application/pdf',
    });
    const html = t.pdf.rendered[0] ?? '';
    expect(html).toContain('858.70');
    expect(html).toContain('Wertschriften- und Guthabenverzeichnis');
    expect(html).toContain('Keine Steuerberatung');
    expect(html).not.toContain('<script');

    const stored = await t.content.execute(
      new GetExportContentQuery('anna', t.project.id, xlsx.id),
    );
    const sheet = sheetOf(await workbookOf(stored.bytes), 'Auszug');
    const texts: string[] = [];
    sheet.eachRow((row) => texts.push(String(row.getCell(1).value ?? '')));
    expect(texts).toContain('kraken');
    expect(texts).toContain('Offene Punkte');

    const listed = await t.list.execute(
      new ListExportsQuery('anna', t.project.id),
    );
    expect(listed.map((e) => e.kind)).toEqual(['simple_pdf', 'simple_xlsx']);
  });

  it('answers 503 for a PDF when no browser is available', async () => {
    const t = await setup(false);
    await expect(
      t.create.execute(
        new CreateExportCommand('anna', t.project.id, 'detailed_pdf'),
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('drafts the mail to the Treuhänder with the two figures, attachments and open questions (F10.6)', async () => {
    const t = await setup();
    await t.create.execute(
      new CreateExportCommand('anna', t.project.id, 'simple_pdf'),
    );
    const draft = await t.mail.execute(
      new GetMailDraftQuery('anna', t.project.id),
    );
    expect(draft.to).toBe('treuhand@example.ch');
    expect(draft.subject).toBe('Steuern 2025: Krypto-Vermögen und Ertrag');
    expect(draft.body).toContain('Guten Tag Treuhand Beispiel AG');
    expect(draft.body).toContain('CHF 858.70');
    expect(draft.body).toContain('CHF 6.75');
    expect(draft.body).toMatch(/Steuern-2025_einfach_.*\.pdf/);
    expect(draft.body).toContain('Offene Fachfragen:');
    expect(draft.body.endsWith('Anna Muster')).toBe(true);
  });

  it('escapes everything that comes from files in the HTML', () => {
    expect(escapeHtml('<img src=x onerror="a">&\'')).toBe(
      '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;',
    );
  });
});
