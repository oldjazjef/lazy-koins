import { BitfinexSource } from './bitfinex.source';
import { CoinbaseSource } from './coinbase.source';
import { CoinGeckoHistorySource } from './coingecko.source';
import { CoinMarketCapSource } from './coinmarketcap.source';
import { CoinPaprikaSource } from './coinpaprika.source';
import { DefiLlamaSource } from './defillama.source';
import { KrakenSource } from './kraken.source';
import type { PriceHttpOptions } from './price-history-http';
import {
  type PriceHistorySourcePort,
  PriceHistorySourcesPort,
  type PriceSourceId,
} from './price-history-source.port';

/** Every price-history adapter, one instance each (each keeps its own serial gate). */
export class PriceHistorySources extends PriceHistorySourcesPort {
  private readonly byIdMap: ReadonlyMap<PriceSourceId, PriceHistorySourcePort>;

  constructor(private readonly sources: readonly PriceHistorySourcePort[]) {
    super();
    this.byIdMap = new Map(sources.map((source) => [source.id, source]));
  }

  /** The real adapters (`options` = a fake fetch and clock in tests). */
  static real(options: PriceHttpOptions = {}): PriceHistorySources {
    return new PriceHistorySources([
      new CoinMarketCapSource(options),
      new CoinGeckoHistorySource(options),
      new DefiLlamaSource(options),
      new CoinPaprikaSource(options),
      new KrakenSource(options),
      new BitfinexSource(options),
      new CoinbaseSource(options),
    ]);
  }

  all(): readonly PriceHistorySourcePort[] {
    return this.sources;
  }

  byId(id: PriceSourceId): PriceHistorySourcePort {
    const source = this.byIdMap.get(id);
    if (!source) throw new RangeError(`unknown price source: ${id}`);
    return source;
  }
}
