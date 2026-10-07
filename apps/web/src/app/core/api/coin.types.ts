/**
 * F7.4 "Coin wählen": which coin a ticker means (`rates/domain/coin-choice.ts` in the API). A
 * ticker is not a coin — "OPN" is both OPEN Ticketing Ecosystem and Opinion. Provider-aware:
 * CoinMarketCap is the second provider (price sources phase 2, its numeric ids).
 */
export const COIN_PROVIDERS = ['coingecko', 'coinmarketcap'] as const;
export type CoinProvider = (typeof COIN_PROVIDERS)[number];

/** The coin the user chose for a ticker (name/symbol as the provider answered). */
export interface CoinChoice {
  provider: CoinProvider;
  id: string;
  name: string | null;
  symbol: string | null;
  /** Set when the coin was identified by a wallet token's chain + contract (F6). */
  contract?: { network: string; address: string } | null;
}

/** A coin of the provider's market list (top coins by market cap). */
export interface MarketCoin {
  provider: CoinProvider;
  id: string;
  name: string;
  symbol: string;
  marketCapRank: number;
  priceUsd: string | null;
}

/**
 * Several relevant coins carry a ticker: `ambiguous` = no clear leader (no price until a coin is
 * chosen), `warning` = the price is used, the user should check ("Passt so" / "Coin wählen").
 */
export interface SharedTicker {
  symbol: string;
  level: 'ambiguous' | 'warning';
  /** `static` = the hand-kept list, `market` = detected from the market list. */
  basis: 'static' | 'market';
  /** Best rank first; may be empty for the hand-kept list. */
  candidates: MarketCoin[];
}

/** A coin of a provider's directory (search hit or id lookup). */
export interface CoinCandidate {
  provider: CoinProvider;
  id: string;
  name: string;
  symbol: string;
  marketCapRank: number | null;
}

/** `GET /rates/coins/search` */
export interface CoinSearch {
  provider: CoinProvider;
  query: string;
  coins: CoinCandidate[];
  /** The built-in id for the ticker ("Vorschlag"). */
  suggested: string | null;
  /** The ticker stands for several coins. */
  ambiguous: boolean;
}

/** `PUT|DELETE /settings/coins/:symbol` */
export interface CoinChoiceResult {
  symbol: string;
  choice: CoinChoice | null;
  choices: Record<string, CoinChoice>;
  removed: { projectRates: number; userRates: number };
}

/** `POST /projects/:id/rates/coin` */
export interface ChooseCoinResult extends CoinChoiceResult {
  fetch: { status: string; source: string | null; points: number };
}

/** How an asset's price is looked up: the chosen coin, nothing (ambiguous ticker), by ticker. */
export const PRICINGS = ['chosen', 'ambiguous', 'ticker'] as const;
export type Pricing = (typeof PRICINGS)[number];

/** `GET …/rates` → `assets`: one row per priced asset of the project. */
export interface AssetPricing {
  asset: string;
  pricing: Pricing;
  coin: CoinChoice | null;
  suggested: string | null;
  sources: string[];
  ignored: string[];
  overridden: boolean;
  /** Other relevant coins carry the ticker; null = none or settled. */
  shared: SharedTicker | null;
}
