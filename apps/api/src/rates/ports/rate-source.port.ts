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

/** Daily CHF prices of a crypto asset (CoinGecko, the user's API key). */
export abstract class ChfPriceSourcePort implements RateSourcePort {
  abstract readonly name: RateEntry['source'];
  abstract dailyChf(
    request: SeriesRequest & {
      readonly coinId: string;
      readonly apiKey: string;
    },
  ): Promise<RateEntry[]>;
}

/** Daily ECB reference rates of USD and EUR in CHF (Frankfurter). */
export abstract class FxRateSourcePort implements RateSourcePort {
  abstract readonly name: RateEntry['source'];
  abstract dailyChf(
    base: 'USD' | 'EUR',
    from: string,
    to: string,
  ): Promise<RateEntry[]>;
}
