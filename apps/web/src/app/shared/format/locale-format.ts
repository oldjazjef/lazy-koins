import { signal } from '@angular/core';

/**
 * F11.2: the number and date format of the app — set by the `LanguageService` from the language
 * and the profile's explicit choice. One signal, so every formatter, pipe and `computed` that
 * reads it follows a switch immediately (no reload).
 */
export const NUMBER_FORMATS = ['de-CH', 'en'] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number];
export const DATE_FORMATS = [
  'dd.MM.yyyy',
  'yyyy-MM-dd',
  'dd/MM/yyyy',
  'MM/dd/yyyy',
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export interface DisplayFormat {
  /** BCP 47 tag for `Intl` (relative times, sorting). */
  readonly intlLocale: string;
  readonly numberFormat: NumberFormat;
  readonly dateFormat: DateFormat;
}

export const SWISS_DISPLAY: DisplayFormat = {
  intlLocale: 'de-CH',
  numberFormat: 'de-CH',
  dateFormat: 'dd.MM.yyyy',
};

const state = signal<DisplayFormat>(SWISS_DISPLAY);

/** The active format (a signal read: callers re-run when it changes). */
export function displayFormat(): DisplayFormat {
  return state();
}

export function setDisplayFormat(format: DisplayFormat): void {
  state.set(format);
}

/** The grouping character: `1’234.56` (de-CH, as `Intl.NumberFormat('de-CH')`) or `1,234.56`. */
export function groupSeparator(format: NumberFormat): string {
  return format === 'en' ? ',' : '’';
}

export type DateMode = 'date' | 'dateTime' | 'dateTimeSeconds';

function parts(value: Date, timeZone: string | undefined) {
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    formatted.find((p) => p.type === type)?.value ?? '';
  return {
    y: part('year'),
    m: part('month'),
    d: part('day'),
    time: `${part('hour')}:${part('minute')}`,
    seconds: part('second'),
  };
}

function toDate(value: string | number | Date): Date | null {
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') return new Date(value);
  // A plain date (`2025-12-31`) is a calendar day, not midnight UTC shown in another zone.
  const plain = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(plain ? `${value}T00:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * A date (and time) in the active format: `31.12.2025 14:05`, `2025-12-31 14:05`, … Time is
 * always 24 h. `timeZone` 'UTC' for values that are UTC days (booking days); plain `yyyy-MM-dd`
 * dates are shown as that day.
 */
export function formatDate(
  value: string | number | Date | null | undefined,
  mode: DateMode = 'date',
  timeZone?: string,
  format: DateFormat = displayFormat().dateFormat,
): string {
  if (value === null || value === undefined || value === '') return '';
  const date = toDate(value);
  if (!date) return '';
  const plain = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const p = parts(date, plain ? 'UTC' : timeZone);
  const day =
    format === 'yyyy-MM-dd'
      ? `${p.y}-${p.m}-${p.d}`
      : format === 'dd/MM/yyyy'
        ? `${p.d}/${p.m}/${p.y}`
        : format === 'MM/dd/yyyy'
          ? `${p.m}/${p.d}/${p.y}`
          : `${p.d}.${p.m}.${p.y}`;
  if (mode === 'date') return day;
  return mode === 'dateTime'
    ? `${day} ${p.time}`
    : `${day} ${p.time}:${p.seconds}`;
}
