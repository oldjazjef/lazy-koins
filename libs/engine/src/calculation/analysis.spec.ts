import type { Booking, BookingKind, Holding } from '../bookings/booking';
import { parseDecimal } from '../money/decimal';
import { chRules } from '../rules/country-rules';
import {
  balancesAt,
  dailyBalances,
  dailyPricesChf,
  flowsBetween,
} from './analysis';

/** Synthetic records only. */
let seq = 0;
function booking(
  timestamp: string,
  asset: string,
  quantity: string,
  kind: BookingKind,
  fee?: string,
): Booking {
  seq += 1;
  return {
    id: `f:${seq}`,
    sourceFileId: 'f',
    row: seq,
    platform: 'kraken',
    accountId: 'main',
    timestamp,
    asset,
    quantity: parseDecimal(quantity),
    kind,
    fee: fee === undefined ? undefined : parseDecimal(fee),
    rawType: kind,
  };
}

const bookings = [
  booking('2025-03-01T10:00:00.000Z', 'ETH', '2', 'deposit'),
  booking('2025-03-02T10:00:00.000Z', 'ETH', '0.1', 'income_staking'),
  booking('2025-03-03T23:59:59.000Z', 'ETH', '-1', 'withdrawal', '0.01'),
  booking('2025-03-04T00:00:00.000Z', 'ETH', '-0.5', 'loss'),
];
const statement: Holding = {
  id: 's:1:holding',
  sourceFileId: 's',
  row: 1,
  platform: 'kraken',
  accountId: 'main',
  asset: 'ETH',
  quantity: parseDecimal('1.1'),
  asOf: '2025-03-03',
};
const input = { rules: chRules, bookings, holdings: [] };

describe('analysis over any date (dashboard)', () => {
  it('gives the balances at the end of any day', () => {
    expect(balancesAt(input, '2025-03-02')).toEqual([
      expect.objectContaining({
        asset: 'ETH',
        quantity: '2.1',
        source: 'ledger',
      }),
    ]);
    expect(balancesAt(input, '2025-03-03')[0]?.quantity).toBe('1.09');
    expect(
      balancesAt({ ...input, holdings: [statement] }, '2025-03-03')[0],
    ).toMatchObject({ quantity: '1.1', source: 'statement' });
  });

  it('sweeps daily balances in one pass, statements winning on their day', () => {
    const days = dailyBalances(
      { ...input, holdings: [statement] },
      '2025-02-28',
      '2025-03-04',
    );
    expect(
      days.map((d) => [d.date, d.balances['kraken|main|ETH'] ?? null]),
    ).toEqual([
      ['2025-02-28', null],
      ['2025-03-01', '2'],
      ['2025-03-02', '2.1'],
      ['2025-03-03', '1.1'],
      ['2025-03-04', '0.59'],
    ]);
  });

  it('sums flows by kind over a range', () => {
    expect(flowsBetween(input, '2025-03-01', '2025-03-03')).toEqual([
      expect.objectContaining({
        asset: 'ETH',
        deposits: '2',
        withdrawals: '1',
        income: '0.1',
        fees: '0.01',
        losses: '0',
      }),
    ]);
  });

  it('gives a daily CHF price series by the price priority', () => {
    const prices = dailyPricesChf(
      [
        {
          kind: 'fx',
          asset: 'USD',
          currency: 'CHF',
          date: '2025-03-01',
          value: '0.9',
          source: 'ecb',
        },
        {
          kind: 'price',
          asset: 'ETH',
          currency: 'USD',
          date: '2025-03-01',
          value: '2000',
          source: 'binance',
        },
      ],
      chRules,
      'ETH',
      '2025-02-28',
      '2025-03-02',
    );
    expect(prices).toEqual([
      { date: '2025-02-28', priceChf: '1800' },
      { date: '2025-03-01', priceChf: '1800' },
      { date: '2025-03-02', priceChf: '1800' },
    ]);
  });
});
