import type { RateEntry } from '@lazykoins/engine';
import type {
  PriceHistorySourcePort,
  PriceHistorySourcesPort,
  PriceSourceErrorCode,
} from '../../integrations/rates/price-history/price-history-source.port';
import {
  chosenCoinSources,
  type CoinChoice,
  type CoinChoices,
  pricePlan,
} from '../domain/coin-choice';
import {
  addDays,
  BINANCE_INFO,
  type CoinPick,
  dayShift,
  isKeyedProvider,
  type KeyedProvider,
  type PriceProviderId,
  type PriceProviderInfo,
  pickBySymbol,
  quoteFor,
} from '../domain/price-providers';
import { RATE_ALIASES } from '../domain/project-rate';
import type { UsdPriceSourcePort } from '../ports/rate-source.port';

/**
 * How one provider answered for one asset: `fetched` (a series), `empty` (no value in the window),
 * `notFound` / `planLacksHistory` / `unsupportedQuote` (the provider cannot serve it), `noKey`
 * (its key is not stored), `noCoin` (it cannot identify this coin — e.g. DefiLlama without a
 * CoinGecko id or contract, any ticker source for a chosen coin), `ambiguous` (its symbol lookup
 * has no clear leader) or `failed` (key refused, rate limit, network, timeout, bad answer).
 */
export type AttemptOutcome =
  | 'fetched'
  | 'empty'
  | 'notFound'
  | 'planLacksHistory'
  | 'unsupportedQuote'
  | 'noKey'
  | 'noCoin'
  | 'ambiguous'
  | 'failed';

export interface ProviderAttempt {
  readonly provider: PriceProviderId;
  readonly outcome: AttemptOutcome;
  /** The provider's error code (`PriceSourceErrorCode`) when it answered with an error. */
  readonly code: PriceSourceErrorCode | null;
}

/** What one asset's lookup found (before it is stored). */
export interface PriceFetch {
  /**
   * `ambiguous` = the ticker stands for several coins and none is chosen (nothing asked);
   * `noKey` = the chosen coin's provider needs a key the user has not stored (and nobody else
   * could price that coin); `failed` = no provider delivered and at least one failed hard.
   */
  readonly status: 'fetched' | 'notFound' | 'ambiguous' | 'noKey' | 'failed';
  readonly source: PriceProviderId | null;
  readonly entries: readonly RateEntry[];
  /** Every provider asked, in order (the answer's "why"). */
  readonly attempts: readonly ProviderAttempt[];
  /** The first hard failure when nothing was fetched (API error code + i18n text). */
  readonly error: {
    readonly provider: PriceProviderId;
    readonly code: PriceSourceErrorCode;
  } | null;
  /** Keyed providers that accepted / refused the user's key in this lookup. */
  readonly keysAccepted: readonly KeyedProvider[];
  readonly keysRejected: readonly KeyedProvider[];
}

/** The adapters the chain asks. */
export interface PriceSources {
  /** Binance daily closes (no key, USD). */
  readonly usd: UsdPriceSourcePort;
  /** Every other provider (CoinGecko, CoinMarketCap, DefiLlama, CoinPaprika, Kraken, …). */
  readonly history: PriceHistorySourcesPort;
  /** Coin lookups of earlier assets/refreshes (one per handler). */
  readonly coins?: CoinRefCache;
}

export interface PriceRequest {
  readonly asset: string;
  readonly from: string;
  readonly to: string;
  /** The tax currency T — asked directly where the provider prices in it, else USD (× USD/T). */
  readonly currency: string;
  readonly choices: CoinChoices;
  /** The user's keys, opened for this refresh only. */
  readonly keys: Readonly<Partial<Record<KeyedProvider, string>>>;
  /** The enabled providers in the user's order (default: Binance → CoinGecko, as before). */
  readonly providers?: readonly PriceProviderId[];
  /** Tickers the market list shows without a clear leader (`CoinMarketService`). */
  readonly marketAmbiguous?: ReadonlyMap<string, readonly string[]>;
  /** The CoinGecko coin the market list means by this ticker (single coin or clear leader). */
  readonly marketLeader?: string | null;
}

const DEFAULT_PROVIDERS: readonly PriceProviderId[] = ['binance', 'coingecko'];
/** CoinGecko answers one point per day at 00:00 UTC only for ranges over 90 days. */
const COINGECKO_MIN_DAYS = 91;
const DAY_MS = 86_400_000;

