import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { BrnCalendarI18nService } from '@spartan-ng/brain/calendar';
import { calendarI18n, firstDayOfWeek } from './calendar-i18n';
import { LanguageService } from './language.service';

describe('calendar texts (F11.2)', () => {
  const label = (key: string) => `<${key}>`;

  it('names months and weekdays in the language', () => {
    const de = calendarI18n('de-CH', 'dd.MM.yyyy', label);
    const en = calendarI18n('en', 'yyyy-MM-dd', label);
    expect(de.formatHeader?.(2, 2026)).toBe('März 2026');
    expect(en.formatHeader?.(2, 2026)).toBe('March 2026');
    expect(de.labelWeekday?.(1)).toBe('Montag');
    expect(en.labelWeekday?.(0)).toBe('Sunday');
    expect(de.months?.()).toHaveLength(12);
    expect(de.labelNext?.()).toBe('<dateField.nextMonth>');
  });

  it('starts the week on Monday, Sunday only with the US date format', () => {
    expect(firstDayOfWeek('dd.MM.yyyy')).toBe(1);
    expect(firstDayOfWeek('yyyy-MM-dd')).toBe(1);
    expect(firstDayOfWeek('dd/MM/yyyy')).toBe(1);
    expect(firstDayOfWeek('MM/dd/yyyy')).toBe(0);
  });

  it('is applied app-wide by the LanguageService and follows a switch', () => {
    TestBed.configureTestingModule({ providers: [provideTranslateService()] });
    const language = TestBed.inject(LanguageService);
    const calendar = TestBed.inject(BrnCalendarI18nService);
    language.apply({
      locale: 'de-CH',
      numberFormat: 'de-CH',
      dateFormat: 'dd.MM.yyyy',
    });
    TestBed.tick();
    expect(calendar.config().firstDayOfWeek()).toBe(1);
    expect(calendar.config().formatHeader(0, 2026)).toBe('Januar 2026');
    language.apply({
      locale: 'en',
      numberFormat: 'en',
      dateFormat: 'MM/dd/yyyy',
    });
    TestBed.tick();
    expect(calendar.config().firstDayOfWeek()).toBe(0);
    expect(calendar.config().formatHeader(0, 2026)).toBe('January 2026');
    TestBed.resetTestingModule();
  });
});
