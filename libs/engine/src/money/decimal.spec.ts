import * as money from './decimal';
import {
  DecimalParseError,
  formatChf,
  formatFixed,
  formatGrouped,
  isDecimal,
  parseDecimal,
  roundTo,
  sum,
  toDecimalString,
  tryParseDecimal,
  ZERO,
} from './decimal';

const d = parseDecimal;

describe('parseDecimal', () => {
  it.each([
    ['0', '0'],
    ['42', '42'],
    ['-42', '-42'],
    ['+7', '7'],
    ['0.1', '0.1'],
    ['.5', '0.5'],
    ['5.', '5'],
    ['1.500', '1.5'],
    ['  12.34  ', '12.34'],
    ['1E-8', '0.00000001'],
    ['1.5e3', '1500'],
    ['-0.00', '0'],
  ])('reads %j as %s', (input, expected) => {
    expect(toDecimalString(d(input))).toBe(expected);
  });

  it('keeps all 18 decimals of a crypto quantity, which a number cannot', () => {
    const wei = '0.000000000000000001';
    expect(toDecimalString(d(wei))).toBe(wei);
    const big = '123456789012345678.123456789012345678';
    expect(toDecimalString(d(big))).toBe(big);
    // The same value through `number` has long lost its tail.
    expect(String(Number(big))).not.toBe(big);
  });

  it('adds exactly where floating point does not', () => {
    expect(toDecimalString(d('0.1').plus(d('0.2')))).toBe('0.3');
    expect(
      toDecimalString(
        d('0.000000000000000001').times(d('1000000000000000000')),
      ),
    ).toBe('1');
  });

  it.each([
    '',
    '   ',
    'abc',
    '1,5',
    "1'000.50",
    '1 000',
    '1.2.3',
    '--1',
    'NaN',
    'Infinity',
    '-Infinity',
    '0x10',
    'CHF 5',
    '5 CHF',
    '1e',
  ])('rejects %j', (input) => {
    expect(() => d(input)).toThrow(DecimalParseError);
    expect(tryParseDecimal(input)).toBeUndefined();
  });

  it('refuses a number at run time too — there is no way in from `number`', () => {
    expect(() => d(0.1 as unknown as string)).toThrow(TypeError);
    expect('fromNumber' in money).toBe(false);
  });

  it('quotes only a short prefix of a bad input in the error', () => {
    const long = `x${'9'.repeat(100)}`;
    expect(() => d(long)).toThrow(/^Not a decimal number: "x9{31}"$/);
  });
});

describe('sum / isDecimal / ZERO', () => {
  it('sums exactly, and the empty sum is zero', () => {
    expect(toDecimalString(sum([d('0.1'), d('0.2'), d('-0.3')]))).toBe('0');
    expect(sum([]).equals(ZERO)).toBe(true);
    expect(toDecimalString(sum([d('1.25'), d('2.5')]))).toBe('3.75');
  });

  it('recognises decimals', () => {
    expect(isDecimal(d('1'))).toBe(true);
    expect(isDecimal(1)).toBe(false);
    expect(isDecimal('1')).toBe(false);
  });
});

describe('roundTo', () => {
  it.each([
    ['halfUp', '0.125', '0.13'],
    ['halfUp', '-0.125', '-0.13'],
    ['halfEven', '0.125', '0.12'],
    ['halfEven', '0.135', '0.14'],
    ['down', '1.239', '1.23'],
    ['down', '-1.239', '-1.23'],
    ['up', '1.231', '1.24'],
    ['up', '-1.231', '-1.24'],
    ['floor', '-1.231', '-1.24'],
    ['ceil', '-1.239', '-1.23'],
  ] as const)('%s rounds %s to %s', (mode, input, expected) => {
    expect(toDecimalString(roundTo(d(input), 2, mode))).toBe(expected);
  });

  it('never yields a negative zero', () => {
    expect(toDecimalString(roundTo(d('-0.001'), 2, 'halfUp'))).toBe('0');
    expect(formatFixed(d('-0.001'), 2, 'halfUp')).toBe('0.00');
  });

  it('refuses nonsense places', () => {
    expect(() => roundTo(d('1'), -1, 'halfUp')).toThrow(RangeError);
    expect(() => roundTo(d('1'), 1.5, 'halfUp')).toThrow(RangeError);
  });

  it('does not mutate its input', () => {
    const value = d('1.005');
    roundTo(value, 2, 'halfUp');
    expect(toDecimalString(value)).toBe('1.005');
  });
});

describe('formatting', () => {
  it('formatFixed pads to the requested decimals', () => {
    expect(formatFixed(d('1'), 2, 'halfUp')).toBe('1.00');
    expect(formatFixed(d('1.005'), 2, 'halfUp')).toBe('1.01');
    expect(formatFixed(d('1.005'), 2, 'down')).toBe('1.00');
    expect(formatFixed(d('2.5'), 0, 'halfEven')).toBe('2');
    expect(formatFixed(d('0.000000000000000001'), 18, 'halfUp')).toBe(
      '0.000000000000000001',
    );
  });

  it('formatGrouped uses Swiss grouping by default', () => {
    expect(formatGrouped(d('1234567.891'), 2, 'halfUp')).toBe('1’234’567.89');
    expect(formatGrouped(d('-1234.5'), 2, 'halfUp')).toBe('-1’234.50');
    expect(formatGrouped(d('999'), 0, 'halfUp')).toBe('999');
    expect(formatGrouped(d('1000'), 0, 'halfUp', "'")).toBe("1'000");
  });

  it('formatChf rounds commercially to centimes', () => {
    expect(formatChf(d('12345.675'))).toBe('12’345.68');
    expect(formatChf(d('0.004'))).toBe('0.00');
  });

  it('toDecimalString round-trips through parseDecimal', () => {
    for (const input of ['0', '-1.5', '0.000000000000000001', '1e21']) {
      const value = d(input);
      expect(d(toDecimalString(value)).equals(value)).toBe(true);
      expect(toDecimalString(value)).not.toMatch(/e/i);
    }
  });
});
