import { registerLocaleData } from '@angular/common';
import localeDeCh from '@angular/common/locales/de-CH';
import localeEn from '@angular/common/locales/en';
import {
  LOCALE_ID,
  type EnvironmentProviders,
  inject,
  provideAppInitializer,
  type Provider,
} from '@angular/core';
import { provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
import { LanguageService } from './language.service';
import { DEFAULT_LOCALE, initialLocale } from './locales';

export {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from './locales';

// Angular's locale data for both languages (pipes that still take a locale, e.g. `uppercase`).
registerLocaleData(localeDeCh);
registerLocaleData(localeEn);

/**
 * Runtime i18n (F11.2): message files are fetched from `/i18n/<lang>.json`; `LanguageService`
 * switches the language at runtime (no reload) and drives the number/date formats.
 *
 * Order matters: `provideTranslateHttpLoader()` must come after `provideTranslateService()`, or
 * the service's own no-op loader wins and every key renders as its raw path (see etx).
 */
export function provideI18n(): (Provider | EnvironmentProviders)[] {
  return [
    { provide: LOCALE_ID, useValue: DEFAULT_LOCALE },
    provideTranslateService({
      lang: initialLocale(),
      fallbackLang: DEFAULT_LOCALE,
    }),
    provideTranslateHttpLoader({ prefix: './i18n/', suffix: '.json' }),
    // `<html lang>` and the formats are set before the first page renders.
    provideAppInitializer(() => {
      inject(LanguageService);
    }),
  ];
}
