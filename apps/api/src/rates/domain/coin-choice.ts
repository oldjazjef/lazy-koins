import { COINGECKO_IDS } from './project-rate';

/**
 * Which coin a ticker means (F7.4): the user's choice per symbol, provider-aware, and the rules
 * that decide where an asset's price comes from. Pure — no network, no Prisma.
 *
 * A ticker is not a coin: "OPN" is both OPEN Ticketing Ecosystem and Opinion, and Binance lists
 * only one of them under `OPNUSDT`. Taking Binance's close for every symbol therefore priced the
 * wrong coin (bug 07.10.2026). The rules:
 *
 * 1. the user chose a coin for the symbol → **only** that provider, never Binance;
 * 2. the symbol is in `AMBIGUOUS_SYMBOLS` and nothing is chosen → **no** price is fetched and the
 *    calculation gets an open item ("Kurs mehrdeutig – Coin wählen");
 * 3. otherwise Binance by ticker, CoinGecko (built-in id table) as the fallback.
 */

/**
 * Price providers a coin can be chosen at. CoinMarketCap is planned (numeric ids); a new provider
 * = its id pattern here, an adapter behind `CoinDirectoryPort` and a price source.
 */
export const COIN_PROVIDERS = ['coingecko'] as const;
export type CoinProvider = (typeof COIN_PROVIDERS)[number];

export function isCoinProvider(value: unknown): value is CoinProvider {
  return (COIN_PROVIDERS as readonly unknown[]).includes(value);
}

/** A coin id as the provider writes it (CoinGecko: `open-ticketing-ecosystem`). */
export const COIN_ID_PATTERNS: Readonly<Record<CoinProvider, RegExp>> = {
  coingecko: /^[a-z0-9-]{1,100}$/,
};

/** A ticker as the app stores assets (upper case; `DOT.S`, `ETH2`). */
export const SYMBOL_PATTERN = /^[A-Z0-9.]{1,40}$/;

/** A token contract on a chain (wallet tokens, F6): the app's network id and the address. */
export interface CoinContract {
  /** `ethereum`, `base`, … (`libs/engine/src/wallets/networks.ts`). */
  readonly network: string;
  /** `0x…` lower case (EVM) or the mint (Solana). */
  readonly address: string;
}

/** The coin the user chose for a symbol. `name`/`symbol` as the provider answered on validation. */
export interface CoinChoice {
  readonly provider: CoinProvider;
  readonly id: string;
  /** e.g. "OPEN Ticketing Ecosystem"; `null` for choices stored before names were kept. */
  readonly name: string | null;
  /** The provider's ticker of the coin (upper case), `null` when unknown. */
  readonly symbol: string | null;
  /**
   * Set when the coin was identified by a wallet token's contract (chain + address) rather than
   * picked — as binding as a picked coin; absent/`null` for a picked one.
   */
  readonly contract?: CoinContract | null;
}

/**
 * The app's token networks → CoinGecko's asset platform ids
 * (`GET /coins/{platform}/contract/{address}`). Networks without contract tokens (bitcoin,
 * cardano, polkadot, cosmos) are absent.
 */
export const COINGECKO_PLATFORMS: Readonly<Record<string, string>> = {
  ethereum: 'ethereum',
  bsc: 'binance-smart-chain',
  polygon: 'polygon-pos',
  arbitrum: 'arbitrum-one',
  optimism: 'optimistic-ethereum',
  base: 'base',
  solana: 'solana',
};

