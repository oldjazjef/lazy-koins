/**
 * The wallet networks lazy-koins knows (F6.3, Decisions: Bitcoin via Esplora, EVM via Etherscan
 * API V2, Solana via an RPC/indexer, Cardano/Polkadot/Cosmos via Koios/Subscan/LCD). Pure data and
 * pure address checks — no lookups here; the API's `integrations/chains/` adapters fetch.
 */

export const NETWORK_FAMILIES = [
  'bitcoin',
  'evm',
  'solana',
  'cardano',
  'polkadot',
  'cosmos',
] as const;
export type NetworkFamily = (typeof NETWORK_FAMILIES)[number];

/**
 * How a network's balance at 31.12. and its income come into the project:
 * - `history`: the full history is fetched; the balance at any date is the ledger over it.
 * - `income`: only income (staking rewards) is fetched; the balance at 31.12. is entered by hand
 *   with a receipt (F6.5).
 * - `manual`: nothing usable can be fetched with free APIs — balance by hand (F6.5).
 */
export type NetworkCoverage = 'history' | 'income' | 'manual';

export interface NetworkInfo {
  readonly id: string;
  readonly family: NetworkFamily;
  /** The chain's own coin (gas, fees). */
  readonly nativeAsset: string;
  readonly nativeDecimals: number;
  /** Etherscan API V2 `chainid` for EVM networks. */
  readonly chainId?: number;
  readonly coverage: NetworkCoverage;
}

export const NETWORKS = [
  {
    id: 'bitcoin',
    family: 'bitcoin',
    nativeAsset: 'BTC',
    nativeDecimals: 8,
    coverage: 'history',
  },
  {
    id: 'ethereum',
    family: 'evm',
    nativeAsset: 'ETH',
    nativeDecimals: 18,
    chainId: 1,
    coverage: 'history',
  },
  {
    id: 'bsc',
    family: 'evm',
    nativeAsset: 'BNB',
    nativeDecimals: 18,
    chainId: 56,
    coverage: 'history',
  },
  {
    id: 'polygon',
    family: 'evm',
    nativeAsset: 'POL',
    nativeDecimals: 18,
    chainId: 137,
    coverage: 'history',
  },
  {
    id: 'arbitrum',
    family: 'evm',
    nativeAsset: 'ETH',
    nativeDecimals: 18,
    chainId: 42161,
    coverage: 'history',
  },
  {
    id: 'optimism',
    family: 'evm',
    nativeAsset: 'ETH',
    nativeDecimals: 18,
    chainId: 10,
    coverage: 'history',
  },
  {
    id: 'base',
    family: 'evm',
    nativeAsset: 'ETH',
    nativeDecimals: 18,
    chainId: 8453,
    coverage: 'history',
  },
  {
    id: 'solana',
    family: 'solana',
    nativeAsset: 'SOL',
    nativeDecimals: 9,
    coverage: 'history',
  },
  {
    id: 'cardano',
    family: 'cardano',
    nativeAsset: 'ADA',
    nativeDecimals: 6,
    coverage: 'income',
  },
  {
    id: 'polkadot',
    family: 'polkadot',
    nativeAsset: 'DOT',
    nativeDecimals: 10,
    coverage: 'income',
  },
  {
    id: 'cosmos',
    family: 'cosmos',
    nativeAsset: 'ATOM',
    nativeDecimals: 6,
    coverage: 'manual',
  },
] as const satisfies readonly NetworkInfo[];

export type NetworkId = (typeof NETWORKS)[number]['id'];
export const NETWORK_IDS: readonly NetworkId[] = NETWORKS.map((n) => n.id);

export function isNetworkId(value: string): value is NetworkId {
  return (NETWORK_IDS as readonly string[]).includes(value);
}

export function networkInfo(id: NetworkId): NetworkInfo {
  const found = NETWORKS.find((n) => n.id === id);
  if (!found) throw new Error(`Unknown network ${id}`);
  return found;
}

export function networksOfFamily(family: NetworkFamily): NetworkId[] {
  return NETWORKS.filter((n) => n.family === family).map((n) => n.id);
}

/** What kind of identifier the user entered. */
export type AddressKind =
  | 'evm'
  | 'bitcoinAddress'
  | 'bitcoinXpub'
  | 'solana'
  | 'cardano'
  | 'polkadot'
  | 'cosmos';

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

/** Decodes base58 (Bitcoin alphabet) into bytes; `undefined` when a character is not base58. */
export function base58Decode(text: string): Uint8Array | undefined {
  if (!BASE58.test(text)) return undefined;
  const alphabet =
    '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = 0n;
  for (const char of text) value = value * 58n + BigInt(alphabet.indexOf(char));
  const bytes: number[] = [];
  while (value > 0n) {
    bytes.unshift(Number(value % 256n));
    value /= 256n;
  }
  for (const char of text) {
    if (char !== '1') break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

/**
 * Recognises a public identifier and says which family it belongs to — `undefined` for anything
 * else. Only the shape is checked (checksums are the adapters' business); a secret never gets
 * here because `detectSecret` runs first.
 */
export function classifyAddress(input: string): AddressKind | undefined {
  const value = input.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) return 'evm';
  if (/^(xpub|ypub|zpub)[1-9A-HJ-NP-Za-km-z]{100,112}$/.test(value)) {
    return 'bitcoinXpub';
  }
  if (/^bc1[02-9ac-hj-np-z]{11,71}$/.test(value)) return 'bitcoinAddress';
  if (/^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(value)) return 'bitcoinAddress';
  if (/^(addr1|stake1)[02-9ac-hj-np-z]{40,120}$/.test(value)) return 'cardano';
  if (/^cosmos1[02-9ac-hj-np-z]{38,58}$/.test(value)) return 'cosmos';
  // Polkadot SS58 (prefix 0) starts with `1`, 47–48 characters.
  if (/^1[1-9A-HJ-NP-Za-km-z]{46,47}$/.test(value)) return 'polkadot';
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) {
    const bytes = base58Decode(value);
    if (bytes?.length === 32) return 'solana';
  }
  return undefined;
}

/** The networks an identifier of this kind can live on (F6.4 checks all of them). */
export function networksForAddress(kind: AddressKind): NetworkId[] {
  switch (kind) {
    case 'evm':
      return networksOfFamily('evm');
    case 'bitcoinAddress':
    case 'bitcoinXpub':
      return ['bitcoin'];
    case 'solana':
      return ['solana'];
    case 'cardano':
      return ['cardano'];
    case 'polkadot':
      return ['polkadot'];
    case 'cosmos':
      return ['cosmos'];
  }
}
