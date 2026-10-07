import type { Booking, BookingKind, Holding } from '../bookings/booking';
import {
  applyCorrections,
  type Correction,
  CORRECTION_SOURCE_PREFIX,
  isCorrectionRecord,
} from '../corrections/corrections';
import { type Decimal, toDecimalString } from '../money/decimal';
import { type RateEntry, RateTable, unitPriceChf } from '../rates/rate-table';
import type { CountryRules } from '../rules/country-rules';
import {
  BOOKING_COLUMNS,
  columnNames,
  HOLDING_COLUMNS,
} from './standard-format';

/**
 * F10.7: a project's records as the **standard format** again — the template's columns, so the
 * file re-imports unchanged (round trip), plus information columns the importer ignores:
 * applied corrections, the CHF price the calculation uses with its source, the value, and where
 * the record came from (file + row). Corrections are applied (a reclassified booking carries its
 * new kind; manual records are included). Pure; amounts are decimal strings, never rounded.
 */

export const EXPORT_EXTRA_COLUMNS = {
  originalType: 'Typ (Original)',
  corrections: 'Korrekturen',
  priceChf: 'Kurs CHF verwendet',
  priceSource: 'Kursquelle',
  valueChf: 'Wert CHF',
  sourceFile: 'Quelldatei',
  row: 'Zeile',
} as const;

/**
 * F11.2: the information columns in English. Only these are translated — the standard format's
 * own columns are a file format (German names) and stay, so the file re-imports in any language.
 */
export const EXPORT_EXTRA_COLUMNS_EN: Readonly<
  Record<keyof typeof EXPORT_EXTRA_COLUMNS, string>
> = {
  originalType: 'Type (original)',
  corrections: 'Corrections',
  priceChf: 'Price CHF used',
  priceSource: 'Price source',
  valueChf: 'Value CHF',
  sourceFile: 'Source file',
  row: 'Row',
};

/** Languages of the information columns (F11.2); anything else is German. */
export type StandardExportLanguage = 'de-CH' | 'en';

function extraColumnNames(
  language: StandardExportLanguage,
): Readonly<Record<keyof typeof EXPORT_EXTRA_COLUMNS, string>> {
  return language === 'en' ? EXPORT_EXTRA_COLUMNS_EN : EXPORT_EXTRA_COLUMNS;
}

/** The information columns with the project's tax currency in the names (F4.1a: "Wert EUR"). */
export function exportExtraColumns(
  currency: string,
  language: StandardExportLanguage = 'de-CH',
): readonly string[] {
  const names = extraColumnNames(language);
  return Object.values(names).map((name) =>
    name === names.priceChf || name === names.valueChf
      ? name.replace('CHF', currency)
      : name,
  );
}

export interface StandardExportFilter {
  readonly platform?: string;
  readonly accountId?: string;
  readonly asset?: string;
  /** Bookings only. */
  readonly kind?: BookingKind;
  /** ISO dates, inclusive (booking day in UTC, holding date). */
  readonly from?: string;
  readonly to?: string;
}

export interface StandardExportInput {
  readonly rules: CountryRules;
  readonly bookings: readonly Booking[];
  readonly holdings: readonly Holding[];
  readonly corrections: readonly Correction[];
  readonly rates: readonly RateEntry[];
  /** SHA-256 → file name, for the "Quelldatei" column. */
  readonly fileNames: Readonly<Record<string, string>>;
  readonly filter?: StandardExportFilter;
  /** F11.2: the language of the information columns; default German. */
  readonly language?: StandardExportLanguage;
}

