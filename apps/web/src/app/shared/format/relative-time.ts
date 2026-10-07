import { displayFormat } from './locale-format';

const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60],
  ['month', 30 * 24 * 60 * 60],
  ['week', 7 * 24 * 60 * 60],
  ['day', 24 * 60 * 60],
  ['hour', 60 * 60],
  ['minute', 60],
];

const FORMATS = new Map<string, Intl.RelativeTimeFormat>();

function formatter(locale: string): Intl.RelativeTimeFormat {
  let format = FORMATS.get(locale);
  if (!format) {
    format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    FORMATS.set(locale, format);
  }
  return format;
}

/**
 * "vor 5 Minuten", "gestern", "jetzt" (de-CH) / "5 minutes ago", "yesterday", "now" (en) — for
 * timestamps of the past, in the active language (F11.2; a signal read).
 */
export function formatRelative(
  iso: string,
  now: number,
  locale = displayFormat().intlLocale,
): string {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  if (Number.isNaN(seconds)) return '';
  const format = formatter(locale);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) {
      return format.format(Math.trunc(seconds / size), unit);
    }
  }
  return format.format(0, 'second');
}
