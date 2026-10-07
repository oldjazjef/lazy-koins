import {
  BadRequestException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { conflict } from '../../common/http/api-errors';
import { ConfigService } from '@nestjs/config';
import {
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import {
  assetsNeedingPrices,
  calculate,
  parseKursliste,
  type RateEntry,
  type RateKind,
  RateTable,
  tryParseDecimal,
} from '@lazykoins/engine';
import { assertProjectOpen } from '../../calculation/application/calculation.handlers';
import { CalculationInputService } from '../../calculation/application/calculation-input.service';
import type { Env } from '../../config/env';
import { NotificationService } from '../../notifications/application/notification.service';
import { projectRoute, Topics } from '../../notifications/domain/notification';
import { loadOwnProject } from '../../projects/application/project-access';
import type { Project } from '../../projects/domain/project';
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import { SettingsReader } from '../../settings/application/settings.handlers';
import { ESTV_LABEL_PREFIX, estvSourceLabel } from '../domain/estv';
import {
  type CoinChoice,
  type CoinChoices,
  type PricePlan,
  pricePlan,
  type SharedTicker,
} from '../domain/coin-choice';
import { CoinMarketService } from './coin-market.service';
import {
  COINGECKO_IDS,
  type ProjectRate,
  type RateKey,
} from '../domain/project-rate';
import { CalculationSnapshotRepositoryPort } from '../../calculation/ports/calculation.repository.port';
import { projectRules } from '../../calculation/application/calculation-input.service';
import { CoinRefCache, fetchPrices, seriesCounts } from './price-fetch';
import { PriceHistorySourcesPort } from '../../integrations/rates/price-history/price-history-source.port';
import type { PriceSourceErrorCode } from '../../integrations/rates/price-history/price-history-source.port';
import {
  enabledProviders,
  type KeyedProvider,
  type PriceProviderId,
} from '../domain/price-providers';
import { EstvKurslisteRepositoryPort } from '../ports/estv.port';
import { ProjectRateRepositoryPort } from '../ports/project-rate.repository.port';
import { RefreshProgress, type RefreshStatus } from './refresh-progress';
import { type ContractCoin, ContractCoinResolver } from './contract-coins';
import {
  FxRateSourcePort,
  fxBasesFor,
  UsdPriceSourcePort,
} from '../ports/rate-source.port';
import {
  type EstvApplySummary,
  estvApplies,
  estvAssetsOf,
  EstvProjectRatesService,
} from './estv-project-rates.service';

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** One stored series (kind, asset, currency, source) in the rates overview. */
export interface RateSeries {
  readonly kind: RateKind;
  readonly asset: string;
  readonly currency: string;
  readonly source: ProjectRate['source'];
  readonly points: number;
  readonly from: string;
  readonly to: string;
  /** The rate of this series used for 31.12. (within the tolerance), if any. */
  readonly yearEnd: { readonly date: string; readonly value: string } | null;
  readonly fetchedAt: string;
}

/**
 * F7.4: how one asset of the project is priced — shown per asset in the Kurse tab with
 * "Falscher Kurs? Coin wählen".
 */
export interface AssetPricing {
  readonly asset: string;
  /** `chosen` = the user's coin only; `ambiguous` = ticker of several coins, nothing fetched; `ticker`. */
  readonly pricing: PricePlan['kind'];
  readonly coin: CoinChoice | null;
  /** The built-in CoinGecko id (a suggestion for "Coin wählen"). */
  readonly suggested: string | null;
  /** Sources of the fetched price series that count (`binance`, `coingecko`). */
  readonly sources: readonly string[];
  /** Fetched series that do not count (a by-ticker series of a chosen/ambiguous ticker). */
  readonly ignored: readonly string[];
  /** An override or ESTV value exists. */
  readonly overridden: boolean;
  /** Other relevant coins carry the same ticker (warning or ambiguous), `null` = none / settled. */
  readonly shared: SharedTicker | null;
}

export interface RatesView {
  readonly taxYear: number;
  /** F4.1a: the project's tax currency — overrides and exchange rates are in it. */
  readonly currency: string;
  /** F11.3: whether "Kurse aktualisieren" may go to the internet. */
  readonly online: boolean;
  readonly series: readonly RateSeries[];
  /** F7.4: every priced asset (latest calculation + stored series) and where its price comes from. */
  readonly assets: readonly AssetPricing[];
  /** Overrides and ESTV values, one row each. */
  readonly manual: readonly ProjectRate[];
  /** F7.4a: the stored Kursliste of the tax year and the version this project uses. */
  readonly estv: {
    /** Downloads allowed (`ESTV_AUTO`, `RATES_ONLINE`, the user's F11.3 switch). */
    readonly autoEnabled: boolean;
    /** The stored version's label, `null` when none is stored for the year. */
    readonly available: string | null;
    readonly cryptoCount: number;
    /** The label of the automatic ESTV values in this project, `null` when none. */
    readonly applied: string | null;
    /** A stored version is not applied yet ("Kurse aktualisieren" / "übernehmen"). */
    readonly outdated: boolean;
    /** F4.1a: the Kursliste is in CHF — false for a project in another currency. */
    readonly applicable: boolean;
  };
}

/** The window fetched for a tax year: the 14-day tolerance on both sides, plus the opening date. */
export function fetchWindow(taxYear: number): { from: string; to: string } {
  return { from: `${taxYear - 1}-12-01`, to: `${taxYear + 1}-01-15` };
}

export class GetRatesQuery {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly asset?: string,
  ) {}
}

/** F7.4: the stored rates, summarised per series; one asset's points when `asset` is given. */
@QueryHandler(GetRatesQuery)
export class GetRatesHandler implements IQueryHandler<
  GetRatesQuery,
  RatesView | ProjectRate[]
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly rates: ProjectRateRepositoryPort,
    private readonly settings: SettingsReader,
    private readonly config: ConfigService<Env, true>,
    private readonly estv: EstvKurslisteRepositoryPort,
    private readonly snapshots: CalculationSnapshotRepositoryPort,
    @Optional() private readonly markets?: CoinMarketService,
  ) {}

  async execute({
    userId,
    projectId,
    asset,
  }: GetRatesQuery): Promise<RatesView | ProjectRate[]> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    const all = await this.rates.listByProject(project.id);
    if (asset !== undefined) {
      const upper = asset.toUpperCase();
      return all.filter((r) => r.asset === upper);
    }
    const yearEnd = `${project.taxYear}-12-31`;
    const groups = new Map<string, ProjectRate[]>();
    for (const rate of all) {
      if (rate.source === 'manual' || rate.source === 'estv') continue;
      const key = `${rate.kind}|${rate.asset}|${rate.currency}|${rate.source}`;
      const list = groups.get(key) ?? [];
      list.push(rate);
      groups.set(key, list);
    }
    const series: RateSeries[] = [...groups.values()].map((list) => {
      const first = list[0] as ProjectRate;
      const table = new RateTable(list, first.currency);
      const point =
        first.kind === 'fx'
          ? table.fx(first.asset, yearEnd)
          : table.lookup('price', first.asset, first.currency, yearEnd, 14);
      return {
        kind: first.kind,
        asset: first.asset,
        currency: first.currency,
        source: first.source,
        points: list.length,
        from: list.reduce((m, r) => (r.date < m ? r.date : m), first.date),
        to: list.reduce((m, r) => (r.date > m ? r.date : m), first.date),
        yearEnd: point
          ? { date: point.date, value: point.value.toFixed() }
          : null,
        fetchedAt: list.reduce(
          (m, r) => (r.fetchedAt > m ? r.fetchedAt : m),
          first.fetchedAt,
        ),
      };
    });
    series.sort(
      (a, b) =>
        compareText(a.kind, b.kind) ||
        compareText(a.asset, b.asset) ||
        compareText(a.currency, b.currency) ||
        compareText(a.source, b.source),
    );
    const resolved = await this.settings.resolve(userId);
    const online =
      resolved.onlineRates &&
      this.config.get('RATES_ONLINE', { infer: true }) !== 'false';
    const version = await this.estv.findVersion(project.taxYear);
    const applicable = estvApplies(project);
    const available =
      version && applicable
        ? estvSourceLabel(project.taxYear, version.exportDate)
        : null;
    const applied =
      all.find(
        (r) => r.source === 'estv' && r.note?.startsWith(ESTV_LABEL_PREFIX),
      )?.note ?? null;
    const snapshot = await this.snapshots.latest(project.id);
    const calculated = snapshot
      ? assetsNeedingPrices(
          { ...snapshot.result, records: {} },
          projectRules(project),
        )
      : [];
    const names = [
      ...calculated,
      ...all.filter((r) => r.kind === 'price').map((r) => r.asset),
    ];
    const shared =
      (await this.markets?.shared(
        names,
        resolved.coinChoices,
        resolved.coinDismissed,
      )) ?? new Map<string, SharedTicker>();
    const assets = assetPricing(all, calculated, resolved.coinChoices, shared);
    return {
      taxYear: project.taxYear,
      currency: project.taxCurrency,
      online,
      series,
      assets,
      manual: all.filter((r) => r.source === 'manual' || r.source === 'estv'),
      estv: {
        autoEnabled:
          online && this.config.get('ESTV_AUTO', { infer: true }) !== 'false',
        available,
        cryptoCount: version?.cryptoCount ?? 0,
        applied: applicable ? applied : null,
        outdated: available !== null && available !== applied,
        applicable,
      },
    };
  }
}

