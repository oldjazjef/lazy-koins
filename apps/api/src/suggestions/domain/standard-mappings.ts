import { createHash } from 'node:crypto';
import {
  type MappingSpec,
  mappingFingerprint,
  validateMappingSpec,
} from '@lazykoins/engine';
// The bundled standard mappings (repo `mappings/standard/`, product data): webpack inlines the
// JSON into the API bundle, so the web server and the desktop app ship the same catalogue.
import binance from '../../../../../mappings/standard/binance-transaction-history.mapping.json';
import bitfinex from '../../../../../mappings/standard/bitfinex-ledger.mapping.json';
import bitpanda from '../../../../../mappings/standard/bitpanda-transactions.mapping.json';
import bitstamp from '../../../../../mappings/standard/bitstamp-transactions.mapping.json';
import bybit from '../../../../../mappings/standard/bybit-transaction-log.mapping.json';
import coinbase from '../../../../../mappings/standard/coinbase-transaction-history.mapping.json';
import cryptocom from '../../../../../mappings/standard/cryptocom-app-crypto-wallet.mapping.json';
import kraken from '../../../../../mappings/standard/kraken-ledger.mapping.json';
import kucoinAccount from '../../../../../mappings/standard/kucoin-account-history.mapping.json';
import kucoinSpot from '../../../../../mappings/standard/kucoin-spot-orders.mapping.json';
import okxFunding from '../../../../../mappings/standard/okx-funding-account-history.mapping.json';
import okxTrading from '../../../../../mappings/standard/okx-trading-account-history.mapping.json';

/**
 * F5.19: the standard mappings as **built-in, read-only templates**. "Übernehmen" copies one into
 * the user's own mappings (origin `copied`; an identical copy I already have is reused) — the
 * catalogue itself is never changed by anyone.
 *
 * `revision` is the catalogue's version of an entry: bump it whenever its JSON changes
 * (`standard-mappings.spec.ts` pins a hash per entry and fails until you do). A copy taken
 * earlier stays as it was; the take answer names the revision.
 */
const CATALOGUE: readonly {
  readonly id: string;
  readonly revision: number;
  readonly json: unknown;
}[] = [
  { id: 'binance-transaction-history', revision: 1, json: binance },
  { id: 'bitfinex-ledger', revision: 1, json: bitfinex },
  { id: 'bitpanda-transactions', revision: 1, json: bitpanda },
  { id: 'bitstamp-transactions', revision: 1, json: bitstamp },
  { id: 'bybit-transaction-log', revision: 1, json: bybit },
  { id: 'coinbase-transaction-history', revision: 1, json: coinbase },
  { id: 'cryptocom-app-crypto-wallet', revision: 1, json: cryptocom },
  { id: 'kraken-ledger', revision: 1, json: kraken },
  { id: 'kucoin-account-history', revision: 1, json: kucoinAccount },
  { id: 'kucoin-spot-orders', revision: 1, json: kucoinSpot },
  { id: 'okx-funding-account-history', revision: 1, json: okxFunding },
  { id: 'okx-trading-account-history', revision: 1, json: okxTrading },
];

export interface StandardMapping {
  /** The file name without `.mapping.json`. */
  readonly id: string;
  readonly revision: number;
  readonly name: string;
  readonly platform: string;
  readonly description: string | null;
  readonly fingerprint: string;
  readonly spec: MappingSpec;
  /** SHA-256 of the canonical JSON (first 12 hex) — what `revision` must follow. */
  readonly hash: string;
}

function load(): readonly StandardMapping[] {
  return CATALOGUE.map(({ id, revision, json }) => {
    const validation = validateMappingSpec(json);
    if (!validation.ok) {
      // A broken catalogue is a build defect — the spec catches it long before this runs.
      throw new Error(`Standard mapping ${id} is invalid`);
    }
    const spec = validation.spec;
    return {
      id,
      revision,
      name: spec.name,
      platform: spec.platform,
      description: spec.description ?? null,
      fingerprint: mappingFingerprint(spec),
      spec,
      hash: createHash('sha256')
        .update(JSON.stringify(spec))
        .digest('hex')
        .slice(0, 12),
    };
  });
}

let loaded: readonly StandardMapping[] | undefined;

/** The catalogue, validated once. */
export function standardMappings(): readonly StandardMapping[] {
  loaded ??= load();
  return loaded;
}

export function findStandardMapping(id: string): StandardMapping | undefined {
  return standardMappings().find((entry) => entry.id === id);
}
