import type {
  CoinCandidate,
  CoinProvider,
  MarketCoin,
} from '../../rates/domain/coin-choice';
import { CoinDirectoryPort } from '../../rates/ports/coin-directory.port';
import type {
  CoinCandidate as SourceCandidate,
  PriceHistorySourcesPort,
} from './price-history/price-history-source.port';

/**
 * "Coin wählen" across providers (F7.4, price sources phase 2): CoinGecko through its own
 * directory (shared gate with its price source, market list), CoinMarketCap through the
 * price-history adapter (`/v1/cryptocurrency/map?symbol=` for a search — no credits — and
 * `/v2/cryptocurrency/info?id=` to validate an id; always with the user's key). The market list
 * (`topCoins`) and contract lookups stay CoinGecko's.
 */
export class ProviderCoinDirectory extends CoinDirectoryPort {
  readonly providers: readonly CoinProvider[] = ['coingecko', 'coinmarketcap'];

  constructor(
    private readonly coingecko: CoinDirectoryPort,
    private readonly sources: PriceHistorySourcesPort,
  ) {
    super();
  }

  async search(
    provider: CoinProvider,
    query: string,
    options: { readonly apiKey?: string; readonly limit: number },
  ): Promise<CoinCandidate[]> {
    if (provider === 'coingecko') {
      return this.coingecko.search(provider, query, options);
    }
    const cmc = this.sources.byId('coinmarketcap');
    const found = (await cmc.searchCoins?.(query, options.apiKey)) ?? [];
    return found.slice(0, options.limit).map(toCandidate);
  }

  async find(
    provider: CoinProvider,
    id: string,
    options: { readonly apiKey?: string },
  ): Promise<CoinCandidate | undefined> {
    if (provider === 'coingecko') {
      return this.coingecko.find(provider, id, options);
    }
    const found = await this.sources
      .byId('coinmarketcap')
      .findCoin?.(id, options.apiKey);
    return found ? toCandidate(found) : undefined;
  }

  async byContract(
    provider: CoinProvider,
    platform: string,
    address: string,
    options: { readonly apiKey?: string },
  ): Promise<CoinCandidate | undefined> {
    if (provider !== 'coingecko') return undefined;
    return this.coingecko.byContract(provider, platform, address, options);
  }

  topCoins(
    provider: CoinProvider,
    count: number,
    options: { readonly apiKey?: string },
  ): Promise<MarketCoin[]> {
    if (provider !== 'coingecko') return Promise.resolve([]);
    return this.coingecko.topCoins(provider, count, options);
  }
}

function toCandidate(found: SourceCandidate): CoinCandidate {
  return {
    provider: 'coinmarketcap',
    id: found.id,
    name: found.name ?? found.symbol,
    symbol: found.symbol.toUpperCase(),
    marketCapRank: found.rank,
  };
}
