import type { Booking, Holding } from '../bookings/booking';
import { parseDecimal } from '../money/decimal';
import { coverageOf, missingFileHints } from './missing-files';

const booking = (
  platform: string,
  accountId: string,
  timestamp: string,
): Booking => ({
  id: `${platform}:${timestamp}`,
  sourceFileId: 'f',
  row: 2,
  platform,
  accountId,
  timestamp,
  asset: 'BTC',
  quantity: parseDecimal('1'),
  kind: 'trade',
  rawType: 'trade',
});

const holding = (
  platform: string,
  accountId: string,
  asOf: string,
): Holding => ({
  id: `${platform}:${asOf}`,
  sourceFileId: 'f',
  row: 2,
  platform,
  accountId,
  asset: 'BTC',
  quantity: parseDecimal('1'),
  asOf,
});

describe('coverageOf', () => {
  it('summarises per platform and account, sorted', () => {
    expect(
      coverageOf(
        [
          booking('kraken', 'spot', '2025-03-01T00:00:00.000Z'),
          booking('binance', 'Spot', '2025-01-01T00:00:00.000Z'),
          booking('kraken', 'spot', '2024-12-01T10:00:00.000Z'),
        ],
        [
          holding('kraken', 'spot', '2025-12-31'),
          holding('kraken', 'spot', '2025-12-31'),
        ],
      ),
    ).toEqual([
      {
        platform: 'binance',
        accountId: 'Spot',
        from: '2025-01-01',
        to: '2025-01-01',
        bookings: 1,
        holdingDates: [],
      },
      {
        platform: 'kraken',
        accountId: 'spot',
        from: '2024-12-01',
        to: '2025-03-01',
        bookings: 2,
        holdingDates: ['2025-12-31'],
      },
    ]);
  });
});

describe('missingFileHints (F5.8)', () => {
  it('reports a history ending before 31.12., one starting after 01.01. and a missing year-end balance', () => {
    const hints = missingFileHints(2025, [
      {
        platform: 'binance',
        accountId: 'Spot',
        from: '2024-01-01',
        to: '2025-06-30',
        bookings: 10,
        holdingDates: [],
      },
      {
        platform: 'kraken',
        accountId: 'spot',
        from: '2025-02-01',
        to: '2025-12-31',
        bookings: 4,
        holdingDates: [],
      },
      {
        platform: 'kraken',
        accountId: 'spot',
        bookings: 0,
        holdingDates: ['2025-12-31'],
      },
    ]);
    expect(hints).toEqual([
      {
        platform: 'binance',
        accountId: 'Spot',
        kind: 'endsEarly',
        date: '2025-06-30',
        hintKey: 'files.missing.howTo.endsEarly',
      },
      {
        platform: 'binance',
        accountId: 'Spot',
        kind: 'noYearEndBalance',
        hintKey: 'files.missing.howTo.noYearEndBalance',
      },
      {
        platform: 'kraken',
        accountId: 'spot',
        kind: 'startsLate',
        date: '2025-02-01',
        hintKey: 'files.missing.howTo.startsLate',
      },
    ]);
  });

  it('merges several files of one account, and is quiet when the year is covered', () => {
    expect(
      missingFileHints(2025, [
        {
          platform: 'kraken',
          accountId: 'spot',
          from: '2020-01-01',
          to: '2025-05-31',
          bookings: 1,
          holdingDates: [],
        },
        {
          platform: 'kraken',
          accountId: 'spot',
          from: '2025-06-01',
          to: '2026-01-15',
          bookings: 1,
          holdingDates: ['2025-12-31'],
        },
      ]),
    ).toEqual([]);
    expect(missingFileHints(2025, [])).toEqual([]);
  });
});