/** A contract as the directory takes it: `0x` + 40 hex (EVM) or a base58 mint (Solana). */
export const CONTRACT_PATTERN =
  /^(0x[0-9a-f]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/;

/** Symbol (upper case) → the chosen coin. */
export type CoinChoices = Readonly<Record<string, CoinChoice>>;

/** What a provider's directory says about a coin (search hit or lookup by id). */
export interface CoinCandidate {
  readonly provider: CoinProvider;
  readonly id: string;
  readonly name: string;
  /** Upper case. */
  readonly symbol: string;
  /** Market-cap rank, `null` when the provider has none. */
  readonly marketCapRank: number | null;
}

/**
 * Tickers known to stand for **several** coins, so an exchange's price by ticker may be the
 * wrong one. Each entry lists the coins (CoinGecko ids) that carry exactly that symbol. Basis:
 * CoinGecko `GET /api/v3/search?query=<SYMBOL>` on 07.10.2026 returned several coins with this
 * exact symbol, each with a market-cap rank (i.e. actively traded) — so neither is a dead
 * namesake. Kept small on purpose: every entry makes users choose before a price is fetched.
 *
 * - OPN: `open-ticketing-ecosystem` (OPEN Ticketing Ecosystem, rank 3301) and `opinion`
 *   (Opinion, rank 1191) — Binance's `OPNUSDT` is not the ticketing token (the reported bug).
 * - ONE: `harmony` (Harmony, rank 649) and `cross-2` (ONEchain, rank 366).
 */
export const AMBIGUOUS_SYMBOLS: Readonly<Record<string, readonly string[]>> = {
  OPN: ['open-ticketing-ecosystem', 'opinion'],
  ONE: ['harmony', 'cross-2'],
};

/** Price sources that look an asset up by its ticker (not by a chosen coin). */
export const TICKER_SOURCES: readonly string[] = ['binance'];

/** Where an asset's daily prices come from (rules 1–3 above). */
export type PricePlan =
  | {
      /** Rule 1: only the chosen coin's provider. */
      readonly kind: 'chosen';
      readonly choice: CoinChoice;
    }
  | {
      /** Rule 2: nothing is fetched until the user chooses. */
      readonly kind: 'ambiguous';
      /** CoinGecko ids that carry the symbol (suggestions for "Coin wählen"). */
      readonly candidates: readonly string[];
    }
  | {
      /** Rule 3: Binance by ticker, then CoinGecko with the built-in id (if any). */
      readonly kind: 'ticker';
      readonly coingeckoId: string | null;
    };

/**
 * `marketAmbiguous`: tickers the market list shows without a clear leader (`sharedTicker` level
 * `ambiguous`, basis `market`) — used when fetching only; the calculation reads the static list.
 */
export function pricePlan(
  asset: string,
  choices: CoinChoices,
  marketAmbiguous: ReadonlyMap<string, readonly string[]> = new Map(),
): PricePlan {
  const symbol = asset.toUpperCase();
  const choice = choices[symbol];
  if (choice) return { kind: 'chosen', choice };
  const candidates = AMBIGUOUS_SYMBOLS[symbol] ?? marketAmbiguous.get(symbol);
  if (candidates) return { kind: 'ambiguous', candidates };
  return { kind: 'ticker', coingeckoId: COINGECKO_IDS[symbol] ?? null };
}

/** The ambiguous symbols the user has not chosen a coin for (sorted). */
export function unresolvedAmbiguous(choices: CoinChoices): string[] {
  return Object.keys(AMBIGUOUS_SYMBOLS)
    .filter((symbol) => !choices[symbol])
    .sort();
}

/**
 * The ambiguous tickers without a chosen coin: the hand-kept list plus the tickers the market
 * list shows without a clear leader (`marketAmbiguity`) — upper case, sorted.
 */
export function ambiguousSymbols(
  choices: CoinChoices,
  marketAmbiguous: ReadonlyMap<string, readonly string[]> = new Map(),
): string[] {
  return [
    ...new Set([
      ...unresolvedAmbiguous(choices),
      ...[...marketAmbiguous.keys()].filter((symbol) => !choices[symbol]),
    ]),
  ].sort();
}

/**
 * Whether a stored price of `source` may be used for `asset`: a ticker source (Binance) only
 * when the asset follows rule 3 — for a chosen coin or an unresolved ambiguous ticker (hand-kept
 * or from the market list) its by-ticker price may belong to another coin.
 */
export function priceSourceUsable(
  asset: string,
  source: string,
  choices: CoinChoices,
  marketAmbiguous?: ReadonlyMap<string, readonly string[]>,
): boolean {
  if (!TICKER_SOURCES.includes(source)) return true;
  return pricePlan(asset, choices, marketAmbiguous).kind === 'ticker';
}

/**
 * The name a Kursliste entry must carry for `asset` (F7.4a, step "ESTV-Abgleich"): the chosen
 * coin's name; `undefined` when nothing (or a choice without a name) was chosen.
 */
export function requiredCoinName(
  asset: string,
  choices: CoinChoices,
): string | undefined {
  const choice = choices[asset.toUpperCase()];
  return choice?.name ?? undefined;
}

/**
 * Reads stored choices (JSON): `{ "OPN": { "provider": "coingecko", "id": "…", "name": "…",
 * "symbol": "OPN" } }`. A plain string value is the older shape (`coingeckoIds`: symbol →
 * CoinGecko id) and reads as a CoinGecko choice without a name. Invalid entries are dropped.
 */
export function parseCoinChoices(value: unknown): CoinChoices {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  const out: Record<string, CoinChoice> = {};
  for (const [rawSymbol, raw] of Object.entries(value)) {
    const symbol = rawSymbol.toUpperCase();
    if (!SYMBOL_PATTERN.test(symbol)) continue;
    if (typeof raw === 'string') {
      if (COIN_ID_PATTERNS.coingecko.test(raw)) {
        out[symbol] = {
          provider: 'coingecko',
          id: raw,
          name: null,
          symbol: null,
        };
      }
      continue;
    }
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    const provider = entry['provider'];
    const id = entry['id'];
    if (!isCoinProvider(provider) || typeof id !== 'string') continue;
    if (!COIN_ID_PATTERNS[provider].test(id)) continue;
    const name = entry['name'];
    const coinSymbol = entry['symbol'];
    const contract = contractOf(entry['contract']);
    out[symbol] = {
      provider,
      id,
      name:
        typeof name === 'string' && name.length > 0 ? name.slice(0, 200) : null,
      symbol:
        typeof coinSymbol === 'string' && coinSymbol.length > 0
          ? coinSymbol.toUpperCase().slice(0, 40)
          : null,
      ...(contract ? { contract } : {}),
    };
  }
  return out;
}

function contractOf(raw: unknown): CoinContract | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { network, address } = raw as Record<string, unknown>;
  if (typeof network !== 'string' || !COINGECKO_PLATFORMS[network]) return null;
  if (typeof address !== 'string' || !CONTRACT_PATTERN.test(address)) {
    return null;
  }
  return { network, address };
}

