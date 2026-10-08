import type { ConfigService } from '@nestjs/config';
import ExcelJS from 'exceljs';
import { CalculateProjectCommand } from '../../calculation/application/calculation.handlers';
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
import { detailedWorkbook } from './excel/detailed-workbook';
import { internalWorkbook } from './excel/internal-workbook';
import { simpleWorkbook } from './excel/simple-workbook';
import { type ExportData, exportFileName } from './export-data';
import { EXPORT_TEXTS, exportKit, formatIsoDate } from './export-texts';
import { ExportDataService } from './exports.handlers';
import { mailDraft } from './mail-draft';
import { internalReportHtml } from './pdf/internal-report-html';
import {
  detailedStatementHtml,
  simpleStatementHtml,
} from './pdf/statement-html';

/**
 * F11.2: every document in the language of the user. The German output is pinned by snapshots
 * (taken before the exports became translatable) — de-CH must stay exactly as it was.
 */
async function exportData(
  settings: Record<string, unknown> = {},
): Promise<ExportData> {
  const t = await calculationSetup();
  const settingsRepo = new InMemoryUserSettingsRepository();
  await settingsRepo.save('anna', {
    displayName: 'Anna Muster',
    advisorName: 'Treuhand Beispiel AG',
    advisorEmail: 'treuhand@example.ch',
    ...settings,
  });
  const config = { get: () => '' } as unknown as ConfigService<Env, true>;
  const users = {
    findById: async () => ({ displayName: 'Anna' }),
  } as unknown as UserRepositoryPort;
  const calculation = {
    calculate: (userId: string, projectId: string) =>
      t.calculate.execute(new CalculateProjectCommand(userId, projectId)),
  } as unknown as CalculationService;
  const service = new ExportDataService(
    t.snapshots,
    t.states,
    new SettingsReader(settingsRepo, new SettingsSecrets(config)),
    users,
    t.files,
    t.inputs,
    calculation,
    new InMemoryHintStateRepository(),
    t.corrections,
    t.transactionEdits,
  );
  const snapshot = await service.currentSnapshot('anna', t.project);
  const data = await service.build(
    'anna',
    t.project,
    snapshot,
    '2026-01-15T10:00:00.000Z',
  );
  return {
    ...data,
    calculatedAt: '2026-01-14T09:00:00.000Z',
    appVersion: '1.0.0+test',
  };
}

/** Sheet names and every cell (formulas as their expression), in order. */
async function workbookTexts(bytes: Uint8Array): Promise<string[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as never);
  const texts: string[] = [];
  for (const sheet of workbook.worksheets) {
    texts.push(`# ${sheet.name}`);
    sheet.eachRow((row) =>
      row.eachCell((cell) => {
        const value = cell.value as { formula?: string } | null;
        texts.push(
          value && typeof value === 'object' && value.formula
            ? `=${value.formula}`
            : String(cell.value ?? ''),
        );
      }),
    );
  }
  return texts;
}

async function allDocuments(data: ExportData) {
  return {
    simpleHtml: simpleStatementHtml(data),
    detailedHtml: detailedStatementHtml(data),
    internalHtml: internalReportHtml(data),
    simpleXlsx: await workbookTexts(await simpleWorkbook(data)),
    detailedXlsx: await workbookTexts(await detailedWorkbook(data)),
    internalXlsx: await workbookTexts(await internalWorkbook(data)),
    mail: mailDraft(data, []),
  };
}

/** Words of the German documents that must not show up in an English one. */
const GERMAN =
  /\b(Steuerwert|Ertrag|Plattform|Kategorie|Menge|Methodik|Bestand|Kurs|Wert|Total Vermögen|Buchungen|erstellt am|Steuerjahr|Kanton|Prüfungen|Offene Punkte|Hinweis|Guten Tag|Anhänge)\b/;

/** What a statement for the tax authority must never say — in English (F10.1/F10.2). */
const FORBIDDEN_EN = /open items?|to check|todo|\badd (a|the)\b|check /i;

function textsOf(documents: Awaited<ReturnType<typeof allDocuments>>) {
  return [
    documents.simpleHtml,
    documents.detailedHtml,
    documents.internalHtml,
    ...documents.simpleXlsx,
    ...documents.detailedXlsx,
    ...documents.internalXlsx,
    documents.mail.subject,
    documents.mail.body,
  ];
}

