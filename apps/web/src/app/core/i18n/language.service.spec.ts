import { TestBed } from '@angular/core/testing';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { formatChf, formatQuantity } from '../../shared/format/number-format';
import {
  languageChoiceOf,
  withLanguage,
} from '../../shared/format/format-options';
import {
  displayFormat,
  formatDate,
  SWISS_DISPLAY,
  setDisplayFormat,
} from '../../shared/format/locale-format';
import { formatRelative } from '../../shared/format/relative-time';
import { LanguageService } from './language.service';
import { browserLocale, initialLocale, LOCALE_STORAGE_KEY } from './locales';

describe('LanguageService (F11.2)', () => {
  function setup() {
    TestBed.configureTestingModule({
      providers: [provideTranslateService({ lang: 'de-CH' })],
    });
    const service = TestBed.inject(LanguageService);
    TestBed.tick();
    return { service, translate: TestBed.inject(TranslateService) };
  }

  beforeEach(() => localStorage.removeItem(LOCALE_STORAGE_KEY));
  afterEach(() => {
    localStorage.removeItem(LOCALE_STORAGE_KEY);
    setDisplayFormat(SWISS_DISPLAY);
  });

  it('switches language, <html lang> and formats at once, and remembers the language', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de-CH');
    const { service, translate } = setup();
    expect(service.locale()).toBe('de-CH');
    expect(formatChf('1234.5')).toBe('1’234.50');

    service.use('en');
    TestBed.tick();
    expect(translate.getCurrentLang()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(displayFormat()).toEqual({
      intlLocale: 'en',
      numberFormat: 'en',
      dateFormat: 'yyyy-MM-dd',
    });
    expect(formatChf('1234.5', 'EUR')).toBe('EUR 1,234.50');
    expect(formatDate('2025-12-31')).toBe('2025-12-31');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
    expect(initialLocale()).toBe('en');
  });

  it('follows the profile: its language with its own formats', () => {
    const { service } = setup();
    service.apply({
      locale: 'en',
      numberFormat: 'de-CH',
      dateFormat: 'dd/MM/yyyy',
    });
    TestBed.tick();
    expect(service.locale()).toBe('en');
    expect(formatQuantity('12345.5')).toBe('12’345.5');
    expect(formatDate('2025-12-31T10:00:00Z', 'dateTime', 'UTC')).toBe(
      '31/12/2025 10:00',
    );

    // No language chosen yet: the current one with its own formats.
    service.apply({
      locale: null,
      numberFormat: 'de-CH',
      dateFormat: 'dd.MM.yyyy',
    });
    TestBed.tick();
    expect(service.locale()).toBe('en');
    expect(displayFormat().numberFormat).toBe('en');
  });

  it('defaults to the browser language: German → de-CH, everything else English', () => {
    expect(browserLocale(['de-DE', 'en'])).toBe('de-CH');
    expect(browserLocale(['de'])).toBe('de-CH');
    expect(browserLocale(['en-GB'])).toBe('en');
    expect(browserLocale(['fr-CH'])).toBe('en');
    expect(browserLocale([])).toBe('de-CH');
  });
});

describe('formats per language (F11.2)', () => {
  afterEach(() => setDisplayFormat(SWISS_DISPLAY));

  it('formats numbers and dates in both formats', () => {
    expect(formatChf('-1234567.891', null, 'en')).toBe('-1,234,567.89');
    expect(formatChf('-1234567.891', null, 'de-CH')).toBe('-1’234’567.89');
    expect(formatQuantity('0.123456789012345678', 18, 'en')).toBe(
      '0.123456789012345678',
    );
    expect(formatDate('2025-03-04', 'date', undefined, 'dd.MM.yyyy')).toBe(
      '04.03.2025',
    );
    expect(formatDate('2025-03-04', 'date', undefined, 'MM/dd/yyyy')).toBe(
      '03/04/2025',
    );
    expect(
      formatDate(
        '2025-03-04T05:06:07Z',
        'dateTimeSeconds',
        'UTC',
        'yyyy-MM-dd',
      ),
    ).toBe('2025-03-04 05:06:07');
    expect(formatDate(null)).toBe('');
    expect(formatDate('not a date')).toBe('');
  });

  it('writes relative times in the active language', () => {
    const now = Date.parse('2026-10-07T12:00:00Z');
    expect(formatRelative('2026-10-07T11:55:00Z', now, 'de-CH')).toBe(
      'vor 5 Minuten',
    );
    expect(formatRelative('2026-10-07T11:55:00Z', now, 'en')).toBe(
      '5 minutes ago',
    );
  });

  it('brings the formats of a new language unless the user chose others', () => {
    const swiss = {
      locale: 'de-CH' as const,
      numberFormat: 'de-CH' as const,
      dateFormat: 'dd.MM.yyyy' as const,
    };
    expect(withLanguage(swiss, 'en')).toEqual({
      locale: 'en',
      numberFormat: 'en',
      dateFormat: 'yyyy-MM-dd',
    });
    expect(withLanguage({ ...swiss, dateFormat: 'dd/MM/yyyy' }, 'en')).toEqual({
      locale: 'en',
      numberFormat: 'de-CH',
      dateFormat: 'dd/MM/yyyy',
    });
    expect(languageChoiceOf(null, 'en')).toEqual({
      locale: 'en',
      numberFormat: 'en',
      dateFormat: 'yyyy-MM-dd',
    });
    expect(
      languageChoiceOf(
        { locale: 'de-CH', numberFormat: 'en', dateFormat: 'yyyy-MM-dd' },
        'en',
      ),
    ).toEqual({
      locale: 'de-CH',
      numberFormat: 'en',
      dateFormat: 'yyyy-MM-dd',
    });
  });
});
