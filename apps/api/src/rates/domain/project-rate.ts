import type { RateEntry, RateKind, RateSource } from '@lazykoins/engine';

/**
 * Stored rates of a project (F7.4): every price and exchange rate the calculation may use, with
 * its source and when it was fetched. `manual` rows are the user's overrides.
 */
export interface ProjectRate extends RateEntry {
  readonly id: string;
  readonly projectId: string;
  /** Shown with the source — the Kursliste version of an automatic ESTV value (F7.4a). */
  readonly note: string | null;
  readonly fetchedAt: string;
}

/** A rate to store, optionally with its label (`note`; absent = none). */
export type StoredRateEntry = RateEntry & { readonly note?: string | null };

/** Identifies one stored rate (the unique key without the project). */
export interface RateKey {
  readonly kind: RateKind;
  readonly asset: string;
  /** USD or a tax currency (F4.1a). */
  readonly currency: string;
  readonly date: string;
  readonly source: RateSource;
}

/**
 * Symbol → CoinGecko coin id for the common assets: the CoinGecko fallback after Binance, the
 * known coin name in the ESTV match and the suggestion in "Coin wählen". A coin the user chose
 * (`settings.coinChoices`, `coin-choice.ts`) always wins. For a symbol in `AMBIGUOUS_SYMBOLS`
 * the entry is only a suggestion — nothing is fetched until the user chose.
 */
export const COINGECKO_IDS: Readonly<Record<string, string>> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  BNB: 'binancecoin',
  SOL: 'solana',
  ADA: 'cardano',
  DOT: 'polkadot',
  XRP: 'ripple',
  DOGE: 'dogecoin',
  LTC: 'litecoin',
  BCH: 'bitcoin-cash',
  LINK: 'chainlink',
  AVAX: 'avalanche-2',
  ATOM: 'cosmos',
  MATIC: 'matic-network',
  POL: 'polygon-ecosystem-token',
  TRX: 'tron',
  XLM: 'stellar',
  XTZ: 'tezos',
  ALGO: 'algorand',
  KSM: 'kusama',
  FLOW: 'flow',
  NEAR: 'near',
  UNI: 'uniswap',
  AAVE: 'aave',
  ETC: 'ethereum-classic',
  XMR: 'monero',
  TON: 'the-open-network',
  SUI: 'sui',
  APT: 'aptos',
  ARB: 'arbitrum',
  OP: 'optimism',
  SHIB: 'shiba-inu',
  PEPE: 'pepe',
  INJ: 'injective-protocol',
  TIA: 'celestia',
  FIL: 'filecoin',
  GRT: 'the-graph',
  MINA: 'mina-protocol',
  KAVA: 'kava',
  SCRT: 'secret',
  LUNA: 'terra-luna-2',
  LUNC: 'terra-luna',
  BTT: 'bittorrent',
  EGLD: 'elrond-erd-2',
  HBAR: 'hedera-hashgraph',
  ICP: 'internet-computer',
  VET: 'vechain',
  EOS: 'eos',
  NEO: 'neo',
  ZEC: 'zcash',
  DASH: 'dash',
  // OPEN Ticketing Ecosystem (on-chain ticketing, onopen.xyz). Verified 07.10.2026 against
  // CoinGecko: GET /api/v3/search?query=OPN and GET /api/v3/coins/open-ticketing-ecosystem →
  // name "OPEN Ticketing Ecosystem", symbol "opn", homepage onopen.xyz. Not "opinion" (also OPN).
  OPN: 'open-ticketing-ecosystem',
};

/**
 * Renamed assets (FACHREGELN, Kurse): prices are looked up under each name in turn and stored
 * under the project's asset name.
 */
export const RATE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  MATIC: ['POL'],
  POL: ['MATIC'],
  BTT: ['BTTC'],
  LUNA: ['LUNA2'],
};
