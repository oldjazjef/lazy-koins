import type { Booking, Holding } from '../bookings/booking';
import type { Correction } from '../corrections/corrections';
import { parseDecimal } from '../money/decimal';
import type { RateEntry } from '../rates/rate-table';
import { chRules } from '../rules/country-rules';
import { calculate } from './calculate';
import { bookingTreatments } from './treatments';
import type { CalculationInput } from './types';

/** Synthetic records only (CLAUDE.md, Private data). */
function booking(
  id: string,
  over: Partial<Omit<Booking, 'quantity' | 'fee'>> & {
    quantity: string;
    fee?: string;
  },
): Booking {
  const { quantity, fee, ...rest } = over;
  return {
    id,
    sourceFileId: 'f1',
    row: Number(id.split(':')[1] ?? 1),
    platform: 'kraken',
    accountId: 'main',
    timestamp: '2025-06-01T12:00:00.000Z',
    asset: 'BTC',
    kind: 'trade',
    rawType: 'trade',
    ...rest,
    quantity: parseDecimal(quantity),
    fee: fee === undefined ? undefined : parseDecimal(fee),
  } as Booking;
}

const chf = (asset: string, date: string, value: string): RateEntry => ({
  kind: 'price',
  asset,
  currency: 'CHF',
  date,
  value,
  source: 'coingecko',
});
const fx = (date: string): RateEntry => ({
  kind: 'fx',
  asset: 'USD',
  currency: 'CHF',
  date,
  value: '0.8',
  source: 'ecb',
});

function input(over: Partial<CalculationInput> = {}): CalculationInput {
  return {
    taxYear: 2025,
    rules: chRules,
    bookings: [],
    holdings: [],
    corrections: [],
    rates: [
      fx('2025-12-31'),
      fx('2025-03-01'),
      chf('ETH', '2025-03-01', '2000'),
      chf('ETH', '2025-12-31', '3000'),
      chf('BTC', '2025-12-31', '80000'),
    ],
    ...over,
  };
}

const correction = (
  id: string,
  data: Correction['data'],
  reason = 'Doppelt importiert',
): Correction => ({ id, createdAt: '2026-01-10T00:00:00.000Z', reason, data });

const rowsOf = (i: CalculationInput) => bookingTreatments(i, calculate(i));
const byId = (i: CalculationInput) =>
  new Map(rowsOf(i).map((row) => [row.id, row] as const));

describe('exclude_booking correction', () => {
  const buy = booking('f1:1', { quantity: '1' });
  const duplicate = booking('f1:2', { quantity: '1' });

  it('leaves the booking out of the calculation, with before/after, and undo restores it', () => {
    const both = input({ bookings: [buy, duplicate] });
    expect(calculate(both).positions[0]?.quantity).toBe('2');

    const excluded = input({
      bookings: [buy, duplicate],
      corrections: [
        correction('c1', { type: 'exclude_booking', bookingId: 'f1:2' }),
      ],
    });
    const result = calculate(excluded);
    expect(result.positions[0]?.quantity).toBe('1');
    expect(result.positions[0]?.recordIds).toEqual(['f1:1']);
    expect(result.corrections).toEqual([
      expect.objectContaining({
        correctionId: 'c1',
        type: 'exclude_booking',
        status: 'applied',
        before: expect.objectContaining({ bookingId: 'f1:2', quantity: '1' }),
        after: null,
      }),
    ]);
  });

  it('reports a booking that is no longer there (or excluded twice) as targetMissing', () => {
    const result = calculate(
      input({
        bookings: [buy],
        corrections: [
          correction('c1', { type: 'exclude_booking', bookingId: 'gone:9' }),
          correction('c2', { type: 'exclude_booking', bookingId: 'f1:1' }),
          correction('c3', { type: 'exclude_booking', bookingId: 'f1:1' }),
        ],
      }),
    );
    expect(result.corrections.map((c) => c.status)).toEqual([
      'targetMissing',
      'applied',
      'targetMissing',
    ]);
    expect(result.positions).toEqual([]);
  });
});

