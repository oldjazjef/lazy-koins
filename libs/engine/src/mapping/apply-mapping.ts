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
  /** The timestamp column actually used (`timestamp.headerPattern` may pick it from the header). */
  readonly timestampColumn: string;
}

/** A number cell, `''` when empty or one of `numbers.nullValues` (`-`). */
function numberText(ctx: Context, row: TableRow, column: string): string {
  const text = row.get(column);
  return ctx.spec.numbers.nullValues?.includes(text) ? '' : text;
}

function parseNumberText(ctx: Context, text: string, column: string): Decimal {
  const value = parseNumber(text, ctx.numbers);
  if (value === undefined) throw new RowFailure('invalidNumber', column);
  return value;
}

function number(ctx: Context, row: TableRow, column: string): Decimal {
  const text = numberText(ctx, row, column);
  if (text === '') throw new RowFailure('required', column);
  return parseNumberText(ctx, text, column);
}

function optionalNumber(
  ctx: Context,
  row: TableRow,
  column: string | undefined,
): Decimal | undefined {
  if (column === undefined || numberText(ctx, row, column) === '')
    return undefined;
  return number(ctx, row, column);
}

/** The text a spec names: a column (optionally cut by a regex's first group) or a constant. */
function extracted(
  row: TableRow,
  source: { column?: string; pattern?: string; value?: string },
): string {
  let text = source.column === undefined ? '' : row.get(source.column);
  if (text !== '' && source.pattern !== undefined) {
    text = (new RegExp(source.pattern, 'i').exec(text)?.[1] ?? '').trim();
  }
  return text !== '' ? text : (source.value ?? '');
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

interface KindDecision {
  readonly kind: BookingKind;
  readonly rawType: string;
  /** The kind columns' values joined by "|" (what `pattern` rules test). */
  readonly joined: string;
  readonly direction?: 'in' | 'out';
}

function kindOf(spec: MappingSpec, row: TableRow): KindDecision {
  const rule = spec.bookings?.kind;
  if (!rule) return { kind: 'unknown', rawType: '', joined: '' };
  const values = rule.columns.map((column) => row.get(column));
  const rawType = values.filter((value) => value !== '').join('/');
  const joined = values.join('|');
  for (const candidate of rule.rules) {
    let hit = false;
    if (candidate.equals) {
      hit =
        candidate.equals.length <= values.length &&
        candidate.equals.every((expected, index) => {
          if (expected === '*') return true;
          return (
            (values[index] ?? '').toLowerCase() ===
            expected.trim().toLowerCase()
          );
        });
    } else if (candidate.pattern) {
      hit = new RegExp(candidate.pattern, 'i').test(joined);
    }
    if (hit) {
      return {
        kind: candidate.kind,
        rawType,
        joined,
        ...(candidate.direction ? { direction: candidate.direction } : {}),
      };
    }
  }
  return { kind: rule.default, rawType, joined };
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

/**
 * The timestamp column: the first header matching `timestamp.headerPattern` (KuCoin writes the
 * zone into it, "Time(UTC+08:00)"), else `timestamp.column`; plus the zone that header names.
 */
function timestampColumnOf(
  spec: MappingSpec,
  table: Table,
): { column: string; zone?: string } {
  const timestamp = spec.bookings?.timestamp;
  if (!timestamp) return { column: '' };
  if (timestamp.headerPattern) {
    const pattern = new RegExp(timestamp.headerPattern, 'i');
    for (const header of table.header) {
      const match = pattern.exec(header);
      if (!match) continue;
      const captured = match[1]?.trim();
      const zone =
        captured !== undefined && fixedOffset(captured) !== undefined
          ? captured
          : undefined;
      return zone === undefined ? { column: header } : { column: header, zone };
    }
  }
  return { column: timestamp.column };
}

/** The zone of the file's wall-clock times: from its name when the spec says so, else fixed. */
function zoneFor(
  spec: MappingSpec,
  file: SourceFile,
  notes: ImportNote[],
  headerZone?: string,
): string {
  const timestamp = spec.bookings?.timestamp;
  if (!timestamp) return 'UTC';
  if (headerZone !== undefined) return headerZone;
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

type BookingsMapping = NonNullable<MappingSpec['bookings']>;
type CounterLeg = Extract<
  NonNullable<BookingsMapping['counter']>,
  { asset: unknown }
>;

/** The fee of a leg: absolute value, and its asset only when it differs from the leg's. */
function feeOf(
  ctx: Context,
  row: TableRow,
  source: { column: string; assetColumn?: string } | undefined,
  asset: string,
): { fee?: Decimal; feeAsset?: string } {
  if (!source) return {};
  const value = optionalNumber(ctx, row, source.column);
  if (value === undefined || value.isZero()) return {};
  const rawFeeAsset = source.assetColumn ? row.get(source.assetColumn) : '';
  const normalised =
    rawFeeAsset === '' ? asset : normaliseAsset(ctx.spec, rawFeeAsset);
  return normalised === asset
    ? { fee: value.abs() }
    : { fee: value.abs(), feeAsset: normalised };
}

/** The counter rule for this row: the first whose `when` matches the main leg. */
function counterRuleFor(
  mapping: BookingsMapping,
  decision: KindDecision,
): CounterLeg | undefined {
  const counter = mapping.counter;
  if (counter === undefined) return undefined;
  const rules = Array.isArray(counter) ? counter : [counter];
  return rules.find(
    (rule) =>
      rule.when.kinds.includes(decision.kind) &&
      (rule.when.pattern === undefined ||
        new RegExp(rule.when.pattern, 'i').test(decision.joined)),
  );
}

/**
 * The second leg of a row (`bookings.counter`): same time, row, kind and group, its own asset,
 * amount, fee and account. `undefined` when the row has no amount for it (empty or 0).
 */
function counterBooking(
  ctx: Context,
  row: TableRow,
  main: Booking,
  rule: CounterLeg,
): Booking | undefined {
  const quantityColumn = rule.quantity.column;
  let text = numberText(ctx, row, quantityColumn);
  if (text !== '' && rule.quantity.pattern !== undefined) {
    text = (
      new RegExp(rule.quantity.pattern, 'i').exec(text)?.[1] ?? ''
    ).trim();
  }
  if (text === '') return undefined;
  const amount = parseNumberText(ctx, text, quantityColumn);
  if (amount.isZero()) return undefined;
  const rawAsset = extracted(row, rule.asset);
  if (rawAsset === '')
    throw new RowFailure('required', rule.asset.column ?? quantityColumn);
  const asset = normaliseAsset(ctx.spec, rawAsset);
  const quantity =
    rule.quantity.sign === 'signed'
      ? amount
      : main.quantity.isNegative()
        ? amount.abs()
        : amount.abs().negated();
  const { fee, feeAsset } = feeOf(ctx, row, rule.fee, asset);
  return {
    id: `${main.id}:counter`,
    sourceFileId: main.sourceFileId,
    row: main.row,
    raw: main.raw,
    platform: main.platform,
    accountId: valueOf(row, rule.account) || main.accountId,
    timestamp: main.timestamp,
    asset,
    quantity,
    kind: main.kind,
    fee,
    feeAsset,
    group: main.group,
    note: main.note,
    rawType: main.rawType,
    rawAsset: rawAsset.trim() === asset ? undefined : rawAsset.trim(),
  };
}

/** One row → its booking, plus the counter leg when the spec has one for this row. */
function bookingsFromRow(ctx: Context, row: TableRow): Booking[] {
  const mapping = ctx.spec.bookings;
  if (!mapping) throw new Error('no bookings mapping');
  const decision = kindOf(ctx.spec, row);
  const rule = counterRuleFor(mapping, decision);
  const main = bookingFromRow(ctx, row, decision);
  if (!rule) return [main];
  const counter = counterBooking(ctx, row, main, rule);
  if (!counter) return [main];
  // The two legs of one row belong together even when the export has no group column.
  const group = main.group ?? `${ctx.file.id}:${row.row}`;
  return [
    { ...main, group },
    { ...counter, group },
  ];
}

function bookingFromRow(
  ctx: Context,
  row: TableRow,
  decision: KindDecision,
): Booking {
  const mapping = ctx.spec.bookings;
  if (!mapping) throw new Error('no bookings mapping');
  const timestampColumn = ctx.timestampColumn;
  const time = row.get(timestampColumn);
  if (time === '') throw new RowFailure('required', timestampColumn);
  let timestamp: string;
  try {
    timestamp = timestampToUtc(time, mapping.timestamp.format, ctx.zone);
  } catch {
    throw new RowFailure('invalidTimestamp', timestampColumn);
  }
  const rawAsset = extracted(row, mapping.asset);
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
    const amountColumn =
      q.fallbackColumn !== undefined && numberText(ctx, row, q.column) === ''
        ? q.fallbackColumn
        : q.column;
    const amount = number(ctx, row, amountColumn).abs();
    const side = row.get(q.sideColumn).toLowerCase();
    quantity = q.outValues.some((v) => v.toLowerCase() === side)
      ? amount.negated()
      : amount;
  }
  if (decision.direction === 'in') quantity = quantity.abs();
  else if (decision.direction === 'out') quantity = quantity.abs().negated();

  const { fee, feeAsset } = feeOf(ctx, row, mapping.fee, asset);

  const { kind, rawType } = decision;
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
    valueUsd: optionalNumber(ctx, row, mapping.valueUsd?.column),
    feeValueUsd: optionalNumber(ctx, row, mapping.feeValueUsd?.column),
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
  const timestampColumn = timestampColumnOf(spec, table);
  const ctx: Context = {
    spec,
    file,
    numbers: spec.numbers,
    zone: zoneFor(spec, file, notes, timestampColumn.zone),
    timestampColumn: timestampColumn.column,
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
        // The main leg first, then its counter leg (bookings.counter) — the running balance
        // (lastPerAsset) belongs to the main leg.
        const legs = bookingsFromRow(ctx, row);
        booking = legs[0];
        bookings.push(...legs);
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
