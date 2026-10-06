import type {
  ChainMovement,
  NetworkFamily,
  NetworkId,
} from '@lazykoins/engine';
import {
  type ChainConnection,
  ChainDataError,
  ChainDataPort,
  type ChainHistory,
  type NetworkActivity,
} from '../../wallets/ports/chain-data.port';

/**
 * `LK_CHAINS_FAKE=1`: a synthetic chain for every family — no network, deterministic, the same
 * answers for every address. Used for development and live runs without API keys. The EVM
 * address is "used" on Ethereum and Base, only spam arrived on Polygon, BNB Chain answers like a
 * free Etherscan plan ("upgrade your plan"), the other chains are unused. Never bound unless the
 * switch is set (outside production).
 */
const FAKE_EVM: Partial<Record<NetworkId, ChainMovement[]>> = {
  ethereum: [
    move('0xfa01', '2024-11-03T09:15:00.000Z', 'ETH', '1.2', {
      counterparty: '0x5555555555555555555555555555555555555555',
    }),
    move('0xfa02', '2025-02-14T16:40:00.000Z', 'ETH', '-0.3', {
      fee: '0.000525',
      feeAsset: 'ETH',
      counterparty: '0x6666666666666666666666666666666666666666',
    }),
    move('0xfa03', '2025-05-20T08:00:00.000Z', 'ETH', '0', {
      fee: '0.0011',
      feeAsset: 'ETH',
    }),
    move('0xfa03', '2025-05-20T08:00:00.000Z', 'USDC', '-50', {
      tokenId: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      tokenName: 'USD Coin',
      counterparty: '0x6666666666666666666666666666666666666666',
    }),
    move('0xfa00', '2024-12-01T12:00:00.000Z', 'USDC', '300', {
      tokenId: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      tokenName: 'USD Coin',
      counterparty: '0x5555555555555555555555555555555555555555',
    }),
    move('0xfa04', '2025-07-07T07:07:00.000Z', 'ETH', '-0.05', {
      fee: '0.0004',
      feeAsset: 'ETH',
      type: 'failed',
    }),
    move('0xfa05', '2025-09-09T09:09:00.000Z', 'USDT', '5000', {
      tokenId: '0x00000000000000000000000000000000000c1a1e',
      tokenName: 'Claim rewards at usdt-bonus.example',
      counterparty: '0x7777777777777777777777777777777777777777',
    }),
  ],
  polygon: [
    move('0xfb01', '2025-03-03T03:03:00.000Z', 'AIRDROP', '1000', {
      tokenId: '0x0000000000000000000000000000000000a1d0f1',
      tokenName: 'Visit claim-airdrop.example to claim',
      counterparty: '0x8888888888888888888888888888888888888888',
    }),
  ],
  base: [
    move('0xfc01', '2025-06-01T10:00:00.000Z', 'ETH', '0.4', {
      counterparty: '0x5555555555555555555555555555555555555555',
    }),
    move('0xfc02', '2025-06-02T10:00:00.000Z', 'ETH', '-0.1', {
      fee: '0.00002',
      feeAsset: 'ETH',
      counterparty: '0x6666666666666666666666666666666666666666',
    }),
  ],
};

const FAKE_OTHER: Partial<Record<NetworkFamily, ChainMovement[]>> = {
  bitcoin: [
    move('f00d01', '2023-04-01T10:00:00.000Z', 'BTC', '0.05'),
    move('f00d02', '2025-01-15T10:00:00.000Z', 'BTC', '0.01'),
    move('f00d03', '2025-08-20T10:00:00.000Z', 'BTC', '-0.02', {
      fee: '0.00001234',
      feeAsset: 'BTC',
    }),
  ],
  solana: [
    move('5igFake1', '2025-02-02T02:02:00.000Z', 'SOL', '12.5'),
    move('5igFake2', '2025-04-04T04:04:00.000Z', 'SOL', '-2', {
      fee: '0.000005',
      feeAsset: 'SOL',
    }),
    move('5igFake3', '2025-04-05T04:04:00.000Z', 'USDC', '120', {
      tokenId: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      verified: true,
    }),
  ],
  cardano: [
    move('reward:500:pool1fake', '2024-08-01T21:44:51.000Z', 'ADA', '3.25', {
      type: 'reward',
    }),
    move('reward:540:pool1fake', '2025-02-27T21:44:51.000Z', 'ADA', '3.5', {
      type: 'reward',
    }),
    move('reward:560:pool1fake', '2025-06-06T21:44:51.000Z', 'ADA', '3.75', {
      type: 'reward',
    }),
  ],
  polkadot: [
    move('25000000-12', '2025-03-10T00:00:00.000Z', 'DOT', '0.42', {
      type: 'reward',
    }),
    move('25500000-7', '2025-10-10T00:00:00.000Z', 'DOT', '0.44', {
      type: 'reward',
    }),
  ],
};

const FAKE_BALANCES: Partial<Record<NetworkFamily, string>> = {
  cardano: 'ADA:1250.5',
  polkadot: 'DOT:120.3',
  cosmos: 'ATOM:42.1',
};

function move(
  txHash: string,
  timestamp: string,
  asset: string,
  quantity: string,
  over: Partial<ChainMovement> = {},
): ChainMovement {
  return {
    txHash,
    timestamp,
    asset,
    tokenId: null,
    tokenName: null,
    quantity,
    fee: null,
    feeAsset: null,
    type: 'transfer',
    counterparty: null,
    verified: null,
    ...over,
  };
}

export class FakeChainAdapter extends ChainDataPort {
  constructor(readonly family: NetworkFamily) {
    super();
  }

  private movements(network: NetworkId): ChainMovement[] {
    if (this.family === 'evm') {
      if (network === 'bsc') {
        throw new ChainDataError(
          'chainNotOnPlan',
          'Free API access is not supported for this chain (fake)',
        );
      }
      return FAKE_EVM[network] ?? [];
    }
    return FAKE_OTHER[this.family] ?? [];
  }

  async activity(
    _connection: ChainConnection,
    network: NetworkId,
  ): Promise<NetworkActivity> {
    const used =
      this.movements(network).length > 0 || this.family === 'cosmos';
    return {
      used,
      txCount: used ? this.movements(network).length : 0,
    };
  }

  async history(
    _connection: ChainConnection,
    network: NetworkId,
  ): Promise<ChainHistory> {
    const balance = FAKE_BALANCES[this.family];
    const [asset, quantity] = balance ? balance.split(':') : [];
    return {
      movements: this.movements(network),
      info: {
        currentBalances:
          asset && quantity ? [{ asset, quantity }] : undefined,
        notes:
          this.family === 'cardano' || this.family === 'polkadot'
            ? ['balanceManual', 'fake']
            : this.family === 'cosmos'
              ? ['balanceManual', 'incomeManual', 'fake']
              : ['fake'],
      },
    };
  }

  async test(): Promise<string> {
    return `Fake ${this.family}`;
  }
}
