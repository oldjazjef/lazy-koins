import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Booking, BookingKind } from '../bookings/booking';
import { csvSourceFile } from '../importers/text/csv';
import type { SourceFile } from '../importers/importer';
import { standardImporter } from '../standard/standard-importer';
import { standardTemplateCsv } from '../standard/template';
import { applyMapping, mappingConfidence } from './apply-mapping';
import { type MappingSpec, validateMappingSpec } from './mapping-spec';
import { scanMappingPrivacy } from './privacy-scan';

/**
 * The ready-to-import standard mappings in `mappings/standard/` (repo root), each applied to its
 * SYNTHETIC sample in `mappings/standard/samples/` (invented values). Every sample holds each
 * type value its mapping classifies at least once; the counts below are what the mapping must
 * make of it. A new mapping needs a sample and a case here — the suite fails otherwise.
 */

const ROOT = new URL('../../../../mappings/standard/', import.meta.url);

interface Case {
  readonly mapping: string;
  readonly sample: string;
  /** Bookings per kind (both legs of a one-row trade count). */
  readonly kinds: Partial<Record<BookingKind, number>>;
  /** Rows the mapping's filters exclude. */
  readonly excluded?: number;
  /** Balances from the running-balance column (lastPerAsset). */
  readonly holdings?: number;
  /**
   * Trade bookings without an opposite leg in their group — only where the export itself has
   * none (derivative PnL, card purchases, dust conversions without an id; see the README).
   */
  readonly unpairedTrades?: number;
}

const CASES: readonly Case[] = [
  {
    mapping: 'binance-transaction-history.mapping.json',
    sample: 'binance-transaction-history-UTC_2.csv',
    kinds: {
      trade: 37,
      fee: 5,
      deposit: 3,
      withdrawal: 5,
      transfer: 28,
      income_interest: 9,
      income_staking: 4,
      income_launchpool: 5,
      income_airdrop: 16,
    },
    unpairedTrades: 4,
  },
  {
    mapping: 'coinbase-transaction-history.mapping.json',
    sample: 'coinbase-transaction-history.csv',
    kinds: {
      trade: 18,
      deposit: 4,
      withdrawal: 9,
      fee: 1,
      transfer: 13,
      income_staking: 4,
      income_interest: 1,
      income_airdrop: 7,
    },
  },
  {
    mapping: 'kraken-ledger.mapping.json',
    sample: 'kraken-ledger.csv',
    kinds: {
      trade: 14,
      deposit: 1,
      withdrawal: 1,
      fee: 1,
      transfer: 13,
      income_staking: 1,
      income_interest: 2,
      income_airdrop: 4,
    },
    excluded: 1,
    holdings: 16,
  },
  {
    mapping: 'bitfinex-ledger.mapping.json',
    sample: 'bitfinex-ledger.csv',
    kinds: {
      trade: 6,
      deposit: 2,
      withdrawal: 2,
      fee: 5,
      transfer: 3,
      income_staking: 1,
      income_interest: 1,
      income_airdrop: 3,
      income_hardfork: 1,
    },
    holdings: 7,
    unpairedTrades: 2,
  },
  {
    mapping: 'bybit-transaction-log.mapping.json',
    sample: 'bybit-transaction-log.csv',
    kinds: {
      trade: 19,
      fee: 6,
      deposit: 1,
      withdrawal: 1,
      transfer: 40,
      income_interest: 2,
      income_airdrop: 2,
    },
    holdings: 6,
    unpairedTrades: 5,
  },
  {
    mapping: 'okx-trading-account-history.mapping.json',
    sample: 'okx-trading-account-history.csv',
    kinds: { trade: 11, transfer: 2, fee: 2 },
    holdings: 4,
    unpairedTrades: 5,
  },
  {
    mapping: 'okx-funding-account-history.mapping.json',
    sample: 'okx-funding-account-history.csv',
    kinds: {
      trade: 3,
      deposit: 3,
      withdrawal: 2,
      transfer: 13,
      income_staking: 2,
      income_interest: 2,
      income_airdrop: 2,
    },
    holdings: 4,
    unpairedTrades: 3,
  },
  {
    mapping: 'kucoin-spot-orders.mapping.json',
    sample: 'kucoin-spot-orders.csv',
    kinds: { trade: 10 },
  },
  {
    mapping: 'kucoin-account-history.mapping.json',
    sample: 'kucoin-account-history.csv',
    kinds: {
      trade: 2,
      deposit: 1,
      withdrawal: 1,
      fee: 1,
      transfer: 2,
      income_staking: 1,
      income_interest: 2,
      income_airdrop: 3,
    },
    unpairedTrades: 2,
  },
  {
    mapping: 'cryptocom-app-crypto-wallet.mapping.json',
    sample: 'cryptocom-app-crypto-wallet.csv',
    kinds: {
      trade: 26,
      deposit: 5,
      withdrawal: 7,
      transfer: 33,
      income_interest: 4,
      income_staking: 4,
      income_launchpool: 1,
      income_airdrop: 11,
    },
    excluded: 2,
    unpairedTrades: 6,
  },
  {
    mapping: 'bitstamp-transactions.mapping.json',
    sample: 'bitstamp-transactions.csv',
    kinds: {
      trade: 4,
      deposit: 2,
      withdrawal: 2,
      transfer: 6,
      income_staking: 1,
    },
  },
  {
    mapping: 'bitpanda-transactions.mapping.json',
    sample: 'bitpanda-transactions.csv',
    kinds: {
      trade: 6,
      deposit: 3,
      withdrawal: 2,
      transfer: 5,
      income_staking: 1,
    },
  },
];

