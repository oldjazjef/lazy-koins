import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import ExcelJS from 'exceljs';
import {
  CalculateProjectCommand,
  GetChecksQuery,
  UpdateOpenItemCommand,
} from '../../calculation/application/calculation.handlers';
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
    t.files,
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

/** Every cell text of every sheet (formulas as their expression). */
function allTexts(workbook: ExcelJS.Workbook): string[] {
  const texts: string[] = workbook.worksheets.map((sheet) => sheet.name);
  for (const sheet of workbook.worksheets) {
    sheet.eachRow((row) =>
      row.eachCell((cell) => {
        const f = formulaOf(cell);
        texts.push(f ?? String(cell.value ?? ''));
      }),
    );
  }
  return texts;
}

/** What a statement for the tax authority must never say (F10.1/F10.2: no to-dos). */
const FORBIDDEN = /offene punkte|nachtragen|zu prüfen|todo|prüfen|prüfung/i;

function expectClean(texts: readonly string[]): void {
  expect(texts.filter((text) => FORBIDDEN.test(text))).toEqual([]);
}

function fillsOf(workbook: ExcelJS.Workbook): string[] {
  const fills: string[] = [];
  for (const sheet of workbook.worksheets) {
    sheet.eachRow((row) =>
      row.eachCell((cell) => {
        const argb = (cell.fill as ExcelJS.FillPattern | undefined)?.fgColor
          ?.argb;
        if (argb) fills.push(argb);
      }),
    );
  }
  return fills;
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
    // A position without price keeps its quantity; its value stays empty, with a neutral note.
    const dot = holdings.getRow(4);
    expect(dot.getCell(11).value).toBe('ohne Kurswert');
    expect(dot.getCell(5).value).not.toBeNull();
    expect(dot.getCell(9).fill).toBeUndefined();
    const texts = allTexts(workbook);
    expect(texts).toContain(
      'ohne Kurswert: Kein Kurswert verfügbar; nicht im Total enthalten.',
    );
    // For the tax authority: no open items, checks, instructions or "to check" colour.
    expectClean(texts);
    expect(fillsOf(workbook)).not.toContain('FFFFF2A8');
    expect(texts).toContain(
      'Farben: blau = Eingabe, schwarz = Formel, grün = Verweis auf Parameter.',
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
    expect(html).toContain(
      'Kein Kurswert verfügbar; nicht im Total enthalten.',
    );
    expectClean([html]);

    const stored = await t.content.execute(
      new GetExportContentQuery('anna', t.project.id, xlsx.id),
    );
    const workbook = await workbookOf(stored.bytes);
    expect(workbook.worksheets.map((s) => s.name)).toEqual(['Auszug']);
    const texts = allTexts(workbook);
    expect(texts).toContain('kraken');
    expect(
      texts.some((text) =>
        text.endsWith('Kein Kurswert verfügbar; nicht im Total enthalten.'),
      ),
    ).toBe(true);
    expectClean(texts);

    const listed = await t.list.execute(
      new ListExportsQuery('anna', t.project.id),
    );
    expect(listed.map((e) => e.kind)).toEqual(['simple_pdf', 'simple_xlsx']);
  });

  it('prints the detailed statement without checks, open items or instructions (F10.2)', async () => {
    const t = await setup();
    await t.create.execute(
      new CreateExportCommand('anna', t.project.id, 'detailed_pdf'),
    );
    const html = t.pdf.rendered[0] ?? '';
    expect(html).toContain('Bestand per 31.12.2025');
    expect(html).toContain('Methodik');
    expect(html).toContain('ohne Kurswert');
    expect(html).toContain(
      'Kein Kurswert verfügbar; nicht im Total enthalten.',
    );
    expect(html).not.toContain('class="check"');
    expect(html).not.toContain('fff2a8;"');
    expectClean([html]);
  });

  it('creates the internal check report with lights, open items and notes (F10.2a)', async () => {
    const t = await setup();
    await t.calculate.execute(
      new CalculateProjectCommand('anna', t.project.id),
    );
    const result = await t.checks.execute(
      new GetChecksQuery('anna', t.project.id),
    );
    const first = result.items[0];
    if (!first) throw new Error('fixture has no open item');
    await t.tick.execute(
      new UpdateOpenItemCommand('anna', t.project.id, first.key, {
        done: true,
        note: 'mit Treuhänder besprochen',
      }),
    );

    const xlsx = await t.create.execute(
      new CreateExportCommand('anna', t.project.id, 'internal_report_xlsx'),
    );
    expect(xlsx.fileName).toMatch(
      /^Steuern-2025_pruefbericht-intern_\d{4}-\d{2}-\d{2}\.xlsx$/,
    );
    const stored = await t.content.execute(
      new GetExportContentQuery('anna', t.project.id, xlsx.id),
    );
    const workbook = await workbookOf(stored.bytes);
    expect(workbook.worksheets.map((s) => s.name)).toEqual([
      'Übersicht',
      'Prüfungen',
      'Offene Punkte',
      'Ohne Kurs',
      'Earn-Lücke',
      'Dateien',
    ]);
    for (const sheet of workbook.worksheets) {
      expect(sheet.getCell('A1').value).toBe(
        'Interner Prüfbericht – nicht für die Steuerbehörde',
      );
    }
    const texts = allTexts(workbook);
    expect(texts).toContain('mit Treuhänder besprochen');
    expect(texts).toContain('erledigt');
    expect(texts.some((text) => text.includes('nachtragen'))).toBe(true);
    expect(fillsOf(workbook).length).toBeGreaterThan(0);

    const pdf = await t.create.execute(
      new CreateExportCommand('anna', t.project.id, 'internal_report_pdf'),
    );
    expect(pdf.mediaType).toBe('application/pdf');
    const html = t.pdf.rendered[0] ?? '';
    expect(html).toContain(
      'Interner Prüfbericht – nicht für die Steuerbehörde',
    );
    expect(html).toContain('Offene Punkte');
    expect(html).toContain('class="light ');
    expect(html).toContain('mit Treuhänder besprochen');

    const listed = await t.list.execute(
      new ListExportsQuery('anna', t.project.id),
    );
    expect(listed.map((e) => e.kind)).toEqual([
      'internal_report_pdf',
      'internal_report_xlsx',
    ]);
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
    await t.create.execute(
      new CreateExportCommand('anna', t.project.id, 'internal_report_pdf'),
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
    // The internal report is never an attachment by default (F10.2a).
    expect(draft.body).not.toContain('pruefbericht-intern');
    // The open technical questions are for the Treuhänder (not for the tax authority).
    expect(draft.body).toContain(
      'Offene Fachfragen (in den Auszügen nicht enthalten):',
    );
    expect(draft.body).toMatch(/- kraken .*DOT.*kein Kurs per 31\.12\./);
    expect(draft.body.endsWith('Anna Muster')).toBe(true);
  });

  it('escapes everything that comes from files in the HTML', () => {
    expect(escapeHtml('<img src=x onerror="a">&\'')).toBe(
      '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;',
    );
  });
});
