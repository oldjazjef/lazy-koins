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
  deriveAddress,
  extendedKind,
  parseExtendedKey,
} from './bitcoin-derivation';
import {
  asArray,
  asRecord,
  asText,
  ChainHttpClient,
  type Fetcher,
  isoFromUnix,
} from './chain-http';

/** BIP44 gap limit: stop after this many unused addresses in a row, per chain. */
export const GAP_LIMIT = 20;
const MAX_ADDRESSES = 400;
const MAX_PAGES_PER_ADDRESS = 80;

/**
 * Bitcoin through any **Esplora**-compatible API (default mempool.space, configurable). A single
 * address, or an xpub/ypub/zpub whose receive (0) and change (1) addresses are derived until
 * `GAP_LIMIT` unused ones in a row. Each transaction becomes one movement for the whole wallet:
 * received to own addresses − spent from own addresses; when the wallet paid, the network fee is
 * its fee (Σ Menge − Σ Gebühr = balance). Unconfirmed transactions are left out.
 */
export class EsploraAdapter extends ChainDataPort {
  readonly family = 'bitcoin' as const;
  private readonly http: ChainHttpClient;

  constructor(fetcher: Fetcher = fetch, spacingMs = 200) {
    super();
    this.http = new ChainHttpClient(fetcher, spacingMs);
  }

  private base(connection: ChainConnection): string {
    return connection.esploraUrl.replace(/\/+$/, '');
  }

  private async txCount(
    connection: ChainConnection,
    address: string,
  ): Promise<number> {
    const { body } = await this.http.request({
      url: `${this.base(connection)}/address/${encodeURIComponent(address)}`,
      secrets: connection.secrets,
    });
    const record = asRecord(body);
    const chain = Number(asText(asRecord(record['chain_stats'])['tx_count']));
    const pool = Number(asText(asRecord(record['mempool_stats'])['tx_count']));
    if (!Number.isFinite(chain)) throw new ChainDataError('badResponse');
    return chain + (Number.isFinite(pool) ? pool : 0);
  }

  /** The wallet's addresses with transactions (all derived ones for an extended key). */
  private async usedAddresses(
    connection: ChainConnection,
    address: string,
  ): Promise<{
    used: { address: string; txCount: number }[];
    scanned: number;
  }> {
    if (!extendedKind(address)) {
      const count = await this.txCount(connection, address);
      return {
        used: count > 0 ? [{ address, txCount: count }] : [],
        scanned: 1,
      };
    }
    let parsed: ReturnType<typeof parseExtendedKey>;
    try {
      parsed = parseExtendedKey(address);
    } catch {
      throw new ChainDataError('invalidAddress');
    }
    const used: { address: string; txCount: number }[] = [];
    let scanned = 0;
    for (const chain of [0, 1] as const) {
      let gap = 0;
      for (let index = 0; gap < GAP_LIMIT; index += 1) {
        if (scanned >= MAX_ADDRESSES) return { used, scanned };
        const derived = deriveAddress(parsed, chain, index);
        const count = await this.txCount(connection, derived);
        scanned += 1;
        if (count > 0) {
          used.push({ address: derived, txCount: count });
          gap = 0;
        } else {
          gap += 1;
        }
      }
    }
    return { used, scanned };
  }

  async activity(
    connection: ChainConnection,
    _network: NetworkId,
    address: string,
  ): Promise<NetworkActivity> {
    const { used } = await this.usedAddresses(connection, address);
    const txCount = used.reduce((sum, a) => sum + a.txCount, 0);
    return { used: txCount > 0, txCount };
  }

  async history(
    connection: ChainConnection,
    _network: NetworkId,
    address: string,
  ): Promise<ChainHistory> {
    const { used, scanned } = await this.usedAddresses(connection, address);
    const own = new Set(used.map((a) => a.address));
    const txs = new Map<string, Record<string, unknown>>();
    let truncated = scanned >= MAX_ADDRESSES;
    for (const { address: addr } of used) {
      let lastSeen: string | null = null;
      for (let page = 0; ; page += 1) {
        if (page >= MAX_PAGES_PER_ADDRESS) {
          truncated = true;
          break;
        }
        const path: string =
          lastSeen === null
            ? `/address/${encodeURIComponent(addr)}/txs`
            : `/address/${encodeURIComponent(addr)}/txs/chain/${encodeURIComponent(lastSeen)}`;
        const { body } = await this.http.request({
          url: `${this.base(connection)}${path}`,
          secrets: connection.secrets,
        });
        const batch = asArray(body).map(asRecord);
        const confirmed = batch.filter(
          (tx) => asRecord(tx['status'])['confirmed'] === true,
        );
        for (const tx of confirmed) {
          const txid = asText(tx['txid']);
          if (txid) txs.set(txid, tx);
        }
        // Esplora pages confirmed transactions by 25.
        if (confirmed.length < 25) break;
        lastSeen = asText(confirmed[confirmed.length - 1]?.['txid']);
        if (lastSeen === null) break;
      }
    }

    const movements: ChainMovement[] = [];
    for (const [txid, tx] of txs) {
      const timestamp = isoFromUnix(
        asText(asRecord(tx['status'])['block_time']),
      );
      if (!timestamp) continue;
      let spent = 0n;
      let received = 0n;
      for (const input of asArray(tx['vin']).map(asRecord)) {
        const prevout = asRecord(input['prevout']);
        const from = asText(prevout['scriptpubkey_address']);
        if (from && own.has(from))
          spent += BigInt(asText(prevout['value']) ?? '0');
      }
      for (const output of asArray(tx['vout']).map(asRecord)) {
        const to = asText(output['scriptpubkey_address']);
        if (to && own.has(to))
          received += BigInt(asText(output['value']) ?? '0');
      }
      const fee = BigInt(asText(tx['fee']) ?? '0');
      const paid = spent > 0n;
      // Σ quantity − Σ fee = received − spent.
      const quantity = paid ? received - spent + fee : received;
      if (quantity === 0n && !paid) continue;
      movements.push({
        txHash: txid,
        timestamp,
        asset: 'BTC',
        tokenId: null,
        tokenName: null,
        quantity: unitsToDecimal(quantity.toString(), 8),
        fee: paid && fee > 0n ? unitsToDecimal(fee.toString(), 8) : null,
        feeAsset: paid && fee > 0n ? 'BTC' : null,
        type: 'transfer',
        counterparty: null,
        verified: null,
      });
    }
    return {
      movements,
      info: {
        truncated,
        addressesScanned: scanned,
        addressesUsed: used.length,
      },
    };
  }

  async test(connection: ChainConnection): Promise<string> {
    const { body } = await this.http.request({
      url: `${this.base(connection)}/blocks/tip/height`,
      secrets: connection.secrets,
    });
    const height = asText(body);
    if (height === null || !/^\d+$/.test(height)) {
      throw new ChainDataError('badResponse');
    }
    return `Block ${height}`;
  }
}
