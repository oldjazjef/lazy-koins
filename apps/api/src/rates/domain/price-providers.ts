import type { FetchedPriceSource } from '@lazykoins/engine';
import {
  LEADER_FACTOR,
  type MarketCoin,
  SHARED_RANK_LIMIT,
} from './coin-choice';

/**
 * The selectable crypto price providers (price sources phase 2, F7.4) — pure rules, no network.
 *
 * Per user an **ordered** list of providers, each on or off (`user_settings.price_sources`). "Kurse
 * aktualisieren" (project and dashboard) goes through the enabled ones in that order per asset and
 * stops at the first that delivers a series; the calculation prefers the series of the provider
 * ranked first (`preferFetchedSources` in the engine).
 *
 * **Default order** (an empty stored list): Binance → CoinGecko, as before phase 2, then the new
 * providers **off**: an existing user's prices come from exactly the same places, and no new third
 * party is contacted until the user switches it on (CoinMarketCap needs a key anyway, CoinPaprika's
 * free tier is personal use only).
 */
export const PRICE_PROVIDERS = [
  'binance',
  'coingecko',
  'coinmarketcap',
  'defillama',
  'coinpaprika',
  'kraken',
  'coinbase',
  'bitfinex',
] as const satisfies readonly FetchedPriceSource[];
export type PriceProviderId = (typeof PRICE_PROVIDERS)[number];

export function isPriceProvider(value: unknown): value is PriceProviderId {
  return (PRICE_PROVIDERS as readonly unknown[]).includes(value);
}

export interface PriceProviderSetting {
  readonly id: PriceProviderId;
  readonly enabled: boolean;
}

/** On by default (today's behaviour); every other provider is appended switched off. */
const DEFAULT_ENABLED: readonly PriceProviderId[] = ['binance', 'coingecko'];

export const DEFAULT_PRICE_PROVIDERS: readonly PriceProviderSetting[] =
  PRICE_PROVIDERS.map((id) => ({ id, enabled: DEFAULT_ENABLED.includes(id) }));

/**
 * The full ordered list from what is stored: known ids in the stored order (duplicates and unknown
 * ids dropped), every provider missing from it appended **off** (a provider added by a later app
 * version never switches itself on). Nothing stored (or not a list) = the default.
 */
export function normalisePriceProviders(raw: unknown): PriceProviderSetting[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_PRICE_PROVIDERS.map((p) => ({ ...p }));
  }
  const out: PriceProviderSetting[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const { id, enabled } = item as Record<string, unknown>;
    if (!isPriceProvider(id) || out.some((p) => p.id === id)) continue;
    out.push({ id, enabled: enabled === true });
  }
  if (out.length === 0) return DEFAULT_PRICE_PROVIDERS.map((p) => ({ ...p }));
  for (const id of PRICE_PROVIDERS) {
    if (!out.some((p) => p.id === id)) out.push({ id, enabled: false });
  }
  return out;
}

/** The enabled providers, in the user's order. */
export function enabledProviders(
  settings: readonly PriceProviderSetting[],
): PriceProviderId[] {
  return settings.filter((p) => p.enabled).map((p) => p.id);
}

/** The full order (enabled or not) — what the calculation ranks stored series by. */
export function providerOrder(
  settings: readonly PriceProviderSetting[],
): PriceProviderId[] {
  return settings.map((p) => p.id);
}

/** Providers whose key the user can store (sealed); see `requiresKey` for the ones that need it. */
export const KEYED_PROVIDERS = ['coingecko', 'coinmarketcap'] as const;
export type KeyedProvider = (typeof KEYED_PROVIDERS)[number];

export function isKeyedProvider(id: string): id is KeyedProvider {
  return (KEYED_PROVIDERS as readonly string[]).includes(id);
}

/**
 * Providers that cannot be asked at all without the user's key. CoinGecko is not one of them: its
 * public API answers without a key (slower, 365 days) — otherwise a coin chosen at CoinGecko by a
 * user without a Demo key would never get a price (bug 07.10.2026: "Schlüssel des Anbieters fehlt"
 * for every chosen coin).
 */
export const KEY_REQUIRED_PROVIDERS = ['coinmarketcap'] as const;

export function requiresKey(id: string): boolean {
  return (KEY_REQUIRED_PROVIDERS as readonly string[]).includes(id);
}

/**
 * How a provider identifies a coin: `ticker` = by the symbol (Binance, Kraken, Bitfinex, Coinbase
 * — never for a chosen coin or an ambiguous ticker); `id` = the provider's coin id (resolved from a
 * chosen coin, the built-in CoinGecko ids, the market list's leader, a contract or a symbol search
 * with a clear leader).
 */
export const PROVIDER_COIN_REF: Readonly<
  Record<PriceProviderId, 'ticker' | 'id'>
> = {
  binance: 'ticker',
  coingecko: 'id',
  coinmarketcap: 'id',
  defillama: 'id',
  coinpaprika: 'id',
  kraken: 'ticker',
  coinbase: 'ticker',
  bitfinex: 'ticker',
};

