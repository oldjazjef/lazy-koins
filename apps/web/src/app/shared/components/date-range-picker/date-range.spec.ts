import {
  dayCount,
  isWholeMonth,
  isWholeYear,
  ordered,
  shiftRange,
  withinBounds,
} from './date-range';

/** The period maths (ported from etx WTA-307): month ends, year boundary, DST, bounds. */
describe('dayCount', () => {
  it('counts both ends', () => {
    expect(dayCount({ from: '2026-09-11', to: '2026-09-11' })).toBe(1);
    expect(dayCount({ from: '2026-01-01', to: '2026-01-31' })).toBe(31);
  });

  it('counts across a DST switch (25.10.2026 has 25 hours in Zurich)', () => {
    expect(dayCount({ from: '2026-10-01', to: '2026-10-31' })).toBe(31);
    expect(dayCount({ from: '2026-03-01', to: '2026-03-31' })).toBe(31);
  });

  it('is 0 for an incomplete period', () => {
    expect(dayCount({ from: '', to: '2026-09-11' })).toBe(0);
  });
});

describe('shiftRange', () => {
  it('steps a whole year by years', () => {
    expect(shiftRange({ from: '2025-01-01', to: '2025-12-31' }, -1)).toEqual({
      from: '2024-01-01',
      to: '2024-12-31',
    });
  });

  it('steps a whole month by months and lands on the real month end', () => {
    expect(shiftRange({ from: '2026-01-01', to: '2026-01-31' }, 1)).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(shiftRange({ from: '2028-03-01', to: '2028-03-31' }, -1)).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    });
  });

  it('crosses the year boundary', () => {
    expect(shiftRange({ from: '2026-01-01', to: '2026-01-31' }, -1)).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(shiftRange({ from: '2025-12-29', to: '2026-01-04' }, 1)).toEqual({
      from: '2026-01-05',
      to: '2026-01-11',
    });
  });

  it('steps any other period by its own length, across DST', () => {
    expect(shiftRange({ from: '2026-10-20', to: '2026-10-26' }, 1)).toEqual({
      from: '2026-10-27',
      to: '2026-11-02',
    });
  });

  it('leaves an incomplete period alone', () => {
    const partial = { from: '2026-09-10', to: '' };
    expect(shiftRange(partial, 1)).toBe(partial);
  });
});

describe('helpers', () => {
  it('recognises whole months and years', () => {
    expect(isWholeMonth({ from: '2026-02-01', to: '2026-02-28' })).toBe(true);
    expect(isWholeMonth({ from: '2026-02-01', to: '2026-02-27' })).toBe(false);
    expect(isWholeYear({ from: '2025-01-01', to: '2025-12-31' })).toBe(true);
    expect(isWholeYear({ from: '2025-01-01', to: '2026-12-31' })).toBe(false);
  });

  it('checks bounds, empty = unbounded', () => {
    const range = { from: '2026-01-01', to: '2026-10-07' };
    expect(withinBounds(range, '', '')).toBe(true);
    expect(withinBounds(range, '2026-01-01', '2026-10-07')).toBe(true);
    expect(withinBounds(range, '', '2026-10-06')).toBe(false);
    expect(withinBounds(range, '2026-01-02', '')).toBe(false);
    expect(withinBounds({ from: '', to: '' }, '', '')).toBe(false);
  });

  it('orders two picked days', () => {
    expect(ordered(new Date(2026, 4, 9), new Date(2026, 4, 2))).toEqual({
      from: '2026-05-02',
      to: '2026-05-09',
    });
  });
});
