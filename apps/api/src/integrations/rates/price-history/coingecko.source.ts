import {
  asRecord,
  checkRange,
  chunkDays,
  codeForStatus,
  DAY_MS,
  dayStart,
  DaySeries,
  PriceHttp,
  type PriceHttpAnswer,
  type PriceHttpOptions,
  rankCandidates,
  rankOf,
  utcDay,
} from './price-history-http';
import {
  type CoinCandidate,
  type ContractRef,
  type DailyPrice,
  type DailyPriceRequest,
  PriceHistorySourcePort,
  type PriceSourceCapabilities,
  type PriceSourceErrorCode,
  type PriceSourceTestResult,
} from './price-history-source.port';

const BASE = 'https://api.coingecko.com/api/v3';
const CHUNK_DAYS = 365;

/** App network → CoinGecko asset platform id (`/coins/{platform}/contract/{address}`). */
const PLATFORMS: Record<string, string> = {
  ethereum: 'ethereum',
  bsc: 'binance-smart-chain',
  polygon: 'polygon-pos',
  arbitrum: 'arbitrum-one',
  optimism: 'optimistic-ethereum',
  base: 'base',
  solana: 'solana',
};

/**
 * CoinGecko public/Demo API (key optional — sent as `x-cg-demo-api-key`) behind the common port.
 * `/coins/{id}/market_chart/range` in any `vs_currency`; the free tiers reach **365 days** back —
 * older ranges answer 401 with `error_code` 10012 ("exceeds the allowed time range") →
 * `planLacksHistory`. Ranges over 90 days come as one point per day at 00:00 UTC, shorter ones
 * hourly; the first point of each UTC day is kept either way (`startOfDay`). The existing
 * `CoinGeckoSource` (rates refresh, F7.4) stays untouched until phase 2 switches over.
 */
export class CoinGeckoHistorySource extends PriceHistorySourcePort {
  readonly id = 'coingecko' as const;
  readonly capabilities: PriceSourceCapabilities = {
    label: 'CoinGecko',
    key: 'optional',
    quotes: 'anyFiat',
    freeHistoryDays: 365,
    coinRef: 'coingeckoId',
    dayPoint: 'startOfDay',
    search: true,
    contractLookup: true,
    personalUseOnly: false,
    attribution: 'Data provided by CoinGecko',
  };
  private readonly http: PriceHttp;

  constructor(options: PriceHttpOptions = {}) {
    super();
    this.http = new PriceHttp(this.id, { spacingMs: 2500, ...options });
  }

  async daily(request: DailyPriceRequest): Promise<DailyPrice[]> {
    checkRange(request.from, request.to);
    if (!/^[a-z0-9-]{1,100}$/.test(request.coin)) {
      throw this.http.error('notFound', null, 'not a CoinGecko id');
    }
    const quote = request.quote.toLowerCase();
    const series = new DaySeries(request.from, request.to, 'first');
    for (const range of chunkDays(request.from, request.to, CHUNK_DAYS)) {
      const from = Math.floor(dayStart(range.from) / 1000);
      const to = Math.floor((dayStart(range.to) + DAY_MS - 1) / 1000);
      const answer = await this.call(
        `${BASE}/coins/${request.coin}/market_chart/range?vs_currency=${encodeURIComponent(quote)}&from=${from}&to=${to}`,
        request.apiKey,
      );
      const prices = asRecord(answer.body)?.['prices'];
      if (!Array.isArray(prices)) {
        throw this.http.fail(
          'badResponse',
          answer,
          [request.apiKey],
          'no prices',
        );
      }
      for (const point of prices) {
        if (!Array.isArray(point)) continue;
        const ms = Number(point[0]);
        if (!Number.isFinite(ms)) continue;
        series.add(utcDay(ms), point[1]);
      }
    }
    return series.toArray();
  }