/**
 * Day semantics (decided for phase 2): the stored value for UTC day **D is the price at the end of
 * D** (the daily close, ≈ 23:59:59 UTC) — what Binance's kline close, Kraken, Bitfinex, Coinbase and
 * DefiLlama deliver. Providers whose daily point is the **first snapshot of a day** (≈ 00:00 UTC:
 * CoinGecko, CoinMarketCap `interval=daily`, CoinPaprika) are asked one day later and each value is
 * filed one day earlier: the 00:00 snapshot of 01.01. is the close of 31.12. — so the year-end value
 * of every provider means the same moment. (Before phase 2, CoinGecko's 00:00 value was filed under
 * its own day; such stored rows stay until the next forced refresh.)
 */
export type DayPoint = 'close' | 'startOfDay';

/** `startOfDay` → shift by −1 day; the request window moves +1 day. */
export function dayShift(dayPoint: DayPoint): number {
  return dayPoint === 'startOfDay' ? -1 : 0;
}

/** `2025-12-31` + n days (UTC). */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** A provider's coin found for a ticker (`resolveCoin` / search answers). */
export interface ProviderCandidate {
  readonly id: string;
  readonly symbol: string;
  readonly name: string | null;
  readonly rank: number | null;
}

export type CoinPick =
  | { readonly kind: 'coin'; readonly coin: ProviderCandidate }
  | { readonly kind: 'ambiguous'; readonly candidates: readonly string[] }
  | { readonly kind: 'none' };

/**
 * The coin a provider means by a ticker — the OPN rules for every provider: exact symbol only; one
 * candidate → it; several → only when the best-ranked one clearly leads (the second ranks at least
 * `LEADER_FACTOR` × worse, or has no rank at all), else **ambiguous** (that provider prices
 * nothing for the ticker). Several candidates without any rank are ambiguous too.
 */
export function pickBySymbol(
  candidates: readonly ProviderCandidate[],
  symbol: string,
): CoinPick {
  const upper = symbol.toUpperCase();
  const exact = candidates
    .filter((c) => c.symbol.toUpperCase() === upper)
    .filter((c, i, all) => all.findIndex((o) => o.id === c.id) === i)
    .sort(
      (a, b) =>
        (a.rank ?? Number.MAX_SAFE_INTEGER) -
          (b.rank ?? Number.MAX_SAFE_INTEGER) || (a.id < b.id ? -1 : 1),
    );
  const [first, second] = exact;
  if (!first) return { kind: 'none' };
  if (!second) return { kind: 'coin', coin: first };
  if (
    first.rank !== null &&
    (second.rank === null || second.rank >= LEADER_FACTOR * first.rank)
  ) {
    return { kind: 'coin', coin: first };
  }
  return { kind: 'ambiguous', candidates: exact.map((c) => c.id) };
}

/**
 * The CoinGecko coin the market list (`coin_market`) means by a ticker: the only relevant coin
 * (rank ≤ `SHARED_RANK_LIMIT`), or the clear leader of a shared ticker (a "warning", not
 * ambiguous); `null` = not in the list or no clear leader.
 */
export function marketLeader(
  symbol: string,
  market: readonly MarketCoin[],
): string | null {
  const upper = symbol.toUpperCase();
  const relevant = market
    .filter((c) => c.symbol === upper && c.marketCapRank <= SHARED_RANK_LIMIT)
    .sort(
      (a, b) => a.marketCapRank - b.marketCapRank || (a.id < b.id ? -1 : 1),
    );
  const [first, second] = relevant;
  if (!first) return null;
  if (!second || second.marketCapRank >= LEADER_FACTOR * first.marketCapRank) {
    return first.id;
  }
  return null;
}

/** What a provider offers, for Einstellungen › Kurse (static; Binance has no adapter in the port). */
export interface PriceProviderInfo {
  readonly id: PriceProviderId;
  readonly label: string;
  readonly key: 'required' | 'optional' | 'none';
  readonly quotes: 'anyFiat' | readonly string[];
  readonly freeHistoryDays: number | null;
  readonly dayPoint: DayPoint;
  readonly coinRef: 'ticker' | 'id';
  readonly personalUseOnly: boolean;
  readonly attribution: string | null;
}

export const BINANCE_INFO: PriceProviderInfo = {
  id: 'binance',
  label: 'Binance',
  key: 'none',
  quotes: ['USD'],
  freeHistoryDays: null,
  dayPoint: 'close',
  coinRef: 'ticker',
  personalUseOnly: false,
  attribution: null,
};

/** The quote to ask a provider in: the tax currency when it prices in it, else USD, else none. */
export function quoteFor(
  quotes: PriceProviderInfo['quotes'],
  taxCurrency: string,
): string | null {
  if (quotes === 'anyFiat' || quotes.includes(taxCurrency)) return taxCurrency;
  return quotes.includes('USD') ? 'USD' : null;
}
