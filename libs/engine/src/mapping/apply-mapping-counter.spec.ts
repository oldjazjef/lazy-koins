import type { Booking } from '../bookings/booking';
import { csvSourceFile } from '../importers/text/csv';
import { toDecimalString } from '../money/decimal';
import { applyMapping } from './apply-mapping';
import {
  type MappingSpec,
  type MappingSpecInput,
  validateMappingSpec,
} from './mapping-spec';

/**
 * The one-row-trade extensions of the mapping format: `bookings.counter` (a second leg from the
 * same row), kind rules with a `direction`, `asset.pattern`, `numbers.nullValues` and
 * `timestamp.headerPattern`. Synthetic files only.
 */

function spec(input: MappingSpecInput): MappingSpec {
  const result = validateMappingSpec(input);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.spec;
}

function csv(text: string, name = 'test.csv') {
  return csvSourceFile({
    id: 'sha-test',
    name,
    bytes: new TextEncoder().encode(text),
  });
}

const view = (b: Booking) => ({
  id: b.id,
  row: b.row,
  account: b.accountId,
  asset: b.asset,
  quantity: toDecimalString(b.quantity),
  kind: b.kind,
  fee: b.fee === undefined ? undefined : toDecimalString(b.fee),
  feeAsset: b.feeAsset,
  group: b.group,
});

const base: MappingSpecInput = {
  format: 'lazy-koins-mapping',
  version: 1,
  name: 'One-row trades',
  platform: 'test',
  match: { headers: ['Time', 'Type', 'Asset', 'Quantity', 'Currency'] },
  numbers: { thousands: [','], stripText: true },
  bookings: {
    timestamp: { column: 'Time', format: 'ymd' },
    asset: { column: 'Asset' },
    quantity: { mode: 'signed', column: 'Quantity' },
    kind: {
      columns: ['Type'],
      rules: [
        { equals: ['Buy'], kind: 'trade', direction: 'in' },
        { equals: ['Sell'], kind: 'trade', direction: 'out' },
        { equals: ['Send'], kind: 'withdrawal', direction: 'out' },
        { equals: ['Stake'], kind: 'transfer', direction: 'out' },
      ],
    },
    counter: [
      {
        asset: { column: 'Currency' },
        quantity: { column: 'Subtotal', sign: 'opposite' },
        fee: { column: 'Fees' },
      },
      {
        when: { kinds: ['transfer'], pattern: '^Stake$' },
        asset: { column: 'Asset' },
        quantity: { column: 'Quantity', sign: 'opposite' },
        account: { value: 'staking' },
      },
    ],
  },
};

const baseBookings = base.bookings as NonNullable<MappingSpecInput['bookings']>;

const FILE = [
  'Time,Type,Asset,Quantity,Currency,Subtotal,Fees',
  '2025-01-02 10:00:00,Buy,BTC,0.1,CHF,"CHF4,000.00",CHF20.00',
  '2025-01-03 10:00:00,Sell,BTC,0.05,CHF,CHF2100.00,CHF10.00',
  '2025-01-04 10:00:00,Send,BTC,-0.01,CHF,CHF400.00,',
  '2025-01-05 10:00:00,Stake,ETH,2,,,',
  '2025-01-06 10:00:00,Buy,ETH,1,CHF,,',
].join('\n');