/** The pricing of every asset of the calculation and of every stored price series (sorted). */
export function assetPricing(
  rates: readonly ProjectRate[],
  calculated: readonly string[],
  choices: CoinChoices,
  shared: ReadonlyMap<string, SharedTicker> = new Map(),
): AssetPricing[] {
  const marketAmbiguous = new Map(
    [...shared.values()]
      .filter((s) => s.level === 'ambiguous' && s.basis === 'market')
      .map((s) => [s.symbol, s.candidates.map((c) => c.id)] as const),
  );
  const names = new Set(calculated.map((a) => a.toUpperCase()));
  for (const r of rates) if (r.kind === 'price') names.add(r.asset);
  return [...names].sort(compareText).map((asset) => {
    const plan = pricePlan(asset, choices, marketAmbiguous);
    const own = rates.filter((r) => r.kind === 'price' && r.asset === asset);
    const fetched = [
      ...new Set(
        own
          .filter((r) => r.source !== 'manual' && r.source !== 'estv')
          .map((r) => r.source),
      ),
    ].sort(compareText);
    return {
      asset,
      pricing: plan.kind,
      coin: plan.kind === 'chosen' ? plan.choice : null,
      suggested: COINGECKO_IDS[asset] ?? null,
      sources: fetched.filter((s) => seriesCounts(asset, s, choices)),
      ignored: fetched.filter((s) => !seriesCounts(asset, s, choices)),
      overridden: own.some((r) => r.source === 'manual' || r.source === 'estv'),
      shared: shared.get(asset) ?? null,
    };
  });
}

