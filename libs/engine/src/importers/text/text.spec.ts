import { csvSourceFile, detectDelimiter, parseCsv } from './csv';
import { decodeText, looksLikeText } from './decode-text';
import { parseNumber } from './numbers';
import {
  fixedOffset,
  isIsoDate,
  offsetFor,
  parseDateTime,
  TimestampParseError,
  timestampToUtc,
} from './timestamps';
import { type Decimal, toDecimalString } from '../../money/decimal';
const str = (value: Decimal | undefined) =>
  value === undefined ? undefined : toDecimalString(value);

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) =>
  new Uint8Array([...text].map((c) => c.charCodeAt(0)));

describe('decodeText', () => {
  it('reads UTF-8 with and without BOM, multi-byte characters included', () => {
    expect(decodeText(bytes(0xef, 0xbb, 0xbf, 0x61, 0xc3, 0xa4))).toEqual({
      text: 'aä',
      encoding: 'utf-8',
    });
    expect(decodeText(bytes(0xe2, 0x82, 0xac)).text).toBe('€');
    expect(decodeText(bytes(0xf0, 0x9f, 0x98, 0x80)).text).toBe('😀');
  });

  it('reads UTF-16 LE/BE with a BOM and LE without one', () => {
    expect(decodeText(bytes(0xff, 0xfe, 0x61, 0x00, 0xe4, 0x00))).toEqual({
      text: 'aä',
      encoding: 'utf-16le',
    });
    expect(decodeText(bytes(0xfe, 0xff, 0x00, 0x61)).text).toBe('a');
    expect(decodeText(bytes(0x61, 0, 0x62, 0, 0x63, 0, 0x64, 0)).encoding).toBe(
      'utf-16le',
    );
  });

  it('falls back to Windows-1252 on invalid UTF-8, and honours a forced encoding', () => {
    expect(decodeText(bytes(0x80, 0x20, 0xe4))).toEqual({
      text: '€ ä',
      encoding: 'windows-1252',
    });
    expect(decodeText(bytes(0x61, 0x00), 'utf-16le').text).toBe('a');
    expect(decodeText(bytes(0xe4), 'windows-1252').text).toBe('ä');
  });

  it('tells text from binary', () => {
    expect(looksLikeText(ascii('a,b\n1,2\n'))).toBe(true);
    expect(looksLikeText(bytes(0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02))).toBe(
      false,
    );
    expect(looksLikeText(bytes())).toBe(false);
    expect(looksLikeText(bytes(0xff, 0xfe, 0x61, 0x00))).toBe(true);
  });
});

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, delimiters and line breaks inside quotes', () => {
    expect(parseCsv('a,"b,c","say ""hi""","x\ny"\r\n1,2,3,4\n')).toEqual([
      ['a', 'b,c', 'say "hi"', 'x\ny'],
      ['1', '2', '3', '4'],
    ]);
  });

  it('detects semicolon, tab and pipe, and strips a BOM', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\n')).toBe('\t');
    expect(detectDelimiter('a|b|c')).toBe('|');
    expect(detectDelimiter('"a;b",c,d')).toBe(',');
    expect(parseCsv('\uFEFFa;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps inner blank lines (row numbers stay right) and drops trailing ones', () => {
    expect(parseCsv('a\n\nb\n\n\n')).toEqual([['a'], [''], ['b']]);
    expect(parseCsv('')).toEqual([]);
  });

  it('builds a SourceFile from bytes with forced options', () => {
    const file = csvSourceFile(
      { id: 'x', name: 'f.csv', bytes: ascii('a;b\n1;2') },
      { delimiter: ';' },
    );
    expect(file).toEqual({
      id: 'x',
      name: 'f.csv',
      kind: 'csv',
      sheets: [
        {
          name: 'f.csv',
          rows: [
            ['a', 'b'],
            ['1', '2'],
          ],
        },
      ],
    });
  });
});

describe('parseNumber', () => {
  it('keeps 18 decimals exactly', () => {
    expect(str(parseNumber('0.123456789012345678'))).toBe(
      '0.123456789012345678',
    );
  });

  it('reads Swiss, comma-decimal and currency-decorated numbers', () => {
    const swiss = {
      decimal: '.',
      thousands: ["'", '’'],
      stripText: false,
    } as const;
    expect(str(parseNumber("1'234.50", swiss))).toBe('1234.5');
    const de = { decimal: ',', thousands: ['.'], stripText: false } as const;
    expect(str(parseNumber('1.234,5', de))).toBe('1234.5');
    const money = { decimal: '.', thousands: [','], stripText: true } as const;
    expect(str(parseNumber('CHF 60,000.00', money))).toBe('60000');
    expect(str(parseNumber('-€12.30', money))).toBe('-12.3');
    expect(str(parseNumber('EUR 5', money))).toBe('5');
    expect(str(parseNumber('(4.5)'))).toBe('-4.5');
    expect(str(parseNumber('1.5E-8'))).toBe('0.000000015');
  });

  it('refuses what is not a number in the format', () => {
    expect(parseNumber('1,5')).toBeUndefined();
    expect(parseNumber('abc')).toBeUndefined();
    expect(parseNumber('')).toBeUndefined();
  });
});

