import {
  type ChainMovement,
  type NetworkId,
  networkInfo,
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

const PAGE = 1000;
const MAX_PAGES = 50;

type Action = 'txlist' | 'txlistinternal' | 'tokentx';

/**
 * EVM chains through **Etherscan API V2** — one key for every chain, `chainid` selects it
 * (Ethereum 1, BNB Chain 56, Polygon 137, Arbitrum 42161, Optimism 10, Base 8453). The history
 * is `txlist` (normal transactions), `txlistinternal` (value moved by contracts) and `tokentx`
 * (ERC-20 transfers), paged by start block (the API stops at 10 000 rows per query).
 *
 * Balance rule (FACHREGELN, EVM-Wallet): incoming +, outgoing − including gas
 * `gasUsed × gasPrice` for successful transactions; a failed transaction moves no value but its
 * gas is paid (booked as a fee). On OP-stack chains (Optimism, Base) the L1 data fee is not part
 * of `gasUsed × gasPrice` — noted on the fetch. Free plans spaced to 4 calls a second.
 */
export class EtherscanAdapter extends ChainDataPort {
  readonly family = 'evm' as const;
  private readonly http: ChainHttpClient;

  constructor(
    fetcher: Fetcher = fetch,
    spacingMs = 250,
    private readonly baseUrl: string = DEFAULT_URLS.etherscan,
  ) {
    super();
    this.http = new ChainHttpClient(fetcher, spacingMs);
  }

  private key(connection: ChainConnection): string {
    if (!connection.etherscanKey) throw new ChainDataError('notConfigured');
    return connection.etherscanKey;
  }

  private chainId(network: NetworkId): number {
    const chainId = networkInfo(network).chainId;
    if (chainId === undefined) throw new ChainDataError('unsupported');
    return chainId;
  }

  private async call(
    connection: ChainConnection,
    network: NetworkId,
    params: Record<string, string>,
  ): Promise<unknown> {
    const key = this.key(connection);
    const query = new URLSearchParams({
      chainid: String(this.chainId(network)),
      ...params,
      apikey: key,
    });
    const { body } = await this.http.request({
      url: `${this.baseUrl}?${query.toString()}`,
      secrets: [key, ...connection.secrets],
    });
    const record = asRecord(body);
    // JSON-RPC proxy answers ({ result: "0x…" }) carry no status.
    if (record['status'] === undefined && record['jsonrpc'] !== undefined) {
      if (record['error'] !== undefined) {
        throw new ChainDataError(
          'providerError',
          redact(JSON.stringify(record['error']), [key]),
        );
      }
      const result = asText(record['result']);
      if (result !== null && !/^0x[0-9a-f]*$/i.test(result)) {
        throw etherscanError(result, key);
      }
      return record['result'];
    }
    const status = asText(record['status']);
    const message = asText(record['message']) ?? '';
    if (status === '1') return record['result'];
    if (/no (transactions|records) found/i.test(message)) return [];
    const result = asText(record['result']) ?? message;
    throw etherscanError(result, key);
  }

  private async paged(
    connection: ChainConnection,
    network: NetworkId,
    action: Action,
    address: string,
  ): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
    const seen = new Set<string>();
    const rows: Record<string, unknown>[] = [];
    let startBlock = '0';
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const batch = asArray(
        await this.call(connection, network, {
          module: 'account',
          action,
          address,
          startblock: startBlock,
          endblock: '999999999',
          page: '1',
          offset: String(PAGE),
          sort: 'asc',
        }),
      ).map(asRecord);
      for (const row of batch) {
        const key = [
          row['hash'],
          row['logIndex'],
          row['traceId'],
          row['from'],
          row['to'],
          row['value'],
          row['contractAddress'],
        ].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(row);
      }
      if (batch.length < PAGE) return { rows, truncated: false };
      const last = asText(batch[batch.length - 1]?.['blockNumber']);
      if (last === null || last === startBlock) {
        return { rows, truncated: true };
      }
      startBlock = last;
    }
    return { rows, truncated: true };
  }

  async activity(
    connection: ChainConnection,
    network: NetworkId,
    address: string,
  ): Promise<NetworkActivity> {
    const probe = (action: Action) =>
      this.call(connection, network, {
        module: 'account',
        action,
        address,
        startblock: '0',
        endblock: '999999999',
        page: '1',
        offset: '1',
        sort: 'asc',
      }).then((result) => asArray(result).length > 0);
    const normal = await probe('txlist');
    const internal = await probe('txlistinternal');
    const tokens = await probe('tokentx');
    const nonceHex = asText(
      await this.call(connection, network, {
        module: 'proxy',
        action: 'eth_getTransactionCount',
        address,
        tag: 'latest',
      }),
    );
    const nonce =
      nonceHex && /^0x[0-9a-f]+$/i.test(nonceHex)
        ? Number.parseInt(nonceHex, 16)
        : null;
    return {
      used: normal || internal || tokens || (nonce ?? 0) > 0,
      txCount: nonce,
    };
  }

  async history(
    connection: ChainConnection,
    network: NetworkId,
    address: string,
  ): Promise<ChainHistory> {
    const info = networkInfo(network);
    const me = address.toLowerCase();
    const normal = await this.paged(connection, network, 'txlist', address);
    const internal = await this.paged(
      connection,
      network,
      'txlistinternal',
      address,
    );
    const tokens = await this.paged(connection, network, 'tokentx', address);
    const movements: ChainMovement[] = [];
    const native = info.nativeAsset;
    const nativeDecimals = info.nativeDecimals;

    for (const tx of normal.rows) {
      const hash = asText(tx['hash']);
      const timestamp = isoFromUnix(asText(tx['timeStamp']));
      if (!hash || !timestamp) continue;
      const from = (asText(tx['from']) ?? '').toLowerCase();
      const to = (asText(tx['to']) ?? '').toLowerCase();
      const value = unitsToDecimal(asText(tx['value']) ?? '0', nativeDecimals);
      const failed =
        asText(tx['isError']) === '1' || asText(tx['txreceipt_status']) === '0';
      const outgoing = from === me;
      const incoming = to === me;
      if (!outgoing && !incoming) continue;
      if (!outgoing && failed) continue;
      let fee: string | null = null;
      if (outgoing) {
        const gasUsed = BigInt(asText(tx['gasUsed']) ?? '0');
        const gasPrice = BigInt(asText(tx['gasPrice']) ?? '0');
        fee = unitsToDecimal((gasUsed * gasPrice).toString(), nativeDecimals);
      }
      let quantity = '0';
      if (!failed) {
        if (outgoing && !incoming) quantity = negate(value);
        if (incoming && !outgoing) quantity = value;
      }
      movements.push({
        txHash: hash,
        timestamp,
        asset: native,
        tokenId: null,
        tokenName: null,
        quantity,
        fee: fee !== null && fee !== '0' ? fee : null,
        feeAsset: fee !== null && fee !== '0' ? native : null,
        type: failed ? 'failed' : 'transfer',
        counterparty: outgoing ? to || null : from || null,
        verified: null,
      });
    }

    for (const tx of internal.rows) {
      const hash = asText(tx['hash']);
      const timestamp = isoFromUnix(asText(tx['timeStamp']));
      if (!hash || !timestamp || asText(tx['isError']) === '1') continue;
      const from = (asText(tx['from']) ?? '').toLowerCase();
      const to = (asText(tx['to']) ?? '').toLowerCase();
      if ((from === me) === (to === me)) continue;
      const value = unitsToDecimal(asText(tx['value']) ?? '0', nativeDecimals);
      if (value === '0') continue;
      movements.push({
        txHash: hash,
        timestamp,
        asset: native,
        tokenId: null,
        tokenName: null,
        quantity: from === me ? negate(value) : value,
        fee: null,
        feeAsset: null,
        type: 'transfer',
        counterparty: from === me ? to : from,
        verified: null,
      });
    }

    for (const tx of tokens.rows) {
      const hash = asText(tx['hash']);
      const timestamp = isoFromUnix(asText(tx['timeStamp']));
      const contract = (asText(tx['contractAddress']) ?? '').toLowerCase();
      if (!hash || !timestamp || !contract) continue;
      const from = (asText(tx['from']) ?? '').toLowerCase();
      const to = (asText(tx['to']) ?? '').toLowerCase();
      if ((from === me) === (to === me)) continue;
      const decimals = Number(asText(tx['tokenDecimal']) ?? '0');
      let value: string;
      try {
        value = unitsToDecimal(
          asText(tx['value']) ?? '0',
          Number.isInteger(decimals) && decimals >= 0 && decimals <= 36
            ? decimals
            : 0,
        );
      } catch {
        continue;
      }
      const symbol = (asText(tx['tokenSymbol']) ?? '').trim();
      movements.push({
        txHash: hash,
        timestamp,
        asset: cleanSymbol(symbol) || `TOKEN-${contract.slice(2, 8)}`,
        tokenId: contract,
        tokenName: (asText(tx['tokenName']) ?? '').trim().slice(0, 120) || null,
        quantity: from === me ? negate(value) : value,
        fee: null,
        feeAsset: null,
        type: 'transfer',
        counterparty: from === me ? to : from,
        verified: null,
      });
    }

    const notes: string[] = [];
    if (network === 'optimism' || network === 'base') {
      notes.push('l1FeeNotIncluded');
    }
    return {
      movements,
      info: {
        truncated: normal.truncated || internal.truncated || tokens.truncated,
        notes,
      },
    };
  }

  async test(connection: ChainConnection, network: NetworkId): Promise<string> {
    const block = asText(
      await this.call(connection, network, {
        module: 'proxy',
        action: 'eth_blockNumber',
      }),
    );
    if (!block || !/^0x[0-9a-f]+$/i.test(block)) {
      throw new ChainDataError('badResponse');
    }
    return `Block ${Number.parseInt(block, 16)}`;
  }
}

/** Etherscan's error texts → codes (the text stays as detail, redacted). */
function etherscanError(text: string, key: string): ChainDataError {
  const detail = redact(text, [key]) || null;
  if (
    /invalid api key|missing\/invalid api key|api key.*(invalid|missing)/i.test(
      text,
    )
  ) {
    return new ChainDataError('invalidKey', detail);
  }
  if (/rate limit|max calls/i.test(text)) {
    return new ChainDataError('rateLimited', detail);
  }
  if (
    /not supported for this chain|upgrade your api plan|free api access/i.test(
      text,
    )
  ) {
    return new ChainDataError('chainNotOnPlan', detail);
  }
  if (/invalid address|invalid.*format/i.test(text)) {
    return new ChainDataError('invalidAddress', detail);
  }
  return new ChainDataError('providerError', detail);
}

function negate(value: string): string {
  if (value === '0') return '0';
  return value.startsWith('-') ? value.slice(1) : `-${value}`;
}

/** Token symbols are user-chosen by the token's creator: keep them printable and short. */
function cleanSymbol(symbol: string): string {
  // eslint-disable-next-line no-control-regex
  return symbol.replace(/[\u0000-\u001f\u007f,;]/g, '').slice(0, 40);
}
