import { type Booking, type Holding, isIncome } from '../bookings/booking';
import {
  applyCorrections,
  type Correction,
  isCorrectionRecord,
} from '../corrections/corrections';
import {
  type Decimal,
  parseDecimal,
  toDecimalString,
  ZERO,
} from '../money/decimal';
import { type RateEntry, RateTable, unitPriceChf } from '../rates/rate-table';
import type { CountryRules } from '../rules/country-rules';
import {
  accountKey,
  ledgerBalances,
  positionsAt,
  statementBalances,
} from './balances';
import type { QuantitySource } from './types';

/**
 * Analyses over any date or range — for the dashboard (F11.4 ff.) and other views that need
 * balances and flows beyond 31.12. Same rules as the calculation (statements take precedence
 * per account on their date, else the ledger; manual holdings replace their asset; dust
 * dropped), same corrections. Pure and deterministic; quantities are decimal strings.
 */

export interface AnalysisInput {
  readonly rules: CountryRules;
  readonly bookings: readonly Booking[];
  readonly holdings: readonly Holding[];
  readonly corrections?: readonly Correction[];
}

export interface BalanceAt {
  readonly platform: string;
  readonly accountId: string;
  readonly asset: string;
  readonly quantity: string;
  readonly source: QuantitySource;
  readonly recordIds: readonly string[];
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The day after an ISO date, as the exclusive timestamp bound of that day (UTC). */
function endOfDay(date: string): string {
  const next = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000);
  return next.toISOString();
}

interface Prepared {
  readonly bookings: readonly Booking[];
  readonly statements: readonly Holding[];
  readonly manual: readonly Holding[];
  readonly dust: Decimal;
}

function prepare(input: AnalysisInput): Prepared {
  const corrected = applyCorrections(
    input.bookings,
    input.holdings,
    input.corrections ?? [],
    input.rules.homeCurrency,
  );
  const bookings = [...corrected.bookings].sort(
    (a, b) => compareText(a.timestamp, b.timestamp) || compareText(a.id, b.id),
  );
  const sources = new Set(
    bookings.map(
      (b) => `${b.sourceFileId}|${accountKey(b.platform, b.accountId)}`,
    ),
  );
  const statements: Holding[] = [];
  const manual: Holding[] = [];
  for (const holding of corrected.holdings) {
    if (isCorrectionRecord(holding.sourceFileId)) manual.push(holding);
    else if (
      !sources.has(
        `${holding.sourceFileId}|${accountKey(holding.platform, holding.accountId)}`,
      )
    )
      statements.push(holding);
  }
  return {
    bookings,
    statements,
    manual,
    dust: parseDecimal(input.rules.dustThreshold),
  };
}

function balancesOn(prepared: Prepared, date: string): BalanceAt[] {
  return positionsAt(
    ledgerBalances(prepared.bookings, endOfDay(date)),
    statementBalances(prepared.statements, date),
    statementBalances(prepared.manual, date),
    prepared.dust,
  ).map((p) => ({
    platform: p.platform,
    accountId: p.accountId,
    asset: p.asset,
    quantity: toDecimalString(p.quantity),
    source: p.source,
    recordIds: p.ids,
  }));
}

/** Balances per platform/account and asset at the end of `date` (ISO, UTC). */
export function balancesAt(input: AnalysisInput, date: string): BalanceAt[] {
  return balancesOn(prepare(input), date);
}

export interface DailyBalances {
  readonly date: string;
  /** `platform|account|asset` → quantity (decimal string); zero balances are left out. */
  readonly balances: Readonly<Record<string, string>>;
}

/**
 * Balances at the end of every day from `from` to `to` (inclusive, at most 3700 days) in one
 * sweep over the bookings — cheap enough for a chart. Statement and manual balances replace the
 * ledger for their account (resp. asset) on the day they are dated, as in `balancesAt`.
 */
export function dailyBalances(
  input: AnalysisInput,
  from: string,
  to: string,
): DailyBalances[] {
  const prepared = prepare(input);
  const days: string[] = [];
  for (
    let t = Date.parse(`${from}T00:00:00Z`);
    t <= Date.parse(`${to}T00:00:00Z`) && days.length < 3700;
    t += 86_400_000
  ) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  const datedAccounts = new Set(
    [...prepared.statements, ...prepared.manual].map((h) => h.asOf),
  );
  const ledger = new Map<string, Decimal>();
  let index = 0;
  const out: DailyBalances[] = [];
  for (const day of days) {
    const bound = endOfDay(day);
    while (index < prepared.bookings.length) {
      const booking = prepared.bookings[index] as Booking;
      if (booking.timestamp >= bound) break;
      const key = `${booking.platform}|${booking.accountId}|${booking.asset}`;
      ledger.set(key, (ledger.get(key) ?? ZERO).plus(booking.quantity));
      if (booking.fee && !booking.fee.isZero()) {
        const feeKey = `${booking.platform}|${booking.accountId}|${booking.feeAsset ?? booking.asset}`;
        ledger.set(feeKey, (ledger.get(feeKey) ?? ZERO).minus(booking.fee));
      }
      index += 1;
    }
    if (datedAccounts.has(day)) {
      // A statement day: the full rule (statements and manual balances win).
      const balances: Record<string, string> = {};
      for (const b of balancesOn(prepared, day))
        balances[`${b.platform}|${b.accountId}|${b.asset}`] = b.quantity;
      out.push({ date: day, balances });
      continue;
    }
    const balances: Record<string, string> = {};
    for (const key of [...ledger.keys()].sort(compareText)) {
      const quantity = ledger.get(key) as Decimal;
      if (quantity.abs().gte(prepared.dust))
        balances[key] = toDecimalString(quantity);
    }
    out.push({ date: day, balances });
  }
  return out;
}

