import { type Decimal, EngineDecimal, parseDecimal } from '../money/decimal';
import type { CountryRules } from '../rules/country-rules';

/**
 * The rate table of a project (F7.4): prices and exchange rates fetched **before** the
 * calculation and stored with their source, plus the user's overrides. The engine only reads it
 * — no network (F7.6, F11.3).
 */

/** Where a rate comes from. `manual` (an override, F7.4) beats everything for the same day. */
export const RATE_SOURCES = [
  'manual',
  'estv',
  'binance',
  'coingecko',
  'ecb',
] as const;
export type RateSource = (typeof RATE_SOURCES)[number];

/** `price`: one unit of `asset` in `currency`. `fx`: one `asset` (USD, EUR) in `currency` (CHF). */
export type RateKind = 'price' | 'fx';

export interface RateEntry {
  readonly kind: RateKind;
  readonly asset: string;
  readonly currency: 'CHF' | 'USD';
  /** ISO date (`2025-12-31`), the day the rate is for (UTC). */
  readonly date: string;
  /** Decimal string. */
  readonly value: string;
  readonly source: RateSource;
}

/** Highest first: the source that wins when several give a rate for the same day. */
const SOURCE_RANK: Readonly<Record<RateSource, number>> = {
  manual: 0,
  estv: 1,
  binance: 2,
  coingecko: 3,
  ecb: 4,
};

/** How a figure's price was found — every position names it (FACHREGELN, Kurse). */
export type PriceOrigin =
  | 'home'
  | 'override'
  | 'estv'
  | 'recordChf'
  | 'recordUsd'
  | 'pegged'
  | 'fx'
  | 'tableChf'
  | 'tableUsd';

export interface PriceQuote {
  /** CHF per unit. */
  readonly priceChf: Decimal;
  readonly origin: PriceOrigin;
  /** The underlying source (`binance`, `ecb`, `record`, …). */
  readonly source: string;
  /** The day the price is for (may differ from the asked day within the tolerance). */
  readonly date: string;
  /** USD per unit and the USD/CHF used, when the CHF price was derived from USD. */
  readonly priceUsd?: Decimal;
  readonly usdChf?: Decimal;
}

interface Point {
  readonly date: string;
  readonly value: Decimal;
  readonly source: RateSource;
}

const DAY_MS = 86_400_000;

/** Days from `a` to `b` (ISO dates), positive when b is later. */
export function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS,
  );
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Exchange rates are forward-filled from the last fixing (weekends, holidays) for this long. */
const FX_FILL_DAYS = 14;

export class RateTable {
  private readonly series = new Map<string, Point[]>();
  /** `kind|ASSET|currency|date` → the winning point of that day. */
  private readonly byDay = new Map<string, Point>();

  constructor(entries: readonly RateEntry[]) {
    const best = new Map<string, Point>();
    for (const entry of entries) {
      const key = `${entry.kind}|${entry.asset.toUpperCase()}|${entry.currency}`;
      const dayKey = `${key}|${entry.date}`;
      const point: Point = {
        date: entry.date,
        value: parseDecimal(entry.value),
        source: entry.source,
      };
      const existing = best.get(dayKey);
      if (!existing || SOURCE_RANK[point.source] < SOURCE_RANK[existing.source])
        best.set(dayKey, point);
    }
    for (const [dayKey, point] of best) {
      this.byDay.set(dayKey, point);
      const key = dayKey.slice(0, dayKey.lastIndexOf('|'));
      const list = this.series.get(key) ?? [];
      list.push(point);
      this.series.set(key, list);
    }
    for (const list of this.series.values())
      list.sort((a, b) => compareText(a.date, b.date));
  }

  /**
   * The rate for a day: the last one on or before it at most `tolerance` days old, otherwise the
   * first one after it at most `tolerance` days later (FACHREGELN: 14 days); otherwise none.
   */
  lookup(
    kind: RateKind,
    asset: string,
    currency: 'CHF' | 'USD',
    date: string,
    tolerance: number,
    sources?: readonly RateSource[],
  ): Point | undefined {
    const key = `${kind}|${asset.toUpperCase()}|${currency}`;
    const list = this.series.get(key);
    if (!list) return undefined;
    if (sources && tolerance === 0) {
      // Same day only (overrides, ESTV): one map lookup instead of a scan — the dashboard asks
      // this for every day of a range.
      const point = this.byDay.get(`${key}|${date}`);
      return point && sources.includes(point.source) ? point : undefined;
    }
    let before: Point | undefined;
    let after: Point | undefined;
    if (!sources) {
      // Binary search: the last point on or before the day.
      let low = 0;
      let high = list.length - 1;
      let found = -1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if ((list[mid] as Point).date <= date) {
          found = mid;
          low = mid + 1;
        } else high = mid - 1;
      }
      before = found >= 0 ? list[found] : undefined;
      after = list[found + 1];
    } else {
      for (const point of list.filter((p) => sources.includes(p.source))) {
        if (point.date <= date) before = point;
        else {
          after = point;
          break;
        }
      }
    }
    if (before && daysBetween(before.date, date) <= tolerance) return before;
    if (after && daysBetween(date, after.date) <= tolerance) return after;
    return undefined;
  }

  /** One unit of `base` (USD, EUR) in CHF on a day, forward-filled (ECB, FACHREGELN). */
  fx(base: string, date: string): Point | undefined {
    if (base === 'CHF') {
      return { date, value: new EngineDecimal(1), source: 'ecb' };
    }
    return this.lookup('fx', base, 'CHF', date, FX_FILL_DAYS);
  }

  /** Every point of a series within [from, to], in date order. */
  pointsBetween(
    kind: RateKind,
    asset: string,
    currency: 'CHF' | 'USD',
    from: string,
    to: string,
  ): readonly Point[] {
    const list = this.series.get(`${kind}|${asset.toUpperCase()}|${currency}`);
    return (list ?? []).filter((p) => p.date >= from && p.date <= to);
  }
}