/**
 * `ambiguous`: a ticker of several coins without a chosen coin — no price fetched; `noKey`: the
 * chosen coin's provider needs a key that is not stored.
 */
export type AssetFetchStatus =
  'fetched' | 'cached' | 'notFound' | 'failed' | 'ambiguous' | 'noKey';

/** One asset's outcome of a refresh (project or dashboard). */
export interface AssetFetchResult {
  readonly asset: string;
  readonly status: AssetFetchStatus;
  /** The provider the series came from. */
  readonly source: string | null;
  readonly points: number;
  /**
   * `failed`: the first provider that failed hard and its code (`PriceSourceErrorCode` — the app
   * shows `rates.sourceErrors.<code>`); `null` otherwise.
   */
  readonly error?: {
    readonly provider: PriceProviderId;
    readonly code: PriceSourceErrorCode;
  } | null;
}

export interface RefreshSummary {
  readonly fx: number;
  /** F7.4a: the stored Kursliste, applied first (ESTV wins at 31.12.). */
  readonly estv: EstvApplySummary;
  readonly assets: readonly AssetFetchResult[];
  /** F6: wallet tokens identified by chain + contract in this refresh (stored as coin choices). */
  readonly contracts?: readonly ContractCoin[];
}

type ResolvedRefreshSettings = Awaited<ReturnType<SettingsReader['resolve']>>;

export class RefreshRatesCommand {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    /** Fetch again even when a series is already stored. */
    readonly force: boolean,
    /** Only these assets (no FX) — "Coin wählen" refetches one asset. */
    readonly only?: readonly string[],
  ) {}
}

