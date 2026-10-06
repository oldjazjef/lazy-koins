import { Injectable } from '@nestjs/common';
import {
  type CsvOptions,
  csvSourceFile,
  type FileKind,
  type Sheet,
  type SourceFile,
} from '@lazykoins/engine';
import ExcelJS from 'exceljs';

/** Guards against a small XLSX that expands into an enormous grid. */
const MAX_ROWS_PER_SHEET = 250_000;
const MAX_COLUMNS = 256;

export interface ReadableFile {
  /** The SHA-256 — the engine's `sourceFileId`. */
  readonly sha256: string;
  readonly name: string;
  readonly kind: FileKind;
  readonly bytes: Uint8Array;
}

export class UnreadableFileError extends Error {
  constructor() {
    super('The file could not be read');
    this.name = 'UnreadableFileError';
  }
}

/**
 * Original bytes → the engine's `SourceFile`. CSV decoding is the engine's (pure); XLSX is
 * unpacked here with ExcelJS, every cell turned into **text**: numbers as the shortest exact
 * form of the double the workbook stores (XLSX itself keeps numbers as IEEE doubles), dates as
 * `YYYY-MM-DD HH:mm:ss` wall-clock (ExcelJS reads them as UTC), formulas as their cached result.
 * PDFs are not read yet (no text extraction): they keep no pages.
 *
 * Never logs or echoes file content.
 */
@Injectable()
export class SourceFileReader {
  async read(file: ReadableFile, csv: CsvOptions = {}): Promise<SourceFile> {
    switch (file.kind) {
      case 'csv':
        return csvSourceFile(
          { id: file.sha256, name: file.name, bytes: file.bytes },
          csv,
        );
      case 'pdf':
        return { id: file.sha256, name: file.name, kind: 'pdf', pages: [] };
      case 'xlsx':
        return {
          id: file.sha256,
          name: file.name,
          kind: 'xlsx',
          sheets: await readWorkbook(file.bytes),
        };
    }
  }
}

async function readWorkbook(bytes: Uint8Array): Promise<Sheet[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(
      Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) as never,
    );
  } catch {
    throw new UnreadableFileError();
  }
  return workbook.worksheets.map((worksheet) => {
    const rows: string[][] = [];
    const last = Math.min(worksheet.rowCount, MAX_ROWS_PER_SHEET);
    for (let r = 1; r <= last; r += 1) {
      const row = worksheet.getRow(r);
      const width = Math.min(row.cellCount, MAX_COLUMNS);
      const cells: string[] = [];
      for (let c = 1; c <= width; c += 1) {
        cells.push(cellText(row.getCell(c).value));
      }
      rows.push(cells);
    }
    return { name: worksheet.name, rows };
  });
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

export function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    const ms = value.getUTCMilliseconds();
    return (
      `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())} ` +
      `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}` +
      (ms ? `.${pad(ms, 3)}` : '')
    );
  }
  if (typeof value === 'object') {
    if ('richText' in value)
      return value.richText.map((part) => part.text).join('');
    if ('formula' in value || 'sharedFormula' in value) {
      return cellText((value as { result?: ExcelJS.CellValue }).result ?? null);
    }
    if ('text' in value) return String(value.text);
    if ('error' in value) return String(value.error);
  }
  return '';
}
