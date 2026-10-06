import type { Booking, BookingKind, Holding } from '../bookings/booking';
import type { Decimal } from '../money/decimal';
import type {
  Confidence,
  ImportNote,
  ImportResult,
  Importer,
  RowError,
  SourceFile,
} from '../importers/importer';
import {
  findTable,
  nameMatches,
  normaliseHeader,
  periodOf,
  type Table,
  type TableRow,
  tableRows,
} from '../importers/table';
import { type NumberFormat, parseNumber } from '../importers/text/numbers';
import {
  fixedOffset,
  isIsoDate,
  parseDateTime,
  timestampToUtc,
  toUtcIso,
} from '../importers/text/timestamps';
import { DEFAULT_ACCOUNT } from '../standard/standard-format';
import type { MappingSpec } from './mapping-spec';

/**
 * Applies a mapping spec to a file — pure and deterministic: the same spec and file always give
 * the same records in file order. Bad rows become `errors` (with row and column); unknown kinds
 * are booked as `unknown`, never dropped (F7.5: every record keeps file, row and raw values).
 */

function locate(spec: MappingSpec, file: SourceFile): Table | undefined {
  if (file.kind === 'pdf') return undefined;
  return findTable(file, spec.match.headers, {
    sheet: spec.source.sheet,
    headerRow: spec.source.headerRow,
  });
}

/**
 * How well a spec fits a file: 0 when the headers (or the file-name pattern) do not match;
 * otherwise the share of the header row the spec names, so a more specific spec beats a vaguer
 * one — 0.5 … 1.
 */
export function mappingConfidence(
  spec: MappingSpec,
  file: SourceFile,
): Confidence {
  if (
    spec.match.fileName &&
    !nameMatches(file, new RegExp(spec.match.fileName, 'i'))
  ) {
    return 0;
  }
  const table = locate(spec, file);
  if (!table) return 0;
  const present = table.header.filter((cell) => cell !== '').length;
  const named = new Set(spec.match.headers.map(normaliseHeader)).size;
  return present === 0 ? 0 : 0.5 + 0.5 * Math.min(1, named / present);
}

/** The spec's fingerprint as stored next to it: its normalised headers, sorted. */
export function mappingFingerprint(spec: MappingSpec): string {
  return [...new Set(spec.match.headers.map(normaliseHeader))].sort().join('|');
}

/** A file's header signature (first non-empty row of each sheet), for matching and storage. */
export function headerSignature(file: SourceFile): string[] {
  if (file.kind === 'pdf') return [];
  for (const sheet of file.sheets) {
    const row = sheet.rows.find((cells) =>
      cells.some((cell) => cell.trim() !== ''),
    );
    if (row)
      return row.map((cell) => cell.trim()).filter((cell) => cell !== '');
  }
  return [];
}

/** Code-point order — never locale-dependent (F7.6). */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

class RowFailure extends Error {
  constructor(
    readonly code: string,
    readonly column?: string,
  ) {
    super(code);
  }
}

interface Context {
  readonly spec: MappingSpec;
  readonly file: SourceFile;
  readonly numbers: NumberFormat;
  readonly zone: string;
}

function number(ctx: Context, row: TableRow, column: string): Decimal {
  const text = row.get(column);
  if (text === '') throw new RowFailure('required', column);
  const value = parseNumber(text, ctx.numbers);
  if (value === undefined) throw new RowFailure('invalidNumber', column);
  return value;
}

function optionalNumber(
  ctx: Context,
  row: TableRow,
  column: string | undefined,
): Decimal | undefined {
  if (column === undefined || row.get(column) === '') return undefined;
  return number(ctx, row, column);
}

function valueOf(
  row: TableRow,
  source: { column?: string; value?: string } | undefined,
): string | undefined {
  if (!source) return undefined;
  const fromColumn = source.column === undefined ? '' : row.get(source.column);
  return fromColumn !== '' ? fromColumn : source.value;
}

export function normaliseAsset(spec: MappingSpec, raw: string): string {
  let asset = raw.trim();
  for (const rewrite of spec.assets.rewrites) {
    asset = asset.replace(new RegExp(rewrite.pattern, 'i'), rewrite.replace);
  }
  const upper = asset.toUpperCase();
  const aliases = new Map(
    Object.entries(spec.assets.aliases).map(([from, to]) => [
      from.toUpperCase(),
      to.toUpperCase(),
    ]),
  );
  return aliases.get(upper) ?? upper;
}

