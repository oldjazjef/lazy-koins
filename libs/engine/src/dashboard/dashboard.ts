import { type Booking, type Holding, isIncome } from '../bookings/booking';
import {
  applyCorrections,
  type Correction,
  isCorrectionRecord,
} from '../corrections/corrections';
import {
  type Decimal,
  EngineDecimal,
  parseDecimal,
  toDecimalString,
  ZERO,
} from '../money/decimal';
import {
  type OwnPrice,
  type RateEntry,
  RateTable,
  unitPriceChf,
} from '../rates/rate-table';
import type { CountryRules } from '../rules/country-rules';
import { dailyBalances } from '../calculation/analysis';
import { accountKey, statementBalances } from '../calculation/balances';
import { incomeLine, matchTransfers } from '../calculation/calculate';

/**
 * The dashboard (F11.4–F11.9): wealth over any period across ALL projects of a user — a pure
 * function of the same records, corrections and stored rates the tax calculation uses (F11.9,
 * no second calculation rule), plus three dashboard rules:
 *
 * 1. **One record set**: records are deduplicated by id (the same stored file in several
 *    projects has the same SHA-256, hence the same record ids — it counts once).
 * 2. **Corrections belong to the year of their project**: a correction counts only when the date
 *    it concerns (the reclassified booking's time, a manual booking's time, a manual holding's
 *    date, an override's date) falls into a year its project "owns" — the project of that tax
 *    year, else the newest project before it, else the oldest after it (`yearOwner`). The same
 *    for overrides and ESTV values among the stored rates (`dashboardRates`).
 * 3. **Accounts without bookings** (a wallet known only from statements or manual positions)
 *    keep their latest statement balance until the next one — otherwise they would only exist on
 *    the day of the statement. Accounts with bookings follow the ledger, statements win on their
 *    own date (as in `dailyBalances`).
 *
 * Missing prices are never 0 (F11.9): a day's total leaves such assets out and names them.
 * Amounts are decimal strings.
 */

export interface DashboardProject {
  readonly id: string;
  readonly taxYear: number;
}

export interface ProjectCorrection extends Correction {
  readonly projectId: string;
}