describe('export language (F11.2)', () => {
  it('keeps the German documents exactly as they were', async () => {
    const documents = await allDocuments(await exportData());
    expect(documents).toMatchSnapshot();
  });

  it('writes every document in English for an English user', async () => {
    const data = await exportData({ locale: 'en' });
    expect(data.locale).toBe('en');
    const documents = await allDocuments(data);

    expect(documents.simpleHtml).toContain('<html lang="en">');
    expect(documents.simpleHtml).toContain(
      'Crypto tax statement 2025 (simple)',
    );
    expect(documents.simpleHtml).toContain('Tax value at 31.12.2025');
    expect(documents.simpleHtml).toContain(
      'Securities and assets list (Wertschriften- und Guthabenverzeichnis)',
    );
    expect(documents.detailedHtml).toContain('Holdings at 31.12.2025');
    expect(documents.detailedXlsx).toEqual(
      expect.arrayContaining([
        '# Overview',
        '# Parameters',
        '# Holdings 31.12.',
        '# Income detail',
        '# Method',
        'Total wealth',
      ]),
    );
    // The formulas refer to the English sheet and status names.
    expect(
      documents.detailedXlsx.filter((text) =>
        text.startsWith("=SUMIFS('Holdings 31.12.'!J:J"),
      ),
    ).not.toHaveLength(0);
    expect(documents.internalXlsx[0]).toBe('# Overview');
    expect(documents.internalHtml).toContain(
      'Internal review report – not for the tax authority',
    );
    expect(documents.mail.subject).toBe('Taxes 2025: crypto wealth and income');
    expect(documents.mail.body.startsWith('Dear Treuhand Beispiel AG')).toBe(
      true,
    );

    // No German left — except the official terms in parentheses — and no to-dos.
    const strip = (text: string) =>
      text.replace(/\([^)]*\)/g, '').replace(/lazy-koins [^\s<]+/g, '');
    const german = textsOf(documents)
      .map(strip)
      .filter((text) => GERMAN.test(text));
    expect(german).toEqual([]);
    const statements = [
      documents.simpleHtml,
      documents.detailedHtml,
      ...documents.simpleXlsx,
      ...documents.detailedXlsx,
    ];
    expect(statements.filter((text) => FORBIDDEN_EN.test(text))).toEqual([]);
  });

  it('follows the number and date format of the profile', async () => {
    const swiss = await allDocuments(await exportData());
    expect(swiss.simpleHtml).toContain('erstellt am 15.01.2026');
    const data = await exportData({
      locale: 'en',
      numberFormat: 'en',
      dateFormat: 'yyyy-MM-dd',
    });
    const english = await allDocuments(data);
    expect(english.simpleHtml).toContain('created on 2026-01-15');
    expect(english.simpleHtml).not.toContain('’');
    expect(
      exportFileName(data, 'einfach', 'pdf').endsWith('_simple_2026-01-15.pdf'),
    ).toBe(true);
    expect(
      exportFileName({ ...data, locale: 'de-CH' }, 'ausfuehrlich', 'xlsx'),
    ).toMatch(/_ausfuehrlich_2026-01-15\.xlsx$/);
  });

  it('formats amounts and dates per format (F11.2)', () => {
    const swiss = exportKit('de-CH');
    expect(swiss.chf('1234567.891')).toBe('1’234’567.89');
    expect(swiss.date('2025-12-31T10:00:00Z')).toBe('31.12.2025');
    const english = exportKit('en', {
      numberFormat: 'en',
      dateFormat: 'MM/dd/yyyy',
    });
    expect(english.chf('1234567.891')).toBe('1,234,567.89');
    expect(english.quantity('12345.5')).toBe('12,345.5');
    expect(english.date('2025-12-31')).toBe('12/31/2025');
    expect(formatIsoDate('2025-12-31', 'dd/MM/yyyy')).toBe('31/12/2025');
  });

  it('has the same texts in every language', () => {
    const keys = (texts: object) => Object.keys(texts).sort();
    expect(keys(EXPORT_TEXTS.en)).toEqual(keys(EXPORT_TEXTS['de-CH']));
    expect(keys(EXPORT_TEXTS.en.col)).toEqual(keys(EXPORT_TEXTS['de-CH'].col));
  });
});
