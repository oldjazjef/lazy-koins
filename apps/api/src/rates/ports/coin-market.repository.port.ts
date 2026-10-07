import type { CoinProvider, MarketCoin } from '../domain/coin-choice';

/**
 * The provider's top coins by market cap (F7.4, `coin_market`), deployment-wide: which coins
 * share a ticker. Replaced as a whole by each refresh (at most daily).
 */
export abstract class CoinMarketRepositoryPort {
  /** When the list of `provider` was last stored; `null` before the first time. */
  abstract fetchedAt(provider: CoinProvider): Promise<string | null>;

  /** The stored coins carrying one of `symbols` (upper case). */
  abstract listBySymbols(
    provider: CoinProvider,
    symbols: readonly string[],
  ): Promise<MarketCoin[]>;

  /**
   * The stored coins up to `maxRank` whose symbol at least one other such coin carries — the
   * only rows that can make a ticker shared (a few dozen out of thousands).
   */
  abstract listShared(
    provider: CoinProvider,
    maxRank: number,
  ): Promise<MarketCoin[]>;

  /** Replaces the provider's whole list (one transaction). */
  abstract replace(
    provider: CoinProvider,
    coins: readonly MarketCoin[],
    fetchedAt: string,
  ): Promise<void>;
}
