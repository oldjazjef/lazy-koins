import {
  BOOKING_KINDS,
  INCOME_KINDS,
  isBookingKind,
  isIncome,
} from './booking';

describe('booking kinds', () => {
  it('is the closed list of the standard format, every F7.2 income category included', () => {
    expect(BOOKING_KINDS).toEqual([
      'trade',
      'deposit',
      'withdrawal',
      'fee',
      'transfer',
      'income_interest',
      'income_staking',
      'income_airdrop',
      'income_launchpool',
      'income_hardfork',
      'loss',
      'spam',
      'unknown',
    ]);
  });

  it('tells income from everything else', () => {
    for (const kind of INCOME_KINDS) expect(isIncome(kind)).toBe(true);
    for (const kind of BOOKING_KINDS.filter((k) => !k.startsWith('income_')))
      expect(isIncome(kind)).toBe(false);
  });

  it('recognises its own values only', () => {
    expect(isBookingKind('trade')).toBe(true);
    expect(isBookingKind('interest')).toBe(false);
    expect(isBookingKind('')).toBe(false);
  });
});
