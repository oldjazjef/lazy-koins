import { Injectable, Logger } from '@nestjs/common';
import {
  type CoinChoices,
  type CoinProvider,
  marketAmbiguity,
  SHARED_RANK_LIMIT,
  type SharedTicker,
  sharedTicker,
} from '../domain/coin-choice';
import { marketLeader } from '../domain/price-providers';
import { CoinDirectoryPort } from '../ports/coin-directory.port';
import { CoinMarketRepositoryPort } from '../ports/coin-market.repository.port';

const DAY_MS = 86_400_000;
const PROVIDER: CoinProvider = 'coingecko';

/**
 * F7.4 shared tickers: keeps the provider's top coins by market cap (`coin_market`,
 * deployment-wide) at most a day old — refreshed only by an explicit "Kurse aktualisieren" with
 * lookups on (F11.3) — and tells for a set of tickers which are shared (`sharedTicker`). A failed
 * refresh keeps the old list; without any list there are no market-based warnings (the static
 * `AMBIGUOUS_SYMBOLS` still apply).
 */
@Injectable()
export class CoinMarketService {
  private readonly logger = new Logger(CoinMarketService.name);
  private running: Promise<void> | null = null;

  constructor(
    private readonly directory: CoinDirectoryPort,
    private readonly market: CoinMarketRepositoryPort,
  ) {}

  /**
   * "Kurse aktualisieren": starts `refreshIfStale` and waits at most `budgetMs` for it — without
   * a key the paced market pages take minutes; they finish in the background and count from the
   * next refresh on (until then the hand-kept list and the old list apply).
   */
  async refreshBriefly(
    apiKey: string | undefined,
    budgetMs = 3000,
  ): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      this.refreshIfStale(apiKey),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, budgetMs);
      }),
    ]);
    if (timer) clearTimeout(timer);
  }

  /** Refreshes the list when it is older than a day (one run at a time). Never throws. */
  async refreshIfStale(
    apiKey: string | undefined,
    now: Date = new Date(),
  ): Promise<void> {
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        const at = await this.market.fetchedAt(PROVIDER);
        if (at && now.getTime() - Date.parse(at) < DAY_MS) return;
        const coins = await this.directory.topCoins(
          PROVIDER,
          SHARED_RANK_LIMIT,
          {
            apiKey,
          },
        );
        if (coins.length > 0) {
          await this.market.replace(PROVIDER, coins, now.toISOString());
        }
      } catch (error) {
        // The warnings are a help, never a reason for "Kurse aktualisieren" to fail.
        this.logger.warn(
          `coin market list not refreshed: ${(error as Error).message}`,
        );
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  /** Per ticker of `assets` its shared-code state (only those that are shared). */
  async shared(
    assets: readonly string[],
    choices: CoinChoices,
    dismissed: readonly string[],
  ): Promise<Map<string, SharedTicker>> {
    const symbols = [...new Set(assets.map((a) => a.toUpperCase()))].sort();
    const coins = await this.market.listBySymbols(PROVIDER, symbols);
    const out = new Map<string, SharedTicker>();
    for (const symbol of symbols) {
      const found = sharedTicker(symbol, coins, choices, dismissed);
      if (found) out.set(symbol, found);
    }
    return out;
  }

  /**
   * Per ticker the CoinGecko coin the stored market list means (the only relevant coin or the
   * clear leader, `marketLeader`) — how CoinGecko and DefiLlama identify a coin that has no
   * built-in id (price sources phase 2). Local data only.
   */
  async leaders(assets: readonly string[]): Promise<Map<string, string>> {
    const symbols = [...new Set(assets.map((a) => a.toUpperCase()))].sort();
    const coins = await this.market.listBySymbols(PROVIDER, symbols);
    const out = new Map<string, string>();
    for (const symbol of symbols) {
      const id = marketLeader(symbol, coins);
      if (id) out.set(symbol, id);
    }
    return out;
  }

  /**
   * Tickers the market list shows without a clear leader — nothing is fetched by ticker for
   * them (symbol → the candidates' ids, for `pricePlan`).
   */
  async marketAmbiguous(
    assets: readonly string[],
    choices: CoinChoices,
  ): Promise<Map<string, readonly string[]>> {
    const wanted = new Set(assets.map((a) => a.toUpperCase()));
    return new Map(
      [...(await marketAmbiguityOf(this.market, choices))].filter(([symbol]) =>
        wanted.has(symbol),
      ),
    );
  }
}

/**
 * Every ticker of the stored market list without a clear leader and without a chosen coin
 * (`marketAmbiguity`) — local data only, so the calculation and the dashboard read it offline.
 */
export async function marketAmbiguityOf(
  market: CoinMarketRepositoryPort | undefined,
  choices: CoinChoices,
): Promise<Map<string, readonly string[]>> {
  if (!market) return new Map();
  return marketAmbiguity(
    await market.listShared(PROVIDER, SHARED_RANK_LIMIT),
    choices,
  );
}
