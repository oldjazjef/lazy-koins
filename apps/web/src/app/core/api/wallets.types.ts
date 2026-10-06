/**
 * Wallets (F6) as the API returns them — hand-mirrored from `apps/api/src/wallets` (see CLAUDE.md,
 * open decision "Frontend API types"). Quantities are decimal strings.
 */

export const NETWORK_IDS = [
  'bitcoin',
  'ethereum',
  'bsc',
  'polygon',
  'arbitrum',
  'optimism',
  'base',
  'solana',
  'cardano',
  'polkadot',
  'cosmos',
] as const;
export type NetworkId = (typeof NETWORK_IDS)[number];

export const NETWORK_COVERAGES = ['history', 'income', 'manual'] as const;
export type NetworkCoverage = (typeof NETWORK_COVERAGES)[number];

export const ADDRESS_KINDS = [
  'evm',
  'bitcoinAddress',
  'bitcoinXpub',
  'solana',
  'cardano',
  'polkadot',
  'cosmos',
] as const;
export type AddressKind = (typeof ADDRESS_KINDS)[number];

export const SECRET_KINDS = [
  'seedPhrase',
  'privateKeyHex',
  'privateKeyWif',
  'extendedPrivateKey',
  'solanaSecretKey',
] as const;
export type SecretKind = (typeof SECRET_KINDS)[number];

/** Error codes of the wallet endpoints (`wallets.errors.<code>`). */
export const WALLET_ERROR_CODES = [
  'secretRefused',
  'unknownAddress',
  'labelRequired',
  'networkNotForAddress',
  'usedByClosedProject',
  'offline',
  'notConfigured',
  'invalidKey',
  'rateLimited',
  'chainNotOnPlan',
  'network',
  'timeout',
  'badResponse',
  'providerError',
  'invalidAddress',
  'unsupported',
  'privateUrl',
  'invalidUrl',
  'evidenceNotPdf',
] as const;

/** Notes a fetch can carry (`wallets.notes.<code>`). */
export const FETCH_NOTES = [
  'l1FeeNotIncluded',
  'balanceManual',
  'incomeManual',
  'fake',
] as const;

export const SPAM_REASONS = [
  'namePattern',
  'zeroValue',
  'addressPoisoning',
  'unverifiedDust',
  'fakeSymbol',
] as const;
export type SpamReason = (typeof SPAM_REASONS)[number];

export interface FetchInfo {
  currentBalances?: { asset: string; quantity: string }[];
  truncated?: boolean;
  addressesScanned?: number;
  addressesUsed?: number;
  notes?: string[];
}

export interface NetworkFetch {
  network: NetworkId;
  coverage: NetworkCoverage;
  selected: boolean;
  used: boolean | null;
  txCount: number | null;
  checkError: string | null;
  status: 'ok' | 'error' | 'none';
  fetchedAt: string | null;
  errorCode: string | null;
  errorDetail: string | null;
  movements: number;
  spamTokens: number;
  info: FetchInfo;
}

export interface Wallet {
  id: string;
  label: string;
  address: string;
  addressKind: AddressKind;
  networks: NetworkId[];
  possibleNetworks: NetworkId[];
  notes: string;
  checkedAt: string | null;
  createdAt: string;
  updatedAt: string;
  projects: {
    id: string;
    name: string;
    taxYear: number;
    status: 'in_progress' | 'reviewed' | 'closed';
  }[];
  perNetwork: NetworkFetch[];
}

export interface WalletRequest {
  label: string;
  address?: string;
  networks?: NetworkId[];
  notes?: string;
}

export interface AddressInspection {
  addressKind: AddressKind | null;
  networks: NetworkId[];
  secret: SecretKind | null;
}

export interface TokenVerdict {
  tokenKey: string;
  asset: string;
  tokenName: string | null;
  spam: boolean;
  reasons: SpamReason[];
  overridden: boolean;
  movements: number;
}

export interface NetworkTokens {
  network: NetworkId;
  tokens: TokenVerdict[];
}

export interface ManualBalance {
  id: string;
  projectId: string;
  walletId: string;
  network: NetworkId;
  asset: string;
  quantity: string;
  asOf: string;
  evidenceFileId: string | null;
  evidenceName: string | null;
  note: string;
  createdAt: string;
}

export interface ProjectWallet {
  wallet: Wallet;
  balances: ManualBalance[];
  files: { id: string; displayName: string }[];
}

export interface ProjectWallets {
  yearEnd: string;
  wallets: ProjectWallet[];
  available: { id: string; label: string; address: string }[];
}

export interface ManualBalanceRequest {
  network: NetworkId;
  asset: string;
  quantity: string;
  asOf?: string;
  evidenceFileId: string;
  note?: string;
}

export const CHAIN_SERVICES = [
  'etherscan',
  'solana',
  'esplora',
  'koios',
  'subscan',
  'cosmos',
] as const;
export type ChainService = (typeof CHAIN_SERVICES)[number];

export interface ChainSettings {
  keys: {
    etherscan: string | null;
    helius: string | null;
    subscan: string | null;
  };
  solanaRpcUrl: string;
  esploraUrl: string;
  koiosUrl: string;
  cosmosLcdUrl: string;
  defaults: {
    esploraUrl: string;
    koiosUrl: string;
    cosmosLcdUrl: string;
    solanaRpcUrl: string;
  };
  keyStorageAvailable: boolean;
}

export interface ChainSettingsRequest {
  etherscanKey?: string | null;
  heliusKey?: string | null;
  subscanKey?: string | null;
  solanaRpcUrl?: string;
  esploraUrl?: string;
  koiosUrl?: string;
  cosmosLcdUrl?: string;
}

export interface ChainServiceTest {
  ok: true;
  service: ChainService;
  detail: string;
  millis: number;
}
