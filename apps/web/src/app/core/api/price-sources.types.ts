/**
 * Price sources (F7.4, phase 2): the crypto price providers the user picks and orders
 * (`rates/domain/price-providers.ts` in the API). Default: Binance → CoinGecko on, the others off.
 */
export const PRICE_PROVIDERS = [
  'binance',
  'coingecko',
  'coinmarketcap',
  'defillama',
  'coinpaprika',
  'kraken',
  'coinbase',
  'bitfinex',
] as const;
export type PriceProviderId = (typeof PRICE_PROVIDERS)[number];

/** Providers whose key the user stores in the app. */
export const KEYED_PROVIDERS = ['coingecko', 'coinmarketcap'] as const;
export type KeyedProvider = (typeof KEYED_PROVIDERS)[number];

export function isKeyedProvider(id: string): id is KeyedProvider {
  return (KEYED_PROVIDERS as readonly string[]).includes(id);
}

export interface PriceSourceSetting {
  id: PriceProviderId;
  enabled: boolean;
}

/** `GET /settings/price-sources` — one provider: what it offers, on/off, its key's hint. */
export interface PriceSourceView extends PriceSourceSetting {
  label: string;
  key: 'required' | 'optional' | 'none';
  /** `anyFiat` or the codes it prices in (USD only → × USD/T of the day). */
  quotes: 'anyFiat' | string[];
  /** Days of daily history on the free tier; null = all. */
  freeHistoryDays: number | null;
  /** `startOfDay` values are filed one day earlier (the close of the day before). */
  dayPoint: 'close' | 'startOfDay';
  coinRef: 'ticker' | 'id';
  personalUseOnly: boolean;
  attribution: string | null;
  keyHint: string | null;
}

export interface PriceSourcesView {
  providers: PriceSourceView[];
  keyStorageAvailable: boolean;
}

/** The provider error codes (API `PriceSourceErrorCode`) — texts under `rates.sourceErrors.*`. */
export const PRICE_SOURCE_ERROR_CODES = [
  'invalidKey',
  'planLacksHistory',
  'rateLimited',
  'notFound',
  'unsupportedQuote',
  'network',
  'timeout',
  'badResponse',
] as const;
export type PriceSourceErrorCode = (typeof PRICE_SOURCE_ERROR_CODES)[number];

/** `POST /settings/price-sources/:provider/test` — never the key. */
export interface PriceSourceTestResult {
  provider: PriceProviderId;
  ok: boolean;
  code?: PriceSourceErrorCode;
  status: number | null;
  historyDays: number | null;
  plan: string | null;
  /** The provider's own words or the system cause (redacted). */
  detail: string | null;
  url: string;
  millis: number;
}

/** Sources whose data must carry the provider's attribution where it is shown. */
export const ATTRIBUTED_SOURCES = ['coingecko', 'coinmarketcap'] as const;
export type AttributedSource = (typeof ATTRIBUTED_SOURCES)[number];

/** The attributed sources among `sources` (sorted, unique). */
export function attributionsFor(
  sources: readonly (string | null | undefined)[],
): AttributedSource[] {
  return ATTRIBUTED_SOURCES.filter((s) => sources.includes(s));
}

/** Where the attribution links to (the providers' terms ask for a link back). */
export const ATTRIBUTION_URLS: Readonly<Record<AttributedSource, string>> = {
  coingecko: 'https://www.coingecko.com',
  coinmarketcap: 'https://coinmarketcap.com',
};