describe('mapping: counter legs (one-row trades)', () => {
  const result = applyMapping(spec(base), csv(FILE));

  it('emits the counter leg right after its main leg, with an id of its own', () => {
    expect(result.errors).toEqual([]);
    expect(result.bookings.map(view)).toEqual([
      {
        id: 'sha-test:2',
        row: 2,
        account: 'main',
        asset: 'BTC',
        quantity: '0.1',
        kind: 'trade',
        fee: undefined,
        feeAsset: undefined,
        group: 'sha-test:2',
      },
      {
        id: 'sha-test:2:counter',
        row: 2,
        account: 'main',
        asset: 'CHF',
        quantity: '-4000',
        kind: 'trade',
        fee: '20',
        feeAsset: undefined,
        group: 'sha-test:2',
      },
      {
        id: 'sha-test:3',
        row: 3,
        account: 'main',
        asset: 'BTC',
        quantity: '-0.05',
        kind: 'trade',
        fee: undefined,
        feeAsset: undefined,
        group: 'sha-test:3',
      },
      {
        id: 'sha-test:3:counter',
        row: 3,
        account: 'main',
        asset: 'CHF',
        quantity: '2100',
        kind: 'trade',
        fee: '10',
        feeAsset: undefined,
        group: 'sha-test:3',
      },
      // A withdrawal gets no counter leg (its rule only applies to trades).
      {
        id: 'sha-test:4',
        row: 4,
        account: 'main',
        asset: 'BTC',
        quantity: '-0.01',
        kind: 'withdrawal',
        fee: undefined,
        feeAsset: undefined,
        group: undefined,
      },
      // An internal move becomes a pair of transfers between two accounts.
      {
        id: 'sha-test:5',
        row: 5,
        account: 'main',
        asset: 'ETH',
        quantity: '-2',
        kind: 'transfer',
        fee: undefined,
        feeAsset: undefined,
        group: 'sha-test:5',
      },
      {
        id: 'sha-test:5:counter',
        row: 5,
        account: 'staking',
        asset: 'ETH',
        quantity: '2',
        kind: 'transfer',
        fee: undefined,
        feeAsset: undefined,
        group: 'sha-test:5',
      },
      // No amount for the second leg: the main leg alone, without an invented group.
      {
        id: 'sha-test:6',
        row: 6,
        account: 'main',
        asset: 'ETH',
        quantity: '1',
        kind: 'trade',
        fee: undefined,
        feeAsset: undefined,
        group: undefined,
      },
    ]);
  });

  it('keeps file, row and raw row on both legs (F7.5)', () => {
    const [main, counter] = result.bookings;
    expect(counter?.sourceFileId).toBe('sha-test');
    expect(counter?.row).toBe(main?.row);
    expect(counter?.raw).toEqual(main?.raw);
    expect(counter?.rawType).toBe('Buy');
    expect(new Set(result.bookings.map((b) => b.id)).size).toBe(
      result.bookings.length,
    );
  });

  it('uses the group column when the export has one', () => {
    const withGroup = applyMapping(
      spec({
        ...base,
        bookings: { ...baseBookings, group: { column: 'Ref' } },
      }),
      csv(
        'Time,Type,Asset,Quantity,Currency,Subtotal,Fees,Ref\n2025-01-02 10:00:00,Buy,BTC,0.1,EUR,100,,T-1',
      ),
    );
    expect(withGroup.bookings.map((b) => b.group)).toEqual(['T-1', 'T-1']);
  });

  it('takes a signed counter amount as written and cuts values out of a note', () => {
    const notes = applyMapping(
      spec({
        ...base,
        match: { headers: ['Time', 'Type', 'Asset', 'Quantity', 'Notes'] },
        bookings: {
          ...baseBookings,
          kind: {
            columns: ['Type'],
            rules: [{ equals: ['Convert'], kind: 'trade', direction: 'out' }],
          },
          counter: {
            asset: { column: 'Notes', pattern: ' to [\\d.,]+ (\\w+)' },
            quantity: {
              column: 'Notes',
              pattern: ' to ([\\d.,]+) ',
              sign: 'signed',
            },
          },
        },
      }),
      csv(
        'Time,Type,Asset,Quantity,Notes\n2025-01-02 10:00:00,Convert,ETH,1,"Converted 1 ETH to 3,250.5 USDC"\n2025-01-03 10:00:00,Convert,ETH,1,no note',
      ),
    );
    expect(notes.errors).toEqual([]);
    expect(notes.bookings.map(view).map((b) => [b.asset, b.quantity])).toEqual([
      ['ETH', '-1'],
      ['USDC', '3250.5'],
      ['ETH', '-1'],
    ]);
  });

  it('reports a counter amount without an asset as a row error', () => {
    const broken = applyMapping(
      spec(base),
      csv(
        'Time,Type,Asset,Quantity,Currency,Subtotal,Fees\n2025-01-02 10:00:00,Buy,BTC,0.1,,100,',
      ),
    );
    expect(broken.bookings).toEqual([]);
    expect(broken.errors).toEqual([
      { row: 2, code: 'required', column: 'Currency' },
    ]);
  });

  it('leaves the running balance (lastPerAsset) to the main leg', () => {
    const ledger = applyMapping(
      spec({
        ...base,
        holdings: {
          mode: 'lastPerAsset',
          asset: { column: 'Asset' },
          quantity: { column: 'Balance' },
        },
      }),
      csv(
        'Time,Type,Asset,Quantity,Currency,Subtotal,Fees,Balance\n2025-01-02 10:00:00,Buy,BTC,0.1,CHF,100,,0.1',
      ),
    );
    expect(ledger.bookings).toHaveLength(2);
    expect(
      ledger.holdings.map((h) => [h.asset, toDecimalString(h.quantity)]),
    ).toEqual([['BTC', '0.1']]);
  });
});

