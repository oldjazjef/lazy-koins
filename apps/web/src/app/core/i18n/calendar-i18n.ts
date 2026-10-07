import type { BrnCalendarI18n, Weekday } from '@spartan-ng/brain/calendar';
import type { DateFormat } from '../../shared/format/locale-format';

type MonthNames = ReturnType<BrnCalendarI18n['months']>;

/** A known Sunday: spartan indexes weekdays 0 (Sunday) … 6 (Saturday). */
const REFERENCE_SUNDAY = new Date(2023, 0, 1);

function weekday(locale: string, index: number, style: 'short' | 'long') {
  const date = new Date(REFERENCE_SUNDAY);
  date.setDate(date.getDate() + index);
  return new Intl.DateTimeFormat(locale, { weekday: style }).format(date);
}

/**
 * The week's first day: Monday (ISO 8601, Swiss and European custom), Sunday only for the US date
 * format `MM/dd/yyyy` — the user chose it, so they read calendars the US way too.
 */
export function firstDayOfWeek(format: DateFormat): Weekday {
  return format === 'MM/dd/yyyy' ? 0 : 1;
}

/**
 * The spartan calendar's texts in the app's language (F11.2): month and weekday names from `Intl`
 * (`Januar` / `January`, `Mo` / `Mon`), the week start from the date format, the arrow labels from
 * the message files (`label` = `translate.instant`, read when the calendar renders, so it follows a
 * language switch). Set app-wide by `LanguageService` — the calendar's own defaults are English
 * and Sunday-first.
 */
export function calendarI18n(
  locale: string,
  format: DateFormat,
  label: (key: string) => string,
): Partial<BrnCalendarI18n> {
  const months = (style: 'short' | 'long') =>
    Array.from({ length: 12 }, (_, month) =>
      new Intl.DateTimeFormat(locale, { month: style }).format(
        new Date(2000, month, 1),
      ),
    ) as unknown as MonthNames;
  return {
    formatWeekdayName: (index) => weekday(locale, index, 'short'),
    labelWeekday: (index) => weekday(locale, index, 'long'),
    months: () => months('short'),
    formatHeader: (month, year) =>
      new Intl.DateTimeFormat(locale, {
        month: 'long',
        year: 'numeric',
      }).format(new Date(year, month, 1)),
    formatMonth: (month) =>
      new Intl.DateTimeFormat(locale, { month: 'short' }).format(
        new Date(2000, month, 1),
      ),
    formatYear: (year) => String(year),
    labelPrevious: () => label('dateField.previousMonth'),
    labelNext: () => label('dateField.nextMonth'),
    firstDayOfWeek: () => firstDayOfWeek(format),
  };
}
