const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60],
  ['month', 30 * 24 * 60 * 60],
  ['week', 7 * 24 * 60 * 60],
  ['day', 24 * 60 * 60],
  ['hour', 60 * 60],
  ['minute', 60],
];

const FORMAT = new Intl.RelativeTimeFormat('de-CH', { numeric: 'auto' });

/** "vor 5 Minuten", "gestern", "jetzt" (de-CH) — for timestamps of the past. */
export function formatRelative(iso: string, now: number): string {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  if (Number.isNaN(seconds)) return '';
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) {
      return FORMAT.format(Math.trunc(seconds / size), unit);
    }
  }
  return FORMAT.format(0, 'second');
}