/**
 * Coin references a provider resolved (symbol search, contract lookup), kept a day so a refresh of
 * 30 assets does not ask the same directory again and again. Deployment-independent data (which
 * coin an id is), never a key or a price.
 */
export class CoinRefCache {
  private readonly entries = new Map<string, { at: number; pick: CoinPick }>();

  constructor(
    private readonly ttlMs = DAY_MS,
    private readonly now: () => number = Date.now,
  ) {}

  async get(key: string, load: () => Promise<CoinPick>): Promise<CoinPick> {
    const hit = this.entries.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.pick;
    const pick = await load();
    if (this.entries.size > 5000) this.entries.clear();
    this.entries.set(key, { at: this.now(), pick });
    return pick;
  }
}

/** The providers to ask for an asset, in order: a chosen coin's provider first, then only those that see the same coin. */
export function providerCandidates(
  plan: ReturnType<typeof pricePlan>,
  order: readonly PriceProviderId[],
): PriceProviderId[] {
  if (plan.kind === 'ambiguous') return [];
  if (plan.kind === 'ticker') return [...order];
  const allowed = chosenCoinSources(plan.choice);
  return [
    plan.choice.provider,
    ...order.filter((p) => p !== plan.choice.provider && allowed.includes(p)),
  ];
}

/**
 * One asset's daily prices over `from`…`to` — the ONE rule for "Kurse aktualisieren" of a project
 * and of the dashboard (price sources phase 2):
 *
 * - an ambiguous ticker without a chosen coin → nothing is asked (`ambiguous`), at any provider;
 * - a chosen coin → its provider first (even when switched off — the choice is the more specific
 *   instruction), then only enabled providers that identify **the same coin** (DefiLlama for a
 *   CoinGecko id, the contract providers for a contract) — never a ticker source;
 * - else the enabled providers in the user's order: Binance/Kraken/Bitfinex/Coinbase by ticker,
 *   CoinGecko by the built-in id, the market list's leader or a symbol search with a clear leader,
 *   CoinMarketCap/CoinPaprika by a symbol search with a clear leader, DefiLlama by a known CoinGecko
 *   id. The first provider with a non-empty series wins; every other answer (not found, plan too
 *   small, quote not offered, empty, no key, no coin, ambiguous at that provider, **and** a hard
 *   failure) moves on to the next — a broken provider never blocks a price another one has.
 *
 * Values are filed per UTC day as the **close of that day** (`dayShift`): start-of-day providers
 * are asked one day later and filed one day earlier. A USD-only provider stores USD (the engine
 * multiplies by USD/T of the day). Never throws for a provider failure.
 */
export async function fetchPrices(
  sources: PriceSources,
  request: PriceRequest,
): Promise<PriceFetch> {
  const plan = pricePlan(
    request.asset,
    request.choices,
    request.marketAmbiguous,
  );
  const attempts: ProviderAttempt[] = [];
  const accepted = new Set<KeyedProvider>();
  const rejected = new Set<KeyedProvider>();
  const done = (
    status: PriceFetch['status'],
    source: PriceProviderId | null,
    entries: readonly RateEntry[],
  ): PriceFetch => {
    const failure = attempts.find((a) => a.outcome === 'failed');
    return {
      status,
      source,
      entries,
      attempts,
      error:
        status === 'failed' && failure
          ? { provider: failure.provider, code: failure.code ?? 'badResponse' }
          : null,
      keysAccepted: [...accepted].sort(),
      keysRejected: [...rejected].sort(),
    };
  };
  if (plan.kind === 'ambiguous') return done('ambiguous', null, []);
  const order = request.providers ?? DEFAULT_PROVIDERS;
  for (const provider of providerCandidates(plan, order)) {
    const result = await askProvider(sources, request, provider, plan);
    attempts.push({
      provider,
      outcome: result.outcome,
      code: result.code,
    });
    if (isKeyedProvider(provider)) {
      if (result.code === 'invalidKey') rejected.add(provider);
      else if (result.keyUsed) accepted.add(provider);
    }
    if (result.outcome === 'fetched') {
      return done('fetched', provider, result.entries);
    }
  }
  if (attempts.some((a) => a.outcome === 'failed')) {
    return done('failed', null, []);
  }
  if (
    plan.kind === 'chosen' &&
    attempts[0]?.provider === plan.choice.provider &&
    attempts[0].outcome === 'noKey'
  ) {
    return done('noKey', null, []);
  }
  return done('notFound', null, []);
}

