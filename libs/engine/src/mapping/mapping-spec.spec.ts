import { mappingJsonSchema, validateMappingSpec } from './mapping-spec';

const minimal = {
  format: 'lazy-koins-mapping',
  version: 1,
  name: 'Test',
  platform: 'test',
  match: { headers: ['Date', 'Amount'] },
  bookings: {
    timestamp: { column: 'Date', format: 'ymd' },
    asset: { column: 'Coin' },
    quantity: { mode: 'signed', column: 'Amount' },
    kind: { columns: ['Type'], rules: [{ equals: ['Buy'], kind: 'trade' }] },
  },
};

describe('mapping spec schema', () => {
  it('accepts a minimal spec and fills in the defaults', () => {
    const result = validateMappingSpec(minimal);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.source.encoding).toBe('auto');
    expect(result.spec.numbers).toEqual({
      decimal: '.',
      thousands: [],
      stripText: false,
    });
    expect(result.spec.filters).toEqual([]);
    expect(result.spec.bookings?.timestamp.timeZone).toBe('UTC');
    expect(result.spec.bookings?.kind.default).toBe('unknown');
  });

  it.each([
    ['wrong format', { ...minimal, format: 'other' }, 'format'],
    ['future version', { ...minimal, version: 2 }, 'version'],
    ['upper-case platform', { ...minimal, platform: 'Kraken' }, 'platform'],
    ['no records', { ...minimal, bookings: undefined }, ''],
    [
      'unknown kind',
      {
        ...minimal,
        bookings: {
          ...minimal.bookings,
          kind: {
            columns: ['T'],
            rules: [{ equals: ['x'], kind: 'interest' }],
          },
        },
      },
      'bookings.kind.rules.0.kind',
    ],
    [
      'bad regex',
      { ...minimal, match: { headers: ['a'], fileName: '(' } },
      'match.fileName',
    ],
    [
      'unknown zone',
      {
        ...minimal,
        bookings: {
          ...minimal.bookings,
          timestamp: { column: 'Date', format: 'ymd', timeZone: 'Mars/Base' },
        },
      },
      'bookings.timestamp.timeZone',
    ],
    [
      'empty rule',
      {
        ...minimal,
        bookings: {
          ...minimal.bookings,
          kind: { columns: ['T'], rules: [{ kind: 'trade' }] },
        },
      },
      'bookings.kind.rules.0',
    ],
    [
      'lastPerAsset without bookings',
      {
        ...minimal,
        bookings: undefined,
        holdings: {
          mode: 'lastPerAsset',
          asset: { column: 'a' },
          quantity: { column: 'b' },
        },
      },
      '',
    ],
  ])('rejects %s', (_label, input, path) => {
    const result = validateMappingSpec(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path)).toContain(path);
  });

  it('exports a JSON Schema with a description on every documented field (for an LLM prompt)', () => {
    const schema = mappingJsonSchema();
    const text = JSON.stringify(schema);
    expect(schema['type']).toBe('object');
    expect(text).toContain('lazy-koins-mapping');
    expect(text).toContain('income_staking');
    expect(text).toContain('Rows to EXCLUDE');
    expect(text.length).toBeLessThan(40_000);
  });
});