/**
 * "Kurse aktualisieren" (F7.4): USD and EUR in the project's tax currency T from the ECB (USD/CHF
 * and EUR/CHF for CHF; F4.1a), then a daily price series for every asset the calculation needs a
 * price for, through the user's price providers in order (`price-fetch.ts`, price sources
 * phase 2 — falling back down the list): a coin the user chose → only that provider
 * first, then only providers that see the same coin, never a ticker source; a ticker of several coins without a choice → nothing (status
 * `ambiguous`, its old fetched rows removed); else the enabled providers (default Binance closes,
 * then CoinGecko in T with the key). The ESTV Kursliste is applied first, for CHF projects only. One request at a time per source; a series already
 * stored for the year is not fetched again (cache) unless `force`. Refused when rate lookups
 * are off (F11.3).
 */
@CommandHandler(RefreshRatesCommand)
export class RefreshRatesHandler implements ICommandHandler<
  RefreshRatesCommand,
  RefreshSummary
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly rates: ProjectRateRepositoryPort,
    private readonly inputs: CalculationInputService,
    private readonly settings: SettingsReader,
    private readonly usd: UsdPriceSourcePort,
    private readonly history: PriceHistorySourcesPort,
    private readonly fx: FxRateSourcePort,
    private readonly config: ConfigService<Env, true>,
    private readonly progress: RefreshProgress,
    private readonly estv: EstvProjectRatesService,
    @Optional() private readonly notifications?: NotificationService,
    @Optional() private readonly markets?: CoinMarketService,
    @Optional() private readonly contractCoins?: ContractCoinResolver,
  ) {}

  /** Coin lookups (symbol search, contract) of the providers, kept a day across refreshes. */
  private readonly coinRefs = new CoinRefCache();

  /**
   * F7.4 + F6: tickers worth identifying by a wallet contract — ambiguous ones (no price
   * otherwise) and, with a CoinGecko key (the chosen coin is priced there), shared ones.
   */
  private async identifyByContract(
    project: Project,
    assets: readonly string[],
    settings: ResolvedRefreshSettings,
    marketAmbiguous: ReadonlyMap<string, readonly string[]>,
  ): Promise<ContractCoin[]> {
    if (!this.contractCoins) return [];
    const choices = settings.coinChoices;
    const shared =
      (await this.markets?.shared(assets, choices, settings.coinDismissed)) ??
      new Map<string, SharedTicker>();
    const wanted = assets.filter((asset) => {
      const plan = pricePlan(asset, choices, marketAmbiguous);
      if (plan.kind === 'chosen') return false;
      if (plan.kind === 'ambiguous') return true;
      return (
        shared.get(asset)?.level === 'warning' &&
        settings.keys.coingecko !== undefined
      );
    });
    return this.contractCoins.resolve(project, wanted, settings.keys.coingecko);
  }

  async execute({
    userId,
    projectId,
    force,
    only,
  }: RefreshRatesCommand): Promise<RefreshSummary> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    assertProjectOpen(project);
    let settings: ResolvedRefreshSettings = await this.settings.resolve(userId);
    if (
      !settings.onlineRates ||
      this.config.get('RATES_ONLINE', { infer: true }) === 'false'
    ) {
      throw conflict(
        'offline',
        'Rate lookups on the internet are switched off (settings)',
      );
    }
    const assembled = await this.inputs.build(project);
    const calculated = calculate(assembled.input);
    const assets = only
      ? [...new Set(only.map((a) => a.toUpperCase()))].sort()
      : assetsNeedingPrices(calculated, assembled.input.rules);
    // F7.4: the market list (at most daily) — tickers without a clear leader get no by-ticker price.
    await this.markets?.refreshBriefly(settings.keys.coingecko);
    let marketAmbiguous =
      (await this.markets?.marketAmbiguous(assets, settings.coinChoices)) ??
      new Map<string, readonly string[]>();
    // F6: a wallet token of an ambiguous/shared ticker is identified by its contract (stored as
    // the user's coin), before ESTV and prices — both then follow that coin.
    const contracts = only
      ? []
      : await this.identifyByContract(
          project,
          assets,
          settings,
          marketAmbiguous,
        );
    if (contracts.length > 0) {
      settings = {
        ...settings,
        coinChoices: {
          ...settings.coinChoices,
          ...Object.fromEntries(contracts.map((c) => [c.asset, c.choice])),
        },
      };
      marketAmbiguous =
        (await this.markets?.marketAmbiguous(assets, settings.coinChoices)) ??
        new Map<string, readonly string[]>();
    }
    const estv = await this.estv.apply(project, {
      assets: estvAssetsOf(calculated, assembled.input.rules),
      coinChoices: settings.coinChoices,
      marketAmbiguous: [...marketAmbiguous.keys()],
    });
    const stored = await this.rates.listByProject(project.id);
    this.progress.start(
      project.id,
      assets.length + (only ? 0 : fxBasesFor(project.taxCurrency).length),
    );
    const keyUse: KeyUse = { accepted: new Set(), rejected: new Set() };
    const leaders =
      (await this.markets?.leaders(assets)) ?? new Map<string, string>();
    try {
      const summary = {
        ...(await this.fetchAll(
          project,
          assets,
          stored,
          force,
          settings,
          keyUse,
          only !== undefined,
          marketAmbiguous,
          leaders,
        )),
        estv,
        contracts,
      };
      // One asset (Coin wählen) says nothing about the others' failures.
      if (!only) await this.notify(userId, project.id, summary, keyUse);
      return summary;
    } finally {
      this.progress.finish(project.id);
    }
  }

  /**
   * F11.12: assets whose lookup failed → one error per project (which assets, "Erneut
   * versuchen"); a keyed provider's 401/403 (CoinGecko, CoinMarketCap) → "Schlüssel prüfen" per
   * provider. A clean refresh resolves them.
   */
  private async notify(
    userId: string,
    projectId: string,
    summary: RefreshSummary,
    keyUse: KeyUse,
  ): Promise<void> {
    if (!this.notifications) return;
    const failed = summary.assets.filter((a) => a.status === 'failed');
    const first = failed.find((a) => a.error)?.error;
    await this.notifications.toggle(
      userId,
      Topics.ratesFetchFailed(projectId),
      failed.length > 0,
      {
        kind: 'error',
        projectId,
        params: {
          assets: failed.slice(0, 10).map((a) => a.asset),
          count: failed.length,
          ...(first
            ? { provider: first.provider, priceError: first.code }
            : {}),
        },
        action: projectRoute(projectId, 'notifications.action.retry', 'rates', {
          named: 'retry:rates',
        }),
      },
    );
    await notifyKeys(this.notifications, userId, keyUse);
  }

  private async fetchAll(
    project: RefreshProject,
    assets: readonly string[],
    stored: readonly ProjectRate[],
    force: boolean,
    settings: Awaited<ReturnType<SettingsReader['resolve']>>,
    keyUse: KeyUse,
    skipFx = false,
    marketAmbiguous: ReadonlyMap<string, readonly string[]> = new Map(),
    leaders: ReadonlyMap<string, string> = new Map(),
  ): Promise<Omit<RefreshSummary, 'estv'>> {
    const { from, to } = fetchWindow(project.taxYear);
    const quote = project.taxCurrency;
    let fx = 0;
    for (const base of skipFx ? [] : fxBasesFor(quote)) {
      this.progress.working(project.id, base);
      await this.devDelay();
      if (force || !covered(stored, 'fx', base, project.taxYear, [quote])) {
        const entries = await this.fx
          .daily(base, quote, from, to)
          .catch(() => []);
        fx += await this.rates.upsertMany(project.id, entries);
      }
      this.progress.step(project.id);
    }

    const results: RefreshSummary['assets'][number][] = [];
    for (const asset of assets) {
      this.progress.working(project.id, asset);
      await this.devDelay();
      results.push(
        await this.fetchAsset(
          project,
          asset,
          stored,
          force,
          settings,
          keyUse,
          marketAmbiguous,
          leaders.get(asset) ?? null,
        ),
      );
      this.progress.step(project.id);
    }
    return { fx, assets: results };
  }

  /** `RATES_DEV_DELAY_MS` (development only, validated in env.ts): makes the progress visible. */
  private async devDelay(): Promise<void> {
    const ms = this.config.get('RATES_DEV_DELAY_MS', { infer: true });
    if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async fetchAsset(
    project: RefreshProject,
    asset: string,
    stored: readonly ProjectRate[],
    force: boolean,
    settings: Awaited<ReturnType<SettingsReader['resolve']>>,
    keyUse: KeyUse,
    marketAmbiguous: ReadonlyMap<string, readonly string[]>,
    marketLeader: string | null,
  ): Promise<RefreshSummary['assets'][number]> {
    const { from, to } = fetchWindow(project.taxYear);
    const usable = ['USD', project.taxCurrency];
    const choices = settings.coinChoices;
    const plan = pricePlan(asset, choices, marketAmbiguous);
    if (plan.kind === 'ambiguous') {
      // Never a by-ticker price for a ticker of several coins: a series fetched before the rule
      // (Binance) is removed so nothing silently prices the asset; the user chooses the coin.
      await this.rates.deleteFetchedPrices(project.id, asset);
      return { asset, status: 'ambiguous', source: null, points: 0 };
    }
    const counting = stored.filter((r) =>
      seriesCounts(asset, r.source, choices, marketAmbiguous),
    );
    if (!force && covered(counting, 'price', asset, project.taxYear, usable)) {
      return { asset, status: 'cached', source: null, points: 0 };
    }
    const found = await fetchPrices(
      { usd: this.usd, history: this.history, coins: this.coinRefs },
      {
        asset,
        from,
        to,
        currency: project.taxCurrency,
        choices,
        keys: priceKeys(settings),
        providers: enabledProviders(settings.priceSources),
        marketAmbiguous,
        marketLeader,
      },
    );
    recordKeys(keyUse, found);
    if (found.status !== 'failed' && plan.kind === 'chosen') {
      // The chosen coin replaces whatever was fetched by ticker before (F7.4).
      await this.rates.deleteFetchedPrices(project.id, asset);
    }
    await this.rates.upsertMany(project.id, found.entries);
    return {
      asset,
      status: found.status,
      source: found.source,
      points: found.entries.length,
      ...(found.error ? { error: found.error } : {}),
    };
  }
}

