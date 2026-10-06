import { z } from 'zod';
import { BOOKING_KINDS, type Booking, type Holding } from '../bookings/booking';
import type { Decimal } from '../money/decimal';
import type {
  ImportResult,
  Importer,
  RowError,
  SourceFile,
} from '../importers/importer';
import {
  findTable,
  periodOf,
  type Table,
  type TableRow,
  tableRows,
} from '../importers/table';
import { parseNumber } from '../importers/text/numbers';
import {
  isIsoDate,
  parseDateTime,
  toUtcIso,
} from '../importers/text/timestamps';
import {
  BOOKING_COLUMNS as B,
  BOOKINGS_SHEET,
  DEFAULT_ACCOUNT,
  HOLDING_COLUMNS as H,
  HOLDINGS_SHEET,
  requiredColumnNames,
} from './standard-format';

/**
 * Numbers in the standard format: `.` as decimal separator; a lone `,` is accepted as well
 * (Excel in de-CH writes `0,5` into a CSV). No grouping.
 */
export function parseStandardNumber(text: string): Decimal | undefined {
  const value = text.trim();
  if (/^[+-]?\d+,\d+$/.test(value)) {
    return parseNumber(value, {
      decimal: ',',
      thousands: [],
      stripText: false,
    });
  }
  return parseNumber(value);
}

/** Row-error codes of the standard format (the app translates `files.rowErrors.<code>`). */
export const ROW_ERROR_CODES = [
  'required',
  'invalidNumber',
  'invalidTimestamp',
  'timeZoneMissing',
  'invalidKind',
  'invalidDate',
  'negative',
] as const;

const text = z.string().trim();
const required = text.min(1, 'required');

const decimal = text.transform((value, ctx): Decimal => {
  const parsed = parseStandardNumber(value);
  if (parsed === undefined) {
    ctx.addIssue({
      code: 'custom',
      message: value === '' ? 'required' : 'invalidNumber',
    });
    return z.NEVER;
  }
  return parsed;
});

const optionalNonNegative = text.transform(
  (value, ctx): Decimal | undefined => {
    if (value === '') return undefined;
    const parsed = parseStandardNumber(value);
    if (parsed === undefined) {
      ctx.addIssue({ code: 'custom', message: 'invalidNumber' });
      return z.NEVER;
    }
    if (parsed.isNegative()) {
      ctx.addIssue({ code: 'custom', message: 'negative' });
      return z.NEVER;
    }
    return parsed;
  },
);

const utcTimestamp = text.transform((value, ctx): string => {
  if (value === '') {
    ctx.addIssue({ code: 'custom', message: 'required' });
    return z.NEVER;
  }
  try {
    const { parts, statedOffset } = parseDateTime(value, 'iso');
    if (statedOffset === undefined) {
      ctx.addIssue({ code: 'custom', message: 'timeZoneMissing' });
      return z.NEVER;
    }
    return toUtcIso(parts, statedOffset);
  } catch {
    ctx.addIssue({ code: 'custom', message: 'invalidTimestamp' });
    return z.NEVER;
  }
});

const kind = text.pipe(z.enum(BOOKING_KINDS, { message: 'invalidKind' }));

const isoDate = text.refine(isIsoDate, { message: 'invalidDate' });

/** One "Buchungen" row, keyed by the German column names. */
export const StandardBookingRowSchema = z.object({
  [B.timestamp.name]: utcTimestamp,
  [B.platform.name]: required,
  [B.account.name]: text,
  [B.kind.name]: kind,
  [B.asset.name]: required,
  [B.quantity.name]: decimal,
  [B.fee.name]: optionalNonNegative,
  [B.feeAsset.name]: text,
  [B.priceChf.name]: optionalNonNegative,
  [B.priceUsd.name]: optionalNonNegative,
  [B.group.name]: text,
  [B.note.name]: text,
});

/** One "Bestände" row. */
export const StandardHoldingRowSchema = z.object({
  [H.platform.name]: required,
  [H.account.name]: text,
  [H.asset.name]: required,
  [H.quantity.name]: decimal,
  [H.asOf.name]: isoDate,
  [H.priceChf.name]: optionalNonNegative,
  [H.priceUsd.name]: optionalNonNegative,
  [H.evidence.name]: text,
});

function rowObject(
  row: TableRow,
  names: readonly string[],
): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, row.get(name)]));
}

function issuesToErrors(
  issues: readonly z.core.$ZodIssue[],
  row: number,
  sheet: string | undefined,
): RowError[] {
  return issues.map((issue) => ({
    row,
    code: issue.message,
    column: typeof issue.path[0] === 'string' ? issue.path[0] : undefined,
    ...(sheet ? { sheet } : {}),
  }));
}

