/**
 * Personal settings (F11.1–F11.3) and stored API keys (F6.7). Hand-written domain types. Keys
 * are kept sealed (`enc:v1:…`, secret-box.ts) and never leave the API — views carry a hint.
 */

export const NUMBER_FORMATS = ['de-CH'] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number];
export const DATE_FORMATS = ['dd.MM.yyyy'] as const;
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
  readonly numberFormat: NumberFormat;
  readonly dateFormat: DateFormat;
  readonly onlineRates: boolean;
  /** Sealed values, `null` when not stored. */
  readonly sealedKeys: Readonly<Record<ApiKeyName, string | null>>;
  /** Symbol → CoinGecko id, overriding the built-in table. */
  readonly coingeckoIds: Readonly<Record<string, string>>;
  readonly updatedAt: string | null;
}

export interface UpdateSettingsInput {
  readonly displayName?: string;
  readonly canton?: string;
  readonly advisorName?: string;
  readonly advisorEmail?: string;
  readonly numberFormat?: NumberFormat;
  readonly dateFormat?: DateFormat;
  readonly onlineRates?: boolean;
  /** A new sealed value, or `null` to remove the key. Absent = unchanged. */
  readonly sealedKeys?: Partial<Record<ApiKeyName, string | null>>;
  readonly coingeckoIds?: Readonly<Record<string, string>>;
}

export function defaultSettings(userId: string): UserSettings {
  return {
    userId,
    displayName: '',
    canton: '',
    advisorName: '',
    advisorEmail: '',
    numberFormat: 'de-CH',
    dateFormat: 'dd.MM.yyyy',
    onlineRates: true,
    sealedKeys: { coingecko: null, etherscan: null },
    coingeckoIds: {},
    updatedAt: null,
  };
}

/** What the API shows about a stored key: that it exists and its last four characters. */
export function keyHint(plain: string | undefined): string | null {
  if (plain === undefined || plain.length === 0) return null;
  return `…${plain.slice(-4)}`;
}