/** Which keyed providers accepted or refused the user's key during one refresh. */
export interface KeyUse {
  readonly accepted: Set<KeyedProvider>;
  readonly rejected: Set<KeyedProvider>;
}

/** The user's opened keys the price providers take (never returned, never logged). */
export function priceKeys(
  settings: Pick<ResolvedRefreshSettings, 'keys'>,
): Partial<Record<KeyedProvider, string>> {
  return {
    ...(settings.keys.coingecko ? { coingecko: settings.keys.coingecko } : {}),
    ...(settings.keys.coinmarketcap
      ? { coinmarketcap: settings.keys.coinmarketcap }
      : {}),
  };
}

export function recordKeys(
  keyUse: KeyUse,
  found: {
    readonly keysAccepted: readonly KeyedProvider[];
    readonly keysRejected: readonly KeyedProvider[];
  },
): void {
  for (const p of found.keysAccepted) keyUse.accepted.add(p);
  for (const p of found.keysRejected) keyUse.rejected.add(p);
}

/**
 * F11.12 `key.invalid:<provider>`: a provider that refused the user's key in this refresh →
 * "Schlüssel prüfen" (Einstellungen › Kurse); one that accepted it (and never refused) → resolved.
 */
export async function notifyKeys(
  notifications: NotificationService,
  userId: string,
  keyUse: KeyUse,
): Promise<void> {
  for (const provider of [...keyUse.rejected].sort()) {
    await notifications.raise(userId, Topics.keyInvalid(provider), {
      kind: 'action',
      params: { service: provider },
      action: {
        labelKey: 'notifications.action.checkKey',
        route: '/app/settings/rates',
      },
    });
  }
  for (const provider of [...keyUse.accepted].sort()) {
    if (keyUse.rejected.has(provider)) continue;
    await notifications.resolve(userId, Topics.keyInvalid(provider));
  }
}

