import { addDays, dateToIso, isoToDate } from '../../format/date-only';

/**
 * A period as the app carries it: two inclusive `yyyy-MM-dd` days, `''` for unset. Never a `Date`
 * — page services, filters and query parameters are ISO strings (`from`/`to` like the API).
 */
export interface DateRange {
  readonly from: string;
  readonly to: string;
}

export const EMPTY_RANGE: DateRange = { from: '', to: '' };

/**
 * A preset the caller offers next to the calendar (the dashboard: running year, last 12 months,
 * the tax years of my projects). The label is an i18n key so it follows a language switch.
 */
export interface DateRangePreset {
  readonly id: string;
  readonly labelKey: string;
  readonly labelParams?: Readonly<Record<string, unknown>>;
  readonly range: DateRange;
}

export function isComplete(range: DateRange): boolean {
  return (
    isoToDate(range.from) !== undefined && isoToDate(range.to) !== undefined
  );
}

export function sameRange(a: DateRange, b: DateRange): boolean {
  return a.from === b.from && a.to === b.to;
}

/** Inclusive: one day counts 1, a January 31 — also across a DST switch (rounded, not floored). */
export function dayCount(range: DateRange): number {
  const start = isoToDate(range.from);
  const end = isoToDate(range.to);
  if (!start || !end) return 0;
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

function monthEnd(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

/** Whether the range is exactly one calendar month (01. to its last day). */
export function isWholeMonth(range: DateRange): boolean {
  const start = isoToDate(range.from);
  const end = isoToDate(range.to);
  return (
    !!start &&
    !!end &&
    start.getDate() === 1 &&
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    end.getDate() === monthEnd(end).getDate()
  );
}

/** Whether the range is exactly one calendar year (01.01.–31.12.). */
export function isWholeYear(range: DateRange): boolean {
  const year = range.from.slice(0, 4);
  return (
    isComplete(range) &&
    range.from === `${year}-01-01` &&
    range.to === `${year}-12-31`
  );
}

/**
 * The range moved by its own size (the arrows, as in etx): a whole year by a year, a whole month
 * by a month (31.08. never becomes 01.10.), anything else by its day count.
 */
export function shiftRange(range: DateRange, direction: -1 | 1): DateRange {
  const start = isoToDate(range.from);
  const end = isoToDate(range.to);
  if (!start || !end) return range;
  if (isWholeYear(range)) {
    const year = start.getFullYear() + direction;
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
  if (isWholeMonth(range)) {
    const moved = new Date(
      start.getFullYear(),
      start.getMonth() + direction,
      1,
    );
    return { from: dateToIso(moved), to: dateToIso(monthEnd(moved)) };
  }
  const days = dayCount(range) * direction;
  return {
    from: dateToIso(addDays(start, days)),
    to: dateToIso(addDays(end, days)),
  };
}

/** Whether the whole range lies within `min`/`max` (`''` = no bound). */
export function withinBounds(
  range: DateRange,
  min: string,
  max: string,
): boolean {
  if (!isComplete(range)) return false;
  return (min === '' || range.from >= min) && (max === '' || range.to <= max);
}

/** Puts the two days in order: picking the end before the start swaps them. */
export function ordered(a: Date, b: Date): DateRange {
  const [from, to] = a.getTime() <= b.getTime() ? [a, b] : [b, a];
  return { from: dateToIso(from), to: dateToIso(to) };
}
