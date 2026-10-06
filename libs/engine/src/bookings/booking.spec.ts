import { BOOKING_KINDS, INCOME_KINDS, isIncome } from './booking';

describe('booking kinds', () => {
  it('covers trades, transfers, fees and every income category of F7.2', () => {
    expect(BOOKING_KINDS).toEqual(
      expect.arrayContaining([
        'trade',
        'deposit',
        'withdrawal',
        'fee',
        'interest',
        'staking',
        'airdrop',
        'launchpool',
        'hardfork',
      ]),
    );
  });

  it('tells income from everything else', () => {
    for (const kind of INCOME_KINDS) expect(isIncome(kind)).toBe(true);
    for (const kind of [
      'trade',
      'deposit',
      'withdrawal',
      'fee',
      'other',
    ] as const)
      expect(isIncome(kind)).toBe(false);
  });
});
