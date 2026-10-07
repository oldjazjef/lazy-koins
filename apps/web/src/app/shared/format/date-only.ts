import type { DateFormat } from './locale-format';

/**
 * Calendar days as the app carries them: `yyyy-MM-dd` strings, no time, no zone. The spartan
 * calendar works in local `Date`s; these are the only conversions between the two. Never
 * `toISOString()` (UTC first — every zone east of Greenwich would lose a day at midnight) and
 * never `new Date('2026-03-29')` (parsed as UTC midnight).
 */
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (value: number): string => String(value).padStart(2, '0');

/** A real calendar day, built at local midnight; `undefined` for anything else (31.02.). */
function localDay(year: number, month: number, day: number): Date | undefined {
  if (year < 1000 || year > 9999) return undefined;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? date
    : undefined;
}

/** `yyyy-MM-dd` → local `Date`, `undefined` when it is not a calendar day. */
export function isoToDate(value: string | null | undefined): Date | undefined {
  const match = ISO_DAY.exec(value ?? '');
  if (!match) return undefined;
  return localDay(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** Local `Date` → `yyyy-MM-dd` (the local calendar day, whatever the clock says). */
export function dateToIso(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Whether a string is a real `yyyy-MM-dd` day. */
export function isIsoDay(value: string | null | undefined): value is string {
  return isoToDate(value) !== undefined;
}

/** A calendar day plus `days` (DST-safe: built from the parts, never by adding milliseconds). */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** `date` in the user's date format (F11.2): `31.12.2025`, `2025-12-31`, `31/12/2025`, `12/31/2025`. */
export function formatDay(date: Date, format: DateFormat): string {
  const d = pad(date.getDate());
  const m = pad(date.getMonth() + 1);
  const y = String(date.getFullYear());
  switch (format) {
    case 'yyyy-MM-dd':
      return `${y}-${m}-${d}`;
    case 'dd/MM/yyyy':
      return `${d}/${m}/${y}`;
    case 'MM/dd/yyyy':
      return `${m}/${d}/${y}`;
    case 'dd.MM.yyyy':
      return `${d}.${m}.${y}`;
  }
}

/**
 * What a user typed, read in their date format — day and month may have one digit (`1.2.2026`).
 * An ISO day (`2026-02-01`, pasted from a file) is always understood too. `null` for anything
 * else, so the field keeps the text and the user can fix a typo.
 */
export function parseDay(raw: string, format: DateFormat): Date | null {
  const text = raw.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) {
    return localDay(Number(iso[1]), Number(iso[2]), Number(iso[3])) ?? null;
  }
  const separator = format === 'dd.MM.yyyy' ? '.' : '/';
  if (format === 'yyyy-MM-dd') return null;
  const parts = text.split(separator);
  if (parts.length !== 3 || !parts.every((part) => /^\d+$/.test(part))) {
    return null;
  }
  const [first, second, year] = parts.map(Number) as [number, number, number];
  if ((parts[2] ?? '').length !== 4) return null;
  const [day, month] =
    format === 'MM/dd/yyyy' ? [second, first] : [first, second];
  return localDay(year, month, day) ?? null;
}
