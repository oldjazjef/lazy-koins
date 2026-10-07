/** A dashboard period (ISO dates, inclusive; `to` = Stichtag). */
export interface Period {
  readonly from: string;
  readonly to: string;
}

export type PeriodPreset =
  | { readonly key: 'ytd' }
  | { readonly key: 'last12' }
  | { readonly key: 'year'; readonly year: number }
  | { readonly key: 'custom' };

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** A local calendar day as ISO (the user's "today", not UTC's). */
export function isoDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** F11.4 default: 01.01. of the current year → today. */
export function yearToDate(today: Date): Period {
  return { from: `${today.getFullYear()}-01-01`, to: isoDay(today) };
}

/** The last 12 months up to today. */
export function lastTwelveMonths(today: Date): Period {
  const start = new Date(
    today.getFullYear(),
    today.getMonth() - 12,
    today.getDate() + 1,
  );
  return { from: isoDay(start), to: isoDay(today) };
}

/** A tax year: 01.01.–31.12. (up to today for the running year). */
export function taxYearPeriod(year: number, today: Date): Period {
  const end = `${year}-12-31`;
  const now = isoDay(today);
  return { from: `${year}-01-01`, to: end > now ? now : end };
}

export function periodOf(preset: PeriodPreset, today: Date): Period | null {
  switch (preset.key) {
    case 'ytd':
      return yearToDate(today);
    case 'last12':
      return lastTwelveMonths(today);
    case 'year':
      return taxYearPeriod(preset.year, today);
    case 'custom':
      return null;
  }
}

/** The preset as a select value (`ytd`, `last12`, `year:2025`, `custom`). */
export function presetValue(preset: PeriodPreset): string {
  return preset.key === 'year' ? `year:${preset.year}` : preset.key;
}

export function presetFrom(value: string): PeriodPreset {
  if (value === 'ytd' || value === 'last12' || value === 'custom') {
    return { key: value };
  }
  const year = Number(value.replace('year:', ''));
  return Number.isInteger(year) ? { key: 'year', year } : { key: 'ytd' };
}
