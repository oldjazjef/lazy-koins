import type { RateEntry } from '@lazykoins/engine';

/**
 * Where rates come from on the internet (F7.4) — fetched **before** a calculation, on the user's
 * explicit "Kurse aktualisieren", and only when rate lookups are on (F11.3). Adapters live in
 * `integrations/rates/` and are bound in `IntegrationsModule`; specs use fakes (no network).
 *
 * Every adapter returns `RateEntry`s for whole days (UTC) with decimal strings parsed from the
 * response text, never through a JS number.
 */
export interface RateSourcePort {
  readonly name: RateEntry['source'];
}

export interface SeriesRequest {
  /** The project's asset name (stored under it). */
  readonly asset: string;
  /** The symbol to ask the source for (an alias for renamed assets). */
  readonly symbol: string;
  /** ISO dates, inclusive. */
  readonly from: string;
  readonly to: string;
}

/** Daily USD closes of a crypto asset (Binance public klines, no key). */
export abstract class UsdPriceSourcePort implements RateSourcePort {
  abstract readonly name: RateEntry['source'];
  abstract dailyUsd(request: SeriesRequest): Promise<RateEntry[]>;
}

/** The outcome of a key check ("Testen", F11.0s) — never contains the key. */
export interface KeyCheckResult {
  readonly ok: boolean;
  /** Why it failed: the key, the provider's limit, the network, … */
  readonly code?:
    'invalidKey' | 'rateLimited' | 'network' | 'timeout' | 'providerError';
  readonly status: number | null;
  /** The provider's own message, redacted (no key in it). */
  readonly providerMessage: string | null;
  /** scheme://host/path that was called — never the query. */
  readonly url: string;
  readonly millis: number;
}

/**
 * Daily prices of a crypto asset in a fiat currency — the project's tax currency (CoinGecko
 * `vs_currency`, the user's API key; F4.1a).
 */
export abstract class FiatPriceSourcePort implements RateSourcePort {
  abstract readonly name: RateEntry['source'];
  abstract dailyFiat(
    request: SeriesRequest & {
      readonly coinId: string;
      readonly apiKey: string;
      /** ISO 4217 code (CHF, EUR, …). */
      readonly currency: string;
    },
  ): Promise<RateEntry[]>;

  /** One cheap authenticated request that proves the key works (no prices, no user data). */
  abstract checkKey(apiKey: string): Promise<KeyCheckResult>;
}

/**
 * Daily ECB reference rates of one currency in another (Frankfurter): USD → T and EUR → T for the
 * project's tax currency T (F4.1a; CHF by default).
 */
export abstract class FxRateSourcePort implements RateSourcePort {
  abstract readonly name: RateEntry['source'];
  abstract daily(
    base: string,
    quote: string,
    from: string,
    to: string,
  ): Promise<RateEntry[]>;
}

/** The exchange rates a project in `taxCurrency` fetches: USD and EUR in it (F4.1a). */
export function fxBasesFor(taxCurrency: string): readonly string[] {
  return ['USD', 'EUR'].filter((base) => base !== taxCurrency);
}
