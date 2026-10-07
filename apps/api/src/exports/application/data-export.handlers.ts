import { BadRequestException, Optional } from '@nestjs/common';
import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
  BOOKINGS_SHEET,
  type ExportTable,
  HOLDINGS_SHEET,
  isBookingKind,
  standardExport,
  type StandardExportFilter,
  toCsv,
} from '@lazykoins/engine';
import ExcelJS from 'exceljs';
import { localeOr } from '../../common/i18n/locale';
import { SettingsReader } from '../../settings/application/settings.handlers';
import { CalculationInputService } from '../../calculation/application/calculation-input.service';
import { loadOwnProject } from '../../projects/application/project-access';
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import { slug } from '../../packages/domain/package-format';
import { XLSX_MEDIA_TYPE } from '../domain/project-export';

export const DATA_EXPORT_FORMATS = ['csv', 'xlsx'] as const;
export type DataExportFormat = (typeof DATA_EXPORT_FORMATS)[number];
export const DATA_EXPORT_TYPES = ['bookings', 'holdings'] as const;
export type DataExportType = (typeof DATA_EXPORT_TYPES)[number];

export interface DataExportFile {
  readonly fileName: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
  readonly rows: number;
}

/** UTF-8 BOM: Excel opens a CSV with umlauts correctly. */
const BOM = String.fromCharCode(0xfeff);

async function workbookOf(
  tables: readonly { name: string; table: ExportTable }[],
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'lazy-koins';
  for (const { name, table } of tables) {
    const sheet = workbook.addWorksheet(name, {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    // Every cell is text: 18 decimals must not become a rounded double (CLAUDE.md, Numbers).
    sheet.columns = table.header.map((header) => ({
      header,
      key: header,
      width: Math.max(12, header.length + 4),
      style: { numFmt: '@' },
    }));
    sheet.getRow(1).font = { bold: true };
    for (const row of table.rows) sheet.addRow([...row]);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

export class DataExportQuery {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly format: DataExportFormat,
    /** CSV holds one record type; XLSX both sheets. */
    readonly type: DataExportType,
    readonly filter: StandardExportFilter,
  ) {}
}

/**
 * F10.7: the project's bookings and holdings in the **standard format** (re-importable as is),
 * with the applied corrections, the CHF price used and its source, and file + row of every
 * record — filtered by platform/account, asset, kind and period. Read from the stored files
 * like the calculation — **only the active ones** (a deactivated file, F5.7a, is left out by
 * `CalculationInputService.build`, decided 09.10.2026); nothing is stored.
 */
@QueryHandler(DataExportQuery)
export class DataExportHandler implements IQueryHandler<
  DataExportQuery,
  DataExportFile
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly inputs: CalculationInputService,
    @Optional() private readonly settings?: SettingsReader,
  ) {}

  async execute({
    userId,
    projectId,
    format,
    type,
    filter,
  }: DataExportQuery): Promise<DataExportFile> {
    if (filter.kind !== undefined && !isBookingKind(filter.kind)) {
      throw new BadRequestException('Unknown kind');
    }
    const project = await loadOwnProject(this.projects, userId, projectId);
    const assembled = await this.inputs.build(project);
    const fileNames: Record<string, string> = {};
    for (const file of assembled.files)
      fileNames[file.sha256] = file.displayName;
    const out = standardExport({
      rules: assembled.input.rules,
      bookings: assembled.input.bookings,
      holdings: assembled.input.holdings,
      corrections: assembled.input.corrections,
      rates: assembled.input.rates,
      fileNames,
      filter,
      // F11.2: the information columns in the user's language (the format's own columns stay).
      language: localeOr((await this.settings?.resolve(userId))?.locale),
    });
    const base = `${slug(project.name)}-${project.taxYear}`;
    if (format === 'xlsx') {
      return {
        fileName: `${base}-daten.xlsx`,
        mediaType: XLSX_MEDIA_TYPE,
        bytes: await workbookOf([
          { name: BOOKINGS_SHEET, table: out.bookings },
          { name: HOLDINGS_SHEET, table: out.holdings },
        ]),
        rows: out.bookings.rows.length + out.holdings.rows.length,
      };
    }
    const table = type === 'bookings' ? out.bookings : out.holdings;
    return {
      fileName: `${base}-${type === 'bookings' ? 'buchungen' : 'bestaende'}.csv`,
      mediaType: 'text/csv; charset=utf-8',
      bytes: new TextEncoder().encode(
        BOM + toCsv([table.header, ...table.rows]),
      ),
      rows: table.rows.length,
    };
  }
}
