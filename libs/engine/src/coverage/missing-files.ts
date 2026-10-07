import type { Booking, Holding } from '../bookings/booking';
import { ledgerBalances } from '../calculation/balances';
import { parseDecimal, toDecimalString, ZERO } from '../money/decimal';

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
  /**
   * The net change per asset over the file's bookings of this account (Σ quantity − Σ fee, a fee
   * in another asset reduces that asset), as decimal strings. Absent on entries stored before it
   * existed — then "is the account empty?" is unknown.
   */
  readonly net?: Readonly<Record<string, string>>;
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
    const key = `${platform}|${accountId}`;
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
  const ledger = ledgerBalances(bookings, '9999-12-31T23:59:59.999Z');
  return [...byKey.entries()]
    .sort(
      ([, a], [, b]) =>
        compareText(a.platform, b.platform) ||
        compareText(a.accountId, b.accountId),
    )
    .map(([key, { dates, ...rest }]) => {
      const account = ledger.get(key);
      const base = { ...rest, holdingDates: [...dates].sort() };
      if (rest.bookings === 0) return base;
      const net: Record<string, string> = {};
      for (const asset of [...(account?.keys() ?? [])].sort(compareText)) {
        net[asset] = toDecimalString(account?.get(asset)?.quantity ?? ZERO);
      }
      return { ...base, net };
    });
}

export const MISSING_FILE_KINDS = [
  /** No booking inside the tax year at all — the history ends before 01.01. ("Fehlende Datei"). */
  'noYearData',
  /** Bookings start after 01.01. of the tax year. */
  'startsLate',
  /** Bookings end before 31.12. of the tax year. */
  'endsEarly',
  /** No statement balance at 31.12. of the tax year (per platform, or per account). */
  'noYearEndBalance',
] as const;
export type MissingFileKind = (typeof MISSING_FILE_KINDS)[number];

export const HINT_SEVERITIES = ['info', 'warning', 'error'] as const;
export type HintSeverity = (typeof HINT_SEVERITIES)[number];

export interface MissingFileHint {
  /**
   * Stable across recalculations and re-uploads of the same situation (`<kind>:<platform>|<account>`,
   * or `noYearEndBalance:<platform>` for the whole platform) — dismissals are keyed by it.
   */
  readonly key: string;
  readonly platform: string;
  /** The account; '' when the hint is about the whole platform (see `accounts`). */
  readonly accountId: string;
  /** Every account the hint is about (sorted). */
  readonly accounts: readonly string[];
  readonly kind: MissingFileKind;
  readonly severity: HintSeverity;
  /** noYearData / endsEarly: last covered date; startsLate: first covered date. */
  readonly date?: string;
  /**
   * endsEarly / noYearData: every asset of the account is (near) zero after its last booking —
   * nothing can be missing after it, so the hint is only informational.
   */
  readonly zeroBalance?: boolean;
  /** i18n key telling where such an export is found (`files.missing.howTo.<kind>[Zero]`). */
  readonly hintKey: string;
}

interface MergedAccount {
  platform: string;
  accountId: string;
  from?: string;
  to?: string;
  /** Dates of statement balances (from files without bookings for this account). */
  statementDates: Set<string>;
  net: Map<string, ReturnType<typeof parseDecimal>>;
  /** false once a file with bookings has no `net` (stored before it existed). */
  netKnown: boolean;
}

/** Coverage hints per platform + account for the tax year, merged over all the project's files. */
export interface MissingFileOptions {
  /** |quantity| below this counts as zero (the country rules' dust threshold). */
  readonly dustThreshold?: string;
}

/**
 * Coverage gaps for the tax year, merged over all the project's files. Bookings before the tax
 * year count (a full history is fine).
 *
 * - An account whose history ends before 01.01. reports `noYearData` (a missing file), one that
 *   ends before 31.12. `endsEarly`; both are `info` only when the account's running balance at
 *   that date is zero (nothing can be missing after it), else `error` / `warning`.
 * - Year-end statements: a **statement** is a balance from a file without bookings for that
 *   account (a ledger's own running balance is not one). When a platform has statement balances
 *   at 31.12. under accounts its ledger does not use (one Kraken statement for spot + earn),
 *   the statement is platform-wide and covers every account. When it has none at all, there is
 *   **one** hint for the platform, not one per account. Accounts that are empty after a last
 *   booking before 31.12. need no statement.
 */
