import { BadRequestException } from '@nestjs/common';
import {
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import { assertProjectOpen } from '../../calculation/application/calculation.handlers';
import { loadOwnProject } from '../../projects/application/project-access';
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import { UserSettingsRepositoryPort } from '../../settings/ports/user-settings.repository.port';
import {
  AMBIGUOUS_SYMBOLS,
  type CoinCandidate,
  type CoinProvider,
} from '../domain/coin-choice';
import { COINGECKO_IDS } from '../domain/project-rate';
import {
  CoinChoiceService,
  type CoinChoiceResult,
  type CoinSearchView,
  normaliseSymbol,
} from './coin-choice.service';
import {
  type AssetFetchStatus,
  RefreshRatesCommand,
  RefreshRatesHandler,
} from './rates.handlers';

export {
  CoinChoiceService,
  type CoinChoiceResult,
  type CoinSearchView,
} from './coin-choice.service';

const SEARCH_LIMIT = 15;

// --- GET /rates/coins/search ---

export class SearchCoinsQuery {
  constructor(
    readonly userId: string,
    readonly provider: CoinProvider,
    readonly query: string,
  ) {}
}

/** "Coin wählen": coins of the provider matching a symbol or name (exact symbol first). */
@QueryHandler(SearchCoinsQuery)
export class SearchCoinsHandler implements IQueryHandler<
  SearchCoinsQuery,
  CoinSearchView
> {
  constructor(private readonly coins: CoinChoiceService) {}

  async execute({
    userId,
    provider,
    query,
  }: SearchCoinsQuery): Promise<CoinSearchView> {
    const q = query.trim();
    if (q.length < 1 || q.length > 60) {
      throw new BadRequestException('q must be 1–60 characters');
    }
    const settings = await this.coins.online(userId);
    const coins = await this.coins.ask(() =>
      // A typed id finds itself too (CoinGecko's search matches ids).
      this.coins.directory.search(provider, q, {
        apiKey: settings.keys.coingecko,
        limit: SEARCH_LIMIT,
      }),
    );
    const symbol = q.toUpperCase();
    return {
      provider,
      query: q,
      coins,
      suggested:
        provider === 'coingecko' ? (COINGECKO_IDS[symbol] ?? null) : null,
      ambiguous: AMBIGUOUS_SYMBOLS[symbol] !== undefined,
    };
  }
}

// --- GET /rates/coins/:provider/:id ---

export class GetCoinQuery {
  constructor(
    readonly userId: string,
    readonly provider: CoinProvider,
    readonly id: string,
  ) {}
}

/** "ID prüfen": the coin behind an id (name, symbol, rank), 422 `unknownCoin` when none. */
@QueryHandler(GetCoinQuery)
export class GetCoinHandler implements IQueryHandler<
  GetCoinQuery,
  CoinCandidate
> {
  constructor(private readonly coins: CoinChoiceService) {}

  execute({ userId, provider, id }: GetCoinQuery): Promise<CoinCandidate> {
    return this.coins.validate(userId, provider, id);
  }
}

// --- PUT|DELETE /settings/coins/:symbol ---

export class SetCoinChoiceCommand {
  constructor(
    readonly userId: string,
    readonly symbol: string,
    /** `null` removes the choice (the ticker rules apply again). */
    readonly coin: {
      readonly provider: CoinProvider;
      readonly id: string;
    } | null,
  ) {}
}

/** Einstellungen › Kurse: a coin per symbol — validated at the provider before it is stored. */
@CommandHandler(SetCoinChoiceCommand)
export class SetCoinChoiceHandler implements ICommandHandler<
  SetCoinChoiceCommand,
  CoinChoiceResult
> {
  constructor(private readonly coins: CoinChoiceService) {}

  async execute({
    userId,
    symbol,
    coin,
  }: SetCoinChoiceCommand): Promise<CoinChoiceResult> {
    normaliseSymbol(symbol);
    if (!coin) return this.coins.store(userId, symbol, null);
    const found = await this.coins.validate(userId, coin.provider, coin.id);
    return this.coins.store(userId, symbol, {
      provider: found.provider,
      id: found.id,
      name: found.name,
      symbol: found.symbol,
    });
  }
}

// --- PUT|DELETE /settings/coins/:symbol/dismissal ---

export class DismissSharedTickerCommand {
  constructor(
    readonly userId: string,
    readonly symbol: string,
    /** true = "Passt so" (no warning any more), false = warn again. */
    readonly dismissed: boolean,
  ) {}
}

/**
 * "Passt so" for a shared-code warning (F7.4): stored per user + ticker, so it does not nag again.
 * Not for the hand-kept `AMBIGUOUS_SYMBOLS` — there a coin must be chosen. Local data only.
 */
@CommandHandler(DismissSharedTickerCommand)
export class DismissSharedTickerHandler implements ICommandHandler<
  DismissSharedTickerCommand,
  { readonly dismissed: readonly string[] }
> {
  constructor(private readonly settingsRepo: UserSettingsRepositoryPort) {}

  async execute({
    userId,
    symbol,
    dismissed,
  }: DismissSharedTickerCommand): Promise<{
    readonly dismissed: readonly string[];
  }> {
    const ticker = normaliseSymbol(symbol);
    if (dismissed && AMBIGUOUS_SYMBOLS[ticker]) {
      throw new BadRequestException(
        `${ticker} stands for several coins: choose the coin instead`,
      );
    }
    const current = (await this.settingsRepo.find(userId))?.coinDismissed ?? [];
    const next = new Set(current);
    if (dismissed) next.add(ticker);
    else next.delete(ticker);
    const list = [...next].sort();
    await this.settingsRepo.save(userId, { coinDismissed: list });
    return { dismissed: list };
  }
}

// --- POST /projects/:id/rates/coin ---

export class ChooseProjectCoinCommand {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly asset: string,
    readonly coin: { readonly provider: CoinProvider; readonly id: string },
  ) {}
}

export interface ChooseProjectCoinResult extends CoinChoiceResult {
  /** The asset's refetch with `force` (only this asset is fetched). */
  readonly fetch: {
    readonly status: AssetFetchStatus;
    readonly source: string | null;
    readonly points: number;
  };
}

/**
 * Kurse tab "Falscher Kurs? Coin wählen": validates the coin, stores the choice (removing the
 * asset's fetched series everywhere, see `CoinChoiceService`), then fetches this asset's prices again
 * with `force` from the chosen provider only.
 */
@CommandHandler(ChooseProjectCoinCommand)
export class ChooseProjectCoinHandler implements ICommandHandler<
  ChooseProjectCoinCommand,
  ChooseProjectCoinResult
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly coins: CoinChoiceService,
    private readonly refresh: RefreshRatesHandler,
  ) {}

  async execute({
    userId,
    projectId,
    asset,
    coin,
  }: ChooseProjectCoinCommand): Promise<ChooseProjectCoinResult> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    assertProjectOpen(project);
    const symbol = normaliseSymbol(asset);
    const found = await this.coins.validate(userId, coin.provider, coin.id);
    const stored = await this.coins.store(userId, symbol, {
      provider: found.provider,
      id: found.id,
      name: found.name,
      symbol: found.symbol,
    });
    const summary = await this.refresh.execute(
      new RefreshRatesCommand(userId, project.id, true, [symbol]),
    );
    const own = summary.assets.find((a) => a.asset === symbol);
    return {
      ...stored,
      fetch: {
        status: own?.status ?? 'notFound',
        source: own?.source ?? null,
        points: own?.points ?? 0,
      },
    };
  }
}
