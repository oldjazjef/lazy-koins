import { registerLocaleData } from '@angular/common';
import localeDeCh from '@angular/common/locales/de-CH';
import {
  LOCALE_ID,
  type EnvironmentProviders,
  type Provider,
} from '@angular/core';
import { provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';

/**
 * Locales the app ships. Adding one means adding `public/i18n/<code>.json`, the code here and
 * its Angular locale data (F11.2: German/Swiss first).
 */
export const SUPPORTED_LOCALES = ['de-CH'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = 'de-CH';

// Dates and numbers through Angular's pipes in Swiss German (`06.10.2026`, `1’234.50`).
registerLocaleData(localeDeCh);

/**
 * Runtime i18n: message files are fetched from `/i18n/<lang>.json`.
 *
 * Order matters: `provideTranslateHttpLoader()` must come after `provideTranslateService()`, or
 * the service's own no-op loader wins and every key renders as its raw path (see etx).
 */
export function provideI18n(): (Provider | EnvironmentProviders)[] {
  return [
    { provide: LOCALE_ID, useValue: DEFAULT_LOCALE },
    provideTranslateService({
      lang: DEFAULT_LOCALE,
      fallbackLang: DEFAULT_LOCALE,
    }),
    provideTranslateHttpLoader({ prefix: './i18n/', suffix: '.json' }),
  ];
}
