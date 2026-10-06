import { type NetworkId, unitsToDecimal } from '@lazykoins/engine';
import {
  type ChainConnection,
  ChainDataError,
  ChainDataPort,
  type ChainHistory,
  type NetworkActivity,
} from '../../wallets/ports/chain-data.port';
import {
  asArray,
  asRecord,
  asText,
  ChainHttpClient,
  type Fetcher,
} from './chain-http';

/**
 * Cosmos Hub through a public **LCD** (REST) endpoint. Free endpoints answer the present only
 * (account, balances, pending rewards) — no history by date and no claimed rewards without an
 * indexer (Mintscan needs a paid key). So: the activity check (F6.4) and the current balance as
 * information; balance at 31.12. and income are entered by hand with a receipt (F6.5) — network
 * coverage `manual`.
 */
export class CosmosLcdAdapter extends ChainDataPort {
  readonly family = 'cosmos' as const;
  private readonly http: ChainHttpClient;

  constructor(fetcher: Fetcher = fetch, spacingMs = 300) {
    super();
    this.http = new ChainHttpClient(fetcher, spacingMs);
  }

  private async get(
    connection: ChainConnection,
    path: string,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const { status, body } = await this.http.request({
      url: `${connection.cosmosLcdUrl.replace(/\/+$/, '')}${path}`,
      secrets: connection.secrets,
      acceptStatus: [404],
    });
    return { status, body: asRecord(body) };
  }

  async activity(
    connection: ChainConnection,
    _network: NetworkId,
    address: string,
  ): Promise<NetworkActivity> {
    const { status, body } = await this.get(
      connection,
      `/cosmos/auth/v1beta1/accounts/${encodeURIComponent(address)}`,
    );
    if (status === 404 || asText(body['code']) === '5') {
      return { used: false, txCount: null };
    }
    const account = asRecord(body['account']);
    const sequence = asText(
      account['sequence'] ?? asRecord(account['base_account'])['sequence'],
    );
    return {
      used: true,
      txCount: sequence && /^\d+$/.test(sequence) ? Number(sequence) : null,
    };
  }

  async history(
    connection: ChainConnection,
    _network: NetworkId,
    address: string,
  ): Promise<ChainHistory> {
    const { status, body } = await this.get(
      connection,
      `/cosmos/bank/v1beta1/balances/${encodeURIComponent(address)}`,
    );
    const balances =
      status === 404
        ? []
        : asArray(body['balances'])
            .map(asRecord)
            .filter((b) => asText(b['denom']) === 'uatom')
            .map((b) => asText(b['amount']))
            .filter((a): a is string => a !== null && /^\d+$/.test(a))
            .map((amount) => ({
              asset: 'ATOM',
              quantity: unitsToDecimal(amount, 6),
            }));
    return {
      movements: [],
      info: {
        currentBalances: balances,
        notes: ['balanceManual', 'incomeManual'],
      },
    };
  }

  async test(connection: ChainConnection): Promise<string> {
    const { body } = await this.get(
      connection,
      '/cosmos/base/tendermint/v1beta1/blocks/latest',
    );
    const height = asText(
      asRecord(asRecord(asRecord(body['block'])['header']))['height'],
    );
    if (!height) throw new ChainDataError('badResponse');
    return `Block ${height}`;
  }
}