export class GetRefreshStatusQuery {
  constructor(
    readonly userId: string,
    readonly projectId: string,
  ) {}
}

/** How far a running refresh of my project is (polled by the app only while it runs). */
@QueryHandler(GetRefreshStatusQuery)
export class GetRefreshStatusHandler implements IQueryHandler<
  GetRefreshStatusQuery,
  RefreshStatus
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly progress: RefreshProgress,
  ) {}

  async execute({
    userId,
    projectId,
  }: GetRefreshStatusQuery): Promise<RefreshStatus> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    return this.progress.of(project.id);
  }
}

/** What a refresh needs of the project. */
type RefreshProject = Pick<Project, 'id' | 'taxYear' | 'taxCurrency'>;

/**
 * A stored series covers the year when it has a point near both ends (the 14-day tolerance).
 * Only series in `currencies` count — after a change of the tax currency (F4.1a) the rates in the
 * old one do not help.
 */
function covered(
  stored: readonly ProjectRate[],
  kind: RateKind,
  asset: string,
  taxYear: number,
  currencies: readonly string[],
): boolean {
  const fetched = stored.filter(
    (r) =>
      r.kind === kind &&
      r.asset === asset &&
      currencies.includes(r.currency) &&
      r.source !== 'manual' &&
      r.source !== 'estv',
  );
  return (
    fetched.some((r) => r.date <= `${taxYear}-01-14`) &&
    fetched.some((r) => r.date >= `${taxYear}-12-17`)
  );
}