export function missingFileHints(
  taxYear: number,
  entries: readonly CoverageEntry[],
  options: MissingFileOptions = {},
): MissingFileHint[] {
  const yearStart = `${taxYear}-01-01`;
  const yearEnd = `${taxYear}-12-31`;
  const dust = parseDecimal(options.dustThreshold ?? '0.0000001');
  const merged = new Map<string, MergedAccount>();
  for (const entry of entries) {
    const key = `${entry.platform}|${entry.accountId}`;
    const m: MergedAccount = merged.get(key) ?? {
      platform: entry.platform,
      accountId: entry.accountId,
      statementDates: new Set<string>(),
      net: new Map(),
      netKnown: true,
    };
    if (
      entry.from !== undefined &&
      (m.from === undefined || entry.from < m.from)
    )
      m.from = entry.from;
    if (entry.to !== undefined && (m.to === undefined || entry.to > m.to))
      m.to = entry.to;
    if (entry.bookings === 0) {
      for (const date of entry.holdingDates) m.statementDates.add(date);
    } else if (entry.net === undefined) {
      m.netKnown = false;
    } else {
      for (const [asset, quantity] of Object.entries(entry.net)) {
        m.net.set(
          asset,
          (m.net.get(asset) ?? ZERO).plus(parseDecimal(quantity)),
        );
      }
    }
    merged.set(key, m);
  }

  const platforms = new Map<string, MergedAccount[]>();
  for (const m of merged.values()) {
    platforms.set(m.platform, [...(platforms.get(m.platform) ?? []), m]);
  }

  const hints: MissingFileHint[] = [];
  for (const platform of [...platforms.keys()].sort(compareText)) {
    const accounts = (platforms.get(platform) ?? []).sort((a, b) =>
      compareText(a.accountId, b.accountId),
    );
    const isEmpty = (m: MergedAccount) =>
      m.netKnown && [...m.net.values()].every((q) => q.abs().lt(dust));
    /** Ended before 31.12. with nothing left: no statement needed. */
    const closed = new Set<string>();

    for (const m of accounts) {
      if (m.from === undefined || m.to === undefined) continue;
      const base = {
        platform,
        accountId: m.accountId,
        accounts: [m.accountId],
      };
      const zero = m.to < yearEnd && isEmpty(m);
      if (zero) closed.add(m.accountId);
      if (m.to < yearStart) {
        hints.push({
          ...base,
          key: `noYearData:${platform}|${m.accountId}`,
          kind: 'noYearData',
          severity: zero ? 'info' : 'error',
          date: m.to,
          ...(zero ? { zeroBalance: true } : {}),
          hintKey: `files.missing.howTo.noYearData${zero ? 'Zero' : ''}`,
        });
        continue;
      }
      if (m.from > yearStart) {
        hints.push({
          ...base,
          key: `startsLate:${platform}|${m.accountId}`,
          kind: 'startsLate',
          severity: 'warning',
          date: m.from,
          hintKey: 'files.missing.howTo.startsLate',
        });
      }
      if (m.to < yearEnd) {
        hints.push({
          ...base,
          key: `endsEarly:${platform}|${m.accountId}`,
          kind: 'endsEarly',
          severity: zero ? 'info' : 'warning',
          date: m.to,
          ...(zero ? { zeroBalance: true } : {}),
          hintKey: `files.missing.howTo.endsEarly${zero ? 'Zero' : ''}`,
        });
      }
    }

    const ledgerAccounts = new Set(
      accounts.filter((m) => m.from !== undefined).map((m) => m.accountId),
    );
    const withStatement = new Set(
      accounts
        .filter((m) => m.statementDates.has(yearEnd))
        .map((m) => m.accountId),
    );
    const needing = accounts
      .map((m) => m.accountId)
      .filter((id) => !closed.has(id) && !withStatement.has(id));
    if (needing.length === 0) continue;
    if (withStatement.size === 0) {
      const [only] = needing;
      hints.push({
        key: `noYearEndBalance:${platform}`,
        platform,
        accountId: needing.length === 1 && only !== undefined ? only : '',
        accounts: needing,
        kind: 'noYearEndBalance',
        severity: 'warning',
        hintKey: 'files.missing.howTo.noYearEndBalance',
      });
      continue;
    }
    const platformWide = [...withStatement].every(
      (id) => !ledgerAccounts.has(id),
    );
    if (platformWide) continue;
    for (const accountId of needing) {
      hints.push({
        key: `noYearEndBalance:${platform}|${accountId}`,
        platform,
        accountId,
        accounts: [accountId],
        kind: 'noYearEndBalance',
        severity: 'warning',
        hintKey: 'files.missing.howTo.noYearEndBalance',
      });
    }
  }
  return hints;
}
