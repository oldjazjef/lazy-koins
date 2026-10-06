#!/usr/bin/env node
/**
 * `pnpm private:inspect` — the ONLY way tooling (and Claude) looks at private/ (CLAUDE.md,
 * Private data). It prints the STRUCTURE of the real exports, never their content:
 *
 *   - every file (recursive): relative path, size, detected kind (csv / xlsx / pdf / json / other);
 *   - CSV: the delimiter, the header row and the number of data rows;
 *   - XLSX: per sheet, its name, the header row (first non-empty row) and the number of rows
 *     below it;
 *   - JSON (golden.json included): its top-level keys only — never a value.
 *
 * Data rows, cell values below the header, amounts, addresses and JSON values are never printed.
 * Symlinks are not followed. Exits 0 with a message when private/ does not exist.
 *
 * Usage: pnpm private:inspect
 */
import { lstatSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const privateDir = path.join(repoRoot, 'private');

if (!existsSync(privateDir)) {
  console.log('private-inspect: no private/ folder — nothing to inspect.');
  process.exit(0);
}

/** Every regular file below `dir`, depth first, sorted — symlinks are skipped, not followed. */
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) return [];
      if (entry.isDirectory()) return walk(full);
      return entry.isFile() ? [full] : [];
    });
}

function kindOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.csv' || ext === '.tsv') return 'csv';
  if (ext === '.xlsx' || ext === '.xlsm') return 'xlsx';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.json') return 'json';
  return 'other';
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** UTF-8 (BOM stripped) or UTF-16 LE/BE by BOM — the encodings exchange exports come in. */
function decode(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe)
    return new TextDecoder('utf-16le').decode(buffer.subarray(2));
  if (buffer[0] === 0xfe && buffer[1] === 0xff)
    return new TextDecoder('utf-16be').decode(buffer.subarray(2));
  const text = new TextDecoder('utf-8').decode(buffer);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** The delimiter that splits the first line into the most fields (outside quotes). */
function detectDelimiter(text) {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  let best = ',';
  let bestCount = -1;
  for (const candidate of [',', ';', '\t', '|']) {
    let count = 0;
    let quoted = false;
    for (const char of firstLine) {
      if (char === '"') quoted = !quoted;
      else if (char === candidate && !quoted) count += 1;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/**
 * RFC 4180-ish: quoted fields may contain delimiters, doubled quotes and line breaks. Returns
 * the header row and the number of non-empty records after it — the data rows themselves are
 * counted, never kept.
 */
function inspectCsv(text) {
  const delimiter = detectDelimiter(text);
  let header;
  let dataRows = 0;
  let field = '';
  let record = [];
  let quoted = false;
  let recordHasContent = false;

  const endRecord = () => {
    record.push(field);
    if (recordHasContent || field.length > 0) {
      if (header === undefined) header = record;
      else dataRows += 1;
    }
    field = '';
    record = [];
    recordHasContent = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        if (header === undefined) field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else if (header === undefined) {
        field += char;
      } else {
        // A data row: only whether it has content matters, never what it is.
        field = 'x';
      }
      recordHasContent = true;
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      record.push(header === undefined ? field : '');
      field = '';
      recordHasContent = true;
    } else if (char === '\n') {
      endRecord();
    } else if (char !== '\r') {
      if (header === undefined) field += char;
      else field = 'x';
    }
  }
  if (field.length > 0 || record.length > 0) endRecord();

  return {
    delimiter: delimiter === '\t' ? 'TAB' : delimiter,
    header: (header ?? []).map((cell) => cell.trim()),
    dataRows,
  };
}

/** A cell's display text, for the header row only. */
function cellText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((t) => t.text).join('');
    if ('text' in value) return String(value.text);
    if ('result' in value) return String(value.result ?? '');
    if (value instanceof Date) return '<date>';
    return '';
  }
  return String(value);
}

async function inspectXlsx(file) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  return workbook.worksheets.map((sheet) => {
    let headerRowNumber;
    let header = [];
    let rowsBelow = 0;
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (headerRowNumber === undefined) {
        headerRowNumber = rowNumber;
        const values = Array.isArray(row.values) ? row.values.slice(1) : [];
        header = values.map((value) => cellText(value).trim());
      } else {
        rowsBelow += 1;
      }
    });
    return { name: sheet.name, headerRowNumber, header, rowsBelow };
  });
}

function inspectJson(text) {
  const parsed = JSON.parse(text);
  if (parsed === null || typeof parsed !== 'object')
    return { topLevel: typeof parsed };
  if (Array.isArray(parsed))
    return { topLevel: 'array', length: parsed.length };
  return { topLevel: 'object', keys: Object.keys(parsed) };
}

const files = walk(privateDir);
console.log(`private-inspect: ${files.length} file(s) under private/\n`);

for (const file of files) {
  const relative = path.relative(repoRoot, file).split(path.sep).join('/');
  const size = lstatSync(file).size;
  const kind = kindOf(file);
  console.log(`${relative}  (${formatSize(size)}, ${kind})`);
  try {
    if (kind === 'csv') {
      const { delimiter, header, dataRows } = inspectCsv(
        decode(readFileSync(file)),
      );
      console.log(`  delimiter: ${delimiter}`);
      console.log(`  header:    ${JSON.stringify(header)}`);
      console.log(`  data rows: ${dataRows}`);
    } else if (kind === 'xlsx') {
      for (const sheet of await inspectXlsx(file)) {
        console.log(`  sheet ${JSON.stringify(sheet.name)}:`);
        if (sheet.headerRowNumber === undefined) {
          console.log('    (empty)');
          continue;
        }
        console.log(
          `    header (row ${sheet.headerRowNumber}): ${JSON.stringify(sheet.header)}`,
        );
        console.log(`    rows below header: ${sheet.rowsBelow}`);
      }
    } else if (kind === 'json') {
      const summary = inspectJson(decode(readFileSync(file)));
      if (summary.keys) {
        console.log(`  top-level keys: ${JSON.stringify(summary.keys)}`);
      } else if (summary.topLevel === 'array') {
        console.log(`  top level: array of ${summary.length}`);
      } else {
        console.log(`  top level: ${summary.topLevel}`);
      }
    }
  } catch (error) {
    // The error's name only — a parser's message could quote file content.
    console.log(
      `  could not inspect: ${error instanceof Error ? error.name : 'error'}`,
    );
  }
  console.log('');
}
