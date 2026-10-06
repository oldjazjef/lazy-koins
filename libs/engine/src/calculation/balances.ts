import type { Booking, Holding } from '../bookings/booking';
import { type Decimal, ZERO } from '../money/decimal';
import type { QuantitySource } from './types';

/**
 * Balances per platform/account and asset at a point in time — the building blocks of the
 * positions at 31.12. (F7.1) and of balances at any other date (dashboard, opening balance).
 * Pure; every balance keeps the ids of the records it was built from (F7.5).
 */

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function accountKey(platform: string, accountId: string): string {
  return `${platform}|${accountId}`;
}

export interface Balance {
  platform: string;
  accountId: string;
  asset: string;
  quantity: Decimal;
  ids: string[];
}

/** platform|account → asset → balance. */
export type Balances = Map<string, Map<string, Balance>>;

export function balanceOf(
  balances: Balances,
  platform: string,
  accountId: string,
  asset: string,
): Balance {
  const key = accountKey(platform, accountId);
  let account = balances.get(key);
  if (!account) {
    account = new Map();
    balances.set(key, account);
  }
  let balance = account.get(asset);
  if (!balance) {
    balance = { platform, accountId, asset, quantity: ZERO, ids: [] };
    account.set(asset, balance);
  }
  return balance;
}

/** The fee of a booking and the asset it is charged in. */
export function feeOf(
  booking: Booking,
): { fee: Decimal; asset: string } | undefined {
  if (booking.fee === undefined || booking.fee.isZero()) return undefined;
  return { fee: booking.fee, asset: booking.feeAsset ?? booking.asset };
}

/**
 * Ledger balances (FACHREGELN, Kraken): Σ quantity − Σ fee per account and asset over every
 * booking before `before` (an ISO timestamp, exclusive).
 */
export function ledgerBalances(
  bookings: readonly Booking[],
  before: string,
): Balances {
  const balances: Balances = new Map();
  for (const booking of bookings) {
    if (booking.timestamp >= before) continue;
    const own = balanceOf(
      balances,
      booking.platform,
      booking.accountId,
      booking.asset,
    );
    own.quantity = own.quantity.plus(booking.quantity);
    own.ids.push(booking.id);
    const fee = feeOf(booking);
    if (fee) {
      const charged = balanceOf(
        balances,
        booking.platform,
        booking.accountId,
        fee.asset,
      );
      charged.quantity = charged.quantity.minus(fee.fee);
      if (charged !== own) charged.ids.push(booking.id);
    }
  }
  return balances;
}

/**
 * Statement balances at a date: per account, the holdings of one file (several rows of an asset
 * add up — e.g. `DOT` and `DOT.S`). When several files state the same account and date, the one
 * with most rows wins (then the smaller file id), so nothing is counted twice.
 */
export function statementBalances(
  holdings: readonly Holding[],
  date: string,
): Balances {
  const perFile = new Map<string, Map<string, Holding[]>>();
  for (const holding of holdings) {
    if (holding.asOf !== date) continue;
    const key = accountKey(holding.platform, holding.accountId);
    const files = perFile.get(key) ?? new Map<string, Holding[]>();
    const list = files.get(holding.sourceFileId) ?? [];
    list.push(holding);
    files.set(holding.sourceFileId, list);
    perFile.set(key, files);
  }
  const balances: Balances = new Map();
  for (const files of perFile.values()) {
    const chosen = [...files.entries()].sort(
      ([a, la], [b, lb]) => lb.length - la.length || compareText(a, b),
    )[0];
    if (!chosen) continue;
    for (const holding of chosen[1]) {
      const balance = balanceOf(
        balances,
        holding.platform,
        holding.accountId,
        holding.asset,
      );
      balance.quantity = balance.quantity.plus(holding.quantity);
      balance.ids.push(holding.id);
    }
  }
  return balances;
}

