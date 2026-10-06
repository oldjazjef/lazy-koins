import type { NetworkFamily } from '@lazykoins/engine';
import {
  type ChainDataPort,
  ChainDataSourcesPort,
} from '../../wallets/ports/chain-data.port';
import { CosmosLcdAdapter } from './cosmos-lcd.adapter';
import { EsploraAdapter } from './esplora.adapter';
import { EtherscanAdapter } from './etherscan.adapter';
import { FakeChainAdapter } from './fake-chain.adapter';
import { KoiosAdapter } from './koios.adapter';
import { SolanaRpcAdapter } from './solana-rpc.adapter';
import { SubscanAdapter } from './subscan.adapter';

/**
 * One `ChainDataPort` adapter per network family — each a single instance, so its serial gate
 * and cache are shared by every user's requests (one queue per provider).
 */
export class ChainSources extends ChainDataSourcesPort {
  constructor(
    private readonly adapters: Readonly<Record<NetworkFamily, ChainDataPort>>,
  ) {
    super();
  }

  forFamily(family: NetworkFamily): ChainDataPort {
    return this.adapters[family];
  }

  static real(): ChainSources {
    return new ChainSources({
      evm: new EtherscanAdapter(),
      bitcoin: new EsploraAdapter(),
      solana: new SolanaRpcAdapter(),
      cardano: new KoiosAdapter(),
      polkadot: new SubscanAdapter(),
      cosmos: new CosmosLcdAdapter(),
    });
  }

  /** `LK_CHAINS_FAKE=1`: synthetic answers, no network (development, demos, e2e). */
  static fake(): ChainSources {
    return new ChainSources({
      evm: new FakeChainAdapter('evm'),
      bitcoin: new FakeChainAdapter('bitcoin'),
      solana: new FakeChainAdapter('solana'),
      cardano: new FakeChainAdapter('cardano'),
      polkadot: new FakeChainAdapter('polkadot'),
      cosmos: new FakeChainAdapter('cosmos'),
    });
  }
}