function kindOf(
  spec: MappingSpec,
  row: TableRow,
): { kind: BookingKind; rawType: string } {
  const rule = spec.bookings?.kind;
  if (!rule) return { kind: 'unknown', rawType: '' };
  const values = rule.columns.map((column) => row.get(column));
  const rawType = values.filter((value) => value !== '').join('/');
  const joined = values.join('|');
  for (const candidate of rule.rules) {
    if (candidate.equals) {
      const hit = candidate.equals.every((expected, index) => {
        if (expected === '*') return true;
        return (
          (values[index] ?? '').toLowerCase() === expected.trim().toLowerCase()
        );
      });
      if (hit && candidate.equals.length <= values.length)
        return { kind: candidate.kind, rawType };
    } else if (
      candidate.pattern &&
      new RegExp(candidate.pattern, 'i').test(joined)
    ) {
      return { kind: candidate.kind, rawType };
    }
  }
  return { kind: rule.default, rawType };
}

function excluded(spec: MappingSpec, row: TableRow): boolean {
  return spec.filters.some((filter) => {
    const value = row.get(filter.column);
    if (filter.empty !== undefined && (value === '') !== filter.empty)
      return false;
    if (
      filter.equals &&
      !filter.equals.some((e) => e.toLowerCase() === value.toLowerCase())
    ) {
      return false;
    }
    if (filter.pattern && !new RegExp(filter.pattern, 'i').test(value))
      return false;
    return true;
  });
}

/** The zone of the file's wall-clock times: from its name when the spec says so, else fixed. */
function zoneFor(
  spec: MappingSpec,
  file: SourceFile,
  notes: ImportNote[],
): string {
  const timestamp = spec.bookings?.timestamp;
  if (!timestamp) return 'UTC';
  if (timestamp.timeZoneFromFileName) {
    const match = new RegExp(timestamp.timeZoneFromFileName, 'i').exec(
      file.name,
    );
    const captured = match?.[1];
    if (captured !== undefined) {
      const text = /^[+-]?\d{1,2}$/.test(captured)
        ? `${captured.startsWith('-') ? '' : '+'}${captured}`
        : captured;
      if (fixedOffset(text) !== undefined) return text;
    }
    notes.push({ code: 'timeZoneAssumed' });
  }
  return timestamp.timeZone;
}

function bookingFromRow(ctx: Context, row: TableRow): Booking {
  const mapping = ctx.spec.bookings;
  if (!mapping) throw new Error('no bookings mapping');
  const time = row.get(mapping.timestamp.column);
  if (time === '') throw new RowFailure('required', mapping.timestamp.column);
  let timestamp: string;
  try {
    timestamp = timestampToUtc(time, mapping.timestamp.format, ctx.zone);
  } catch {
    throw new RowFailure('invalidTimestamp', mapping.timestamp.column);
  }
  const rawAsset = row.get(mapping.asset.column);
  if (rawAsset === '') throw new RowFailure('required', mapping.asset.column);
  const asset = normaliseAsset(ctx.spec, rawAsset);

  let quantity: Decimal;
  const q = mapping.quantity;
  if (q.mode === 'signed') {
    quantity = number(ctx, row, q.column);
  } else if (q.mode === 'inOut') {
    const incoming = optionalNumber(ctx, row, q.inColumn);
    const outgoing = optionalNumber(ctx, row, q.outColumn);
    if (incoming === undefined) {
      if (outgoing === undefined) throw new RowFailure('required', q.inColumn);
      quantity = outgoing.abs().negated();
    } else {
      quantity =
        outgoing === undefined
          ? incoming.abs()
          : incoming.abs().minus(outgoing.abs());
    }
  } else {
    const amount = number(ctx, row, q.column).abs();
    const side = row.get(q.sideColumn).toLowerCase();
    quantity = q.outValues.some((v) => v.toLowerCase() === side)
      ? amount.negated()
      : amount;
  }

  let fee: Decimal | undefined;
  let feeAsset: string | undefined;
  if (mapping.fee) {
    const value = optionalNumber(ctx, row, mapping.fee.column);
    if (value !== undefined && !value.isZero()) {
      fee = value.abs();
      const rawFeeAsset = mapping.fee.assetColumn
        ? row.get(mapping.fee.assetColumn)
        : '';
      const normalised =
        rawFeeAsset === '' ? asset : normaliseAsset(ctx.spec, rawFeeAsset);
      feeAsset = normalised === asset ? undefined : normalised;
    }
  }

  const { kind, rawType } = kindOf(ctx.spec, row);
  const group = mapping.group ? row.get(mapping.group.column) : '';
  const note = mapping.note ? row.get(mapping.note.column) : '';
  return {
    id: `${ctx.file.id}:${row.row}`,
    sourceFileId: ctx.file.id,
    row: row.row,
    raw: row.raw(),
    platform: ctx.spec.platform,
    accountId: valueOf(row, mapping.account) || DEFAULT_ACCOUNT,
    timestamp,
    asset,
    quantity,
    kind,
    fee,
    feeAsset,
    priceChf: optionalNumber(ctx, row, mapping.priceChf?.column),
    priceUsd: optionalNumber(ctx, row, mapping.priceUsd?.column),
    group: group || undefined,
    note: note || undefined,
    rawType,
    rawAsset: rawAsset.trim() === asset ? undefined : rawAsset.trim(),
  };
}