export interface Flows {
  readonly platform: string;
  readonly accountId: string;
  readonly asset: string;
  /** Deposits (positive). */
  readonly deposits: string;
  /** Withdrawals (as a positive amount). */
  readonly withdrawals: string;
  /** Income bookings (F7.2 kinds), gross quantity. */
  readonly income: string;
  /** Fees in this asset (fee bookings and fees of other bookings), positive. */
  readonly fees: string;
  /** Losses (as a positive amount). */
  readonly losses: string;
  /** Trades (signed: bought − sold). */
  readonly trades: string;
  readonly recordIds: readonly string[];
}

/**
 * In/out flows per platform/account and asset over [from, to] (ISO dates, inclusive, UTC):
 * deposits, withdrawals, income, fees, losses and the net of trades, each with its records.
 */
export function flowsBetween(
  input: AnalysisInput,
  from: string,
  to: string,
): Flows[] {
  const { bookings } = prepare(input);
  const start = `${from}T00:00:00.000Z`;
  const end = endOfDay(to);
  const byKey = new Map<
    string,
    {
      platform: string;
      accountId: string;
      asset: string;
      deposits: Decimal;
      withdrawals: Decimal;
      income: Decimal;
      fees: Decimal;
      losses: Decimal;
      trades: Decimal;
      ids: string[];
    }
  >();
  const entry = (platform: string, accountId: string, asset: string) => {
    const key = `${platform}|${accountId}|${asset}`;
    let found = byKey.get(key);
    if (!found) {
      found = {
        platform,
        accountId,
        asset,
        deposits: ZERO,
        withdrawals: ZERO,
        income: ZERO,
        fees: ZERO,
        losses: ZERO,
        trades: ZERO,
        ids: [],
      };
      byKey.set(key, found);
    }
    return found;
  };
  for (const b of bookings) {
    if (b.timestamp < start || b.timestamp >= end) continue;
    const e = entry(b.platform, b.accountId, b.asset);
    e.ids.push(b.id);
    if (b.kind === 'deposit') e.deposits = e.deposits.plus(b.quantity);
    else if (b.kind === 'withdrawal')
      e.withdrawals = e.withdrawals.plus(b.quantity.abs());
    else if (isIncome(b.kind)) e.income = e.income.plus(b.quantity);
    else if (b.kind === 'fee') e.fees = e.fees.plus(b.quantity.abs());
    else if (b.kind === 'loss') e.losses = e.losses.plus(b.quantity.abs());
    else if (b.kind === 'trade') e.trades = e.trades.plus(b.quantity);
    if (b.fee && !b.fee.isZero()) {
      const f = entry(b.platform, b.accountId, b.feeAsset ?? b.asset);
      f.fees = f.fees.plus(b.fee);
      if (f !== e) f.ids.push(b.id);
    }
  }
  return [...byKey.values()]
    .sort(
      (a, b) =>
        compareText(a.platform, b.platform) ||
        compareText(a.accountId, b.accountId) ||
        compareText(a.asset, b.asset),
    )
    .map((e) => ({
      platform: e.platform,
      accountId: e.accountId,
      asset: e.asset,
      deposits: toDecimalString(e.deposits),
      withdrawals: toDecimalString(e.withdrawals),
      income: toDecimalString(e.income),
      fees: toDecimalString(e.fees),
      losses: toDecimalString(e.losses),
      trades: toDecimalString(e.trades),
      recordIds: e.ids,
    }));
}

/**
 * CHF per unit of an asset for every day in [from, to], by the same price priority as the
 * calculation (null where there is none) — from the stored daily series, no network.
 */
export function dailyPricesChf(
  rates: readonly RateEntry[],
  rules: CountryRules,
  asset: string,
  from: string,
  to: string,
): { readonly date: string; readonly priceChf: string | null }[] {
  const table = new RateTable(rates, rules.homeCurrency);
  const out: { date: string; priceChf: string | null }[] = [];
  for (
    let t = Date.parse(`${from}T00:00:00Z`);
    t <= Date.parse(`${to}T00:00:00Z`) && out.length < 3700;
    t += 86_400_000
  ) {
    const date = new Date(t).toISOString().slice(0, 10);
    const quote = unitPriceChf(table, rules, asset, date);
    out.push({
      date,
      priceChf: quote ? toDecimalString(quote.priceChf) : null,
    });
  }
  return out;
}
