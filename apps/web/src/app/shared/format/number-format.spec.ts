import { formatChf, formatQuantity, isNegative } from './number-format';

describe('Swiss number format (F11.2)', () => {
  it('formats CHF with grouping and two decimals, half up', () => {
    expect(formatChf('1234567.891')).toBe('1’234’567.89');
    expect(formatChf('0.005')).toBe('0.01');
    expect(formatChf('-1234.5')).toBe('-1’234.50');
    expect(formatChf('-0.001')).toBe('0.00');
    expect(formatChf(null)).toBe('–');
    expect(formatChf('abc')).toBe('–');
  });

  it('keeps 18-decimal quantities exact up to the requested places', () => {
    expect(formatQuantity('0.123456789012345678', 18)).toBe(
      '0.123456789012345678',
    );
    expect(formatQuantity('0.123456789012345678')).toBe('0.123456789');
    expect(formatQuantity('12345.5')).toBe('12’345.5');
    expect(formatQuantity('1000')).toBe('1’000');
  });

  it('tells negative values without Number()', () => {
    expect(isNegative('-0.0000000001')).toBe(true);
    expect(isNegative('0')).toBe(false);
  });
});
