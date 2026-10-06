import {
  type ChainMovement,
  type NetworkId,
  unitsToDecimal,
} from '@lazykoins/engine';
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

/** Shelley: epoch 208 started 2020-07-29 21:44:51 UTC; every epoch lasts five days. */
const EPOCH_208_MS = Date.UTC(2020, 6, 29, 21, 44, 51);
const EPOCH_MS = 5 * 86_400_000;

export function cardanoEpochStart(epoch: number): string {
  return new Date(EPOCH_208_MS + (epoch - 208) * EPOCH_MS).toISOString();
}

/**
 * Cardano through **Koios** (free, no key needed). What the free API allows without a full UTxO
 * replay: the **staking rewards** per epoch (income, F7.2 — dated at the start of the epoch in
 * which they became spendable) and the **current** balance (shown as information). The balance
 * at 31.12. is entered by hand with a receipt (F6.5) — network coverage `income`.
 * A payment address (`addr1…`) is resolved to its stake address first.
 */
export class KoiosAdapter extends ChainDataPort {
  readonly family = 'cardano' as const;
  private readonly http: ChainHttpClient;

  constructor(fetcher: Fetcher = fetch, spacingMs = 300) {
    super();
    this.http = new ChainHttpClient(fetcher, spacingMs);
  }

  private async post(
    connection: ChainConnection,
    path: string,
    body: unknown,
  ): Promise<unknown[]> {
    const { body: answer } = await this.http.request({
      url: `${connection.koiosUrl.replace(/\/+$/, '')}${path}`,
      method: 'POST',
      body,
      secrets: connection.secrets,
    });
    if (!Array.isArray(answer)) throw new ChainDataError('badResponse');
    return answer;
  }

  /** The stake address, and whether the payment address itself has UTxOs. */
  private async stakeOf(
    connection: ChainConnection,
    address: string,
  ): Promise<{ stake: string | null; addressUsed: boolean }> {
    if (address.startsWith('stake1'))
      return { stake: address, addressUsed: false };
    const [info] = (
      await this.post(connection, '/address_info', { _addresses: [address] })
    ).map(asRecord);
    if (!info) return { stake: null, addressUsed: false };
    return {
      stake: asText(info['stake_address']),
      addressUsed:
        asArray(info['utxo_set']).length > 0 ||
        (asText(info['balance']) ?? '0') !== '0',
    };
  }

  private async account(
    connection: ChainConnection,
    stake: string,
  ): Promise<Record<string, unknown> | undefined> {
    const [info] = (
      await this.post(connection, '/account_info', {
        _stake_addresses: [stake],
      })
    ).map(asRecord);
    return info;
  }

  async activity(
    connection: ChainConnection,
    _network: NetworkId,
    address: string,
  ): Promise<NetworkActivity> {
    const { stake, addressUsed } = await this.stakeOf(connection, address);
    if (addressUsed) return { used: true, txCount: null };
    if (!stake) return { used: false, txCount: null };
    const account = await this.account(connection, stake);
    const used =
      account !== undefined &&
      (asText(account['status']) === 'registered' ||
        (asText(account['total_balance']) ?? '0') !== '0');
    return { used, txCount: null };
  }

  async history(
    connection: ChainConnection,
    _network: NetworkId,
    address: string,
  ): Promise<ChainHistory> {
    const { stake } = await this.stakeOf(connection, address);
    if (!stake) {
      return { movements: [], info: { notes: ['balanceManual'] } };
    }
    const account = await this.account(connection, stake);
    const rows = await this.post(connection, '/account_rewards', {
      _stake_addresses: [stake],
    });
    // Older Koios nests the list per stake address; newer answers are flat.
    const rewards = rows
      .map(asRecord)
      .flatMap((row) =>
        Array.isArray(row['rewards']) ? row['rewards'].map(asRecord) : [row],
      );
    const movements: ChainMovement[] = [];
    for (const reward of rewards) {
      const amount = asText(reward['amount']);
      const epoch = Number(asText(reward['spendable_epoch']));
      const earned = asText(reward['earned_epoch']) ?? '';
      if (!amount || !/^\d+$/.test(amount) || amount === '0') continue;
      if (!Number.isInteger(epoch) || epoch < 208) continue;
      const type = asText(reward['type']) ?? 'member';
      movements.push({
        txHash: `reward:${earned}:${asText(reward['pool_id']) ?? type}`,
        timestamp: cardanoEpochStart(epoch),
        asset: 'ADA',
        tokenId: null,
        tokenName: null,
        quantity: unitsToDecimal(amount, 6),
        fee: null,
        feeAsset: null,
        type: 'reward',
        counterparty: null,
        verified: null,
      });
    }
    const total = asText(account?.['total_balance']);
    return {
      movements,
      info: {
        currentBalances:
          total && /^\d+$/.test(total)
            ? [{ asset: 'ADA', quantity: unitsToDecimal(total, 6) }]
            : [],
        notes: ['balanceManual'],
      },
    };
  }

  async test(connection: ChainConnection): Promise<string> {
    const { body } = await this.http.request({
      url: `${connection.koiosUrl.replace(/\/+$/, '')}/tip`,
      secrets: connection.secrets,
    });
    const tip = asRecord(asArray(body)[0]);
    const epoch = asText(tip['epoch_no']);
    if (!epoch) throw new ChainDataError('badResponse');
    return `Epoch ${epoch}`;
  }
}
