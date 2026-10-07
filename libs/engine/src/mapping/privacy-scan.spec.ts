import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateMappingSpec } from './mapping-spec';
import {
  classifyPrivateValue,
  removePrivacyFindings,
  scanMappingPrivacy,
} from './privacy-scan';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(__dirname, 'fixtures', name), 'utf8'));

/** A synthetic spec with planted personal data (all invented, test vectors only). */
function planted(): Record<string, unknown> {
  return {
    format: 'lazy-koins-mapping',
    version: 1,
    name: 'Bank Export',
    platform: 'somebank',
    description:
      'Written by max.muster@example.com for account CH9300762011623852957',
    match: {
      headers: ['Datum', 'Betrag', 'Kontoinhaber'],
      fileName: 'export_12345678',
    },
    filters: [
      { column: 'Kontoinhaber', equals: ['Max Muster', 'Pending'] },
      { column: 'Status', equals: ['pending'] },
      {
        column: 'Ref',
        pattern: '^0x52908400098527886E0F7030069857D2E4169EE7$',
      },
    ],
    assets: {
      rewrites: [],
      aliases: {
        XXBT: 'BTC',
        U1234567: 'CHF',
      },
    },
    bookings: {
      timestamp: { column: 'Datum', format: 'dmy', timeZone: 'Europe/Zurich' },
      account: { value: 'Konto 987654321' },
      asset: { column: 'Währung' },
      quantity: { mode: 'signed', column: 'Betrag' },
      kind: { columns: ['Typ'], rules: [{ equals: ['Kauf'], kind: 'trade' }] },
    },
    holdings: {
      mode: 'rows',
      asset: { column: 'Währung' },
      quantity: { column: 'Saldo' },
      evidence: {
        column: 'Beleg',
        value: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      },
    },
  };
}

describe('classifyPrivateValue', () => {
  it.each([
    ['anna@example.org', 'email'],
    ['CH93 0076 2011 6238 5295 7', 'iban'],
    ['0x52908400098527886E0F7030069857D2E4169EE7', 'walletAddress'],
    ['bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 'walletAddress'],
    ['1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', 'walletAddress'],
    ['Konto 12345678', 'accountId'],
    ['AB12C3456', 'accountId'],
  ])('%s → %s', (text, kind) => {
    expect(classifyPrivateValue(text)).toBe(kind);
  });

  it.each([
    'spot / main',
    'Staking Reward',
    'XXBT',
    'pending',
    '2025-12-31',
    'trade',
    '\\.(S|M|F)$',
    'CH12 not an iban 00',
  ])('leaves %s alone', (text) => {
    expect(classifyPrivateValue(text)).toBeNull();
  });

  it('flags a person’s name only where names are expected', () => {
    expect(classifyPrivateValue('Max Muster', true)).toBe('personName');
    expect(classifyPrivateValue('Max Muster')).toBeNull();
  });

  it('flags a seed phrase as a secret', () => {
    const words =
      'abandon ability able about above absent absorb abstract absurd abuse access accident';
    expect(classifyPrivateValue(words)).toBe('secret');
  });
});

describe('scanMappingPrivacy', () => {
  it('finds nothing in the synthetic fixtures (their constants are generic)', () => {
    for (const name of [
      'kraken-ledger.mapping.json',
      'bitfinex-ledger.mapping.json',
      'revolut-crypto-statement.mapping.json',
      'binance-transaction-history-csv.mapping.json',
    ]) {
      const spec = validateMappingSpec(fixture(name));
      expect(spec.ok).toBe(true);
      if (spec.ok) expect(scanMappingPrivacy(spec.spec)).toEqual([]);
    }
  });

  it('finds every planted value with its path, never in column names', () => {
    const findings = scanMappingPrivacy(planted());
    expect(findings.map((f) => [f.path, f.kind, f.removable])).toEqual([
      ['/description', 'email', true],
      ['/match/fileName', 'accountId', true],
      ['/filters/0/equals/0', 'personName', true],
      ['/filters/2/pattern', 'walletAddress', true],
      ['/assets/aliases/U1234567', 'accountId', true],
      ['/bookings/account/value', 'accountId', true],
      ['/holdings/evidence/value', 'walletAddress', true],
    ]);
    expect(findings.some((f) => f.path.includes('headers'))).toBe(false);
  });
});

describe('removePrivacyFindings', () => {
  it('removes every removable finding and keeps a valid spec', () => {
    const spec = planted();
    const cleaned = removePrivacyFindings(
      spec,
      scanMappingPrivacy(spec).map((f) => f.path),
    ) as Record<string, unknown>;
    expect(scanMappingPrivacy(cleaned)).toEqual([]);
    expect(validateMappingSpec(cleaned).ok).toBe(true);
    expect(cleaned['description']).toBeUndefined();
    expect(cleaned['filters']).toEqual([
      { column: 'Kontoinhaber', equals: ['Pending'] },
      { column: 'Status', equals: ['pending'] },
    ]);
    expect((cleaned['assets'] as { aliases: unknown }).aliases).toEqual({
      XXBT: 'BTC',
    });
    expect((cleaned['bookings'] as Record<string, unknown>)['account']).toBe(
      undefined,
    );
    expect(
      (cleaned['holdings'] as Record<string, unknown>)['evidence'],
    ).toEqual({
      column: 'Beleg',
    });
    // The input is untouched.
    expect(spec['description']).toBeDefined();
  });

  it('drops a filter whose only value goes, and ignores unknown or structural paths', () => {
    const spec = {
      ...planted(),
      filters: [{ column: 'Kontoinhaber', equals: ['Max Muster'] }],
    };
    const cleaned = removePrivacyFindings(spec, [
      '/filters/0/equals/0',
      '/name',
      '/match/headers/0',
      '/nope/1',
    ]) as Record<string, unknown>;
    expect(cleaned['filters']).toEqual([]);
    expect(cleaned['name']).toBe('Bank Export');
    expect((cleaned['match'] as { headers: string[] }).headers).toHaveLength(3);
  });
});