  async searchCoins(query: string, apiKey?: string): Promise<CoinCandidate[]> {
    const text = query.trim();
    if (text === '') return [];
    const answer = await this.call(
      `${BASE}/search?query=${encodeURIComponent(text)}`,
      apiKey,
    );
    const coins = asRecord(answer.body)?.['coins'];
    if (!Array.isArray(coins)) return [];
    return rankCandidates(coins.flatMap(candidateOf), text).slice(0, 25);
  }

  async resolveCoin(
    ref: { readonly symbol?: string; readonly contract?: ContractRef },
    apiKey?: string,
  ): Promise<CoinCandidate[]> {
    if (ref.contract) {
      const platform = PLATFORMS[ref.contract.network];
      if (
        !platform ||
        !/^[A-Za-z0-9]{20,64}$/.test(ref.contract.address.replace(/^0x/, ''))
      ) {
        return [];
      }
      try {
        const answer = await this.call(
          `${BASE}/coins/${platform}/contract/${encodeURIComponent(ref.contract.address)}`,
          apiKey,
        );
        return candidateOf(answer.body);
      } catch (error) {
        if ((error as { code?: unknown }).code === 'notFound') return [];
        throw error;
      }
    }
    const symbol = ref.symbol?.trim() ?? '';
    if (symbol === '') return [];
    const found = await this.searchCoins(symbol, apiKey);
    return found.filter(
      (candidate) => candidate.symbol.toUpperCase() === symbol.toUpperCase(),
    );
  }

  /** `GET /ping` (with the key when given) — a wrong key answers 401. */
  test(apiKey?: string): Promise<PriceSourceTestResult> {
    const url = `${BASE}/ping`;
    return this.http.test(url, async () => {
      const answer = await this.call(url, apiKey);
      return {
        status: answer.status,
        historyDays: 365,
        plan: apiKey?.trim() ? 'Demo' : 'Public (no key)',
        detail: null,
      };
    }, [apiKey]);
  }

  private async call(url: string, apiKey?: string): Promise<PriceHttpAnswer> {
    const key = apiKey?.trim();
    const answer = await this.http.get(
      url,
      key ? { 'x-cg-demo-api-key': key } : {},
      [key],
    );
    const code = errorCodeOf(answer);
    if (code === null) {
      if (answer.body === undefined) {
        throw this.http.fail('badResponse', answer, [key], 'not JSON');
      }
      return answer;
    }
    throw this.http.fail(code, answer, [key], messageOf(answer) ?? undefined);
  }
}

/** CoinGecko's error shapes: `{error:{status:{error_code}}}`, `{status:{error_code}}`, `{error}`. */
function errorCodeOf(answer: PriceHttpAnswer): PriceSourceErrorCode | null {
  const status = statusOf(answer.body);
  const errorCode = status?.['error_code'];
  if (errorCode === '10012') return 'planLacksHistory';
  if (answer.status >= 200 && answer.status < 300 && errorCode === undefined) {
    return null;
  }
  if (
    typeof errorCode === 'string' &&
    ['10002', '10005', '10010', '10011'].includes(errorCode)
  ) {
    return 'invalidKey';
  }
  if (answer.status === 400) return 'notFound';
  return codeForStatus(answer.status) ?? 'badResponse';
}

function statusOf(body: unknown): Record<string, unknown> | undefined {
  const record = asRecord(body);
  return (
    asRecord(asRecord(record?.['error'])?.['status']) ??
    asRecord(record?.['status'])
  );
}

function messageOf(answer: PriceHttpAnswer): string | null {
  const message = statusOf(answer.body)?.['error_message'];
  if (typeof message === 'string') return message;
  const error = asRecord(answer.body)?.['error'];
  if (typeof error === 'string') return error;
  return answer.text.trim().slice(0, 500) || null;
}

function candidateOf(raw: unknown): CoinCandidate[] {
  const record = asRecord(raw);
  const id = record?.['id'];
  const symbol = record?.['symbol'];
  if (typeof id !== 'string' || typeof symbol !== 'string') return [];
  const name = record?.['name'];
  return [
    {
      id,
      symbol: symbol.toUpperCase(),
      name: typeof name === 'string' ? name : null,
      rank: rankOf(record?.['market_cap_rank']),
    },
  ];
}