interface Answer {
  readonly outcome: AttemptOutcome;
  readonly code: PriceSourceErrorCode | null;
  readonly entries: readonly RateEntry[];
  /** The user's key went to the provider and was not refused. */
  readonly keyUsed: boolean;
}

const answer = (
  outcome: AttemptOutcome,
  code: PriceSourceErrorCode | null = null,
  keyUsed = false,
): Answer => ({ outcome, code, entries: [], keyUsed });

/** What the chain knows of a provider (Binance is not behind the history port). */
export function providerInfo(
  history: PriceHistorySourcesPort,
  provider: PriceProviderId,
): PriceProviderInfo {
  if (provider === 'binance') return BINANCE_INFO;
  const c = history.byId(provider).capabilities;
  return {
    id: provider,
    label: c.label,
    key: c.key,
    quotes: c.quotes,
    freeHistoryDays: c.freeHistoryDays,
    dayPoint: c.dayPoint,
    coinRef: c.coinRef === 'ticker' ? 'ticker' : 'id',
    personalUseOnly: c.personalUseOnly,
    attribution: c.attribution,
  };
}

async function askProvider(
  sources: PriceSources,
  request: PriceRequest,
  provider: PriceProviderId,
  plan: ReturnType<typeof pricePlan>,
): Promise<Answer> {
  const info = providerInfo(sources.history, provider);
  const quote = quoteFor(info.quotes, request.currency);
  if (quote === null) return answer('unsupportedQuote');
  const key = isKeyedProvider(provider) ? request.keys[provider] : undefined;
  if (isKeyedProvider(provider) && !key) return answer('noKey');
  const shift = dayShift(info.dayPoint);
  try {
    if (provider === 'binance') {
      if (plan.kind !== 'ticker') return answer('noCoin');
      return toAnswer(await binanceSeries(sources.usd, request), false);
    }
    const source = sources.history.byId(provider);
    const pick = await coinFor(sources, source, provider, request, plan, key);
    if (pick.kind === 'ambiguous')
      return answer('ambiguous', null, Boolean(key));
    if (pick.kind === 'none') return answer('noCoin', null, Boolean(key));
    let from = addDays(request.from, -shift);
    const to = addDays(request.to, -shift);
    if (
      provider === 'coingecko' &&
      (Date.parse(to) - Date.parse(from)) / DAY_MS < COINGECKO_MIN_DAYS
    ) {
      from = addDays(to, -COINGECKO_MIN_DAYS);
    }
    const prices = await source.daily({
      coin: pick.coin.id,
      quote,
      from,
      to,
      ...(key ? { apiKey: key } : {}),
    });
    const entries: RateEntry[] = prices
      .map((p) => ({ date: addDays(p.date, shift), value: p.value }))
      .filter((p) => p.date >= request.from && p.date <= request.to)
      .map((p) => ({
        kind: 'price' as const,
        asset: request.asset.toUpperCase(),
        currency: quote,
        date: p.date,
        value: p.value,
        source: provider,
      }));
    return toAnswer(entries, Boolean(key));
  } catch (error) {
    const code = errorCode(error);
    if (
      code === 'notFound' ||
      code === 'planLacksHistory' ||
      code === 'unsupportedQuote'
    ) {
      return answer(code, code, Boolean(key));
    }
    return answer('failed', code, false);
  }
}

function toAnswer(entries: readonly RateEntry[], keyUsed: boolean): Answer {
  return entries.length > 0
    ? { outcome: 'fetched', code: null, entries, keyUsed }
    : answer('empty', null, keyUsed);
}

/** Binance `<SYM>USDT` closes, then the renamed asset's aliases (earlier symbols win per day). */
async function binanceSeries(
  usd: UsdPriceSourcePort,
  request: PriceRequest,
): Promise<RateEntry[]> {
  const asset = request.asset.toUpperCase();
  let entries: RateEntry[] = [];
  for (const symbol of [asset, ...(RATE_ALIASES[asset] ?? [])]) {
    const found = await usd.dailyUsd({
      asset,
      symbol,
      from: request.from,
      to: request.to,
    });
    const dates = new Set(entries.map((e) => e.date));
    entries = [...entries, ...found.filter((e) => !dates.has(e.date))];
  }
  return entries;
}

