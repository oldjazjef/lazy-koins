import { LOCALE_FORMATS } from '../../core/i18n/language.service';
import {
  LOCALE_NAMES,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from '../../core/i18n/locales';
import {
  DATE_FORMATS,
  type DateFormat,
  NUMBER_FORMATS,
  type NumberFormat,
} from './locale-format';

/** The choices of Profil › Sprache und Format and the wizard's first step (F11.2). */
export const LANGUAGE_OPTIONS = SUPPORTED_LOCALES.map((value) => ({
  value,
  /** In its own language, as language pickers do. */
  label: LOCALE_NAMES[value],
}));

const NUMBER_FORMAT_KEYS: Readonly<Record<NumberFormat, string>> = {
  'de-CH': 'profile.numberFormats.deCH',
  en: 'profile.numberFormats.en',
};

const DATE_FORMAT_KEYS: Readonly<Record<DateFormat, string>> = {
  'dd.MM.yyyy': 'profile.dateFormats.ddMMyyyy',
  'yyyy-MM-dd': 'profile.dateFormats.yyyyMMdd',
  'dd/MM/yyyy': 'profile.dateFormats.ddMMyyyySlash',
  'MM/dd/yyyy': 'profile.dateFormats.MMddyyyySlash',
};

export const NUMBER_FORMAT_OPTIONS = NUMBER_FORMATS.map((value) => ({
  value,
  labelKey: NUMBER_FORMAT_KEYS[value],
}));

export const DATE_FORMAT_OPTIONS = DATE_FORMATS.map((value) => ({
  value,
  labelKey: DATE_FORMAT_KEYS[value],
}));

export interface LanguageChoice {
  readonly locale: SupportedLocale;
  readonly numberFormat: NumberFormat;
  readonly dateFormat: DateFormat;
}

/**
 * What the profile shows: the stored language with its formats — or, before the first choice
 * (`locale: null`, F11.2 "Vorgabe: Browsersprache"), the active language with its own formats.
 */
export function languageChoiceOf(
  settings: {
    readonly locale: SupportedLocale | null;
    readonly numberFormat: NumberFormat;
    readonly dateFormat: DateFormat;
  } | null,
  active: SupportedLocale,
): LanguageChoice {
  if (!settings?.locale) return { locale: active, ...LOCALE_FORMATS[active] };
  return {
    locale: settings.locale,
    numberFormat: settings.numberFormat,
    dateFormat: settings.dateFormat,
  };
}

/**
 * A new language brings its own formats — unless the user had chosen formats that are not the
 * previous language's defaults (then they stay).
 */
export function withLanguage(
  current: LanguageChoice,
  locale: SupportedLocale,
): LanguageChoice {
  const previous = LOCALE_FORMATS[current.locale];
  const untouched =
    current.numberFormat === previous.numberFormat &&
    current.dateFormat === previous.dateFormat;
  return untouched
    ? { locale, ...LOCALE_FORMATS[locale] }
    : { ...current, locale };
}