// --- Shared tickers detected from market data (warnings) ---

/** A coin of the provider's market list (top coins by market cap), as cached deployment-wide. */
export interface MarketCoin {
  readonly provider: CoinProvider;
  readonly id: string;
  readonly name: string;
  /** Upper case. */
  readonly symbol: string;
  readonly marketCapRank: number;
  /** USD per unit when the list was fetched (decimal string), `null` when unknown. */
  readonly priceUsd: string | null;
}

/** Only coins up to this market-cap rank are "relevant" competitors for a ticker. */
export const SHARED_RANK_LIMIT = 2000;
/**
 * A ticker has a **clear leader** when the second-ranked coin with that symbol ranks at least
 * this many times lower than the first (rank 10 vs ≥ 30). Without one, nothing is fetched by
 * ticker (as for `AMBIGUOUS_SYMBOLS`).
 */
export const LEADER_FACTOR = 3;

/**
 * What the market data says about a ticker (rule, deterministic over the cached list):
 *
 * - `ambiguous` — in `AMBIGUOUS_SYMBOLS` (hard override, cannot be dismissed), or at least two
 *   relevant coins (rank ≤ `SHARED_RANK_LIMIT`) carry it and the second ranks better than
 *   `LEADER_FACTOR` × the first (no clear leader): "Kurs mehrdeutig – Coin wählen", nothing is
 *   fetched by ticker;
 * - `warning` — at least two relevant coins carry it but one clearly leads: the price is used,
 *   the app asks "Kürzel wird von mehreren Coins verwendet – prüfen?";
 * - `null` — one relevant coin or none, a chosen coin (it silences everything), or the user said
 *   "Passt so" (`dismissed`; not for the hard list).
 */
export type SharedLevel = 'ambiguous' | 'warning';

export interface SharedTicker {
  readonly symbol: string;
  readonly level: SharedLevel;
  /** `static` = the hand-kept list, `market` = detected from the market list. */
  readonly basis: 'static' | 'market';
  /** The relevant coins with that symbol, best rank first (may be empty for the static list). */
  readonly candidates: readonly MarketCoin[];
}

export function sharedTicker(
  asset: string,
  market: readonly MarketCoin[],
  choices: CoinChoices,
  dismissed: readonly string[],
): SharedTicker | null {
  const symbol = asset.toUpperCase();
  if (choices[symbol]) return null;
  const candidates = market
    .filter((c) => c.symbol === symbol && c.marketCapRank <= SHARED_RANK_LIMIT)
    .sort(
      (a, b) => a.marketCapRank - b.marketCapRank || (a.id < b.id ? -1 : 1),
    );
  if (AMBIGUOUS_SYMBOLS[symbol]) {
    return { symbol, level: 'ambiguous', basis: 'static', candidates };
  }
  const [first, second] = candidates;
  if (!first || !second) return null;
  const level: SharedLevel =
    second.marketCapRank < LEADER_FACTOR * first.marketCapRank
      ? 'ambiguous'
      : 'warning';
  // "Passt so" settles a warning only — without a clear leader a coin must be chosen.
  if (level === 'warning' && dismissed.includes(symbol)) return null;
  return { symbol, level, basis: 'market', candidates };
}

/**
 * Every ticker the market list shows without a clear leader (level `ambiguous`, basis `market`)
 * and without a chosen coin → its candidates' ids. Independent of any project, so the
 * calculation, the dashboard and "Kurse aktualisieren" read the same map.
 */
export function marketAmbiguity(
  market: readonly MarketCoin[],
  choices: CoinChoices,
): Map<string, readonly string[]> {
  const out = new Map<string, readonly string[]>();
  for (const symbol of [...new Set(market.map((c) => c.symbol))].sort()) {
    const found = sharedTicker(symbol, market, choices, []);
    if (found?.level === 'ambiguous' && found.basis === 'market') {
      out.set(
        symbol,
        found.candidates.map((c) => c.id),
      );
    }
  }
  return out;
}

/** The CoinGecko ids of the choices (the older `coingeckoIds` shape, for packages). */
export function coingeckoIdsOf(choices: CoinChoices): Record<string, string> {
  return Object.fromEntries(
    Object.entries(choices)
      .filter(([, c]) => c.provider === 'coingecko')
      .map(([symbol, c]) => [symbol, c.id]),
  );
}
