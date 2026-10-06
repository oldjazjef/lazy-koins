import {
  type AddressKind,
  type ChainMovement,
  classifyAddress,
  detectSecret,
  isNetworkId,
  type NetworkId,
  networksForAddress,
  type SecretKind,
} from '@lazykoins/engine';

/**
 * Wallets (F6). Hand-written domain types — never a re-export of a Prisma model.
 *
 * - **wallet**: a public address (or a Bitcoin xpub/ypub/zpub) of one user with a label, the
 *   networks it is used on and notes (F6.1);
 * - **network check** (F6.4): on which of the possible networks the address was ever used;
 * - **network data**: the last fetch per network — normalised movements (decimal strings);
 * - **manual balance** (F6.5): a balance at 31.12. with a receipt, per project.
 */

export const ADDRESS_KINDS = [
  'evm',
  'bitcoinAddress',
  'bitcoinXpub',
  'solana',
  'cardano',
  'polkadot',
  'cosmos',
] as const satisfies readonly AddressKind[];

/** Prefix of the origin of a project file a wallet fetch derived (F6.3). */
export const WALLET_ORIGIN = 'wallet:';

export function walletOrigin(walletId: string): string {
  return `${WALLET_ORIGIN}${walletId}`;
}

/** The wallet id inside a `wallet:<id>` origin, else `undefined`. */
export function originWalletId(origin: string): string | undefined {
  return origin.startsWith(WALLET_ORIGIN)
    ? origin.slice(WALLET_ORIGIN.length)
    : undefined;
}

export interface NetworkCheckResult {
  readonly network: NetworkId;
  /** null = the lookup failed (see `errorCode`). */
  readonly used: boolean | null;
  /** Transactions seen (outgoing count on EVM chains); null = unknown. */
  readonly txCount: number | null;
  readonly errorCode: string | null;
  readonly detail: string | null;
}

export interface NetworkCheck {
  readonly checkedAt: string;
  readonly results: readonly NetworkCheckResult[];
}

export interface Wallet {
  readonly id: string;
  readonly ownerId: string;
  readonly label: string;
  readonly address: string;
  readonly addressKind: AddressKind;
  readonly networks: readonly NetworkId[];
  readonly notes: string;
  readonly networkCheck: NetworkCheck | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NewWallet {
  readonly ownerId: string;
  readonly label: string;
  readonly address: string;
  readonly addressKind: AddressKind;
  readonly networks: readonly NetworkId[];
  readonly notes: string;
}

export interface WalletChanges {
  readonly label?: string;
  readonly networks?: readonly NetworkId[];
  readonly notes?: string;
}

/** Information a fetch reports next to the movements (shown, never calculated with). */
export interface FetchInfo {
  /** The balance today as the provider states it (information only, F6.5 hint). */
  readonly currentBalances?: readonly {
    readonly asset: string;
    readonly quantity: string;
  }[];
  /** The history was cut at the adapter's limit — older transactions are missing. */
  readonly truncated?: boolean;
  /** Bitcoin xpub: how many derived addresses were looked at / had transactions. */
  readonly addressesScanned?: number;
  readonly addressesUsed?: number;
  /** Stable note codes the app translates (`wallets.notes.<code>`). */
  readonly notes?: readonly string[];
}

export interface WalletNetworkData {
  readonly walletId: string;
  readonly network: NetworkId;
  readonly status: 'ok' | 'error';
  readonly errorCode: string | null;
  /** The provider's own message (never a key — adapters redact). */
  readonly errorDetail: string | null;
  readonly movements: readonly ChainMovement[];
  readonly info: FetchInfo;
  readonly fetchedAt: string;
}

export interface TokenOverride {
  readonly network: NetworkId;
  readonly tokenKey: string;
}

export interface WalletManualBalance {
  readonly id: string;
  readonly projectId: string;
  readonly walletId: string;
  readonly network: NetworkId;
  readonly asset: string;
  /** Decimal string, ≥ 0. */
  readonly quantity: string;
  readonly asOf: string;
  /** The project file holding the receipt (a PDF, evidence only); null once it was removed. */
  readonly evidenceFileId: string | null;
  readonly note: string;
  readonly createdAt: string;
}

export type NewManualBalance = Omit<WalletManualBalance, 'id' | 'createdAt'>;

/** Why an entered wallet is refused. `secret` never carries the input (F6.2). */
export type WalletInputProblem =
  | { readonly code: 'secretRefused'; readonly kind: SecretKind }
  | { readonly code: 'unknownAddress' }
  | { readonly code: 'labelRequired' }
  | { readonly code: 'networkNotForAddress'; readonly network: string };

/**
 * F6.2 first: every typed field is checked for seed phrases and private keys before anything
 * else looks at it. Then the address must be a known public identifier and every network one it
 * can live on.
 */
export function checkWalletInput(input: {
  readonly label: string;
  readonly address?: string;
  readonly notes?: string;
  readonly networks?: readonly string[];
  /** For an update: the stored address's kind. */
  readonly addressKind?: AddressKind;
}):
  | {
      ok: true;
      addressKind: AddressKind;
      networks: NetworkId[] | undefined;
    }
  | { ok: false; problem: WalletInputProblem } {
  for (const field of [input.address ?? '', input.label, input.notes ?? '']) {
    const kind = detectSecret(field);
    if (kind) return { ok: false, problem: { code: 'secretRefused', kind } };
  }
  if (input.label.trim() === '') {
    return { ok: false, problem: { code: 'labelRequired' } };
  }
  const addressKind =
    input.address !== undefined
      ? classifyAddress(input.address)
      : input.addressKind;
  if (!addressKind) return { ok: false, problem: { code: 'unknownAddress' } };
  const possible = networksForAddress(addressKind);
  let networks: NetworkId[] | undefined;
  if (input.networks !== undefined) {
    networks = [];
    for (const network of input.networks) {
      if (!isNetworkId(network) || !possible.includes(network)) {
        return {
          ok: false,
          problem: { code: 'networkNotForAddress', network },
        };
      }
      if (!networks.includes(network)) networks.push(network);
    }
    networks.sort(
      (a, b) => possible.indexOf(a) - possible.indexOf(b),
    );
  }
  return { ok: true, addressKind, networks };
}
