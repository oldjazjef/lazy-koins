import {
  buildMappingSample,
  csvSourceFile,
  guessDelimiter,
  type ImportResult,
} from '@lazykoins/engine';
import { checkBaseUrl, isPrivateHost } from './base-url';
import { judge, repairMessage } from './mapping-candidate';

/** A synthetic export: 3 preamble lines, a header, `rows` data rows. Never real data. */
function syntheticCsv(rows: number): Uint8Array {
  const lines = [
    'Synthetic Exchange — transaction export',
    'Account;demo',
    '',
    'Date;Type;Asset;Amount;TxId;Note',
  ];
  const types = ['Buy', 'Sell', 'Staking Reward', 'Deposit', 'Withdraw'];
  for (let i = 0; i < rows; i += 1) {
    lines.push(
      [
        `2025-01-${String((i % 28) + 1).padStart(2, '0')} 10:00:00`,
        types[i % types.length],
        i % 2 === 0 ? 'BTC' : 'ETH',
        `0.${String(i).padStart(8, '0')}1`,
        `0x${i.toString(16).padStart(64, 'a')}`,
        `note ${i}`,
      ].join(';'),
    );
  }
  return new TextEncoder().encode(lines.join('\n'));
}

const file = (bytes: Uint8Array) =>
  csvSourceFile(
    { id: 'a'.repeat(64), name: 'export_UTC_2_.csv', bytes },
    { delimiter: guessDelimiter(new TextDecoder().decode(bytes)) },
  );
const booking = (kind: string, rawType: string) =>
  ({ kind, rawType }) as unknown as ImportResult['bookings'][number];

const result = (over: Partial<ImportResult>): ImportResult => ({
  bookings: [],
  holdings: [],
  errors: [],
  notes: [],
  period: null,
  ...over,
});

describe('judge + repairMessage', () => {
  const sample = buildMappingSample(file(syntheticCsv(20)));

  it('accepts a clean result', () => {
    const quality = judge(
      result({ bookings: [booking('trade', 'Buy'), booking('trade', 'Sell')] }),
    );
    expect(quality.problems).toEqual([]);
    expect(quality.kindCounts).toEqual({ trade: 2 });
  });

  it('flags many unknown kinds and names them only when the sample showed them', () => {
    const r = result({
      bookings: [
        booking('unknown', 'Staking Reward'),
        booking('unknown', 'Staking Reward'),
        booking('unknown', 'secret value not in sample'),
        booking('trade', 'Buy'),
      ],
    });
    const quality = judge(r);
    expect(quality.problems).toEqual(['unknownKinds']);
    expect(quality.unknownValues[0]).toEqual({
      value: 'Staking Reward',
      count: 2,
    });
    const message = repairMessage(sample, [], r, quality);
    expect(message).toContain('"Staking Reward": 2');
    expect(message).not.toContain('secret value not in sample');
  });

  it('summarises row errors by code and column with row numbers', () => {
    const r = result({
      bookings: [booking('trade', 'Buy')],
      errors: [
        { row: 5, code: 'invalidTimestamp', column: 'Date' },
        { row: 6, code: 'invalidTimestamp', column: 'Date' },
      ],
    });
    const quality = judge(r);
    expect(quality.problems).toEqual(['rowErrors']);
    expect(repairMessage(sample, [], r, quality)).toContain(
      'invalidTimestamp @ Date: 2 (rows 5, 6)',
    );
  });

  it('reports a missing header and schema issues', () => {
    const r = result({ errors: [{ row: 0, code: 'headerNotFound' }] });
    const quality = judge(r);
    expect(quality.problems).toEqual(['headerNotFound']);
    const message = repairMessage(
      sample,
      [{ path: 'bookings.quantity', message: 'Invalid input' }],
      r,
      quality,
    );
    expect(message).toContain('bookings.quantity: Invalid input');
    expect(message).toContain('header row was not found');
  });
});

describe('provider base URL (SSRF guard)', () => {
  it.each([
    'http://localhost:11434/v1',
    'http://127.0.0.1:1234/v1',
    'http://10.0.0.5/v1',
    'http://192.168.1.10/v1',
    'http://172.20.0.1/v1',
    'http://169.254.169.254/latest',
    'http://[::1]:8080/v1',
    'http://ollama/v1',
    'http://gpu.internal/v1',
  ])('treats %s as private', (url) => {
    expect(checkBaseUrl(url, false)).toBe('privateUrl');
    expect(checkBaseUrl(url, true)).toBeUndefined();
  });

  it('accepts public https endpoints and refuses odd URLs', () => {
    expect(checkBaseUrl('https://api.mistral.ai/v1', false)).toBeUndefined();
    expect(checkBaseUrl('', false)).toBeUndefined();
    expect(checkBaseUrl('ftp://example.com', true)).toBe('invalidUrl');
    expect(checkBaseUrl('https://user:pw@example.com', true)).toBe(
      'invalidUrl',
    );
    expect(checkBaseUrl('not a url', true)).toBe('invalidUrl');
    expect(isPrivateHost('api.openai.com')).toBe(false);
  });
});
