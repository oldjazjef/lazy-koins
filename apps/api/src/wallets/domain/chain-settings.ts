/**
 * F6.7: what the chain lookups need besides the Etherscan key (that one lives in the general
 * settings, `user_settings.etherscan_key`). Keys are kept sealed (`enc:v1:…`) and never leave the
 * API — views carry a hint (`…abcd`). URLs are plain: empty = the public default.
 */
export interface ChainSettings {
  readonly userId: string;
  readonly sealedHeliusKey: string | null;
  readonly solanaRpcUrl: string;
  readonly sealedSubscanKey: string | null;
  readonly esploraUrl: string;
  readonly koiosUrl: string;
  readonly cosmosLcdUrl: string;
  readonly updatedAt: string | null;
}

export interface ChainSettingsInput {
  /** A new sealed value, `null` to remove; absent = unchanged. */
  readonly sealedHeliusKey?: string | null;
  readonly sealedSubscanKey?: string | null;
  readonly solanaRpcUrl?: string;
  readonly esploraUrl?: string;
  readonly koiosUrl?: string;
  readonly cosmosLcdUrl?: string;
}

export function defaultChainSettings(userId: string): ChainSettings {
  return {
    userId,
    sealedHeliusKey: null,
    solanaRpcUrl: '',
    sealedSubscanKey: null,
    esploraUrl: '',
    koiosUrl: '',
    cosmosLcdUrl: '',
    updatedAt: null,
  };
}

/** The public endpoints used when the user set none. */
export const DEFAULT_URLS = {
  esplora: 'https://mempool.space/api',
  koios: 'https://api.koios.rest/api/v1',
  cosmosLcd: 'https://cosmos-rest.publicnode.com',
  solanaPublic: 'https://api.mainnet-beta.solana.com',
  helius: 'https://mainnet.helius-rpc.com',
  subscan: 'https://polkadot.api.subscan.io',
  etherscan: 'https://api.etherscan.io/v2/api',
} as const;

/** The services the settings page can test (F6.7 "Testen"). */
export const CHAIN_SERVICES = [
  'etherscan',
  'solana',
  'esplora',
  'koios',
  'subscan',
  'cosmos',
] as const;
export type ChainService = (typeof CHAIN_SERVICES)[number];