function readSpec(name: string): MappingSpec {
  const json: unknown = JSON.parse(
    readFileSync(fileURLToPath(new URL(name, ROOT)), 'utf8'),
  );
  const result = validateMappingSpec(json);
  if (!result.ok) throw new Error(`${name}: ${JSON.stringify(result.issues)}`);
  return result.spec;
}

function readSample(name: string): SourceFile {
  const bytes = readFileSync(fileURLToPath(new URL(`samples/${name}`, ROOT)));
  return csvSourceFile({
    id: `sha-${name}`,
    name,
    bytes: new Uint8Array(bytes),
  });
}

function textFile(name: string, text: string): SourceFile {
  return csvSourceFile({
    id: `sha-${name}`,
    name,
    bytes: new TextEncoder().encode(text),
  });
}

function kindCounts(bookings: readonly Booking[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const b of bookings) counts[b.kind] = (counts[b.kind] ?? 0) + 1;
  return counts;
}

/** Trade bookings that have no trade leg of the opposite sign in their group. */
function unpairedTrades(bookings: readonly Booking[]): Booking[] {
  const trades = bookings.filter((b) => b.kind === 'trade');
  return trades.filter(
    (b) =>
      b.group === undefined ||
      !trades.some(
        (other) =>
          other !== b &&
          other.group === b.group &&
          other.quantity.isNegative() !== b.quantity.isNegative(),
      ),
  );
}