describe('bookingTreatments (Transaktionen)', () => {
  it('says how every booking counts, newest first', () => {
    const rows = byId(
      input({
        bookings: [
          booking('f1:1', { quantity: '1' }),
          booking('f1:2', {
            asset: 'ETH',
            quantity: '0.5',
            kind: 'income_staking',
            timestamp: '2025-03-01T08:00:00.000Z',
          }),
          booking('f1:3', { quantity: '-0.1', kind: 'transfer' }),
          booking('f1:4', { asset: 'SCAM', quantity: '100', kind: 'spam' }),
          booking('f1:5', { quantity: '0.2', kind: 'unknown' }),
          booking('f1:6', {
            quantity: '0.3',
            timestamp: '2026-01-02T00:00:00.000Z',
          }),
        ],
      }),
    );
    expect(rows.get('f1:1')).toEqual(
      expect.objectContaining({
        treatment: 'balance',
        figureIds: ['pos:kraken|main|BTC'],
      }),
    );
    expect(rows.get('f1:2')).toEqual(
      expect.objectContaining({
        treatment: 'income',
        valueChf: '1000',
        incomeCategory: expect.any(String),
      }),
    );
    expect(rows.get('f1:2')?.figureIds).toContain('inc:f1:2');
    expect(rows.get('f1:3')?.treatment).toBe('transfer');
    expect(rows.get('f1:4')?.treatment).toBe('spam');
    expect(rows.get('f1:5')?.treatment).toBe('unknown');
    expect(rows.get('f1:6')?.treatment).toBe('afterYear');
    expect(
      rowsOf(
        input({
          bookings: [
            booking('a:1', {
              quantity: '1',
              timestamp: '2025-01-01T00:00:00.000Z',
            }),
            booking('a:2', {
              quantity: '1',
              timestamp: '2025-02-01T00:00:00.000Z',
            }),
          ],
        }),
      ).map((r) => r.id),
    ).toEqual(['a:2', 'a:1']);
  });

  it('marks bookings of an account valued from a statement as checkOnly', () => {
    const statement: Holding = {
      id: 's1:1',
      sourceFileId: 's1',
      row: 1,
      platform: 'kraken',
      accountId: 'main',
      asset: 'BTC',
      quantity: parseDecimal('1'),
      asOf: '2025-12-31',
    };
    const rows = byId(
      input({
        bookings: [booking('f1:1', { quantity: '1' })],
        holdings: [statement],
      }),
    );
    expect(rows.get('f1:1')?.treatment).toBe('checkOnly');
  });

  it('keeps an excluded booking listed with the correction and its reason, in no figure', () => {
    const rows = byId(
      input({
        bookings: [
          booking('f1:1', { quantity: '1' }),
          booking('f1:2', { quantity: '1' }),
        ],
        corrections: [
          correction(
            'c1',
            { type: 'exclude_booking', bookingId: 'f1:2' },
            'Testüberweisung',
          ),
        ],
      }),
    );
    expect(rows.get('f1:2')).toEqual(
      expect.objectContaining({
        treatment: 'excluded',
        correctionId: 'c1',
        correctionReason: 'Testüberweisung',
        figureIds: [],
        quantity: '1',
      }),
    );
    expect(rows.get('f1:1')?.treatment).toBe('balance');
  });

  it('shows a reclassification (imported kind) and manual bookings with their correction', () => {
    const rows = byId(
      input({
        bookings: [booking('f1:1', { quantity: '1', kind: 'deposit' })],
        corrections: [
          correction(
            'c1',
            { type: 'reclassify', bookingId: 'f1:1', kind: 'transfer' },
            'Eigenes Konto',
          ),
          correction('m1', {
            type: 'manual_booking',
            booking: {
              platform: 'ledger',
              accountId: 'main',
              timestamp: '2025-05-01T00:00:00Z',
              asset: 'ETH',
              quantity: '1',
              kind: 'trade',
            },
          }),
        ],
      }),
    );
    expect(rows.get('f1:1')).toEqual(
      expect.objectContaining({
        kind: 'transfer',
        importedKind: 'deposit',
        treatment: 'transfer',
        correctionId: 'c1',
        correctionReason: 'Eigenes Konto',
      }),
    );
    expect(rows.get('correction:m1')).toEqual(
      expect.objectContaining({
        manual: true,
        correctionId: 'm1',
        treatment: 'balance',
      }),
    );
  });
});