export interface ProjectRates {
  readonly projectId: string;
  readonly rates: readonly RateEntry[];
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The project whose corrections and overrides count for a calendar year (rule 2). */
export function yearOwner(
  projects: readonly DashboardProject[],
  year: number,
): string | undefined {
  const sorted = [...projects].sort(
    (a, b) => a.taxYear - b.taxYear || compareText(a.id, b.id),
  );
  const exact = sorted.find((p) => p.taxYear === year);
  if (exact) return exact.id;
  const before = sorted.filter((p) => p.taxYear < year).pop();
  if (before) return before.id;
  return sorted[0]?.id;
}

function yearOf(dateOrTimestamp: string): number {
  return Number(dateOrTimestamp.slice(0, 4));
}

/** Rule 2 for corrections: those whose date lies in a year their project owns. */
export function dashboardCorrections(
  projects: readonly DashboardProject[],
  corrections: readonly ProjectCorrection[],
  bookings: readonly Booking[],
): Correction[] {
  const timestampOf = new Map(bookings.map((b) => [b.id, b.timestamp]));
  const out: Correction[] = [];
  for (const correction of corrections) {
    const { data } = correction;
    const date =
      data.type === 'price_override'
        ? data.date
        : data.type === 'reclassify'
          ? timestampOf.get(data.bookingId)
          : data.type === 'manual_booking'
            ? data.booking.timestamp
            : data.holding.asOf;
    if (date === undefined) continue;
    if (yearOwner(projects, yearOf(date)) !== correction.projectId) continue;
    out.push({
      id: correction.id,
      createdAt: correction.createdAt,
      reason: correction.reason,
      data,
    });
  }
  return out;
}

/**
 * Rule 2 for rates: fetched series of every project count (they are market data); overrides
 * (`manual`) and ESTV values only from the project that owns their year. `shared` = the user's
 * own rate cache (series fetched for the dashboard).
 */
export function dashboardRates(
  projects: readonly DashboardProject[],
  perProject: readonly ProjectRates[],
  shared: readonly RateEntry[],
): RateEntry[] {
  const out: RateEntry[] = [];
  const seen = new Set<string>();
  const add = (entry: RateEntry) => {
    const key = `${entry.kind}|${entry.asset}|${entry.currency}|${entry.date}|${entry.source}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(entry);
  };
  const ordered = [...perProject].sort((a, b) =>
    compareText(a.projectId, b.projectId),
  );
  for (const { projectId, rates } of ordered) {
    for (const entry of rates) {
      const yearBound = entry.source === 'manual' || entry.source === 'estv';
      if (yearBound && yearOwner(projects, yearOf(entry.date)) !== projectId)
        continue;
      add(entry);
    }
  }
  for (const entry of shared) if (entry.source !== 'manual') add(entry);
  return out;
}

/** Records of several projects as one set: the first of each id wins (rule 1). */
export function uniqueRecords<T extends { readonly id: string }>(
  records: readonly T[],
): T[] {
  const seen = new Set<string>();
  return records.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

export interface DashboardInput {
  readonly rules: CountryRules;
  readonly bookings: readonly Booking[];
  readonly holdings: readonly Holding[];
  /** Already chosen per rule 2 (`dashboardCorrections`); undone ones left out. */
  readonly corrections: readonly Correction[];
  readonly rates: readonly RateEntry[];
  /** ISO dates, inclusive; at most 3660 days apart. */
  readonly from: string;
  readonly to: string;
  /** Points per sparkline (default 60). */
  readonly sparklinePoints?: number;
}

export interface DashboardPoint {
  readonly date: string;
  /** Σ quantity × CHF price of the day over the assets with a price. */
  readonly valueChf: string;
  /** Assets held that day without a price — left out of `valueChf`, never as 0. */
  readonly missing: readonly string[];
}

export const KPI_KINDS = [
  'deposits',
  'withdrawals',
  'income',
  'costs',
  'tradingFees',
] as const;
export type KpiKind = (typeof KPI_KINDS)[number];

export interface Kpi {
  readonly kind: KpiKind;
  readonly valueChf: string;
  /** Bookings behind the figure (F7.5). */
  readonly recordIds: readonly string[];
  /** Bookings of this figure without a price (not in `valueChf`). */
  readonly missingPrices: number;
}

export interface AllocationSlice {
  /** The asset, or `null` for "Andere" (everything after the largest seven). */
  readonly asset: string | null;
  readonly valueChf: string;
  /** Share of the priced total in percent, 2 decimals. */
  readonly sharePct: string;
  /** How many assets "Andere" holds (1 for a named slice). */
  readonly assets: number;
}

export interface DashboardAccount {
  readonly platform: string;
  readonly accountId: string;
  readonly quantity: string;
  readonly valueChf: string | null;
}

export type DashboardHoldingStatus = 'ok' | 'missingPrice' | 'negative';

export interface DashboardHolding {
  readonly asset: string;
  readonly quantity: string;
  /** CHF per unit at the period end (Stichtag), null = no price. */
  readonly priceChf: string | null;
  readonly valueChf: string | null;
  readonly status: DashboardHoldingStatus;
  /** CHF per unit over the period, evenly sampled; null = no price that day. */
  readonly sparkline: readonly (string | null)[];
  readonly accounts: readonly DashboardAccount[];
}

export interface DashboardResult {
  readonly from: string;
  readonly to: string;
  readonly series: readonly DashboardPoint[];
  /** Value at the end of the day before `from`. */
  readonly startValueChf: string;
  readonly endValueChf: string;
  readonly changeChf: string;
  /** Percent, 2 decimals; null when the start value is 0. */
  readonly changePct: string | null;
  readonly kpis: readonly Kpi[];
  /** Income in percent of the end value, 2 decimals; null when the end value is 0. */
  readonly incomeSharePct: string | null;
  readonly allocation: readonly AllocationSlice[];
  readonly holdings: readonly DashboardHolding[];
  /** Every asset held in the period that had no price on at least one day. */
  readonly missingPrices: readonly string[];
}

const DAY_MS = 86_400_000;
const NAMED_SLICES = 7;

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function daysOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (
    let t = Date.parse(`${from}T00:00:00Z`);
    t <= Date.parse(`${to}T00:00:00Z`) && out.length < 3700;
    t += DAY_MS
  ) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

function percent(part: Decimal, whole: Decimal): string | null {
  if (whole.isZero()) return null;
  return part
    .div(whole)
    .times(100)
    .toDecimalPlaces(2, EngineDecimal.ROUND_HALF_UP)
    .toFixed(2);
}

function splitKey(key: string): {
  platform: string;
  accountId: string;
  asset: string;
} {
  const last = key.lastIndexOf('|');
  const account = key.slice(0, last);
  const middle = account.indexOf('|');
  return {
    platform: account.slice(0, middle),
    accountId: account.slice(middle + 1),
    asset: key.slice(last + 1),
  };
}

export function dashboard(input: DashboardInput): DashboardResult {
  const { rules, from, to } = input;
  const dust = parseDecimal(rules.dustThreshold);
  const spamPattern = new RegExp(rules.spamPattern, 'i');
  const corrected = applyCorrections(
    uniqueRecords(input.bookings),
    uniqueRecords(input.holdings),
    input.corrections,
  );
  const bookings = [...corrected.bookings].sort(
    (a, b) => compareText(a.timestamp, b.timestamp) || compareText(a.id, b.id),
  );
  const holdings = [...corrected.holdings].sort((a, b) =>
    compareText(a.id, b.id),
  );
  const table = new RateTable([...input.rates, ...corrected.rates]);

  // Spam (F6.6): never valued, never counted.
  const spamKeys = new Set(
    bookings
      .filter((b) => b.kind === 'spam')
      .map((b) => `${b.platform}|${b.accountId}|${b.asset}`),
  );
  const isSpam = (key: string, asset: string) =>
    spamPattern.test(asset) || spamKeys.has(key);

  // A record's own price (a statement's valuation) counts on its own day, as in the calculation.
  const ownPrices = new Map<string, OwnPrice>();
  for (const h of holdings) {
    if (h.priceChf === undefined && h.priceUsd === undefined) continue;
    const key = `${h.asset}|${h.asOf}`;
    if (!ownPrices.has(key))
      ownPrices.set(key, { priceChf: h.priceChf, priceUsd: h.priceUsd });
  }
  const prices = new Map<string, Decimal | null>();
  const priceOf = (asset: string, date: string): Decimal | null => {
    const key = `${asset}|${date}`;
    const cached = prices.get(key);
    if (cached !== undefined) return cached;
    const quote = unitPriceChf(
      table,
      rules,
      asset,
      date,
      ownPrices.get(key) ?? {},
    );
    const value = quote ? quote.priceChf : null;
    prices.set(key, value);
    return value;
  };

  // --- Daily balances (rule 3 for accounts without bookings) ---
  const dayBefore = addDays(from, -1);
  const days = daysOf(dayBefore, to);
  const bookedAccounts = new Set(
    bookings.map((b) => accountKey(b.platform, b.accountId)),
  );
  const ledgerDays = dailyBalances(
    { rules, bookings, holdings, corrections: [] },
    dayBefore,
    to,
  );
  const statementOnly = holdings.filter(
    (h) => !bookedAccounts.has(accountKey(h.platform, h.accountId)),
  );
  const datesPerAccount = new Map<string, string[]>();
  for (const h of statementOnly) {
    const key = accountKey(h.platform, h.accountId);
    const list = datesPerAccount.get(key) ?? [];
    if (!list.includes(h.asOf)) list.push(h.asOf);
    datesPerAccount.set(key, list);
  }
  for (const list of datesPerAccount.values()) list.sort(compareText);
  const carried = new Map<string, Record<string, string>>();
  const carriedOn = (account: string, date: string): Record<string, string> => {
    const cacheKey = `${account}#${date}`;
    const cached = carried.get(cacheKey);
    if (cached) return cached;
    const own = statementOnly.filter(
      (h) => accountKey(h.platform, h.accountId) === account,
    );
    const statements = statementBalances(
      own.filter((h) => !isCorrectionRecord(h.sourceFileId)),
      date,
    );
    const manual = statementBalances(
      own.filter((h) => isCorrectionRecord(h.sourceFileId)),
      date,
    );
    const out: Record<string, string> = {};
    for (const balances of [statements, manual]) {
      for (const accountBalances of balances.values())
        for (const balance of accountBalances.values())
          out[`${balance.platform}|${balance.accountId}|${balance.asset}`] =
            toDecimalString(balance.quantity);
    }
    carried.set(cacheKey, out);
    return out;
  };

  const balancesPerDay: Record<string, string>[] = days.map((day, index) => {
    const out: Record<string, string> = {};
    const ledger = ledgerDays[index]?.balances ?? {};
    for (const [key, quantity] of Object.entries(ledger)) {
      const { platform, accountId } = splitKey(key);
      if (bookedAccounts.has(accountKey(platform, accountId)))
        out[key] = quantity;
    }
    for (const [account, dates] of datesPerAccount) {
      const latest = dates.filter((d) => d <= day).pop();
      if (latest) Object.assign(out, carriedOn(account, latest));
    }
    return out;
  });

  // --- Series ---
  const missingEver = new Set<string>();
  const points: DashboardPoint[] = days.map((day, index) => {
    let total = ZERO;
    const missing = new Set<string>();
    const balances = balancesPerDay[index] ?? {};
    for (const key of Object.keys(balances).sort(compareText)) {
      const { asset } = splitKey(key);
      if (isSpam(key, asset)) continue;
      const quantity = parseDecimal(balances[key] as string);
      if (!quantity.isPositive() || quantity.abs().lt(dust)) continue;
      const price = priceOf(asset, day);
      if (price === null) missing.add(asset);
      else total = total.plus(quantity.times(price));
    }
    for (const asset of missing) missingEver.add(asset);
    return {
      date: day,
      valueChf: toDecimalString(total),
      missing: [...missing].sort(compareText),
    };
  });
  const start = parseDecimal(points[0]?.valueChf ?? '0');
  const series = points.slice(1);
  const end = parseDecimal(series[series.length - 1]?.valueChf ?? '0');

  // --- KPIs (F11.6) ---
  const startTs = `${from}T00:00:00.000Z`;
  const endTs = new Date(Date.parse(`${to}T00:00:00Z`) + DAY_MS).toISOString();
  const inRange = (b: Booking) => b.timestamp >= startTs && b.timestamp < endTs;
  const matched = matchTransfers(bookings, rules);
  const external = new Set([
    ...matched.unmatchedWithdrawals.map((b) => b.id),
    ...matched.unmatchedDeposits.map((b) => b.id),
  ]);
  const internal = new Set(
    [...matched.considered.withdrawals, ...matched.considered.deposits]
      .map((b) => b.id)
      .filter((id) => !external.has(id)),
  );
  const tradeGroups = new Set(
    bookings
      .filter((b) => b.kind === 'trade' && b.group !== undefined)
      .map((b) => b.group as string),
  );
  const acc = new Map<
    KpiKind,
    { value: Decimal; ids: string[]; missing: number }
  >(KPI_KINDS.map((k) => [k, { value: ZERO, ids: [], missing: 0 }]));
  const book = (
    kind: KpiKind,
    id: string,
    value: Decimal | null | undefined,
  ) => {
    const entry = acc.get(kind) as {
      value: Decimal;
      ids: string[];
      missing: number;
    };
    if (!entry.ids.includes(id)) entry.ids.push(id);
    if (value === null || value === undefined) entry.missing += 1;
    else entry.value = entry.value.plus(value);
  };
  const valueOf = (
    asset: string,
    quantity: Decimal,
    date: string,
    own: OwnPrice,
  ) => {
    const quote = unitPriceChf(table, rules, asset, date, own);
    return quote ? quantity.abs().times(quote.priceChf) : null;
  };
  for (const b of bookings) {
    if (!inRange(b)) continue;
    const key = `${b.platform}|${b.accountId}|${b.asset}`;
    if (b.kind === 'spam' || isSpam(key, b.asset)) continue;
    const date = b.timestamp.slice(0, 10);
    const own = { priceChf: b.priceChf, priceUsd: b.priceUsd };
    const isTradeRelated =
      b.kind === 'trade' || (b.group !== undefined && tradeGroups.has(b.group));
    if (b.kind === 'deposit' && !internal.has(b.id)) {
      book('deposits', b.id, valueOf(b.asset, b.quantity, date, own));
    } else if (b.kind === 'withdrawal' && !internal.has(b.id)) {
      book('withdrawals', b.id, valueOf(b.asset, b.quantity, date, own));
    } else if (isIncome(b.kind)) {
      const line = incomeLine(b, table, rules, spamPattern);
      if (line.status !== 'spam')
        book(
          'income',
          b.id,
          line.valueChf === null ? null : parseDecimal(line.valueChf),
        );
    } else if (b.kind === 'loss') {
      book('costs', b.id, valueOf(b.asset, b.quantity, date, own));
    } else if (b.kind === 'fee') {
      book(
        isTradeRelated ? 'tradingFees' : 'costs',
        b.id,
        valueOf(b.asset, b.quantity, date, own),
      );
    }
    if (b.fee && !b.fee.isZero() && !isIncome(b.kind)) {
      const feeAsset = b.feeAsset ?? b.asset;
      book(
        isTradeRelated ? 'tradingFees' : 'costs',
        b.id,
        valueOf(feeAsset, b.fee, date, feeAsset === b.asset ? own : {}),
      );
    }
  }
  const kpis: Kpi[] = KPI_KINDS.map((kind) => {
    const entry = acc.get(kind) as {
      value: Decimal;
      ids: string[];
      missing: number;
    };
    return {
      kind,
      valueChf: toDecimalString(entry.value),
      recordIds: entry.ids,
      missingPrices: entry.missing,
    };
  });
  const income = parseDecimal(
    kpis.find((k) => k.kind === 'income')?.valueChf ?? '0',
  );

  // --- Holdings at the period end (F11.8, Stichtag = `to`) ---
  const endBalances = balancesPerDay[balancesPerDay.length - 1] ?? {};
  const byAsset = new Map<string, DashboardAccount[]>();
  for (const key of Object.keys(endBalances).sort(compareText)) {
    const { platform, accountId, asset } = splitKey(key);
    if (isSpam(key, asset)) continue;
    const quantity = parseDecimal(endBalances[key] as string);
    if (quantity.abs().lt(dust)) continue;
    const price = priceOf(asset, to);
    const list = byAsset.get(asset) ?? [];
    list.push({
      platform,
      accountId,
      quantity: toDecimalString(quantity),
      valueChf:
        price === null || quantity.isNegative()
          ? null
          : toDecimalString(quantity.times(price)),
    });
    byAsset.set(asset, list);
  }
  const sampleDays = sampleOf(
    days.slice(1),
    Math.max(2, input.sparklinePoints ?? 60),
  );
  const holdingsOut: DashboardHolding[] = [...byAsset.entries()].map(
    ([asset, accounts]) => {
      const quantity = accounts.reduce(
        (sum, a) => sum.plus(parseDecimal(a.quantity)),
        ZERO,
      );
      const price = priceOf(asset, to);
      const status: DashboardHoldingStatus = quantity.isNegative()
        ? 'negative'
        : price === null
          ? 'missingPrice'
          : 'ok';
      return {
        asset,
        quantity: toDecimalString(quantity),
        priceChf: price === null ? null : toDecimalString(price),
        valueChf:
          status === 'ok' && price !== null
            ? toDecimalString(quantity.times(price))
            : null,
        status,
        sparkline: sampleDays.map((day) => {
          const p = priceOf(asset, day);
          return p === null ? null : toDecimalString(p);
        }),
        accounts,
      };
    },
  );
  holdingsOut.sort(
    (a, b) =>
      parseDecimal(b.valueChf ?? '0').comparedTo(
        parseDecimal(a.valueChf ?? '0'),
      ) || compareText(a.asset, b.asset),
  );

  // --- Allocation (F11.7) ---
  const priced = holdingsOut.filter(
    (h) => h.valueChf !== null && parseDecimal(h.valueChf).isPositive(),
  );
  const pricedTotal = priced.reduce(
    (sum, h) => sum.plus(parseDecimal(h.valueChf as string)),
    ZERO,
  );
  const allocation: AllocationSlice[] = priced
    .slice(0, NAMED_SLICES)
    .map((h) => ({
      asset: h.asset,
      valueChf: h.valueChf as string,
      sharePct:
        percent(parseDecimal(h.valueChf as string), pricedTotal) ?? '0.00',
      assets: 1,
    }));
  const rest = priced.slice(NAMED_SLICES);
  if (rest.length > 0) {
    const value = rest.reduce(
      (sum, h) => sum.plus(parseDecimal(h.valueChf as string)),
      ZERO,
    );
    allocation.push({
      asset: null,
      valueChf: toDecimalString(value),
      sharePct: percent(value, pricedTotal) ?? '0.00',
      assets: rest.length,
    });
  }

  return {
    from,
    to,
    series,
    startValueChf: toDecimalString(start),
    endValueChf: toDecimalString(end),
    changeChf: toDecimalString(end.minus(start)),
    changePct: start.isPositive() ? percent(end.minus(start), start) : null,
    kpis,
    incomeSharePct: end.isPositive() ? percent(income, end) : null,
    allocation,
    holdings: holdingsOut,
    missingPrices: [...missingEver].sort(compareText),
  };
}

/** At most `count` evenly spaced items, always the first and the last. */
function sampleOf<T>(items: readonly T[], count: number): T[] {
  if (items.length <= count) return [...items];
  const out: T[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(items[Math.round((i * (items.length - 1)) / (count - 1))] as T);
  }
  return out;
}

/** The kinds of bookings a KPI drill-down can list, for the API's validation. */
export function isKpiKind(value: string): value is KpiKind {
  return (KPI_KINDS as readonly string[]).includes(value);
}
