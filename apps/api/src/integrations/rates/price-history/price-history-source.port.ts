/**
 * Historical daily prices from a selectable provider (CoinMarketCap, CoinGecko, DefiLlama,
 * CoinPaprika, Kraken, Bitfinex, Coinbase) behind ONE contract — phase 1 of "price sources":
 * adapters only, bound in `IntegrationsModule` but not used by any handler yet. Phase 2 adds the
 * settings (provider order, sealed keys, per-provider coin mapping), the wiring into the
 * project's "Kurse aktualisieren" and the dashboard refresh, and the UI (CLAUDE.md, "Price
 * sources").
 *
 * Rules every adapter keeps:
 * - **No request without an explicit call** — the caller decides online/offline (F11.3); an
 *   adapter has no gate of its own and never fetches in the background.
 * - Prices are **decimal strings** parsed from the response text (`parseJsonKeepingNumbers`),
 *   never a JS number; one value per **UTC day**, sorted, inside the requested range.
 * - Calls are serialised per provider with a minimum spacing, a timeout and a size cap.
 * - Failures are a `PriceSourceError` with a `code`; a key never appears in a message, a detail
 *   or a URL that leaves the adapter.
 */

export const PRICE_SOURCE_IDS = [
  'coinmarketcap',
  'coingecko',
  'defillama',
  'coinpaprika',
  'kraken',
  'bitfinex',
  'coinbase',
] as const;
export type PriceSourceId = (typeof PRICE_SOURCE_IDS)[number];

export type PriceSourceErrorCode =
  /** Key missing, unknown, disabled or not activated (401/402/403 without a plan reason). */
  | 'invalidKey'
  /** The key's plan (or the provider's fixed depth) does not reach the requested days. */
  | 'planLacksHistory'
  | 'rateLimited'
  /** Unknown coin id / pair. */
  | 'notFound'
  /** The provider does not price in this currency (check `capabilities.quotes` first). */
  | 'unsupportedQuote'
  | 'network'
  | 'timeout'
  /** 5xx, not JSON, an unexpected shape, or larger than the size cap. */
  | 'badResponse';

export class PriceSourceError extends Error {
  constructor(
    readonly source: PriceSourceId,
    readonly code: PriceSourceErrorCode,
    readonly status: number | null,
    /** The provider's own words or the system cause — redacted, ≤ 500 characters. */
    readonly detail: string | null,
  ) {
    super(
      `${source}: ${code}${status === null ? '' : ` (HTTP ${status})`}${detail ? ` — ${detail}` : ''}`,
    );
    this.name = 'PriceSourceError';
  }
}

/** What the coin reference passed to `daily` is for this provider. */
export type CoinRefKind =
  /** CoinMarketCap's numeric id as a string (`1` = Bitcoin). */
  | 'cmcId'
  /** CoinGecko's API id (`bitcoin`). */
  | 'coingeckoId'
  /** DefiLlama's coin key: `coingecko:<id>` or `<chain>:<address>`. */
  | 'llamaCoin'
  /** CoinPaprika's id (`btc-bitcoin`). */
  | 'paprikaId'
  /** The plain ticker (`BTC`); the adapter maps exchange aliases (Kraken `XBT`, Bitfinex `UST`). */
  | 'ticker';

export interface PriceSourceCapabilities {
  readonly label: string;
  readonly key: 'required' | 'optional' | 'none';
  /** ISO codes it prices in directly; `anyFiat` = the provider converts to any common fiat. */
  readonly quotes: 'anyFiat' | readonly string[];
  /**
   * Days of daily history reachable on the free tier (or the provider's fixed depth — Kraken);
   * `null` = the whole history.
   */
  readonly freeHistoryDays: number | null;
  readonly coinRef: CoinRefKind;
  /**
   * `close` = the last trade / end-of-day value of day D; `startOfDay` = the first snapshot of
   * day D (≈ 00:00 UTC, which is about the close of D − 1).
   */
  readonly dayPoint: 'close' | 'startOfDay';
  /** `searchCoins` exists. */
  readonly search: boolean;
  /** `resolveCoin` accepts a contract address. */
  readonly contractLookup: boolean;
  /** Free tier licensed for personal use only. */
  readonly personalUseOnly: boolean;
  /** Attribution the provider asks for when its data is shown, or `null`. */
  readonly attribution: string | null;
}

export interface CoinCandidate {
  /** The reference `daily` takes (see `capabilities.coinRef`). */
  readonly id: string;
  readonly symbol: string;
  readonly name: string | null;
  /** Market-cap rank where the provider tells it — for sorting a choice, never a price. */
  readonly rank: number | null;
}

export interface ContractRef {
  /** App network name: ethereum, bsc, polygon, arbitrum, optimism, base, solana. */
  readonly network: string;
  readonly address: string;
}

export interface DailyPriceRequest {
  /** The provider's coin reference (see `capabilities.coinRef`). */
  readonly coin: string;
  /** ISO 4217, upper case (CHF, EUR, USD, …). */
  readonly quote: string;
  /** ISO dates, inclusive, UTC days. */
  readonly from: string;
  readonly to: string;
  readonly apiKey?: string;
}

export interface DailyPrice {
  readonly date: string;
  /** Plain decimal string (no exponent), > 0. */
  readonly value: string;
}

/** "Testen": one cheap request (a probe of the history depth where that costs nothing extra). */
export interface PriceSourceTestResult {
  readonly ok: boolean;
  readonly code?: PriceSourceErrorCode;
  readonly status: number | null;
  /** Days of daily history the key reaches, as far as the test could tell; `null` = unknown/all. */
  readonly historyDays: number | null;
  /** The plan as far as the provider tells it (credits, limits) — never the key. */
  readonly plan: string | null;
  /** Provider message or cause, redacted. */
  readonly detail: string | null;
  /** scheme://host/path of the last call — never the query. */
  readonly url: string;
  readonly millis: number;
}

export abstract class PriceHistorySourcePort {
  abstract readonly id: PriceSourceId;
  abstract readonly capabilities: PriceSourceCapabilities;

  /** Free-text / symbol search for the coin-mapping UI (only where `capabilities.search`). */
  searchCoins?(query: string, apiKey?: string): Promise<CoinCandidate[]>;

  /** Candidates for a ticker or a contract address (exact symbol matches first). */
  resolveCoin?(
    ref: { readonly symbol?: string; readonly contract?: ContractRef },
    apiKey?: string,
  ): Promise<CoinCandidate[]>;

  /** Daily prices for `[from, to]`; days the provider has no value for are simply missing. */
  abstract daily(request: DailyPriceRequest): Promise<DailyPrice[]>;

  /** Checks reachability and — for keyed providers — the key and its plan. Never throws. */
  abstract test(apiKey?: string): Promise<PriceSourceTestResult>;
}

/** All price-history adapters, by id — the DI token phase 2 injects. */
export abstract class PriceHistorySourcesPort {
  abstract all(): readonly PriceHistorySourcePort[];
  abstract byId(id: PriceSourceId): PriceHistorySourcePort;
}
