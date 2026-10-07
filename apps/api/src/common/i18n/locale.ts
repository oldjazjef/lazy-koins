/**
 * The languages of lazy-koins (F11.2): German (Switzerland) and English. The web app has one
 * message file per locale (`apps/web/public/i18n/<locale>.json`); the API's own texts (exports,
 * mail template, assistant prompt, country labels) keep a catalogue per locale next to the code
 * that uses them — adding a language = one more entry in each, typed by `Record<Locale, …>`.
 */
export const SUPPORTED_LOCALES = ['de-CH', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** What a user gets before choosing — and what every export used before F11.2. */
export const DEFAULT_LOCALE: Locale = 'de-CH';

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === 'string' &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

/** A stored or requested locale, else the default (German). */
export function localeOr(
  value: unknown,
  fallback: Locale = DEFAULT_LOCALE,
): Locale {
  return isLocale(value) ? value : fallback;
}
