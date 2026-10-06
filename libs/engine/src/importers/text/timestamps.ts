/**
 * Timestamps from exports → UTC ISO strings (`2025-03-01T12:00:00.000Z`), pure: no clock, no
 * host time zone. Zones are a fixed offset (`+02:00`, `UTC`) or an IANA name (`Europe/Zurich`),
 * resolved through `Intl` for the given instant — deterministic for a given ICU time-zone table.
 */

export interface DateTimeParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly millisecond: number;
}

export class TimestampParseError extends Error {
  constructor(readonly input: string) {
    // A short prefix only: the text comes from a user's file (CLAUDE.md, Private data).
    super(`Not a timestamp: ${JSON.stringify(input.slice(0, 32))}`);
    this.name = 'TimestampParseError';
  }
}

/** The field orders `parseDateTime` reads. */
export const DATE_FORMATS = [
  'iso',
  'ymd',
  'dmy',
  'mdy',
  'named',
  'unix',
  'unixMs',
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

const TIME = String.raw`(?:[ T,]\s*(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?\s*([AaPp][Mm])?)?`;
const ZONE = String.raw`\s*(Z|UTC|GMT|[+-]\d{2}:?\d{2}|[+-]\d{1,2})?`;

/** `2025-03-01 12:00:00(.1234)`, `2025/03/01`, `25-03-01 12:00` (two-digit year). */
const YMD = new RegExp(
  String.raw`^(\d{2}|\d{4})[-/.](\d{1,2})[-/.](\d{1,2})${TIME}${ZONE}$`,
);
/** `01-03-2025 12:00:00`, `01.03.2025 12:00` (day first). */
const DMY = new RegExp(
  String.raw`^(\d{1,2})[-./](\d{1,2})[-./](\d{2}|\d{4})${TIME}${ZONE}$`,
);
/** `3/1/2025 12:00:00 PM` (US: month first, optional 12-hour clock). */
const MDY = new RegExp(
  String.raw`^(\d{1,2})[/-](\d{1,2})[/-](\d{4})${TIME}${ZONE}$`,
);
/** `Jan 5, 2024, 10:12:13 AM` (English month name). */
const NAMED = new RegExp(
  String.raw`^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4}),?${TIME}${ZONE}$`,
);

const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];

/** A parsed wall-clock time plus the zone offset the text itself states (minutes east of UTC). */
export interface ParsedDateTime {
  readonly parts: DateTimeParts;
  readonly statedOffset?: number;
}

function year(text: string): number {
  return text.length === 2 ? 2000 + Number(text) : Number(text);
}

/** Splits a timestamp written in `format`; throws `TimestampParseError` on anything else. */
export function parseDateTime(
  input: string,
  format: DateFormat,
): ParsedDateTime {
  const text = input.trim();
  if (format === 'unix' || format === 'unixMs') {
    if (!/^\d{1,13}(\.\d+)?$/.test(text)) throw new TimestampParseError(input);
    const [whole = '0', frac = ''] = text.split('.');
    const ms =
      format === 'unix'
        ? Number(whole) * 1000 + Number(frac.padEnd(3, '0').slice(0, 3))
        : Number(whole);
    const date = new Date(ms);
    return {
      parts: {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        hour: date.getUTCHours(),
        minute: date.getUTCMinutes(),
        second: date.getUTCSeconds(),
        millisecond: date.getUTCMilliseconds(),
      },
      statedOffset: 0,
    };
  }
  const pattern =
    format === 'iso' || format === 'ymd'
      ? YMD
      : format === 'dmy'
        ? DMY
        : format === 'mdy'
          ? MDY
          : NAMED;
  const match = pattern.exec(text);
  if (!match) throw new TimestampParseError(input);
  const [, a = '', b = '', c = '', h, mi, s, frac, meridiem, zone] = match;
  let y: number;
  let m: number;
  let d: number;
  if (pattern === YMD) {
    [y, m, d] = [year(a), Number(b), Number(c)];
  } else if (pattern === DMY) {
    [y, m, d] = [year(c), Number(b), Number(a)];
  } else if (pattern === MDY) {
    [y, m, d] = [Number(c), Number(a), Number(b)];
  } else {
    [y, m, d] = [
      Number(c),
      MONTHS.indexOf(a.slice(0, 3).toLowerCase()) + 1,
      Number(b),
    ];
  }
  let hour = h === undefined ? 0 : Number(h);
  if (meridiem) {
    if (hour < 1 || hour > 12) throw new TimestampParseError(input);
    hour = (hour % 12) + (meridiem.toLowerCase() === 'pm' ? 12 : 0);
  }
  const parts: DateTimeParts = {
    year: y,
    month: m,
    day: d,
    hour,
    minute: mi === undefined ? 0 : Number(mi),
    second: s === undefined ? 0 : Number(s),
    millisecond:
      frac === undefined ? 0 : Number(frac.padEnd(3, '0').slice(0, 3)),
  };
  if (!isValid(parts)) throw new TimestampParseError(input);
  const statedOffset = zone === undefined ? undefined : fixedOffset(zone);
  return statedOffset === undefined ? { parts } : { parts, statedOffset };
}

