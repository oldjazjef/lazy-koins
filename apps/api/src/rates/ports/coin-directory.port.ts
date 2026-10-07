import type {
  CoinCandidate,
  CoinProvider,
  MarketCoin,
} from '../domain/coin-choice';

/**
 * A price provider's coin directory (F7.4, "Coin wählen"): search coins by symbol/name and look
 * one up by id, so the user sees which coin they pick instead of typing an id blind. One port for
 * every provider — the adapter dispatches by `provider` (today CoinGecko; CoinMarketCap plugs in
 * as another entry). Only on the user's explicit action, never in a calculation; specs use a fake.
 *
 * Errors: a provider failure throws (`RateSourceError` with its HTTP status, or a network error);
 * an unknown id is `undefined`.
 */
export abstract class CoinDirectoryPort {
  /** The providers this directory can ask. */
  abstract readonly providers: readonly CoinProvider[];

  /** Coins whose symbol, name or id matches `query` — best first, at most `limit`. */
  abstract search(
    provider: CoinProvider,
    query: string,
    options: { readonly apiKey?: string; readonly limit: number },
  ): Promise<CoinCandidate[]>;

  /** One coin by its provider id; `undefined` when the provider does not know it. */
  abstract find(
    provider: CoinProvider,
    id: string,
    options: { readonly apiKey?: string },
  ): Promise<CoinCandidate | undefined>;

  /**
   * The coin of a token contract (`platform` = the provider's chain id, e.g. CoinGecko
   * `ethereum`, `base`; `address` as the chain writes it); `undefined` when the provider does not
   * list that contract.
   */
  abstract byContract(
    provider: CoinProvider,
    platform: string,
    address: string,
    options: { readonly apiKey?: string },
  ): Promise<CoinCandidate | undefined>;

  /**
   * The top `count` coins by market cap (rank, symbol, name, USD price) — the deployment-wide
   * list that shows which coins share a ticker. Several requests (pages) through the gate.
   */
  abstract topCoins(
    provider: CoinProvider,
    count: number,
    options: { readonly apiKey?: string },
  ): Promise<MarketCoin[]>;
}
