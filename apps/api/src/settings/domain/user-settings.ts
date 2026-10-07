/**
 * Personal settings (F11.1–F11.3) and stored API keys (F6.7). Hand-written domain types. Keys
 * are kept sealed (`enc:v1:…`, secret-box.ts) and never leave the API — views carry a hint.
 */

import type { Locale } from '../../common/i18n/locale';
import type { CoinChoices } from '../../rates/domain/coin-choice';

/** F11.2: `de-CH` = 1’234.56, `en` = 1,234.56. */
export const NUMBER_FORMATS = ['de-CH', 'en'] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number];
export const DATE_FORMATS = [
  'dd.MM.yyyy',
  'yyyy-MM-dd',
  'dd/MM/yyyy',
  'MM/dd/yyyy',
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

/** The keys a user can store; mirrored by columns `<name>_key`. */
export const API_KEY_NAMES = ['coingecko', 'etherscan'] as const;
export type ApiKeyName = (typeof API_KEY_NAMES)[number];

export interface UserSettings {
  readonly userId: string;
  readonly displayName: string;
  readonly canton: string;
  readonly advisorName: string;
  readonly advisorEmail: string;
  /** F11.2: the language of app and exports; `null` = not chosen yet (exports in German). */
  readonly locale: Locale | null;
  readonly numberFormat: NumberFormat;
  readonly dateFormat: DateFormat;
  readonly onlineRates: boolean;
  /** Sealed values, `null` when not stored. */
  readonly sealedKeys: Readonly<Record<ApiKeyName, string | null>>;
  /**
   * Symbol → the coin the user chose (provider + id + name, F7.4): prices of that symbol come only
   * from that provider, never from an exchange by ticker (`rates/domain/coin-choice.ts`).
   */
  readonly coinChoices: CoinChoices;
  /** Tickers whose shared-code warning the user settled ("Passt so"), upper case, sorted. */
  readonly coinDismissed: readonly string[];
  readonly updatedAt: string | null;
}

export interface UpdateSettingsInput {
  readonly displayName?: string;
  readonly canton?: string;
  readonly advisorName?: string;
  readonly advisorEmail?: string;
  readonly locale?: Locale;
  readonly numberFormat?: NumberFormat;
  readonly dateFormat?: DateFormat;
  readonly onlineRates?: boolean;
  /** A new sealed value, or `null` to remove the key. Absent = unchanged. */
  readonly sealedKeys?: Partial<Record<ApiKeyName, string | null>>;
  /** The whole map (replaces the stored one); absent = unchanged. */
  readonly coinChoices?: CoinChoices;
  readonly coinDismissed?: readonly string[];
}

export function defaultSettings(userId: string): UserSettings {
  return {
    userId,
    displayName: '',
    canton: '',
    advisorName: '',
    advisorEmail: '',
    locale: null,
    numberFormat: 'de-CH',
    dateFormat: 'dd.MM.yyyy',
    onlineRates: true,
    sealedKeys: { coingecko: null, etherscan: null },
    coinChoices: {},
    coinDismissed: [],
    updatedAt: null,
  };
}

/** What the API shows about a stored key: that it exists and its last four characters. */
export function keyHint(plain: string | undefined): string | null {
  if (plain === undefined || plain.length === 0) return null;
  return `…${plain.slice(-4)}`;
}
