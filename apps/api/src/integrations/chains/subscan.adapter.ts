import {
  type ChainMovement,
  type NetworkId,
  unitsToDecimal,
} from '@lazykoins/engine';
import { DEFAULT_URLS } from '../../wallets/domain/chain-settings';
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
  isoFromUnix,
  redact,
} from './chain-http';

const ROWS = 100;
const MAX_PAGES = 100;

/**
 * Polkadot through **Subscan** (API key, free plan). Fetched: staking rewards (income,
 * `reward_slash`, planck → DOT with 10 decimals) and the current balance (information). The
 * balance at 31.12. is entered by hand with a receipt (F6.5) — network coverage `income`.
 */
export class SubscanAdapter extends ChainDataPort {
  readonly family = 'polkadot' as const;
  private readonly http: ChainHttpClient;

  constructor(
    fetcher: Fetcher = fetch,
    spacingMs = 300,
    private readonly baseUrl: string = DEFAULT_URLS.subscan,
  ) {
    super();
    this.http = new ChainHttpClient(fetcher, spacingMs);
  }

  private async call(
    connection: ChainConnection,
    path: string,
    body: unknown,
  ): Promise<Record<string, unknown> | null> {
    const key = connection.subscanKey;
    if (!key) throw new ChainDataError('notConfigured');
    const { body: answer } = await this.http.request({
      url: `${this.baseUrl}${path}`,
      method: 'POST',
      body,
      headers: { 'x-api-key': key },
      secrets: [key, ...connection.secrets],
    });
    const record = asRecord(answer);
    const code = asText(record['code']);
    if (code === '0') return asRecord(record['data']);
    // 10004 = Record Not Found: the account never appeared on chain.
    if (code === '10004') return null;
    const message = redact(asText(record['message']) ?? '', [key]) || null;
    if (/api key|unauthori/i.test(message ?? '')) {
      throw new ChainDataError('invalidKey', message);
    }
    if (/rate|limit/i.test(message ?? '')) {
      throw new ChainDataError('rateLimited', message);
    }
    if (/invalid.*(address|account)/i.test(message ?? '')) {
      throw new ChainDataError('invalidAddress', message);
    }
    throw new ChainDataError('providerError', message);
  }

  async activity(
    connection: ChainConnection,
    _network: NetworkId,
    address: string,
  ): Promise<NetworkActivity> {
    const data = await this.call(connection, '/api/v2/scan/search', {
      key: address,
    });
    if (!data) return { used: false, txCount: null };
    const account = asRecord(data['account']);
    const count = Number(asText(account['count_extrinsic']) ?? 'NaN');
    const balance = asText(account['balance']) ?? '0';
    return {
      used:
        (Number.isFinite(count) && count > 0) || !/^0(\.0*)?$/.test(balance),
      txCount: Number.isFinite(count) ? count : null,
    };
  }

  async history(
    connection: ChainConnection,
    _network: NetworkId,
    address: string,
  ): Promise<ChainHistory> {
    const search = await this.call(connection, '/api/v2/scan/search', {
      key: address,
    });
    const movements: ChainMovement[] = [];
    let truncated = true;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const data = await this.call(
        connection,
        '/api/v2/scan/account/reward_slash',
        { address, row: ROWS, page, category: 'Reward' },
      );
      const list = asArray(data?.['list']).map(asRecord);
      for (const item of list) {
        const amount = asText(item['amount']);
        const timestamp = isoFromUnix(asText(item['block_timestamp']));
        if (!amount || !/^\d+$/.test(amount) || !timestamp) continue;
        movements.push({
          txHash:
            asText(item['event_index']) ??
            asText(item['extrinsic_index']) ??
            `reward:${timestamp}`,
          timestamp,
          asset: 'DOT',
          tokenId: null,
          tokenName: null,
          quantity: unitsToDecimal(amount, 10),
          fee: null,
          feeAsset: null,
          type: 'reward',
          counterparty: null,
          verified: null,
        });
      }
      if (list.length < ROWS) {
        truncated = false;
        break;
      }
    }
    const balance = asText(asRecord(search?.['account'])['balance']);
    return {
      movements,
      info: {
        truncated,
        currentBalances:
          balance && /^\d+(\.\d+)?$/.test(balance)
            ? [{ asset: 'DOT', quantity: balance }]
            : [],
        notes: ['balanceManual'],
      },
    };
  }

  async test(connection: ChainConnection): Promise<string> {
    const data = await this.call(connection, '/api/scan/metadata', {});
    const block = asText(data?.['blockNum']);
    if (!block) throw new ChainDataError('badResponse');
    return `Block ${block}`;
  }
}
