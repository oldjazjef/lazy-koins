import type { RateEntry } from '@lazykoins/engine';
import { type CoinChoices, pricePlan } from '../domain/coin-choice';
import { RATE_ALIASES } from '../domain/project-rate';
import type {
  FiatPriceSourcePort,
  UsdPriceSourcePort,
} from '../ports/rate-source.port';

/** What one asset's lookup found (before it is stored). */
export interface PriceFetch {
  /**
   * `ambiguous` = the ticker stands for several coins and none is chosen (nothing asked);
   * `noKey` = the chosen coin's provider needs a key the user has not stored.
   */
  readonly status: 'fetched' | 'notFound' | 'ambiguous' | 'noKey';
  readonly source: string | null;
  readonly entries: readonly RateEntry[];
  /** A keyed provider was asked (its 401/403 means the key is refused). */
  readonly keyed: boolean;
}

/**
 * One asset's daily prices over `from`…`to`, by the price plan (`coin-choice.ts`) — the one rule
 * for "Kurse aktualisieren" of a project and of the dashboard:
 *
 * - a chosen coin → only its provider (CoinGecko in `currency` with the user's key), **never**
 *   Binance by ticker;
 * - an ambiguous ticker without a choice → nothing is asked (`ambiguous`);
 * - else Binance `<SYM>USDT` (and the renamed asset's aliases), CoinGecko with the built-in id as
 *   the fallback when a key is stored.
 *
 * A provider failure throws (the caller records `failed`).
 */
export async function fetchPrices(
  sources: {
    readonly usd: UsdPriceSourcePort;
    readonly fiat: FiatPriceSourcePort;
  },
  request: {
    readonly asset: string;
    readonly from: string;
    readonly to: string;
    /** The tax currency CoinGecko answers in. */
    readonly currency: string;
    readonly choices: CoinChoices;
    readonly apiKey: string | undefined;
    /** Tickers the market list shows without a clear leader (`CoinMarketService`). */
    readonly marketAmbiguous?: ReadonlyMap<string, readonly string[]>;
  },
): Promise<PriceFetch> {
  const { asset, from, to, currency, apiKey } = request;
  const plan = pricePlan(asset, request.choices, request.marketAmbiguous);
  if (plan.kind === 'ambiguous') {
    return { status: 'ambiguous', source: null, entries: [], keyed: false };
  }
  const coingecko = async (coinId: string): Promise<PriceFetch> => {
    if (!apiKey) {
      return { status: 'noKey', source: null, entries: [], keyed: false };
    }
    const entries = await sources.fiat.dailyFiat({
      asset,
      symbol: asset,
      from,
      to,
      coinId,
      apiKey,
      currency,
    });
    return {
      status: entries.length > 0 ? 'fetched' : 'notFound',
      source: entries.length > 0 ? sources.fiat.name : null,
      entries,
      keyed: true,
    };
  };
  if (plan.kind === 'chosen') {
    // Today every provider is CoinGecko; another one gets its own source here.
    return coingecko(plan.choice.id);
  }
  let entries: RateEntry[] = [];
  for (const symbol of [asset, ...(RATE_ALIASES[asset] ?? [])]) {
    const found = await sources.usd.dailyUsd({ asset, symbol, from, to });
    // Earlier symbols win per day (an asset's own name before its alias).
    const dates = new Set(entries.map((e) => e.date));
    entries = [...entries, ...found.filter((e) => !dates.has(e.date))];
  }
  if (entries.length > 0) {
    return {
      status: 'fetched',
      source: sources.usd.name,
      entries,
      keyed: false,
    };
  }
  if (plan.coingeckoId && apiKey) return coingecko(plan.coingeckoId);
  return { status: 'notFound', source: null, entries: [], keyed: false };
}

/**
 * Whether a stored series of `source` counts as the asset's series (cache check): a chosen coin
 * only by its provider's series, an ambiguous ticker never, otherwise any fetched source.
 */
export function seriesCounts(
  asset: string,
  source: string,
  choices: CoinChoices,
  marketAmbiguous?: ReadonlyMap<string, readonly string[]>,
): boolean {
  const plan = pricePlan(asset, choices, marketAmbiguous);
  if (plan.kind === 'ambiguous') return false;
  if (plan.kind === 'chosen') return source === plan.choice.provider;
  return true;
}
