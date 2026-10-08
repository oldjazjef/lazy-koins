import type { Booking } from '../bookings/booking';
import { parseDecimal } from '../money/decimal';
import {
  applyTransactionEdits,
  type TransactionEdit,
  TransactionChangesSchema,
  transactionKeys,
} from './edits';

/** Synthetic records only (CLAUDE.md, Private data). */
function booking(
  id: string,
  over: Partial<Omit<Booking, 'quantity'>> & { quantity?: string } = {},
): Booking {
  const { quantity, ...rest } = over;
  return {
    id,
    sourceFileId: id.split(':')[0] ?? 'f',
    row: Number(id.split(':')[1] ?? 1),
    platform: 'kraken',
    accountId: 'main',
    timestamp: '2025-06-01T12:00:00.000Z',
    asset: 'BTC',
    kind: 'unknown',
    rawType: 'reward',
    ...rest,
    quantity: parseDecimal(quantity ?? '1'),
  } as Booking;
}

const edit = (
  id: string,
  key: string,
  changes: TransactionEdit['changes'],
  createdAt = `2026-10-0${id.length}T00:00:00.000Z`,
): TransactionEdit => ({ id, key, createdAt, reason: 'r', changes });

describe('transactionKeys', () => {
  it('uses the booking id for a file and wallet + network + tx + position for a wallet', () => {
    const file = [booking('aa:2'), booking('aa:3')];
    expect([...transactionKeys(file, null).values()]).toEqual(['aa:2', 'aa:3']);
    // A new fetch writes other rows (and another SHA) — the keys stay the same.
    const first = [
      booking('s1:2', { accountId: 'ethereum', group: '0xt1' }),
      booking('s1:3', { accountId: 'ethereum', group: '0xt1' }),
      booking('s1:4', { accountId: 'ethereum', group: '0xt2' }),
    ];
    const again = [
      booking('s2:2', { accountId: 'ethereum', group: '0xt0' }),
      booking('s2:3', { accountId: 'ethereum', group: '0xt1' }),
      booking('s2:4', { accountId: 'ethereum', group: '0xt1' }),
      booking('s2:5', { accountId: 'ethereum', group: '0xt2' }),
    ];
    const a = transactionKeys(first, 'w1');
    const b = transactionKeys(again, 'w1');
    expect(a.get('s1:3')).toBe('wallet:w1:ethereum:0xt1:1');
    expect(b.get('s2:4')).toBe(a.get('s1:3'));
    expect(b.get('s2:5')).toBe(a.get('s1:4'));
  });
});

describe('applyTransactionEdits', () => {
  const key = (b: Booking) => b.id;

  it('applies kind, asset and note in order; a later edit wins', () => {
    const result = applyTransactionEdits(
      [booking('f:1'), booking('f:2')],
      key,
      [
        edit('e1', 'f:1', { kind: 'income_staking' }),
        edit('e22', 'f:1', { kind: 'income_interest', note: 'Earn' }),
        edit('e333', 'f:2', { asset: 'ETH' }),
      ],
    );
    expect(result.bookings.map((b) => [b.kind, b.asset, b.note])).toEqual([
      ['income_interest', 'BTC', 'Earn'],
      ['unknown', 'ETH', undefined],
    ]);
    expect(result.effects.get('f:1')).toMatchObject({
      editIds: ['e1', 'e22'],
      before: { kind: 'unknown' },
      after: { kind: 'income_interest', note: 'Earn' },
      hidden: false,
    });
  });

  it('hides a booking and shows it again', () => {
    const hidden = applyTransactionEdits([booking('f:1')], key, [
      edit('e1', 'f:1', { hidden: true }),
    ]);
    expect(hidden.bookings).toEqual([]);
    expect(hidden.hidden.map((b) => b.id)).toEqual(['f:1']);
    const shown = applyTransactionEdits([booking('f:1')], key, [
      edit('e1', 'f:1', { hidden: true }),
      edit('e22', 'f:1', { hidden: false }),
    ]);
    expect(shown.bookings.map((b) => b.id)).toEqual(['f:1']);
  });

  it('turns both sides of a link into transfers, even across files', () => {
    const out = booking('a:1', { kind: 'withdrawal', quantity: '-1' });
    const back = booking('b:7', { kind: 'deposit', platform: 'ledger' });
    const result = applyTransactionEdits([out, back], key, [
      edit('e1', 'a:1', { linkedKey: 'b:7' }),
    ]);
    expect(result.bookings.map((b) => b.kind)).toEqual([
      'transfer',
      'transfer',
    ]);
    expect(result.effects.get('b:7')?.linkedKey).toBe('a:1');
    const unlinked = applyTransactionEdits([out, back], key, [
      edit('e1', 'a:1', { linkedKey: 'b:7' }),
      edit('e22', 'a:1', { linkedKey: null }),
    ]);
    expect(unlinked.bookings.map((b) => b.kind)).toEqual([
      'withdrawal',
      'deposit',
    ]);
  });

  it('leaves the input untouched without edits', () => {
    const input = [booking('f:1')];
    expect(applyTransactionEdits(input, key, []).bookings).toBe(input);
  });

  it('validates changes: at least one field, closed kinds, no unknown keys', () => {
    expect(TransactionChangesSchema.safeParse({}).success).toBe(false);
    expect(TransactionChangesSchema.safeParse({ kind: 'gift' }).success).toBe(
      false,
    );
    expect(
      TransactionChangesSchema.safeParse({ kind: 'spam', bookingId: 'x' })
        .success,
    ).toBe(false);
    expect(TransactionChangesSchema.parse({ asset: ' eth ' })).toEqual({
      asset: 'ETH',
    });
  });
});