/**
 * The provider's reference for the asset's coin (see `fetchPrices`). Ticker providers take the
 * symbol itself; the others an id from the choice, the built-in CoinGecko ids, the market list's
 * leader, a contract or a symbol lookup with a clear leader (`pickBySymbol`).
 */
async function coinFor(
  sources: PriceSources,
  source: PriceHistorySourcePort,
  provider: PriceProviderId,
  request: PriceRequest,
  plan: ReturnType<typeof pricePlan>,
  key: string | undefined,
): Promise<CoinPick> {
  const asset = request.asset.toUpperCase();
  const coin = (id: string): CoinPick => ({
    kind: 'coin',
    coin: { id, symbol: asset, name: null, rank: null },
  });
  const cached = (cacheKey: string, load: () => Promise<CoinPick>) =>
    sources.coins ? sources.coins.get(cacheKey, load) : load();
  if (source.capabilities.coinRef === 'ticker') {
    return plan.kind === 'ticker' ? coin(asset) : { kind: 'none' };
  }
  if (plan.kind === 'chosen') {
    return chosenRef(provider, plan.choice, source, key, cached);
  }
  if (plan.kind !== 'ticker') return { kind: 'none' };
  const geckoId = plan.coingeckoId ?? request.marketLeader ?? null;
  switch (provider) {
    case 'coingecko':
      if (geckoId) return coin(geckoId);
      break;
    case 'defillama':
      return geckoId ? coin(`coingecko:${geckoId}`) : { kind: 'none' };
    default:
      break;
  }
  if (!source.resolveCoin) return { kind: 'none' };
  return cached(`${provider}|symbol|${asset}`, async () =>
    pickBySymbol(
      (await source.resolveCoin?.({ symbol: asset }, key)) ?? [],
      asset,
    ),
  );
}

/** A chosen coin at a provider: its own id, CoinGecko's id on DefiLlama, or its contract. */
async function chosenRef(
  provider: PriceProviderId,
  choice: CoinChoice,
  source: PriceHistorySourcePort,
  key: string | undefined,
  cached: (key: string, load: () => Promise<CoinPick>) => Promise<CoinPick>,
): Promise<CoinPick> {
  const coin = (id: string): CoinPick => ({
    kind: 'coin',
    coin: { id, symbol: choice.symbol ?? '', name: choice.name, rank: null },
  });
  if (provider === choice.provider) return coin(choice.id);
  if (provider === 'defillama' && choice.provider === 'coingecko') {
    return coin(`coingecko:${choice.id}`);
  }
  const contract = choice.contract;
  if (!contract || !source.resolveCoin) return { kind: 'none' };
  return cached(
    `${provider}|contract|${contract.network}:${contract.address}`,
    async () => {
      const found = (await source.resolveCoin?.({ contract }, key)) ?? [];
      const first = found[0];
      // One contract is one coin: several answers would be a provider oddity — take none.
      return found.length === 1 && first
        ? { kind: 'coin', coin: first }
        : { kind: 'none' };
    },
  );
}

/**
 * A provider failure's code: `PriceSourceError.code`, or — for the older adapters (Binance,
 * `RateSourceError` with an HTTP status) — from the status.
 */
export function errorCode(error: unknown): PriceSourceErrorCode {
  const failed = error as { code?: unknown; status?: unknown } | null;
  const code = failed?.code;
  if (
    typeof code === 'string' &&
    [
      'invalidKey',
      'planLacksHistory',
      'rateLimited',
      'notFound',
      'unsupportedQuote',
      'network',
      'timeout',
      'badResponse',
    ].includes(code)
  ) {
    return code as PriceSourceErrorCode;
  }
  const status = failed?.status;
  if (status === null || status === undefined) return 'network';
  if (status === 401 || status === 403) return 'invalidKey';
  if (status === 404) return 'notFound';
  if (status === 429) return 'rateLimited';
  return 'badResponse';
}

/**
 * Whether a stored series of `source` counts as the asset's series (cache check): never for an
 * ambiguous ticker; for a chosen coin only the series of the sources that see that coin
 * (`chosenCoinSources`); otherwise any fetched source.
 */
export function seriesCounts(
  asset: string,
  source: string,
  choices: CoinChoices,
  marketAmbiguous?: ReadonlyMap<string, readonly string[]>,
): boolean {
  const plan = pricePlan(asset, choices, marketAmbiguous);
  if (plan.kind === 'ambiguous') return false;
  if (plan.kind === 'chosen') {
    return chosenCoinSources(plan.choice).includes(source);
  }
  return true;
}
