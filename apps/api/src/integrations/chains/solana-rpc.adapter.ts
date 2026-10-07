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
  isoFromUnix,
  redact,
} from './chain-http';

const SIGNATURE_PAGE = 1000;
const MAX_TRANSACTIONS = 3000;

/** Well-known SPL mints → symbol (anything else is named after its mint). */
const KNOWN_MINTS: Readonly<Record<string, string>> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT',
  So11111111111111111111111111111111111111112: 'WSOL',
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: 'MSOL',
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: 'JITOSOL',
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: 'JUP',
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: 'BONK',
};

/**
 * Solana through a JSON-RPC endpoint — Helius (`https://mainnet.helius-rpc.com/?api-key=…`), any
 * other RPC URL, or the public endpoint (heavily rate-limited). `getSignaturesForAddress` pages
 * the wallet's transactions; each is read with `getTransaction` (`jsonParsed`) and turned into
 * the wallet's balance changes: SOL from pre/post balances (the fee is the wallet's when it is
 * the fee payer, account 0), SPL tokens from pre/post token balances owned by the wallet. The
 * balance at a date follows from the history. Staking rewards of stake accounts are not part of
 * a wallet's history (enter them manually or by statement).
 */
export class SolanaRpcAdapter extends ChainDataPort {
  readonly family = 'solana' as const;
  private readonly http: ChainHttpClient;

  constructor(fetcher: Fetcher = fetch, spacingMs = 120) {
    super();
    this.http = new ChainHttpClient(fetcher, spacingMs);
  }

  private async rpc(
    connection: ChainConnection,
    method: string,
    params: unknown[],
  ): Promise<unknown> {
    const { body } = await this.http.request({
      url: connection.solanaRpcUrl,
      method: 'POST',
      body: { jsonrpc: '2.0', id: 1, method, params },
      secrets: connection.secrets,
    });
    const record = asRecord(body);
    if (record['error'] !== undefined) {
      const error = asRecord(record['error']);
      const message = redact(
        asText(error['message']) ?? 'RPC error',
        connection.secrets,
      );
      const code = Number(asText(error['code']));
      throw new ChainDataError(
        code === -32602
          ? 'invalidAddress'
          : code === 429
            ? 'rateLimited'
            : 'providerError',
        message,
      );
    }
    return record['result'];
  }

  private async signatures(
    connection: ChainConnection,
    address: string,
    limit: number,
  ): Promise<{ signatures: Record<string, unknown>[]; truncated: boolean }> {
    const out: Record<string, unknown>[] = [];
    let before: string | undefined;
    while (out.length < limit) {
      const batch = asArray(
        await this.rpc(connection, 'getSignaturesForAddress', [
          address,
          {
            limit: Math.min(SIGNATURE_PAGE, limit - out.length),
            ...(before ? { before } : {}),
          },
        ]),
      ).map(asRecord);
      out.push(...batch);
      if (batch.length < SIGNATURE_PAGE)
        return { signatures: out, truncated: false };
      before = asText(batch[batch.length - 1]?.['signature']) ?? undefined;
      if (!before) break;
    }
    return { signatures: out, truncated: out.length >= limit };
  }

  async activity(
    connection: ChainConnection,
    _network: NetworkId,
    address: string,
  ): Promise<NetworkActivity> {
    const { signatures } = await this.signatures(connection, address, 1);
    return { used: signatures.length > 0, txCount: null };
  }

  async history(
    connection: ChainConnection,
    _network: NetworkId,
    address: string,
  ): Promise<ChainHistory> {
    const { signatures, truncated } = await this.signatures(
      connection,
      address,
      MAX_TRANSACTIONS,
    );
    const movements: ChainMovement[] = [];
    for (const entry of signatures) {
      const signature = asText(entry['signature']);
      if (!signature) continue;
      const tx = asRecord(
        await this.rpc(connection, 'getTransaction', [
          signature,
          {
            encoding: 'jsonParsed',
            maxSupportedTransactionVersion: 0,
            commitment: 'finalized',
          },
        ]),
      );
      movements.push(...movementsOf(tx, signature, address));
    }
    return { movements, info: { truncated } };
  }

  async test(connection: ChainConnection): Promise<string> {
    const slot = asText(await this.rpc(connection, 'getSlot', []));
    if (slot === null || !/^\d+$/.test(slot)) {
      throw new ChainDataError('badResponse');
    }
    return `Slot ${slot}`;
  }
}

/** The wallet's balance changes in one parsed transaction. Exported for the tests. */
export function movementsOf(
  tx: Record<string, unknown>,
  signature: string,
  address: string,
): ChainMovement[] {
  const timestamp = isoFromUnix(asText(tx['blockTime']));
  const meta = asRecord(tx['meta']);
  if (!timestamp || Object.keys(meta).length === 0) return [];
  const failed = meta['err'] !== null && meta['err'] !== undefined;
  const message = asRecord(asRecord(tx['transaction'])['message']);
  const keys = asArray(message['accountKeys']).map((key) =>
    typeof key === 'string' ? key : (asText(asRecord(key)['pubkey']) ?? ''),
  );
  const index = keys.indexOf(address);
  const out: ChainMovement[] = [];
  const feePayer = index === 0;
  const fee = BigInt(asText(meta['fee']) ?? '0');

  if (index >= 0) {
    const pre = BigInt(asText(asArray(meta['preBalances'])[index]) ?? '0');
    const post = BigInt(asText(asArray(meta['postBalances'])[index]) ?? '0');
    const change = post - pre;
    const paid = feePayer ? fee : 0n;
    // Σ quantity − Σ fee = change.
    const quantity = failed ? 0n : change + paid;
    if (quantity !== 0n || paid > 0n) {
      out.push({
        txHash: signature,
        timestamp,
        asset: 'SOL',
        tokenId: null,
        tokenName: null,
        quantity: unitsToDecimal(quantity.toString(), 9),
        fee: paid > 0n ? unitsToDecimal(paid.toString(), 9) : null,
        feeAsset: paid > 0n ? 'SOL' : null,
        type: failed ? 'failed' : 'transfer',
        counterparty: null,
        verified: null,
      });
    }
  }

  if (!failed) {
    const sums = new Map<string, { raw: bigint; decimals: number }>();
    const add = (list: unknown, sign: 1n | -1n) => {
      for (const balance of asArray(list).map(asRecord)) {
        if (asText(balance['owner']) !== address) continue;
        const mint = asText(balance['mint']);
        const amount = asRecord(balance['uiTokenAmount']);
        const raw = asText(amount['amount']);
        const decimals = Number(asText(amount['decimals']) ?? '0');
        if (!mint || raw === null || !/^\d+$/.test(raw)) continue;
        const current = sums.get(mint) ?? { raw: 0n, decimals };
        sums.set(mint, {
          raw: current.raw + sign * BigInt(raw),
          decimals,
        });
      }
    };
    add(meta['preTokenBalances'], -1n);
    add(meta['postTokenBalances'], 1n);
    for (const [mint, { raw, decimals }] of [...sums.entries()].sort()) {
      if (raw === 0n) continue;
      out.push({
        txHash: signature,
        timestamp,
        asset: KNOWN_MINTS[mint] ?? `SPL-${mint.slice(0, 6)}`,
        tokenId: mint,
        tokenName: null,
        quantity: unitsToDecimal(raw.toString(), decimals),
        fee: null,
        feeAsset: null,
        type: 'transfer',
        counterparty: null,
        verified: KNOWN_MINTS[mint] ? true : null,
      });
    }
  }
  return out;
}