function optional<T>(value: T | undefined | ''): T | undefined {
  return value === '' ? undefined : value;
}

/** Locates the two tables of a standard file (either may be absent, not both). */
export function standardTables(file: SourceFile): {
  bookings?: Table;
  holdings?: Table;
} {
  if (file.kind === 'pdf') return {};
  const bookingCols = requiredColumnNames(B);
  const holdingCols = requiredColumnNames(H);
  if (file.kind === 'xlsx') {
    return {
      bookings:
        findTable(file, bookingCols, { sheet: BOOKINGS_SHEET, maxScan: 5 }) ??
        findTable(file, bookingCols, { maxScan: 5 }),
      holdings:
        findTable(file, holdingCols, { sheet: HOLDINGS_SHEET, maxScan: 5 }) ??
        findTable(file, holdingCols, { maxScan: 5 }),
    };
  }
  const bookings = findTable(file, bookingCols, { maxScan: 1 });
  return bookings
    ? { bookings }
    : { holdings: findTable(file, holdingCols, { maxScan: 1 }) };
}

/** Reads a standard-format file (CSV or XLSX). Bad rows become `errors`, the rest is imported. */
export function parseStandardFile(file: SourceFile): ImportResult {
  const { bookings: bookingTable, holdings: holdingTable } =
    standardTables(file);
  const errors: RowError[] = [];
  const bookings: Booking[] = [];
  const holdings: Holding[] = [];
  const sheetLabel = (table: Table) =>
    file.kind === 'xlsx' ? table.sheet.name : undefined;

  if (bookingTable) {
    const names = Object.values(B).map((c) => c.name);
    for (const row of tableRows(bookingTable)) {
      const parsed = StandardBookingRowSchema.safeParse(rowObject(row, names));
      if (!parsed.success) {
        errors.push(
          ...issuesToErrors(
            parsed.error.issues,
            row.row,
            sheetLabel(bookingTable),
          ),
        );
        continue;
      }
      const v = parsed.data;
      const asset = String(v[B.asset.name]).toUpperCase();
      const kindValue = v[B.kind.name] as Booking['kind'];
      bookings.push({
        id: `${file.id}:${sheetLabel(bookingTable) ?? ''}:${row.row}`,
        sourceFileId: file.id,
        row: row.row,
        raw: row.raw(),
        platform: String(v[B.platform.name]),
        accountId: String(v[B.account.name]) || DEFAULT_ACCOUNT,
        timestamp: v[B.timestamp.name] as string,
        asset,
        quantity: v[B.quantity.name] as Decimal,
        kind: kindValue,
        fee: v[B.fee.name] as Decimal | undefined,
        feeAsset: optional(String(v[B.feeAsset.name]).toUpperCase()),
        priceChf: v[B.priceChf.name] as Decimal | undefined,
        priceUsd: v[B.priceUsd.name] as Decimal | undefined,
        group: optional(String(v[B.group.name])),
        note: optional(String(v[B.note.name])),
        rawType: kindValue,
      });
    }
  }

  if (holdingTable) {
    const names = Object.values(H).map((c) => c.name);
    for (const row of tableRows(holdingTable)) {
      const parsed = StandardHoldingRowSchema.safeParse(rowObject(row, names));
      if (!parsed.success) {
        errors.push(
          ...issuesToErrors(
            parsed.error.issues,
            row.row,
            sheetLabel(holdingTable),
          ),
        );
        continue;
      }
      const v = parsed.data;
      holdings.push({
        id: `${file.id}:${sheetLabel(holdingTable) ?? ''}:${row.row}`,
        sourceFileId: file.id,
        row: row.row,
        raw: row.raw(),
        platform: String(v[H.platform.name]),
        accountId: String(v[H.account.name]) || DEFAULT_ACCOUNT,
        asset: String(v[H.asset.name]).toUpperCase(),
        quantity: v[H.quantity.name] as Decimal,
        asOf: String(v[H.asOf.name]),
        priceChf: v[H.priceChf.name] as Decimal | undefined,
        priceUsd: v[H.priceUsd.name] as Decimal | undefined,
        evidence: optional(String(v[H.evidence.name])),
      });
    }
  }

  return {
    bookings,
    holdings,
    period: periodOf([
      ...bookings.map((b) => b.timestamp),
      ...holdings.map((h) => h.asOf),
    ]),
    errors,
    notes: [],
  };
}

export const STANDARD_IMPORTER_ID = 'standard-v1';

/** The built-in importer for the standard format itself. */
export const standardImporter: Importer = {
  id: STANDARD_IMPORTER_ID,
  platform: '',
  fileKinds: ['csv', 'xlsx'],
  detect(file) {
    const { bookings, holdings } = standardTables(file);
    return bookings || holdings ? 1 : 0;
  },
  parse: parseStandardFile,
};