describe('timestamps', () => {
  it('reads the common orders, fractions, 12-hour clock and two-digit years', () => {
    expect(timestampToUtc('2025-03-01 12:00:00.1234', 'ymd', 'UTC')).toBe(
      '2025-03-01T12:00:00.123Z',
    );
    expect(timestampToUtc('25-03-01 12:00:00', 'ymd', 'UTC')).toBe(
      '2025-03-01T12:00:00.000Z',
    );
    expect(timestampToUtc('01-03-2025 12:00:00', 'dmy', 'UTC')).toBe(
      '2025-03-01T12:00:00.000Z',
    );
    expect(timestampToUtc('01.03.2025', 'dmy', 'UTC')).toBe(
      '2025-03-01T00:00:00.000Z',
    );
    expect(timestampToUtc('3/1/2025 12:30:00 AM', 'mdy', 'UTC')).toBe(
      '2025-03-01T00:30:00.000Z',
    );
    expect(timestampToUtc('Jan 5, 2024, 10:12:13 PM', 'named', 'UTC')).toBe(
      '2024-01-05T22:12:13.000Z',
    );
    expect(timestampToUtc('1735689600', 'unix', 'Europe/Zurich')).toBe(
      '2025-01-01T00:00:00.000Z',
    );
  });

  it('applies fixed offsets and lets a zone in the text win', () => {
    expect(timestampToUtc('2025-03-01 12:00:00', 'ymd', '+02:00')).toBe(
      '2025-03-01T10:00:00.000Z',
    );
    expect(timestampToUtc('2025-03-01T12:00:00+01:00', 'iso', '+05:00')).toBe(
      '2025-03-01T11:00:00.000Z',
    );
    expect(timestampToUtc('2025-03-01T12:00:00Z', 'iso', 'Europe/Zurich')).toBe(
      '2025-03-01T12:00:00.000Z',
    );
    expect(fixedOffset('-5')).toBe(-300);
    expect(fixedOffset('UTC')).toBe(0);
    expect(fixedOffset('Europe/Zurich')).toBeUndefined();
  });

  it('knows summer time in Europe/Zurich', () => {
    const winter = parseDateTime('2025-01-15 12:00:00', 'ymd').parts;
    const summer = parseDateTime('2025-07-15 12:00:00', 'ymd').parts;
    expect(offsetFor(winter, 'Europe/Zurich')).toBe(60);
    expect(offsetFor(summer, 'Europe/Zurich')).toBe(120);
    expect(timestampToUtc('2025-03-30 03:30:00', 'ymd', 'Europe/Zurich')).toBe(
      '2025-03-30T01:30:00.000Z',
    );
    expect(timestampToUtc('2025-03-30 01:30:00', 'ymd', 'Europe/Zurich')).toBe(
      '2025-03-30T00:30:00.000Z',
    );
    // Skipped spring hour moves forward; the repeated autumn hour reads as summer time.
    expect(timestampToUtc('2025-03-30 02:30:00', 'ymd', 'Europe/Zurich')).toBe(
      '2025-03-30T01:30:00.000Z',
    );
    expect(timestampToUtc('2025-10-26 02:30:00', 'ymd', 'Europe/Zurich')).toBe(
      '2025-10-26T00:30:00.000Z',
    );
  });

  it('refuses impossible dates and foreign text, quoting only a prefix', () => {
    expect(() => parseDateTime('2025-02-30 00:00:00', 'ymd')).toThrow(
      TimestampParseError,
    );
    expect(() => parseDateTime('2025-01-01 24:00:00', 'ymd')).toThrow(
      TimestampParseError,
    );
    expect(() => parseDateTime('yesterday', 'ymd')).toThrow(
      TimestampParseError,
    );
    expect(() => parseDateTime('13:00 PM', 'mdy')).toThrow(TimestampParseError);
    expect(isIsoDate('2025-12-31')).toBe(true);
    expect(isIsoDate('2025-13-01')).toBe(false);
  });
});