function holdingAsOf(ctx: Context, row: TableRow): string {
  const asOf = ctx.spec.holdings?.asOf;
  if (asOf?.column) {
    const text = row.get(asOf.column);
    if (text !== '') {
      try {
        const { parts } = parseDateTime(text, asOf.format);
        return toUtcIso(parts).slice(0, 10);
      } catch {
        throw new RowFailure('invalidDate', asOf.column);
      }
    }
  }
  if (asOf?.value && isIsoDate(asOf.value)) return asOf.value;
  throw new RowFailure('required', asOf?.column ?? 'asOf');
}

function holdingFromRow(ctx: Context, row: TableRow, asOf: string): Holding {
  const mapping = ctx.spec.holdings;
  if (!mapping) throw new Error('no holdings mapping');
  const rawAsset = row.get(mapping.asset.column);
  if (rawAsset === '') throw new RowFailure('required', mapping.asset.column);
  return {
    id: `${ctx.file.id}:${row.row}:holding`,
    sourceFileId: ctx.file.id,
    row: row.row,
    raw: row.raw(),
    platform: ctx.spec.platform,
    accountId: valueOf(row, mapping.account) || DEFAULT_ACCOUNT,
    asset: normaliseAsset(ctx.spec, rawAsset),
    quantity: number(ctx, row, mapping.quantity.column),
    asOf,
    evidence: valueOf(row, mapping.evidence),
  };
}

/** Spec + file → standard records. Never throws on bad rows; throws only if the file does not match. */
export function applyMapping(
  spec: MappingSpec,
  file: SourceFile,
): ImportResult {
  const table = locate(spec, file);
  if (!table) {
    return {
      bookings: [],
      holdings: [],
      period: null,
      errors: [{ row: 0, code: 'headerNotFound' }],
      notes: [],
    };
  }
  const notes: ImportNote[] = [];
  const errors: RowError[] = [];
  const ctx: Context = {
    spec,
    file,
    numbers: spec.numbers,
    zone: zoneFor(spec, file, notes),
  };
  const bookings: Booking[] = [];
  const holdings: Holding[] = [];
  /** lastPerAsset: account|asset → [timestamp, row] of the latest row. */
  const latest = new Map<string, { timestamp: string; row: TableRow }>();
  const sheet = file.kind === 'xlsx' ? table.sheet.name : undefined;
  const fail = (row: number, error: unknown) => {
    if (error instanceof RowFailure) {
      errors.push({
        row,
        code: error.code,
        column: error.column,
        ...(sheet ? { sheet } : {}),
      });
    } else {
      throw error;
    }
  };

  for (const row of tableRows(table)) {
    if (excluded(spec, row)) {
      notes.push({ code: 'excluded', row: row.row });
      continue;
    }
    let booking: Booking | undefined;
    if (spec.bookings) {
      try {
        booking = bookingFromRow(ctx, row);
        bookings.push(booking);
      } catch (error) {
        fail(row.row, error);
        continue;
      }
    }
    const holdingSpec = spec.holdings;
    if (!holdingSpec) continue;
    try {
      if (holdingSpec.mode === 'rows') {
        holdings.push(holdingFromRow(ctx, row, holdingAsOf(ctx, row)));
      } else if (booking) {
        // Keyed by the asset as written: a running balance is per raw asset (`DOT` and `DOT.S`
        // are two balances on Kraken even though both map to DOT).
        const key = `${booking.accountId}|${row.get(holdingSpec.asset.column)}`;
        const previous = latest.get(key);
        // Later timestamp wins; on a tie the later row (ledgers list an event's rows in order).
        if (!previous || booking.timestamp >= previous.timestamp) {
          latest.set(key, { timestamp: booking.timestamp, row });
        }
      }
    } catch (error) {
      fail(row.row, error);
    }
  }

  for (const [, { timestamp, row }] of [...latest.entries()].sort(([a], [b]) =>
    compareText(a, b),
  )) {
    try {
      holdings.push(holdingFromRow(ctx, row, timestamp.slice(0, 10)));
    } catch (error) {
      fail(row.row, error);
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
    notes,
  };
}

/** A stored mapping as an importer for the registry (auto-matching on upload). */
export function mappingImporter(id: string, spec: MappingSpec): Importer {
  return {
    id: `mapping:${id}`,
    platform: spec.platform,
    fileKinds: ['csv', 'xlsx'],
    detect: (file) => mappingConfidence(spec, file),
    parse: (file) => applyMapping(spec, file),
  };
}
