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
import { InMemoryHintStateRepository } from '../../files/testing/in-memory-hint-state.repository';
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
  const hintStates = new InMemoryHintStateRepository();
  const data = new ExportDataService(
    t.snapshots,
    t.states,
    settings,
    users,
    t.files,
    t.inputs,
    calculation,
    hintStates,
    t.corrections,
    t.transactionEdits,
  );
  return {
    ...t,
    data,
    hintStates,
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
    // A CHF project keeps its labels (F4.1a changes nothing for CHF).
    expect(texts).toEqual(
      expect.arrayContaining([
        'Wert CHF',
        'USD/CHF',
        'ESTV-Kurs (Override)',
        'USD/CHF per 31.12.2025',
      ]),
    );

    // The app version (X.Y.Z+<commit>) under Methodik.
    const method: string[] = [];
    sheetOf(workbook, SHEETS.method).eachRow((row) =>
      method.push(String(row.getCell(1).value)),
    );
    expect(method).toContain('Erstellt mit lazy-koins 0.0.0-dev+unknown.');
  });

  it('labels every amount with the tax currency of an EUR project (F4.1a)', async () => {
    const t = await setup();
    await t.projects.update(t.project.id, { taxCurrency: 'EUR' });
    await t.rates.upsertMany(t.project.id, [
      {
        kind: 'fx',
        asset: 'USD',
        currency: 'EUR',
        date: '2025-12-31',
        value: '0.85',
        source: 'ecb',
      },
      {
        kind: 'fx',
        asset: 'USD',
        currency: 'EUR',
        date: '2025-03-01',
        value: '0.9',
        source: 'ecb',
      },
    ]);
    const meta = await t.create.execute(
      new CreateExportCommand('anna', t.project.id, 'detailed_xlsx'),
    );
    // BTC 0.005 × 90000 × 0.85 + CHF 498.7 / 0.8 × 0.85; income 1.5 DOT × 5 × 0.9.
    expect(meta).toMatchObject({
      wealthChf: '912.36875',
      incomeChf: '6.75',
    });
    const workbook = await workbookOf(
      (
        await t.content.execute(
          new GetExportContentQuery('anna', t.project.id, meta.id),
        )
      ).bytes,
    );
    const holdings = sheetOf(workbook, SHEETS.holdings);
    const header = (holdings.getRow(1).values as unknown[]).map(String);
    expect(header).toEqual(
      expect.arrayContaining([
        'USD/EUR',
        'Kurs EUR direkt',
        'Kurs (Override)',
        'Wert EUR',
      ]),
    );
    expect(header.some((h) => h.includes('CHF'))).toBe(false);
    expect(formulaOf(holdings.getRow(2).getCell(7))).toBe('USDEUR');
    // Same formula structure as in CHF.
    expect(formulaOf(holdings.getRow(2).getCell(10))).toBe(
      'IF(I2<>"",E2*I2,IF(H2<>"",E2*H2,IF(F2<>"",E2*F2*G2,"")))',
    );
    const parameters = sheetOf(workbook, SHEETS.parameters);
    expect(parameters.getCell('A3').value).toBe('USD/EUR per 31.12.2025');
    expect(parameters.getCell('A4').value).toBe('EUR/EUR per 31.12.2025');
    expect(workbook.definedNames.model.map((n) => n.name)).toEqual(
      expect.arrayContaining(['USDEUR', 'EUREUR']),
    );
    const texts = allTexts(workbook);
    expect(texts).toContain('Steuerwert EUR');
    expect(texts).toContain('Ertrag EUR');
    expectClean(texts);

    await t.create.execute(
      new CreateExportCommand('anna', t.project.id, 'simple_pdf'),
    );
    const html = t.pdf.rendered[0] ?? '';
    expect(html).toContain('EUR 912.37');
    expect(html).toContain('Steuerwert EUR');
    expect(html).not.toContain('Steuerwert CHF');
    const draft = await t.mail.execute(
      new GetMailDraftQuery('anna', t.project.id),
    );
    expect(draft.body).toContain('EUR 912.37');
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
    expect(html).toContain('lazy-koins 0.0.0-dev+unknown');
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
    expect(html).toContain('lazy-koins 0.0.0-dev+unknown');
    expect(html).toContain('mit Treuhänder besprochen');

    const listed = await t.list.execute(
      new ListExportsQuery('anna', t.project.id),
    );
    expect(listed.map((e) => e.kind)).toEqual([
      'internal_report_pdf',
      'internal_report_xlsx',
    ]);
  });

  it('leaves hints marked "in Ordnung" or ignored out of the internal report (F5.8)', async () => {
    const t = await setup();
    const snapshot = await t.data.currentSnapshot('anna', t.project);
    const before = await t.data.build('anna', t.project, snapshot, 'x');
    expect(before.hints.length).toBeGreaterThan(0);
    const [first, ...rest] = before.hints;
    if (!first) throw new Error('no hint');
    await t.hintStates.save(t.project.id, first.key, {
      status: 'done',
      note: '',
    });
    const after = await t.data.build('anna', t.project, snapshot, 'x');
    expect(after.hints.map((h) => h.key)).toEqual(rest.map((h) => h.key));
  });

  it('writes the Wertschriftenverzeichnis as Excel with formulas, CSV and PDF (F10.11)', async () => {
    const t = await setup();
    const xlsx = await t.create.execute(
      new CreateExportCommand('anna', t.project.id, 'securities_xlsx'),
    );
    expect(xlsx.fileName).toMatch(/_wertschriftenverzeichnis_.*\.xlsx$/);
    const workbook = await workbookOf(
      (
        await t.content.execute(
          new GetExportContentQuery('anna', t.project.id, xlsx.id),
        )
      ).bytes,
    );
    const sheet = sheetOf(workbook, 'Wertschriftenverzeichnis');
    const texts = allTexts(workbook);
    expect(texts).toContain('Wertschriften- und Guthabenverzeichnis 2025');
    expect(texts.some((x) => /^SUM\(G\d+:G\d+\)$/.test(x))).toBe(true);
    expect(texts.some((x) => /^ABS\(D\d+\)\*E\d+$/.test(x))).toBe(true);
    let dotIncome: unknown;
    sheet.eachRow((row) => {
      if (row.getCell(3).value === 'DOT') dotIncome = row.getCell(9).value;
    });
    expect(dotIncome).toBe(6.75);
    expectClean(texts);

    const csv = await t.create.execute(
      new CreateExportCommand('anna', t.project.id, 'securities_csv'),
    );
    expect(csv).toMatchObject({ mediaType: 'text/csv; charset=utf-8' });
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(
      (
        await t.content.execute(
          new GetExportContentQuery('anna', t.project.id, csv.id),
        )
      ).bytes,
    );
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain('Ertrag ohne VST CHF');
    expect(text).toMatch(/kraken,spot,DOT,1\.5,.*,6\.75,/);
    expectClean([text]);

    await t.create.execute(
      new CreateExportCommand('anna', t.project.id, 'securities_pdf'),
    );
    const html = t.pdf.rendered.at(-1) ?? '';
    expect(html).toContain('Verrechnungssteuer');
    expect(html).toContain('Keine Steuerberatung');
    expectClean([html]);
  });

  it('writes the Ertrags- und Belegliste with origin, sums per category and asset (F10.12)', async () => {
    const t = await setup();
    const xlsx = await t.create.execute(
      new CreateExportCommand('anna', t.project.id, 'income_list_xlsx'),
    );
    const workbook = await workbookOf(
      (
        await t.content.execute(
          new GetExportContentQuery('anna', t.project.id, xlsx.id),
        )
      ).bytes,
    );
    expect(workbook.worksheets.map((w) => w.name)).toEqual([
      'Erträge',
      'Summen',
    ]);
    const texts = allTexts(workbook);
    expect(texts).toContain('buchungen.csv, Zeile 5');
    expect(texts).toContain('Summen je Kategorie');
    expect(texts).toContain('Summen je Asset');
    expectClean(texts);
    await t.create.execute(
      new CreateExportCommand('anna', t.project.id, 'income_list_pdf'),
    );
    const html = t.pdf.rendered.at(-1) ?? '';
    expect(html).toContain('Ertrags- und Belegliste 2025');
    expect(html).toContain('buchungen.csv, Zeile 5');
    expect(html).toContain('6.75');
    expectClean([html]);
  });

  it('writes the Transaktions- und Bestandesnachweis with changes and evidence (F10.13)', async () => {
    const t = await setup();
    await t.transactionEdits.add('anna', [
      {
        key: `${t.bookingsFile.sha256}::6`,
        changes: { kind: 'transfer' },
        reason: 'Umbuchung auf eigenes Konto',
        source: 'user',
      },
    ]);
    const xlsx = await t.create.execute(
      new CreateExportCommand('anna', t.project.id, 'evidence_xlsx'),
    );
    const workbook = await workbookOf(
      (
        await t.content.execute(
          new GetExportContentQuery('anna', t.project.id, xlsx.id),
        )
      ).bytes,
    );
    const texts = allTexts(workbook);
    expect(texts).toContain('Übrige Buchung → Übertrag');
    expect(texts).toContain('Umbuchung auf eigenes Konto');
    expect(texts).toContain('Kontoauszug: bestaende.csv');
    expect(texts.some((x) => /^SUM\(G\d+:G\d+\)$/.test(x))).toBe(true);
    expectClean(texts);
    await t.create.execute(
      new CreateExportCommand('anna', t.project.id, 'evidence_pdf'),
    );
    const html = t.pdf.rendered.at(-1) ?? '';
    expect(html).toContain('Bestände per 31.12.2025');
    expect(html).toContain('Umbuchung auf eigenes Konto');
    expectClean([html]);
  });

  it('answers 503 with code pdfUnavailable for a PDF when no browser is available', async () => {
    const t = await setup(false);
    const error: unknown = await t.create
      .execute(new CreateExportCommand('anna', t.project.id, 'detailed_pdf'))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    // The app shows `errors.api.pdfUnavailable` instead of a generic server error.
    expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
      code: 'pdfUnavailable',
    });
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
