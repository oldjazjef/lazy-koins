import type { BookingKind } from '../bookings/booking';
import { parseDecimal } from '../money/decimal';
import {
  BOOKING_COLUMNS,
  columnNames,
  HOLDING_COLUMNS,
} from '../standard/standard-format';
import { toCsv } from '../standard/template';

/**
 * F6.3 → the existing pipeline: what the chain adapters fetched (normalised movements) becomes
 * **standard-format records** — a derived "Buchungen" CSV per wallet and project, and a
 * "Bestände" CSV for manual balances (F6.5). The calculation, checks and exports then read them
 * like any other file; nothing in the calculation knows about chains.
 *
 * Pure and deterministic: the same movements, overrides and wallet give the same bytes (so a
 * re-fetch without news keeps the same SHA-256 and the same file).
 */

/** One balance change of the wallet in one transaction and one asset, as an adapter reports it. */
export interface ChainMovement {
  /** Transaction hash / signature — kept in `Referenz` (traceability, F7.5). */
  readonly txHash: string;
  /** ISO 8601 UTC. */
  readonly timestamp: string;
  /** Symbol as the chain states it (`ETH`, `USDC`, a token's own symbol). */
  readonly asset: string;
  /** Token contract / mint; `null` for the network's own coin. */
  readonly tokenId: string | null;
  /** The token's name as the chain states it (spam heuristics read it). */
  readonly tokenName: string | null;
  /** Signed decimal string: + arrives, − leaves. Without the fee. */
  readonly quantity: string;
  /** Network fee paid by the wallet in this transaction (positive), else `null`. */
  readonly fee: string | null;
  readonly feeAsset: string | null;
  /**
   * - `transfer`: an ordinary movement (deposit / withdrawal by its sign),
   * - `reward`: staking reward (income),
   * - `airdrop`: an airdrop the indexer labels as such (income),
   * - `failed`: a failed transaction — only its fee counts.
   */
  readonly type: 'transfer' | 'reward' | 'airdrop' | 'failed';
  /** The other side (sender for incoming, receiver for outgoing), when known. */
  readonly counterparty: string | null;
  /**
   * Token verification as the indexer states it: `true` verified, `false` explicitly unverified,
   * `null` unknown (most APIs).
   */
  readonly verified: boolean | null;
}

export type SpamReason =
  | 'namePattern'
  | 'zeroValue'
  | 'addressPoisoning'
  | 'unverifiedDust'
  | 'fakeSymbol';

export interface TokenVerdict {
  /** `<tokenId>` or `native`. */
  readonly tokenKey: string;
  readonly asset: string;
  readonly tokenName: string | null;
  readonly spam: boolean;
  /** Why the heuristics call it spam (also when overridden). */
  readonly reasons: readonly SpamReason[];
  /** The user said "kein Spam" (F6.6). */
  readonly overridden: boolean;
  readonly movements: number;
}

export function tokenKeyOf(movement: Pick<ChainMovement, 'tokenId'>): string {
  return movement.tokenId ?? 'native';
}

/** Names that announce a scam: "Claim", URLs, "visit", "reward at". FACHREGELN: "Claim". */
const SCAM_NAME =
  /claim|https?:|www\.|\.(com|io|org|net|xyz|app|site|top|vip|gift|finance)\b|t\.me|visit|reward[s]? at|airdrop at|free mint/i;

/** Symbols scammers copy; a non-native copy with this symbol is suspicious unless verified. */
const IMPERSONATED = new Set(['ETH', 'USDT', 'USDC', 'WETH', 'WBTC', 'DAI']);

function similarButDifferent(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y || x.length < 10 || y.length < 10) return false;
  return x.slice(0, 6) === y.slice(0, 6) && x.slice(-4) === y.slice(-4);
}

/**
 * F6.6 heuristics, per token: a scam name (FACHREGELN: "Claim"), zero-value transfers, address
 * poisoning (a look-alike of an address the wallet sent to), a native symbol on an unverified
 * token, and unverified tokens that only ever arrived (dust airdrops). `notSpam` = the user's
 * overrides ("kein Spam") by token key — they win.
 */
