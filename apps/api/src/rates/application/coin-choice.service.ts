import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { conflict } from '../../common/http/api-errors';
import type { Env } from '../../config/env';
import { UserRateRepositoryPort } from '../../dashboard/ports/user-rate.repository.port';
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import {
  type ResolvedSettings,
  SettingsReader,
} from '../../settings/application/settings.handlers';
import { UserSettingsRepositoryPort } from '../../settings/ports/user-settings.repository.port';
import {
  COIN_ID_PATTERNS,
  type CoinCandidate,
  type CoinChoice,
  type CoinChoices,
  type CoinProvider,
  SYMBOL_PATTERN,
} from '../domain/coin-choice';
import { CoinDirectoryPort } from '../ports/coin-directory.port';
import { ProjectRateRepositoryPort } from '../ports/project-rate.repository.port';

/** What the coin directory answers for a symbol, with the app's hints. */
export interface CoinSearchView {
  readonly provider: CoinProvider;
  readonly query: string;
  readonly coins: readonly CoinCandidate[];
  /** The built-in id for the symbol (`COINGECKO_IDS`) — shown as "Vorschlag". */
  readonly suggested: string | null;
  /** The ticker stands for several coins (`AMBIGUOUS_SYMBOLS`). */
  readonly ambiguous: boolean;
}

/** After a choice: which rows were removed so no other coin's price keeps counting. */
export interface CoinChoiceResult {
  readonly symbol: string;
  readonly choice: CoinChoice | null;
  readonly choices: CoinChoices;
  /** Fetched project rows removed (open projects of the user) + rate-cache rows removed. */
  readonly removed: {
    readonly projectRates: number;
    readonly userRates: number;
  };
}

export function normaliseSymbol(raw: string): string {
  const symbol = raw.trim().toUpperCase();
  if (!SYMBOL_PATTERN.test(symbol)) {
    throw new BadRequestException(
      'symbol must be 1–40 letters, digits or dots',
    );
  }
  return symbol;
}

function checkId(provider: CoinProvider, id: string): string {
  const trimmed = id.trim();
  if (!COIN_ID_PATTERNS[provider].test(trimmed)) {
    throw new BadRequestException(`not a ${provider} coin id`);
  }
  return trimmed;
}

/**
 * The user's coin per ticker (F7.4): asks the provider's directory (search, validation — online
 * only, F11.3) and stores a choice. Storing or removing one also removes the asset's **fetched**
 * prices everywhere they could still count — every open project of the user (`project_rate`,
 * never `manual`/`estv`) and the dashboard's rate cache (`user_rate`) — so no series of another
 * coin survives; reading filters by-ticker prices of chosen/ambiguous tickers anyway, and the
 * changed rates/choices change the calculation's input hash (stale) and the dashboard's cache key.
 * Closed projects (F4.5) keep their rows.
 */
@Injectable()
export class CoinChoiceService {
  constructor(
    readonly directory: CoinDirectoryPort,
    private readonly settings: SettingsReader,
    private readonly settingsRepo: UserSettingsRepositoryPort,
    private readonly projects: ProjectRepositoryPort,
    private readonly rates: ProjectRateRepositoryPort,
    private readonly userRates: UserRateRepositoryPort,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** F11.3: the directory is on the internet — refused with the switch or `RATES_ONLINE` off. */
  async online(userId: string): Promise<ResolvedSettings> {
    const settings = await this.settings.resolve(userId);
    if (
      !settings.onlineRates ||
      this.config.get('RATES_ONLINE', { infer: true }) === 'false'
    ) {
      throw conflict(
        'offline',
        'Rate lookups on the internet are switched off (settings)',
      );
    }
    return settings;
  }

  /** A directory call; its failure becomes a coded 502 (status only, never a body). */
  async ask<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      const status = (error as { status?: unknown } | null)?.status;
      throw new BadGatewayException({
        statusCode: 502,
        error: 'Bad Gateway',
        message: 'The coin directory could not be reached',
        code: 'coinProviderFailed',
        status: typeof status === 'number' ? status : null,
      });
    }
  }

  /** Validates `id` at the provider: the coin with its name and symbol, else 422 `unknownCoin`. */
  async validate(
    userId: string,
    provider: CoinProvider,
    rawId: string,
  ): Promise<CoinCandidate> {
    const id = checkId(provider, rawId);
    const settings = await this.online(userId);
    const coin = await this.ask(() =>
      this.directory.find(provider, id, { apiKey: settings.keys.coingecko }),
    );
    if (!coin) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: `${provider} does not know the coin ${id}`,
        code: 'unknownCoin',
      });
    }
    return coin;
  }

  /** Stores (or with `null` removes) the choice for `symbol` and removes the asset's fetched prices. */
  async store(
    userId: string,
    rawSymbol: string,
    choice: CoinChoice | null,
  ): Promise<CoinChoiceResult> {
    const symbol = normaliseSymbol(rawSymbol);
    const current = (await this.settingsRepo.find(userId))?.coinChoices ?? {};
    const next: Record<string, CoinChoice> = { ...current };
    if (choice) next[symbol] = choice;
    else delete next[symbol];
    await this.settingsRepo.save(userId, { coinChoices: next });
    let projectRates = 0;
    for (const project of await this.projects.findByOwner(userId)) {
      if (project.status === 'closed') continue;
      projectRates += await this.rates.deleteFetchedPrices(project.id, symbol);
    }
    const userRates = await this.userRates.deletePrices(userId, symbol);
    return {
      symbol,
      choice: next[symbol] ?? null,
      choices: next,
      removed: { projectRates, userRates },
    };
  }
}