/** Statement balances with manual holdings (F9.3) replacing their asset. */
export function overlay(statements: Balances, manual: Balances): Balances {
  const out: Balances = new Map();
  for (const [key, account] of statements) out.set(key, new Map(account));
  for (const [key, account] of manual) {
    const target = out.get(key) ?? new Map<string, Balance>();
    for (const [asset, balance] of account) target.set(asset, balance);
    out.set(key, target);
  }
  return out;
}

export interface RawPosition {
  platform: string;
  accountId: string;
  asset: string;
  quantity: Decimal;
  source: QuantitySource;
  ids: string[];
}

/**
 * Platforms whose statement is **platform-wide**: it states balances only under accounts the
 * ledger does not use (one Kraken statement for spot + earn sub-accounts). Such a statement
 * replaces the ledger of every account of the platform — the same rule as the F5.8 hints.
 * Returns platform → { statement account keys, ledger account keys }, sorted.
 */
export function platformWideStatements(
  ledger: Balances,
  statements: Balances,
): Map<string, { statements: string[]; ledgers: string[] }> {
  const platformOf = (account: Map<string, Balance>) =>
    account.values().next().value?.platform;
  const byPlatform = new Map<
    string,
    { statements: string[]; ledgers: string[] }
  >();
  const entry = (platform: string) => {
    let found = byPlatform.get(platform);
    if (!found) {
      found = { statements: [], ledgers: [] };
      byPlatform.set(platform, found);
    }
    return found;
  };
  for (const [key, account] of statements) {
    const platform = platformOf(account);
    if (platform !== undefined) entry(platform).statements.push(key);
  }
  for (const [key, account] of ledger) {
    const platform = platformOf(account);
    if (platform !== undefined) entry(platform).ledgers.push(key);
  }
  const out = new Map<string, { statements: string[]; ledgers: string[] }>();
  for (const platform of [...byPlatform.keys()].sort(compareText)) {
    const { statements: s, ledgers: l } = byPlatform.get(platform) as {
      statements: string[];
      ledgers: string[];
    };
    if (s.length === 0 || l.length === 0) continue;
    if (s.some((key) => l.includes(key))) continue;
    out.set(platform, {
      statements: s.sort(compareText),
      ledgers: l.sort(compareText),
    });
  }
  return out;
}

/**
 * Positions at a date (F7.1): from the statement of an account when one exists for that date
 * (it takes precedence for the whole account), otherwise from the ledger; a platform-wide
 * statement (`platformWideStatements`) replaces the ledger of all the platform's accounts — no
 * double count. A manual holding (F9.3) replaces its asset. |quantity| below the dust threshold
 * is dropped.
 */
export function positionsAt(
  ledger: Balances,
  statements: Balances,
  manual: Balances,
  dust: Decimal,
): RawPosition[] {
  const out = new Map<string, RawPosition>();
  const replaced = new Set(
    [...platformWideStatements(ledger, statements).values()].flatMap(
      (p) => p.ledgers,
    ),
  );
  const accounts = new Set(
    [...ledger.keys(), ...statements.keys()].filter(
      (key) => !replaced.has(key),
    ),
  );
  for (const key of accounts) {
    const statement = statements.get(key);
    const source: QuantitySource = statement ? 'statement' : 'ledger';
    for (const balance of (
      statement ??
      ledger.get(key) ??
      new Map()
    ).values()) {
      out.set(`${key}|${balance.asset}`, {
        platform: balance.platform,
        accountId: balance.accountId,
        asset: balance.asset,
        quantity: balance.quantity,
        source,
        ids: [...balance.ids],
      });
    }
  }
  for (const [key, account] of manual) {
    for (const balance of account.values()) {
      out.set(`${key}|${balance.asset}`, {
        platform: balance.platform,
        accountId: balance.accountId,
        asset: balance.asset,
        quantity: balance.quantity,
        source: 'manual',
        ids: [...balance.ids],
      });
    }
  }
  return [...out.values()]
    .filter((p) => p.quantity.abs().gte(dust))
    .sort(
      (a, b) =>
        compareText(a.platform, b.platform) ||
        compareText(a.accountId, b.accountId) ||
        compareText(a.asset, b.asset),
    );
}