describe('standard mappings (mappings/standard)', () => {
  it('has a case for every mapping JSON and every sample', () => {
    const files = readdirSync(fileURLToPath(ROOT));
    expect(files.filter((f) => f.endsWith('.mapping.json')).sort()).toEqual(
      CASES.map((c) => c.mapping).sort(),
    );
    expect(
      readdirSync(fileURLToPath(new URL('samples/', ROOT))).sort(),
    ).toEqual(CASES.map((c) => c.sample).sort());
  });

  describe.each(CASES)('$mapping', (c) => {
    const spec = readSpec(c.mapping);
    const file = readSample(c.sample);
    const result = applyMapping(spec, file);

    it('is a valid spec with a plain name, a description and a lower-case platform', () => {
      expect(spec.name.length).toBeGreaterThan(5);
      expect(spec.description?.length ?? 0).toBeGreaterThan(200);
      expect(spec.platform).toMatch(/^[a-z]+$/);
    });

    it('reads every row of its sample without errors or unknown kinds', () => {
      expect(result.errors).toEqual([]);
      expect(
        result.bookings
          .filter((b) => b.kind === 'unknown')
          .map((b) => b.rawType),
      ).toEqual([]);
      expect(result.notes.filter((n) => n.code !== 'excluded')).toEqual([]);
      expect(result.notes.filter((n) => n.code === 'excluded')).toHaveLength(
        c.excluded ?? 0,
      );
    });

    it('classifies the sample as expected', () => {
      expect(kindCounts(result.bookings)).toEqual(c.kinds);
      expect(result.holdings).toHaveLength(c.holdings ?? 0);
    });

    it('keeps the legs of a trade together (group with an opposite leg)', () => {
      expect(unpairedTrades(result.bookings)).toHaveLength(
        c.unpairedTrades ?? 0,
      );
    });

    it('gives every record a unique id and keeps its source row (F7.5)', () => {
      const ids = result.bookings.map((b) => b.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const b of result.bookings) {
        expect(b.sourceFileId).toBe(file.id);
        expect(b.row).toBeGreaterThan(1);
        expect(b.raw).toBeDefined();
      }
    });

    it('is recognised only by its own mapping — not by the others, not as the standard format', () => {
      expect(mappingConfidence(spec, file)).toBeGreaterThan(0);
      expect(standardImporter.detect(file)).toBe(0);
      for (const other of CASES) {
        if (other.mapping === c.mapping) continue;
        expect({
          other: other.mapping,
          confidence: mappingConfidence(readSpec(other.mapping), file),
        }).toEqual({ other: other.mapping, confidence: 0 });
      }
    });

    it('carries nothing that looks personal (library review)', () => {
      const json: unknown = JSON.parse(
        readFileSync(fileURLToPath(new URL(c.mapping, ROOT)), 'utf8'),
      );
      expect(scanMappingPrivacy(json)).toEqual([]);
    });

    it('does not claim the standard-format templates', () => {
      for (const type of ['bookings', 'holdings'] as const) {
        const template = textFile(
          `template-${type}.csv`,
          standardTemplateCsv(type),
        );
        expect(mappingConfidence(spec, template)).toBe(0);
      }
    });
  });

  it('reads the zone from the Binance file name and falls back to UTC with a note', () => {
    const spec = readSpec('binance-transaction-history.mapping.json');
    const text = readFileSync(
      fileURLToPath(
        new URL('samples/binance-transaction-history-UTC_2.csv', ROOT),
      ),
      'utf8',
    );
    const withZone = applyMapping(spec, textFile('history-UTC_2.csv', text));
    const without = applyMapping(spec, textFile('history.csv', text));
    expect(withZone.bookings[0]?.timestamp).toBe('2025-01-02T07:00:00.000Z');
    expect(without.bookings[0]?.timestamp).toBe('2025-01-02T09:00:00.000Z');
    expect(without.notes).toContainEqual({ code: 'timeZoneAssumed' });
  });

  it('books both sides of a one-row trade with the fee on the money leg (Coinbase)', () => {
    const result = applyMapping(
      readSpec('coinbase-transaction-history.mapping.json'),
      readSample('coinbase-transaction-history.csv'),
    );
    const buy = result.bookings.filter((b) => b.rawType.startsWith('Buy/'));
    expect(
      buy.map((b) => [b.asset, b.quantity.toString(), b.fee?.toString()]),
    ).toEqual([
      ['BTC', '0.05', undefined],
      ['CHF', '-4250', '63.75'],
    ]);
    const convert = result.bookings.filter((b) =>
      b.rawType.startsWith('Convert/'),
    );
    expect(convert.map((b) => [b.asset, b.quantity.toString()])).toEqual([
      ['ETH', '-0.5'],
      ['USDC', '1612.903226'],
    ]);
  });

  it('normalises Kraken asset codes and keeps the balance per raw asset', () => {
    const result = applyMapping(
      readSpec('kraken-ledger.mapping.json'),
      readSample('kraken-ledger.csv'),
    );
    const assets = new Set(result.bookings.map((b) => b.asset));
    expect([...assets].sort()).toEqual(
      [
        'BTC',
        'DOT',
        'ETH',
        'ETHW',
        'EUR',
        'FLR',
        'LUNA',
        'LUNA2',
        'SOL',
        'USD',
        'USDC',
        'USDT',
      ].sort(),
    );
    const dot = result.holdings.filter((h) => h.asset === 'DOT');
    expect(dot.map((h) => [h.accountId, h.quantity.toString()])).toEqual([
      ['earn / bonded', '15.0421'],
      ['spot / main', '-15'],
    ]);
  });
});
