import { tryParseDecimal } from '@lazykoins/engine';
import type {
  CoinCandidate,
  CoinProvider,
  MarketCoin,
} from '../../rates/domain/coin-choice';
import { CoinDirectoryPort } from '../../rates/ports/coin-directory.port';
import { type Fetcher, getJson, SerialGate } from './http-rate-client';

const BASE = 'https://api.coingecko.com/api/v3';

/**
 * CoinGecko's coin directory: `GET /search?query=` (symbol, name or id) and `GET /coins/{id}`
 * (validation: name, symbol, market-cap rank). The user's demo key when one is stored (higher
 * limit), else the public API. Shares the CoinGecko gate with the price source (one request at a
 * time, 2.5 s apart). Answers are parsed with the numbers' source text (`getJson`).
 */
export class CoinGeckoDirectory extends CoinDirectoryPort {
  readonly providers: readonly CoinProvider[] = ['coingecko'];

  constructor(
    private readonly gate: SerialGate = new SerialGate(2500),
    private readonly fetcher: Fetcher = fetch,
    /** Market list pacing (tests pass 0). */
    private readonly pacing: {
      readonly publicPageMs: number;
      readonly retryAfterMs: number;
    } = { publicPageMs: 15_000, retryAfterMs: 65_000 },
  ) {
    super();
  }

  private pause(ms: number): Promise<void> {
    return ms > 0
      ? new Promise((resolve) => setTimeout(resolve, ms))
      : Promise.resolve();
  }

  async search(
    _provider: CoinProvider,
    query: string,
    options: { readonly apiKey?: string; readonly limit: number },
  ): Promise<CoinCandidate[]> {
    const url = `${BASE}/search?query=${encodeURIComponent(query)}`;
    const body = await getJson(
      this.fetcher,
      this.gate,
      'coingecko',
      url,
      headers(options.apiKey),
    );
    const coins =
      typeof body === 'object' && body !== null && 'coins' in body
        ? (body as { coins: unknown }).coins
        : undefined;
    if (!Array.isArray(coins)) return [];
    const wanted = query.trim().toUpperCase();
    const found = coins
      .map(candidateOf)
      .filter((c): c is CoinCandidate => c !== undefined);
    // Exact symbol first (the ticker the user has), then by market-cap rank, unranked last.
    return found
      .map((c, index) => ({ c, index }))
      .sort(
        (a, b) =>
          Number(b.c.symbol === wanted) - Number(a.c.symbol === wanted) ||
          rankOrder(a.c) - rankOrder(b.c) ||
          a.index - b.index,
      )
      .slice(0, options.limit)
      .map(({ c }) => c);
  }

  async find(
    _provider: CoinProvider,
    id: string,
    options: { readonly apiKey?: string },
  ): Promise<CoinCandidate | undefined> {
    const url = `${BASE}/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`;
    const body = await getJson(
      this.fetcher,
      this.gate,
      'coingecko',
      url,
      headers(options.apiKey),
    );
    const coin = candidateOf(body);
    return coin && coin.id === id ? coin : undefined;
  }

  /** `GET /coins/{platform}/contract/{address}`: 404 = not listed (`undefined`). */
  async byContract(
    _provider: CoinProvider,
    platform: string,
    address: string,
    options: { readonly apiKey?: string },
  ): Promise<CoinCandidate | undefined> {
    const url = `${BASE}/coins/${encodeURIComponent(platform)}/contract/${encodeURIComponent(address)}`;
    const body = await getJson(
      this.fetcher,
      this.gate,
      'coingecko',
      url,
      headers(options.apiKey),
    );
    return candidateOf(body);
  }

  /**
   * The market pages, paced for the public API (live check 07.10.2026: 8 pages 2.5 s apart got a
   * 429): without a key a pause after each page (outside the gate, so a user's search still
   * passes) and one retry after a 429.
   */
  topCoins(
    _provider: CoinProvider,
    count: number,
    options: { readonly apiKey?: string },
  ): Promise<MarketCoin[]> {
    const ask = async (url: string): Promise<unknown> => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          const body = await getJson(
            this.fetcher,
            this.gate,
            'coingecko',
            url,
            headers(options.apiKey),
          );
          if (!options.apiKey) await this.pause(this.pacing.publicPageMs);
          return body;
        } catch (error) {
          const status = (error as { status?: unknown } | null)?.status;
          if (status !== 429 || attempt >= 1) throw error;
          await this.pause(this.pacing.retryAfterMs);
        }
      }
    };
    return topCoinsOf(ask, count);
  }
}

const PAGE = 250;

/** `GET /coins/markets` pages (250 coins each, best market cap first) up to `count` coins. */
export async function topCoinsOf(
  ask: (url: string) => Promise<unknown>,
  count: number,
): Promise<MarketCoin[]> {
  // A coin can show up on two pages when ranks shift while paging (live 07.10.2026: the unique
  // key failed) — the first (best) rank wins; rows the table would refuse are skipped.
  const out: MarketCoin[] = [];
  const seen = new Set<string>();
  const pages = Math.ceil(count / PAGE);
  for (let page = 1; page <= pages; page += 1) {
    const body = await ask(
      `${BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${PAGE}&page=${page}&sparkline=false`,
    );
    if (!Array.isArray(body) || body.length === 0) break;
    for (const raw of body) {
      const coin = candidateOf(raw);
      if (!coin || coin.marketCapRank === null || seen.has(coin.id)) continue;
      if (coin.symbol.length === 0 || coin.name.trim().length === 0) continue;
      seen.add(coin.id);
      const price = tryParseDecimal(
        String((raw as Record<string, unknown>)['current_price'] ?? ''),
      );
      out.push({
        provider: 'coingecko',
        id: coin.id,
        name: coin.name,
        symbol: coin.symbol,
        marketCapRank: coin.marketCapRank,
        priceUsd: price && !price.isNegative() ? price.toFixed() : null,
      });
    }
    if (body.length < PAGE) break;
  }
  return out.filter((c) => c.marketCapRank <= count);
}

function headers(apiKey: string | undefined): Record<string, string> {
  return apiKey ? { 'x-cg-demo-api-key': apiKey } : {};
}

function rankOrder(coin: CoinCandidate): number {
  return coin.marketCapRank ?? Number.MAX_SAFE_INTEGER;
}

/** `{ id, name, symbol, market_cap_rank }` of a search hit or a coin; `undefined` when unusable. */
function candidateOf(raw: unknown): CoinCandidate | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const entry = raw as Record<string, unknown>;
  const { id, name, symbol } = entry;
  if (typeof id !== 'string' || typeof name !== 'string') return undefined;
  if (typeof symbol !== 'string' || !/^[a-z0-9-]{1,100}$/.test(id)) {
    return undefined;
  }
  // Numbers arrive as their source text (parseJsonKeepingNumbers).
  const rank = Number(entry['market_cap_rank']);
  return {
    provider: 'coingecko',
    id,
    name: name.slice(0, 200),
    symbol: symbol.toUpperCase().slice(0, 40),
    marketCapRank:
      entry['market_cap_rank'] !== null && Number.isInteger(rank) && rank > 0
        ? rank
        : null,
  };
}