export function tokenVerdicts(
  movements: readonly ChainMovement[],
  nativeAsset: string,
  notSpam: ReadonlySet<string> = new Set(),
): TokenVerdict[] {
  const sentTo = new Set(
    movements
      .filter((m) => m.counterparty && m.quantity.startsWith('-'))
      .map((m) => (m.counterparty ?? '').toLowerCase()),
  );
  const byToken = new Map<string, ChainMovement[]>();
  for (const movement of movements) {
    const key = tokenKeyOf(movement);
    const list = byToken.get(key) ?? [];
    list.push(movement);
    byToken.set(key, list);
  }
  const verdicts: TokenVerdict[] = [];
  for (const [tokenKey, list] of [...byToken.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    const first = list[0] as ChainMovement;
    const reasons: SpamReason[] = [];
    if (tokenKey !== 'native') {
      const name = `${first.asset} ${first.tokenName ?? ''}`;
      if (SCAM_NAME.test(name)) reasons.push('namePattern');
      const transfers = list.filter((m) => m.type !== 'failed');
      if (
        transfers.length > 0 &&
        transfers.every((m) => parseDecimal(m.quantity).isZero())
      ) {
        reasons.push('zeroValue');
      }
      const incoming = transfers.filter(
        (m) => !m.quantity.startsWith('-') && !parseDecimal(m.quantity).isZero(),
      );
      if (
        incoming.some(
          (m) =>
            m.counterparty !== null &&
            [...sentTo].some((to) =>
              similarButDifferent(to, m.counterparty ?? ''),
            ),
        )
      ) {
        reasons.push('addressPoisoning');
      }
      const verified = list.some((m) => m.verified === true);
      if (
        !verified &&
        (first.asset.toUpperCase() === nativeAsset.toUpperCase() ||
          IMPERSONATED.has(first.asset.toUpperCase())) &&
        list.some((m) => m.verified === false)
      ) {
        reasons.push('fakeSymbol');
      }
      const neverSent = transfers.every((m) => !m.quantity.startsWith('-'));
      if (
        neverSent &&
        list.some((m) => m.verified === false) &&
        !verified &&
        transfers.length > 0
      ) {
        reasons.push('unverifiedDust');
      }
    }
    const overridden = notSpam.has(tokenKey);
    verdicts.push({
      tokenKey,
      asset: first.asset,
      tokenName: first.tokenName,
      spam: reasons.length > 0 && !overridden,
      reasons,
      overridden,
      movements: list.length,
    });
  }
  return verdicts;
}

/** Spam tokens get their own asset name, so a fake "USDT" never taints the real position. */
export function spamAssetName(asset: string): string {
  return `SPAM:${asset}`;
}

export interface WalletBookingContext {
  /** `Plattform`: the wallet's label. */
  readonly platform: string;
  /** `Konto`: the network id (`ethereum`, `bitcoin`, …). */
  readonly accountId: string;
  readonly nativeAsset: string;
  readonly notSpam?: ReadonlySet<string>;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function kindOf(movement: ChainMovement, spam: boolean): BookingKind {
  if (spam) return 'spam';
  if (movement.type === 'failed') return 'fee';
  if (movement.type === 'reward') return 'income_staking';
  if (movement.type === 'airdrop') return 'income_airdrop';
  const quantity = parseDecimal(movement.quantity);
  if (quantity.isZero()) return movement.fee ? 'fee' : 'unknown';
  return quantity.isNegative() ? 'withdrawal' : 'deposit';
}

/**
 * The standard "Buchungen" rows (without header) for one wallet on one network, sorted by time,
 * then transaction, then asset — the row number is the movement's index (+1 for the header), the
 * hash stays in `Referenz`. A failed transaction or a call without value becomes a `fee`
 * booking of `−fee`; any other fee travels in `Gebühr` (Σ Menge − Σ Gebühr = the chain's balance).
 */
export function walletBookingRows(
  movements: readonly ChainMovement[],
  context: WalletBookingContext,
): string[][] {
  const verdicts = new Map(
    tokenVerdicts(movements, context.nativeAsset, context.notSpam).map(
      (v) => [v.tokenKey, v] as const,
    ),
  );
  const sorted = [...movements].sort(
    (a, b) =>
      compareText(a.timestamp, b.timestamp) ||
      compareText(a.txHash, b.txHash) ||
      // The network's own coin (gas) first, then tokens by contract.
      compareText(a.tokenId ?? '', b.tokenId ?? '') ||
      compareText(a.quantity, b.quantity),
  );
  const rows: string[][] = [];
  for (const movement of sorted) {
    const spam = verdicts.get(tokenKeyOf(movement))?.spam ?? false;
    const kind = kindOf(movement, spam);
    const asset = spam ? spamAssetName(movement.asset) : movement.asset;
    let quantity = parseDecimal(movement.quantity);
    let fee = movement.fee ? parseDecimal(movement.fee) : undefined;
    if (kind === 'fee' && fee) {
      // The value did not move (failed tx / call without value): the fee is the booking.
      quantity = fee.negated();
      fee = undefined;
    }
    if (kind === 'unknown' && quantity.isZero() && !fee) continue;
    const feeAsset =
      fee && movement.feeAsset && movement.feeAsset !== movement.asset
        ? movement.feeAsset
        : '';
    const note = [
      movement.tokenName ?? '',
      movement.tokenId ? `Token ${movement.tokenId}` : '',
      movement.type === 'failed' ? 'fehlgeschlagen' : '',
      movement.counterparty
        ? `${quantity.isNegative() ? 'an' : 'von'} ${movement.counterparty}`
        : '',
    ]
      .filter((part) => part !== '')
      .join(' · ');
    rows.push([
      movement.timestamp,
      context.platform,
      context.accountId,
      kind,
      kind === 'fee' && movement.feeAsset ? movement.feeAsset : asset,
      quantity.toString(),
      fee ? fee.toString() : '',
      feeAsset,
      '',
      '',
      movement.txHash,
      note.slice(0, 300),
    ]);
  }
  return rows;
}

/** The derived "Buchungen" CSV (header + rows) — the bytes a wallet fetch stores. */
export function walletBookingsCsv(rows: readonly (readonly string[])[]): string {
  return toCsv([columnNames(BOOKING_COLUMNS), ...rows]);
}

export interface ManualBalance {
  readonly platform: string;
  readonly accountId: string;
  readonly asset: string;
  readonly quantity: string;
  /** ISO date. */
  readonly asOf: string;
  /** "Beleg": the evidence file's name (F6.5). */
  readonly evidence: string;
}

/** F6.5: manual balances as a "Bestände" CSV — statement holdings for their account. */
export function walletHoldingsCsv(balances: readonly ManualBalance[]): string {
  const rows = [...balances]
    .sort(
      (a, b) =>
        compareText(a.accountId, b.accountId) ||
        compareText(a.asset, b.asset) ||
        compareText(a.asOf, b.asOf),
    )
    .map((b) => [
      b.platform,
      b.accountId,
      b.asset,
      parseDecimal(b.quantity).toString(),
      b.asOf,
      '',
      '',
      b.evidence,
    ]);
  return toCsv([columnNames(HOLDING_COLUMNS), ...rows]);
}

/**
 * Raw integer units (wei, satoshi, lamports) → a decimal string, by moving the point — never via
 * a JS number (CLAUDE.md, Numbers). `'1500000000000000000', 18` → `'1.5'`.
 */
export function unitsToDecimal(raw: string, decimals: number): string {
  const text = raw.trim();
  if (!/^-?\d+$/.test(text)) throw new Error('Not an integer amount');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error('Unsupported number of decimals');
  }
  const negative = text.startsWith('-');
  const digits = (negative ? text.slice(1) : text).replace(/^0+/, '') || '0';
  if (decimals === 0) return parseDecimal(`${negative ? '-' : ''}${digits}`).toString();
  const padded = digits.padStart(decimals + 1, '0');
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = padded.slice(padded.length - decimals);
  return parseDecimal(`${negative ? '-' : ''}${whole}.${fraction}`).toString();
}