/** A record's own price information (a statement's CHF valuation, an export's USD price). */
export interface OwnPrice {
  readonly priceChf?: Decimal;
  readonly priceUsd?: Decimal;
}

/**
 * CHF per unit of `asset` on `date`, by the FACHREGELN priority (the first that exists wins):
 *
 * 1. the home currency itself (CHF = 1);
 * 2. an override for that day (F7.4, F9.1) — `manual` rates;
 * 3. the ESTV Kursliste value for that day;
 * 4. the record's own CHF price ("Kurs CHF direkt", e.g. a statement valuation);
 * 5. the record's own USD price × USD/CHF of the day;
 * 6. USD-pegged assets (stablecoins, USD) = 1 USD × USD/CHF; other fiat via its CHF rate (EUR);
 * 7. a stored CHF price (CoinGecko) within the tolerance;
 * 8. a stored USD price (Binance close, CoinGecko) within the tolerance × USD/CHF of the day.
 *
 * `undefined` = no price: the figure stays without value and becomes an open point.
 */
export function unitPriceChf(
  table: RateTable,
  rules: CountryRules,
  asset: string,
  date: string,
  own: OwnPrice = {},
): PriceQuote | undefined {
  const upper = asset.toUpperCase();
  if (upper === rules.homeCurrency) {
    return {
      priceChf: new EngineDecimal(1),
      origin: 'home',
      source: 'fixed',
      date,
    };
  }
  const override = table.lookup('price', upper, 'CHF', date, 0, ['manual']);
  if (override) {
    return {
      priceChf: override.value,
      origin: 'override',
      source: 'manual',
      date,
    };
  }
  const estv = table.lookup('price', upper, 'CHF', date, 0, ['estv']);
  if (estv) {
    return { priceChf: estv.value, origin: 'estv', source: 'estv', date };
  }
  if (own.priceChf !== undefined) {
    return {
      priceChf: own.priceChf,
      origin: 'recordChf',
      source: 'record',
      date,
    };
  }
  const usdChf = table.fx('USD', date);
  if (own.priceUsd !== undefined && usdChf) {
    return {
      priceChf: own.priceUsd.times(usdChf.value),
      origin: 'recordUsd',
      source: 'record',
      date,
      priceUsd: own.priceUsd,
      usdChf: usdChf.value,
    };
  }
  if (rules.usdPegged.includes(upper)) {
    if (!usdChf) return undefined;
    return {
      priceChf: usdChf.value,
      origin: 'pegged',
      source: usdChf.source,
      date,
      priceUsd: new EngineDecimal(1),
      usdChf: usdChf.value,
    };
  }
  if (rules.fiat.includes(upper)) {
    const rate = table.fx(upper, date);
    return rate
      ? { priceChf: rate.value, origin: 'fx', source: rate.source, date }
      : undefined;
  }
  const chf = table.lookup(
    'price',
    upper,
    'CHF',
    date,
    rules.priceToleranceDays,
  );
  if (chf) {
    return {
      priceChf: chf.value,
      origin: 'tableChf',
      source: chf.source,
      date: chf.date,
    };
  }
  const usd = table.lookup(
    'price',
    upper,
    'USD',
    date,
    rules.priceToleranceDays,
  );
  if (usd && usdChf) {
    return {
      priceChf: usd.value.times(usdChf.value),
      origin: 'tableUsd',
      source: usd.source,
      date: usd.date,
      priceUsd: usd.value,
      usdChf: usdChf.value,
    };
  }
  return undefined;
}

/**
 * The yearly average CHF price (FACHREGELN, Earn-Lücke): the mean over the year's daily USD
 * closes × USD/CHF of each day; without USD prices the mean of stored CHF prices. USD-pegged
 * assets average the USD/CHF rate itself.
 */
export function yearlyAverageChf(
  table: RateTable,
  rules: CountryRules,
  asset: string,
  year: number,
): Decimal | undefined {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const upper = asset.toUpperCase();
  const mean = (values: Decimal[]) =>
    values.length === 0
      ? undefined
      : values
          .reduce((a, b) => a.plus(b), new EngineDecimal(0))
          .div(values.length);
  if (upper === rules.homeCurrency) return new EngineDecimal(1);
  if (rules.usdPegged.includes(upper) || rules.fiat.includes(upper)) {
    const base = rules.usdPegged.includes(upper) ? 'USD' : upper;
    return mean(
      table.pointsBetween('fx', base, 'CHF', from, to).map((p) => p.value),
    );
  }
  const daily: Decimal[] = [];
  for (const point of table.pointsBetween('price', upper, 'USD', from, to)) {
    const fx = table.fx('USD', point.date);
    if (fx) daily.push(point.value.times(fx.value));
  }
  if (daily.length > 0) return mean(daily);
  return mean(
    table.pointsBetween('price', upper, 'CHF', from, to).map((p) => p.value),
  );
}