export interface ExportTable {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export interface StandardExport {
  readonly bookings: ExportTable;
  readonly holdings: ExportTable;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const text = (value: Decimal | undefined) =>
  value === undefined ? '' : toDecimalString(value);

function matches(
  filter: StandardExportFilter,
  record: { platform: string; accountId: string; asset: string },
  date: string,
  kind?: BookingKind,
): boolean {
  if (filter.platform && record.platform !== filter.platform) return false;
  if (filter.accountId && record.accountId !== filter.accountId) return false;
  if (filter.asset && record.asset !== filter.asset.toUpperCase()) return false;
  if (filter.kind && kind !== filter.kind) return false;
  if (filter.from && date < filter.from) return false;
  if (filter.to && date > filter.to) return false;
  return true;
}

export function standardExport(input: StandardExportInput): StandardExport {
  const filter = input.filter ?? {};
  const corrected = applyCorrections(
    input.bookings,
    input.holdings,
    input.corrections,
    input.rules.homeCurrency,
  );
  const table = new RateTable(
    [...input.rates, ...corrected.rates],
    input.rules.homeCurrency,
  );
  const notes = new Map<string, string[]>();
  const note = (id: string, value: string) =>
    notes.set(id, [...(notes.get(id) ?? []), value]);
  for (const applied of corrected.applied) {
    if (applied.status !== 'applied') continue;
    if (applied.type === 'reclassify' && applied.before) {
      note(
        String(applied.before['bookingId']),
        `reclassify ${applied.correctionId}: ${String(applied.before['kind'])} → ${String(applied.after?.['kind'])}`,
      );
    }
  }
  const origin = (sourceFileId: string, id: string) =>
    isCorrectionRecord(sourceFileId)
      ? `${sourceFileId.slice(CORRECTION_SOURCE_PREFIX.length)}`
      : (notes.get(id) ?? []).join('; ');
  const fileOf = (sourceFileId: string) =>
    isCorrectionRecord(sourceFileId)
      ? input.language === 'en'
        ? 'Correction'
        : 'Korrektur'
      : (input.fileNames[sourceFileId] ?? sourceFileId);

  const bookings = [...corrected.bookings]
    .filter((b) => matches(filter, b, b.timestamp.slice(0, 10), b.kind))
    .sort(
      (a, b) =>
        compareText(a.timestamp, b.timestamp) || compareText(a.id, b.id),
    );
  const bookingRows = bookings.map((b) => {
    const quote = unitPriceChf(
      table,
      input.rules,
      b.asset,
      b.timestamp.slice(0, 10),
      { priceChf: b.priceChf, priceUsd: b.priceUsd },
    );
    return [
      b.timestamp,
      b.platform,
      b.accountId,
      b.kind,
      b.asset,
      toDecimalString(b.quantity),
      text(b.fee),
      b.fee ? (b.feeAsset ?? '') : '',
      text(b.priceChf),
      text(b.priceUsd),
      b.group ?? '',
      b.note ?? '',
      b.rawType,
      isCorrectionRecord(b.sourceFileId)
        ? `manual_booking ${origin(b.sourceFileId, b.id)}`
        : origin(b.sourceFileId, b.id),
      quote ? toDecimalString(quote.priceChf) : '',
      quote ? `${quote.origin}/${quote.source}` : '',
      quote ? toDecimalString(b.quantity.times(quote.priceChf)) : '',
      fileOf(b.sourceFileId),
      String(b.row),
    ];
  });

  const holdings = [...corrected.holdings]
    .filter((h) => matches(filter, h, h.asOf))
    .sort((a, b) => compareText(a.asOf, b.asOf) || compareText(a.id, b.id));
  const holdingRows = holdings.map((h) => {
    const quote = unitPriceChf(table, input.rules, h.asset, h.asOf, {
      priceChf: h.priceChf,
      priceUsd: h.priceUsd,
    });
    return [
      h.platform,
      h.accountId,
      h.asset,
      toDecimalString(h.quantity),
      h.asOf,
      text(h.priceChf),
      text(h.priceUsd),
      h.evidence ?? '',
      '',
      isCorrectionRecord(h.sourceFileId)
        ? `manual_holding ${origin(h.sourceFileId, h.id)}`
        : '',
      quote ? toDecimalString(quote.priceChf) : '',
      quote ? `${quote.origin}/${quote.source}` : '',
      quote ? toDecimalString(h.quantity.times(quote.priceChf)) : '',
      fileOf(h.sourceFileId),
      String(h.row),
    ];
  });

  const extras = exportExtraColumns(
    input.rules.homeCurrency,
    input.language ?? 'de-CH',
  );
  return {
    bookings: {
      header: [...columnNames(BOOKING_COLUMNS), ...extras],
      rows: bookingRows,
    },
    holdings: {
      header: [...columnNames(HOLDING_COLUMNS), ...extras],
      rows: holdingRows,
    },
  };
}