function isValid(p: DateTimeParts): boolean {
  if (p.month < 1 || p.month > 12 || p.day < 1) return false;
  if (p.hour > 23 || p.minute > 59 || p.second > 59) return false;
  // Date.UTC rolls 31.02. over into March — a round trip catches it.
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDate() === p.day;
}

/** `Z`, `UTC`, `+02:00`, `+0200`, `-5` → minutes east of UTC; `undefined` for anything else. */
export function fixedOffset(zone: string): number | undefined {
  const text = zone.trim().toUpperCase();
  if (text === 'Z' || text === 'UTC' || text === 'GMT') return 0;
  const match = /^(?:UTC|GMT)?([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(text);
  if (!match) return undefined;
  const [, sign, hours = '0', minutes = '0'] = match;
  const total = Number(hours) * 60 + Number(minutes);
  if (total > 14 * 60) return undefined;
  return sign === '-' ? -total : total;
}

/** Whether `zone` is a fixed offset or an IANA zone this runtime knows. */
export function isKnownZone(zone: string): boolean {
  if (fixedOffset(zone) !== undefined) return true;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function localMs(parts: DateTimeParts): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
}

/** The offset of an IANA zone at a UTC instant, from Intl. */
function ianaOffsetAt(zone: string, utcMs: number): number {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const get = (type: string) =>
    Number(
      format.formatToParts(new Date(utcMs)).find((p) => p.type === type)
        ?.value ?? 0,
    );
  const wall = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((wall - Math.floor(utcMs / 1000) * 1000) / 60_000);
}

/**
 * Minutes east of UTC for a wall-clock time in `zone`. For IANA zones the offset is found for
 * that instant (summer time included); in the repeated autumn hour the earlier (summer) reading
 * wins.
 */
export function offsetFor(parts: DateTimeParts, zone: string): number {
  const fixed = fixedOffset(zone);
  if (fixed !== undefined) return fixed;
  const local = localMs(parts);
  // The offsets in force a day either side cover any transition; an offset is right when the
  // instant it gives has that same offset.
  const candidates = [
    ...new Set([
      ianaOffsetAt(zone, local - 86_400_000),
      ianaOffsetAt(zone, local),
      ianaOffsetAt(zone, local + 86_400_000),
    ]),
  ];
  const consistent = candidates.filter(
    (offset) => ianaOffsetAt(zone, local - offset * 60_000) === offset,
  );
  // Two readings (the repeated autumn hour): the earlier, summer one. None (the skipped spring
  // hour): the offset before the gap, which moves the time forward as clocks do.
  if (consistent.length > 0) return Math.max(...consistent);
  return Math.min(...candidates);
}

/** Wall-clock parts in a zone `offsetMinutes` east of UTC → UTC ISO string (ms to 3 digits). */
export function toUtcIso(parts: DateTimeParts, offsetMinutes = 0): string {
  return new Date(localMs(parts) - offsetMinutes * 60_000).toISOString();
}

/**
 * Text → UTC ISO. A zone written in the text (`Z`, `+01:00`) wins; otherwise `zone` (a fixed
 * offset or an IANA name) is applied.
 */
export function timestampToUtc(
  input: string,
  format: DateFormat,
  zone: string,
): string {
  const { parts, statedOffset } = parseDateTime(input, format);
  return toUtcIso(parts, statedOffset ?? offsetFor(parts, zone));
}

/** Whether `text` is a valid ISO calendar date `YYYY-MM-DD`. */
export function isIsoDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  return (
    m >= 1 &&
    m <= 12 &&
    d >= 1 &&
    new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d
  );
}