export interface ManualRateInput {
  readonly kind: RateKind;
  readonly asset: string;
  /** The tax currency, or USD for a USD price. */
  readonly currency: string;
  readonly date: string;
  readonly value: string;
}

export class SetManualRateCommand {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly rate: ManualRateInput,
  ) {}
}

/**
 * F7.4: override a rate for one day (e.g. the ESTV value of USD/CHF at 31.12.). Prices are in the
 * project's tax currency or in USD, exchange rates in the tax currency (F4.1a).
 */
@CommandHandler(SetManualRateCommand)
export class SetManualRateHandler implements ICommandHandler<
  SetManualRateCommand,
  RateEntry
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly rates: ProjectRateRepositoryPort,
  ) {}

  async execute({
    userId,
    projectId,
    rate,
  }: SetManualRateCommand): Promise<RateEntry> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    assertProjectOpen(project);
    const value = tryParseDecimal(rate.value);
    if (!value || value.isNegative() || value.isZero()) {
      throw new BadRequestException('value must be a positive decimal');
    }
    const currency = rate.currency.toUpperCase();
    if (currency !== project.taxCurrency && currency !== 'USD') {
      throw new BadRequestException(
        `prices are in ${project.taxCurrency} or USD`,
      );
    }
    if (rate.kind === 'fx' && currency !== project.taxCurrency) {
      throw new BadRequestException(
        `exchange rates are in ${project.taxCurrency}`,
      );
    }
    const entry: RateEntry = {
      kind: rate.kind,
      asset: rate.asset.trim().toUpperCase(),
      currency,
      date: rate.date,
      value: value.toFixed(),
      source: 'manual',
    };
    await this.rates.upsertMany(project.id, [entry]);
    return entry;
  }
}

export class DeleteManualRateCommand {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly key: Omit<RateKey, 'source'> & {
      readonly source: 'manual' | 'estv';
    },
  ) {}
}

@CommandHandler(DeleteManualRateCommand)
export class DeleteManualRateHandler implements ICommandHandler<
  DeleteManualRateCommand,
  void
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly rates: ProjectRateRepositoryPort,
  ) {}

  async execute({
    userId,
    projectId,
    key,
  }: DeleteManualRateCommand): Promise<void> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    assertProjectOpen(project);
    const removed = await this.rates.delete(project.id, {
      ...key,
      asset: key.asset.toUpperCase(),
    });
    if (!removed) throw new NotFoundException('No such rate');
  }
}

export class ImportKurslisteCommand {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly content: string,
  ) {}
}

/** The ESTV Kursliste the user downloaded (XML or the documented CSV), as `estv` rates. */
@CommandHandler(ImportKurslisteCommand)
export class ImportKurslisteHandler implements ICommandHandler<
  ImportKurslisteCommand,
  { imported: number; skipped: number }
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly rates: ProjectRateRepositoryPort,
  ) {}

  async execute({
    userId,
    projectId,
    content,
  }: ImportKurslisteCommand): Promise<{ imported: number; skipped: number }> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    assertProjectOpen(project);
    const { entries, skipped } = parseKursliste(content, project.taxYear);
    if (entries.length === 0) {
      throw new BadRequestException('No rate found in the Kursliste');
    }
    await this.rates.upsertMany(project.id, entries);
    return { imported: entries.length, skipped };
  }
}