describe('mapping: direction, asset pattern, null values, zone from the header', () => {
  const kucoinLike = spec({
    format: 'lazy-koins-mapping',
    version: 1,
    name: 'Pairs',
    platform: 'test',
    match: { headers: ['Symbol', 'Side', 'Filled Amount', 'Fee'] },
    numbers: { nullValues: ['-'] },
    bookings: {
      timestamp: {
        column: 'Filled Time(UTC)',
        format: 'ymd',
        headerPattern: '^Filled Time\\s*\\((UTC[^)]*)\\)$',
      },
      asset: { column: 'Symbol', pattern: '^([^-]+)-' },
      quantity: {
        mode: 'side',
        column: 'Filled Amount',
        sideColumn: 'Side',
        outValues: ['SELL'],
      },
      fee: { column: 'Fee', assetColumn: 'Fee Currency' },
      kind: { columns: ['Side'], rules: [{ pattern: '.', kind: 'trade' }] },
    },
  });

  it('reads the zone from the time header, the base asset from the pair and "-" as empty', () => {
    const result = applyMapping(
      kucoinLike,
      csv(
        'Symbol,Side,Filled Amount,Fee,Fee Currency,Filled Time(UTC+08:00)\nBTC-USDT,SELL,0.5,-,USDT,2025-01-02 08:00:00\nETH-BTC,BUY,2,0.01,ETH,2025-01-02 09:00:00',
      ),
    );
    expect(result.errors).toEqual([]);
    expect(result.bookings.map((b) => [b.timestamp, b.asset])).toEqual([
      ['2025-01-02T00:00:00.000Z', 'BTC'],
      ['2025-01-02T01:00:00.000Z', 'ETH'],
    ]);
    expect(result.bookings.map(view).map((b) => [b.quantity, b.fee])).toEqual([
      ['-0.5', undefined],
      ['2', '0.01'],
    ]);
  });

  it('falls back to the timestamp column and zone when no header matches', () => {
    const result = applyMapping(
      kucoinLike,
      csv(
        'Symbol,Side,Filled Amount,Fee,Fee Currency,Filled Time(UTC)\nBTC-USDT,BUY,1,0,USDT,2025-01-02 08:00:00',
      ),
    );
    expect(result.bookings[0]?.timestamp).toBe('2025-01-02T08:00:00.000Z');
  });

  it('leaves specs without the new fields exactly as before', () => {
    const plain = spec({
      ...base,
      bookings: {
        ...baseBookings,
        counter: undefined,
        kind: {
          columns: ['Type'],
          rules: [{ equals: ['Send'], kind: 'withdrawal' }],
        },
      },
    });
    expect(plain.numbers).toEqual({
      decimal: '.',
      thousands: [','],
      stripText: true,
    });
    const result = applyMapping(
      plain,
      csv(
        'Time,Type,Asset,Quantity,Currency\n2025-01-04 10:00:00,Send,BTC,0.01,CHF',
      ),
    );
    // No direction on the rule: the amount's own sign stands.
    expect(result.bookings.map(view)).toEqual([
      {
        id: 'sha-test:2',
        row: 2,
        account: 'main',
        asset: 'BTC',
        quantity: '0.01',
        kind: 'withdrawal',
        fee: undefined,
        feeAsset: undefined,
        group: undefined,
      },
    ]);
  });
});
