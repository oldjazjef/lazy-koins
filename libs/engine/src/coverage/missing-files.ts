import type { Booking, Holding } from '../bookings/booking';

/** Code-point order — never locale-dependent (F7.6). */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * F5.8 "fehlende Dateien" — from the standard records alone, no platform knowledge: per
 * platform + account, which part of the tax year the files' bookings cover, and whether a balance
 * at year end (31.12.) exists to check the ledger against (F8.1).
 */

/** What one file contributes per platform + account (stored with the file, see the API). */
export interface CoverageEntry {
  readonly platform: string;
  readonly accountId: string;
  /** First and last booking date (ISO, UTC); absent when the file has only balances. */
  readonly from?: string;
  readonly to?: string;
  readonly bookings: number;
  /** Dates of the balances the file states for this account (sorted, unique). */
  readonly holdingDates: readonly string[];
}

/** Summarises a file's records into coverage entries, sorted by platform, then account. */
export function coverageOf(
  bookings: readonly Booking[],
  holdings: readonly Holding[],
): CoverageEntry[] {
  const byKey = new Map<
    string,
    {
      platform: string;
      accountId: string;
      from?: string;
      to?: string;
      bookings: number;
      dates: Set<string>;
    }
  >();
  const entry = (platform: string, accountId: string) => {
    const key = `${platform}\u0000${accountId}`;
    let found = byKey.get(key);
    if (!found) {
      found = { platform, accountId, bookings: 0, dates: new Set() };
      byKey.set(key, found);
    }
    return found;
  };
  for (const booking of bookings) {
    const e = entry(booking.platform, booking.accountId);
    const date = booking.timestamp.slice(0, 10);
    e.bookings += 1;
    if (e.from === undefined || date < e.from) e.from = date;
    if (e.to === undefined || date > e.to) e.to = date;
  }
  for (const holding of holdings)
    entry(holding.platform, holding.accountId).dates.add(holding.asOf);
  return [...byKey.values()]
    .sort(
      (a, b) =>
        compareText(a.platform, b.platform) ||
        compareText(a.accountId, b.accountId),
    )
    .map(({ dates, ...rest }) => ({
      ...rest,
      holdingDates: [...dates].sort(),
    }));
}

export const MISSING_FILE_KINDS = [
  /** Bookings start after 01.01. of the tax year (or after it entirely). */
  'startsLate',
  /** Bookings end before 31.12. of the tax year. */
  'endsEarly',
  /** No balance (statement) at 31.12. of the tax year for this account. */
  'noYearEndBalance',
] as const;
export type MissingFileKind = (typeof MISSING_FILE_KINDS)[number];

export interface MissingFileHint {
  readonly platform: string;
  readonly accountId: string;
  readonly kind: MissingFileKind;
  /** startsLate: first covered date; endsEarly: last covered date. */
  readonly date?: string;
  /** i18n key telling where such an export is found (`files.missing.howTo.<kind>`). */
  readonly hintKey: string;
}

/**
 * Coverage gaps for the tax year, per platform + account, merged over all the project's files.
 * Bookings before the tax year count (a full history is fine). A platform whose bookings all end
 * before the year starts is reported as ending early too.
 */
export function missingFileHints(
  taxYear: number,
  entries: readonly CoverageEntry[],
): MissingFileHint[] {
  const yearStart = `${taxYear}-01-01`;
  const yearEnd = `${taxYear}-12-31`;
  const merged = new Map<
    string,
    {
      platform: string;
      accountId: string;
      from?: string;
      to?: string;
      dates: Set<string>;
    }
  >();
  for (const entry of entries) {
    const key = `${entry.platform}\u0000${entry.accountId}`;
    const m = merged.get(key) ?? {
      platform: entry.platform,
      accountId: entry.accountId,
      dates: new Set<string>(),
    };
    if (
      entry.from !== undefined &&
      (m.from === undefined || entry.from < m.from)
    )
      m.from = entry.from;
    if (entry.to !== undefined && (m.to === undefined || entry.to > m.to))
      m.to = entry.to;
    for (const date of entry.holdingDates) m.dates.add(date);
    merged.set(key, m);
  }
  const hints: MissingFileHint[] = [];
  const sorted = [...merged.values()].sort(
    (a, b) =>
      compareText(a.platform, b.platform) ||
      compareText(a.accountId, b.accountId),
  );
  for (const m of sorted) {
    const base = { platform: m.platform, accountId: m.accountId };
    if (m.from !== undefined && m.to !== undefined) {
      if (m.from > yearStart) {
        hints.push({
          ...base,
          kind: 'startsLate',
          date: m.from,
          hintKey: 'files.missing.howTo.startsLate',
        });
      }
      if (m.to < yearEnd) {
        hints.push({
          ...base,
          kind: 'endsEarly',
          date: m.to,
          hintKey: 'files.missing.howTo.endsEarly',
        });
      }
    }
    if (!m.dates.has(yearEnd)) {
      hints.push({
        ...base,
        kind: 'noYearEndBalance',
        hintKey: 'files.missing.howTo.noYearEndBalance',
      });
    }
  }
  return hints;
}
