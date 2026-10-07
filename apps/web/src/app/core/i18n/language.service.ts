import {
  DOCUMENT,
  effect,
  inject,
  Injectable,
  signal,
  untracked,
} from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { BrnCalendarI18nService } from '@spartan-ng/brain/calendar';
import {
  type DateFormat,
  type DisplayFormat,
  type NumberFormat,
  setDisplayFormat,
} from '../../shared/format/locale-format';
import { desktopBridge } from '../desktop/desktop-bridge';
import { calendarI18n } from './calendar-i18n';
import {
  initialLocale,
  isSupportedLocale,
  LOCALE_STORAGE_KEY,
  type SupportedLocale,
} from './locales';

/** The formats a language starts with (F11.2); the profile may choose others. */
export const LOCALE_FORMATS: Readonly<
  Record<
    SupportedLocale,
    { readonly numberFormat: NumberFormat; readonly dateFormat: DateFormat }
  >
> = {
  'de-CH': { numberFormat: 'de-CH', dateFormat: 'dd.MM.yyyy' },
  en: { numberFormat: 'en', dateFormat: 'yyyy-MM-dd' },
};

/** What the profile stores (F11.2) — `locale: null` = not chosen yet. */
export interface LanguageSettings {
  readonly locale: SupportedLocale | null;
  readonly numberFormat: NumberFormat;
  readonly dateFormat: DateFormat;
}

/**
 * F11.2: the app's language and number/date format, switched at runtime without a reload —
 * ngx-translate's language, `<html lang>`, the formatters (`displayFormat()`), the device's
 * remembered language (login page) and, on the desktop, the main process (menus, dialogs).
 * The profile is the source (`apply`); before sign-in the last used or the browser's language.
 */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly translate = inject(TranslateService);
  private readonly document = inject(DOCUMENT);
  /** The date pickers' month/weekday names and week start (spartan's root service). */
  private readonly calendar = inject(BrnCalendarI18nService);

  private readonly current = signal<SupportedLocale>(initialLocale());
  /** The profile's explicit formats; `null` = the language's own. */
  private readonly formats = signal<{
    numberFormat: NumberFormat;
    dateFormat: DateFormat;
  } | null>(null);

  /** The active language (a signal: `computed`s that translate in code read it). */
  readonly locale = this.current.asReadonly();

  constructor() {
    // At once for the first render, then on every change.
    const start = this.current();
    this.activate(start, LOCALE_FORMATS[start]);
    effect(() => {
      const locale = this.current();
      const formats = this.formats() ?? LOCALE_FORMATS[locale];
      untracked(() => this.activate(locale, formats));
    });
  }

  /** Switches the language now (the profile select, the wizard). */
  use(locale: SupportedLocale): void {
    this.current.set(locale);
  }

  /**
   * The profile's settings: its language (or, when none is chosen yet, the current one — the
   * browser's on first sign-in) with its stored formats; formats of a language never chosen are
   * the language's own.
   */
  apply(settings: LanguageSettings): void {
    if (settings.locale && isSupportedLocale(settings.locale)) {
      this.current.set(settings.locale);
      this.formats.set({
        numberFormat: settings.numberFormat,
        dateFormat: settings.dateFormat,
      });
    } else {
      this.formats.set(null);
    }
  }

  /** Formats for a preview (the profile form before saving). */
  preview(
    locale: SupportedLocale,
    numberFormat: NumberFormat,
    dateFormat: DateFormat,
  ): void {
    this.current.set(locale);
    this.formats.set({ numberFormat, dateFormat });
  }

  private activate(
    locale: SupportedLocale,
    formats: { numberFormat: NumberFormat; dateFormat: DateFormat },
  ): void {
    const display: DisplayFormat = {
      intlLocale: locale,
      numberFormat: formats.numberFormat,
      dateFormat: formats.dateFormat,
    };
    setDisplayFormat(display);
    this.calendar.use(
      calendarI18n(locale, formats.dateFormat, (key) =>
        this.translate.instant(key),
      ),
    );
    if (this.translate.getCurrentLang() !== locale) this.translate.use(locale);
    this.document.documentElement.lang = locale;
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // Storage blocked: the browser's language next time.
    }
    void desktopBridge()
      ?.locale?.set(locale)
      .catch(() => undefined);
  }
}
