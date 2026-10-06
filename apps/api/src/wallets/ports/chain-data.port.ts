import type {
  ChainMovement,
  NetworkFamily,
  NetworkId,
} from '@lazykoins/engine';
import type { FetchInfo } from '../domain/wallet';

/**
 * F6.3 / F6.4: one adapter per network family behind this port (`integrations/chains/`). The
 * adapters are the only code that talks to Etherscan, Esplora, Solana RPC, Koios, Subscan or a
 * Cosmos LCD; they serialise their calls, keep a minimum spacing, cache successful answers for a
 * few minutes and never put a key into a log or an error. Called only from an explicit user
 * action ("Netzwerke prüfen", "Abrufen", "Testen") — never inside the calculation.
 */

/** Everything an adapter may need, opened for one call. Never logged, never returned. */
export interface ChainConnection {
  readonly etherscanKey?: string;
  readonly esploraUrl: string;
  /** Full JSON-RPC URL (a Helius URL carries its key in the query). */
  readonly solanaRpcUrl: string;
  readonly subscanKey?: string;
  readonly koiosUrl: string;
  readonly cosmosLcdUrl: string;
  /** Values to redact from any provider message before it is stored or returned. */
  readonly secrets: readonly string[];
}

/** F6.4: was the address ever used on this network? */
export interface NetworkActivity {
  readonly used: boolean;
  readonly txCount: number | null;
}

export interface ChainHistory {
  readonly movements: readonly ChainMovement[];
  readonly info: FetchInfo;
}

/** Stable error codes; the app translates `wallets.errors.<code>`. */
export const CHAIN_ERROR_CODES = [
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
] as const;
export type ChainErrorCode = (typeof CHAIN_ERROR_CODES)[number];

/** A failed lookup: a code, the HTTP status and the provider's own words (redacted). */
export class ChainDataError extends Error {
  constructor(
    readonly code: ChainErrorCode,
    readonly detail: string | null = null,
    readonly status: number | null = null,
  ) {
    super(`chain lookup failed: ${code}${status === null ? '' : ` (HTTP ${status})`}`);
    this.name = 'ChainDataError';
  }
}

export abstract class ChainDataPort {
  abstract readonly family: NetworkFamily;

  /** F6.4. */
  abstract activity(
    connection: ChainConnection,
    network: NetworkId,
    address: string,
  ): Promise<NetworkActivity>;

  /** F6.3: the whole history as movements (or what the network allows, see `coverage`). */
  abstract history(
    connection: ChainConnection,
    network: NetworkId,
    address: string,
  ): Promise<ChainHistory>;

  /**
   * F6.7 "Testen": one request without user data that proves URL and key work; resolves with a
   * short description of what answered (e.g. the latest block).
   */
  abstract test(connection: ChainConnection, network: NetworkId): Promise<string>;
}

/** The adapter per family (bound in `IntegrationsModule`; fakes with `LK_CHAINS_FAKE=1`). */
export abstract class ChainDataSourcesPort {
  abstract forFamily(family: NetworkFamily): ChainDataPort;
}
