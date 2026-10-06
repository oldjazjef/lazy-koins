import type { Booking, Holding } from '../bookings/booking';
import { parseDecimal } from '../money/decimal';
import {
  coverageOf,
  type CoverageEntry,
  missingFileHints,
} from './missing-files';

const booking = (
  platform: string,
  accountId: string,
  timestamp: string,
  quantity = '1',
  extra: Partial<Booking> = {},
): Booking => ({
  id: `${platform}:${accountId}:${timestamp}:${quantity}`,
  sourceFileId: 'f',
  row: 2,
  platform,
  accountId,
  timestamp,
  asset: 'BTC',
  quantity: parseDecimal(quantity),
  kind: 'trade',
  rawType: 'trade',
  ...extra,
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

/** One file of the synthetic project: its coverage entries. */
const ledger = (
  platform: string,
  accountId: string,
  from: string,
  to: string,
  net?: Record<string, string>,
): CoverageEntry => ({
  platform,
  accountId,
  from,
  to,
  bookings: 3,
  holdingDates: [],
  ...(net ? { net } : {}),
});
const statement = (
  platform: string,
  accountId: string,
  date: string,
): CoverageEntry => ({
  platform,
  accountId,
  bookings: 0,
  holdingDates: [date],
});

describe('coverageOf', () => {
  it('summarises per platform and account, sorted, with the net change per asset', () => {
    expect(
      coverageOf(
        [
          booking('kraken', 'spot', '2025-03-01T00:00:00.000Z', '-0.4', {
            fee: parseDecimal('0.1'),
            feeAsset: 'CHF',
          }),
          booking('binance', 'Spot', '2025-01-01T00:00:00.000Z'),
          booking('kraken', 'spot', '2024-12-01T10:00:00.000Z'),
        ],
        [
          holding('kraken', 'spot', '2025-12-31'),
          holding('kraken', 'spot', '2025-12-31'),
          holding('kraken', 'earn', '2025-12-31'),
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
        net: { BTC: '1' },
      },
      {
        platform: 'kraken',
        accountId: 'earn',
        bookings: 0,
        holdingDates: ['2025-12-31'],
      },
      {
        platform: 'kraken',
        accountId: 'spot',
        from: '2024-12-01',
        to: '2025-03-01',
        bookings: 2,
        holdingDates: ['2025-12-31'],
        net: { BTC: '0.6', CHF: '-0.1' },
      },
    ]);
  });
});

describe('missingFileHints (F5.8)', () => {
  it('reports a history ending before 31.12., one starting after 01.01. and a missing year-end balance', () => {
    const hints = missingFileHints(2025, [
      ledger('binance', 'Spot', '2024-01-01', '2025-06-30', { BTC: '2' }),
      ledger('kraken', 'spot', '2025-02-01', '2025-12-31', { BTC: '1' }),
      statement('kraken', 'spot', '2025-12-31'),
    ]);
    expect(hints).toEqual([
      {
        key: 'endsEarly:binance|Spot',
        platform: 'binance',
        accountId: 'Spot',
        accounts: ['Spot'],
        kind: 'endsEarly',
        severity: 'warning',
        date: '2025-06-30',
        hintKey: 'files.missing.howTo.endsEarly',
      },
      {
        key: 'noYearEndBalance:binance',
        platform: 'binance',
        accountId: 'Spot',
        accounts: ['Spot'],
        kind: 'noYearEndBalance',
        severity: 'warning',
        hintKey: 'files.missing.howTo.noYearEndBalance',
      },
      {
        key: 'startsLate:kraken|spot',
        platform: 'kraken',
        accountId: 'spot',
        accounts: ['spot'],
        kind: 'startsLate',
        severity: 'warning',
        date: '2025-02-01',
        hintKey: 'files.missing.howTo.startsLate',
      },
    ]);
  });

  it('merges several files of one account, and is quiet when the year is covered', () => {
    expect(
      missingFileHints(2025, [
        ledger('kraken', 'spot', '2020-01-01', '2025-05-31', { BTC: '1' }),
        ledger('kraken', 'spot', '2025-06-01', '2026-01-15', { BTC: '1' }),
        statement('kraken', 'spot', '2025-12-31'),
      ]),
    ).toEqual([]);
    expect(missingFileHints(2025, [])).toEqual([]);
  });

  it('takes a platform-wide statement (accounts the ledger does not use) for every sub-account', () => {
    // A Kraken-like ledger with spot + two earn sub-accounts, and one statement for "Kraken".
    const entries = [
      ledger('kraken', 'spot / main', '2024-01-01', '2025-12-30', {
        BTC: '0.5',
      }),
      ledger('kraken', 'earn / bonded', '2024-01-01', '2025-12-31', {
        DOT: '10',
      }),
      ledger('kraken', 'earn / flexible', '2024-01-01', '2025-12-31', {
        ETH: '1',
      }),
      statement('kraken', 'kraken', '2025-12-31'),
    ];
    expect(
      missingFileHints(2025, entries).map((h) => [h.key, h.severity]),
    ).toEqual([['endsEarly:kraken|spot / main', 'warning']]);
  });

  it('still asks per account when the statement names some of the ledger accounts', () => {
    const hints = missingFileHints(2025, [
      ledger('kraken', 'earn', '2024-01-01', '2025-12-31', { DOT: '1' }),
      ledger('kraken', 'spot', '2024-01-01', '2025-12-31', { BTC: '1' }),
      statement('kraken', 'spot', '2025-12-31'),
    ]);
    expect(hints.map((h) => h.key)).toEqual(['noYearEndBalance:kraken|earn']);
  });

  it('collapses "no year-end balance" into one hint per platform when there is no statement at all', () => {
    const hints = missingFileHints(2025, [
      ledger('kraken', 'earn', '2024-01-01', '2025-12-31', { DOT: '1' }),
      ledger('kraken', 'spot', '2024-01-01', '2025-12-31', { BTC: '1' }),
      ledger('kraken', 'staking', '2024-01-01', '2025-12-31', { ETH: '1' }),
    ]);
    expect(hints).toEqual([
      {
        key: 'noYearEndBalance:kraken',
        platform: 'kraken',
        accountId: '',
        accounts: ['earn', 'spot', 'staking'],
        kind: 'noYearEndBalance',
        severity: 'warning',
        hintKey: 'files.missing.howTo.noYearEndBalance',
      },
    ]);
  });

  it('downgrades an early end to info when the account is empty at that date, and needs no statement then', () => {
    const hints = missingFileHints(2025, [
      ledger('binance', 'Spot', '2024-01-01', '2025-02-09', {
        BTC: '0',
        USDT: '0.00000001',
      }),
      ledger('bitfinex', 'exchange', '2020-01-01', '2023-05-01', { ETH: '0' }),
    ]);
    expect(hints).toEqual([
      {
        key: 'endsEarly:binance|Spot',
        platform: 'binance',
        accountId: 'Spot',
        accounts: ['Spot'],
        kind: 'endsEarly',
        severity: 'info',
        date: '2025-02-09',
        zeroBalance: true,
        hintKey: 'files.missing.howTo.endsEarlyZero',
      },
      {
        key: 'noYearData:bitfinex|exchange',
        platform: 'bitfinex',
        accountId: 'exchange',
        accounts: ['exchange'],
        kind: 'noYearData',
        severity: 'info',
        date: '2023-05-01',
        zeroBalance: true,
        hintKey: 'files.missing.howTo.noYearDataZero',
      },
    ]);
  });

  it('reports a history that ends before the year as a missing file (error) when something is left', () => {
    const [hint] = missingFileHints(2025, [
      ledger('bitfinex', 'exchange', '2020-01-01', '2024-11-30', { ETH: '3' }),
    ]);
    expect(hint).toMatchObject({
      key: 'noYearData:bitfinex|exchange',
      kind: 'noYearData',
      severity: 'error',
      date: '2024-11-30',
    });
  });

  it('treats an unknown balance (entries stored before `net` existed) as not empty', () => {
    const hints = missingFileHints(2025, [
      ledger('binance', 'Spot', '2024-01-01', '2025-02-09'),
    ]);
    expect(hints.map((h) => [h.kind, h.severity])).toEqual([
      ['endsEarly', 'warning'],
      ['noYearEndBalance', 'warning'],
    ]);
  });

  it('does not take a ledger running balance at 31.12. for a statement', () => {
    const hints = missingFileHints(2025, [
      {
        ...ledger('kraken', 'spot', '2024-01-01', '2025-12-31', { BTC: '1' }),
        holdingDates: ['2025-12-31'],
      },
    ]);
    expect(hints.map((h) => h.key)).toEqual(['noYearEndBalance:kraken']);
  });

  it('keeps its keys stable when the dates move (dismissals survive new files)', () => {
    const before = missingFileHints(2025, [
      ledger('binance', 'Spot', '2024-01-01', '2025-06-30', { BTC: '1' }),
    ]);
    const after = missingFileHints(2025, [
      ledger('binance', 'Spot', '2024-01-01', '2025-09-30', { BTC: '1' }),
    ]);
    expect(after.map((h) => h.key)).toEqual(before.map((h) => h.key));
  });
});
