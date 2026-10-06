import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
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
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import { SettingsReader } from '../../settings/application/settings.handlers';
import { ESTV_LABEL_PREFIX, estvSourceLabel } from '../domain/estv';
import {
  COINGECKO_IDS,
  type ProjectRate,
  RATE_ALIASES,
  type RateKey,
} from '../domain/project-rate';
import { EstvKurslisteRepositoryPort } from '../ports/estv.port';
import { ProjectRateRepositoryPort } from '../ports/project-rate.repository.port';
import { RefreshProgress, type RefreshStatus } from './refresh-progress';
import {
  ChfPriceSourcePort,
  FxRateSourcePort,
  UsdPriceSourcePort,
} from '../ports/rate-source.port';
import {
  type EstvApplySummary,
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
  readonly currency: 'CHF' | 'USD';
  readonly source: ProjectRate['source'];
  readonly points: number;
  readonly from: string;
  readonly to: string;
  /** The rate of this series used for 31.12. (within the tolerance), if any. */
  readonly yearEnd: { readonly date: string; readonly value: string } | null;
  readonly fetchedAt: string;
}

export interface RatesView {
  readonly taxYear: number;
  /** F11.3: whether "Kurse aktualisieren" may go to the internet. */
  readonly online: boolean;
  readonly series: readonly RateSeries[];
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
      const table = new RateTable(list);
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
    const available = version
      ? estvSourceLabel(project.taxYear, version.exportDate)
      : null;
    const applied =
      all.find(
        (r) => r.source === 'estv' && r.note?.startsWith(ESTV_LABEL_PREFIX),
      )?.note ?? null;
    return {
      taxYear: project.taxYear,
      online,
      series,
      manual: all.filter((r) => r.source === 'manual' || r.source === 'estv'),
      estv: {
        autoEnabled:
          online && this.config.get('ESTV_AUTO', { infer: true }) !== 'false',
        available,
        cryptoCount: version?.cryptoCount ?? 0,
        applied,
        outdated: available !== null && available !== applied,
      },
    };
  }
}

export type AssetFetchStatus = 'fetched' | 'cached' | 'notFound' | 'failed';

export interface RefreshSummary {
  readonly fx: number;
  /** F7.4a: the stored Kursliste, applied first (ESTV wins at 31.12.). */
  readonly estv: EstvApplySummary;
  readonly assets: readonly {
    readonly asset: string;
    readonly status: AssetFetchStatus;
    readonly source: string | null;
    readonly points: number;
  }[];
}

export class RefreshRatesCommand {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    /** Fetch again even when a series is already stored. */
    readonly force: boolean,
  ) {}
}

/**
 * "Kurse aktualisieren" (F7.4): USD/CHF and EUR/CHF from the ECB, then a daily price series for
 * every asset the calculation needs a price for — Binance closes first (no key), CoinGecko CHF
 * when Binance has none and a key is stored. One request at a time per source; a series already
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
    private readonly chf: ChfPriceSourcePort,
    private readonly fx: FxRateSourcePort,
    private readonly config: ConfigService<Env, true>,
    private readonly progress: RefreshProgress,
    private readonly estv: EstvProjectRatesService,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  async execute({
    userId,
    projectId,
    force,
  }: RefreshRatesCommand): Promise<RefreshSummary> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    assertProjectOpen(project);
    const settings = await this.settings.resolve(userId);
    if (
      !settings.onlineRates ||
      this.config.get('RATES_ONLINE', { infer: true }) === 'false'
    ) {
      throw new ConflictException(
        'Rate lookups on the internet are switched off (settings)',
      );
    }
    const assembled = await this.inputs.build(project);
    const calculated = calculate(assembled.input);
    const assets = assetsNeedingPrices(calculated, assembled.input.rules);
    const estv = await this.estv.apply(project, {
      assets: estvAssetsOf(calculated, assembled.input.rules),
      coingeckoIds: settings.coingeckoIds,
    });
    const stored = await this.rates.listByProject(project.id);
    this.progress.start(project.id, assets.length + 2);
    const keyUse: KeyUse = { accepted: false, rejected: false };
    try {
      const summary = {
        ...(await this.fetchAll(
          project,
          assets,
          stored,
          force,
          settings,
          keyUse,
        )),
        estv,
      };
      await this.notify(userId, project.id, summary, keyUse);
      return summary;
    } finally {
      this.progress.finish(project.id);
    }
  }

  /**
   * F11.12: assets whose lookup failed → one error per project (which assets, "Erneut
   * versuchen"); a CoinGecko 401/403 → "Schlüssel prüfen". A clean refresh resolves both.
   */
  private async notify(
    userId: string,
    projectId: string,
    summary: RefreshSummary,
    keyUse: KeyUse,
  ): Promise<void> {
    if (!this.notifications) return;
    const failed = summary.assets
      .filter((a) => a.status === 'failed')
      .map((a) => a.asset);
    await this.notifications.toggle(
      userId,
      Topics.ratesFetchFailed(projectId),
      failed.length > 0,
      {
        kind: 'error',
        projectId,
        params: { assets: failed.slice(0, 10), count: failed.length },
        action: projectRoute(projectId, 'notifications.action.retry', 'rates', {
          named: 'retry:rates',
        }),
      },
    );
    if (keyUse.rejected) {
      await this.notifications.raise(userId, Topics.keyInvalid('coingecko'), {
        kind: 'action',
        params: { service: 'CoinGecko' },
        action: {
          labelKey: 'notifications.action.checkKey',
          route: '/app/settings/rates',
        },
      });
    } else if (keyUse.accepted) {
      await this.notifications.resolve(userId, Topics.keyInvalid('coingecko'));
    }
  }

  private async fetchAll(
    project: { readonly id: string; readonly taxYear: number },
    assets: readonly string[],
    stored: readonly ProjectRate[],
    force: boolean,
    settings: Awaited<ReturnType<SettingsReader['resolve']>>,
    keyUse: KeyUse,
  ): Promise<Omit<RefreshSummary, 'estv'>> {
    const { from, to } = fetchWindow(project.taxYear);
    let fx = 0;
    for (const base of ['USD', 'EUR'] as const) {
      this.progress.working(project.id, base);
      await this.devDelay();
      if (force || !covered(stored, 'fx', base, project.taxYear)) {
        const entries = await this.fx.dailyChf(base, from, to).catch(() => []);
        fx += await this.rates.upsertMany(project.id, entries);
      }
      this.progress.step(project.id);
    }

    const results: RefreshSummary['assets'][number][] = [];
    for (const asset of assets) {
      this.progress.working(project.id, asset);
      await this.devDelay();
      results.push(
        await this.fetchAsset(project, asset, stored, force, settings, keyUse),
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
    project: { readonly id: string; readonly taxYear: number },
    asset: string,
    stored: readonly ProjectRate[],
    force: boolean,
    settings: Awaited<ReturnType<SettingsReader['resolve']>>,
    keyUse: KeyUse,
  ): Promise<RefreshSummary['assets'][number]> {
    const { from, to } = fetchWindow(project.taxYear);
    if (!force && covered(stored, 'price', asset, project.taxYear)) {
      return { asset, status: 'cached', source: null, points: 0 };
    }
    let keyed = false;
    try {
      const symbols = [asset, ...(RATE_ALIASES[asset] ?? [])];
      let entries: RateEntry[] = [];
      let source: string | null = null;
      for (const symbol of symbols) {
        const found = await this.usd.dailyUsd({ asset, symbol, from, to });
        entries = mergeByDate(entries, found);
      }
      if (entries.length > 0) source = this.usd.name;
      const coinId = settings.coingeckoIds[asset] ?? COINGECKO_IDS[asset];
      const apiKey = settings.keys.coingecko;
      if (entries.length === 0 && coinId && apiKey) {
        keyed = true;
        entries = await this.chf.dailyChf({
          asset,
          symbol: asset,
          from,
          to,
          coinId,
          apiKey,
        });
        if (entries.length > 0) source = this.chf.name;
        keyUse.accepted = true;
      }
      await this.rates.upsertMany(project.id, entries);
      return {
        asset,
        status: entries.length > 0 ? 'fetched' : 'notFound',
        source,
        points: entries.length,
      };
    } catch (error) {
      if (keyed && isAuthFailure(error)) keyUse.rejected = true;
      return { asset, status: 'failed', source: null, points: 0 };
    }
  }
}

/** Whether a keyed source accepted or refused the user's key during one refresh. */
interface KeyUse {
  accepted: boolean;
  rejected: boolean;
}

/** A source's 401/403 (`RateSourceError.status`): the key is invalid or expired. */
function isAuthFailure(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 401 || status === 403;
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

/** A stored series covers the year when it has a point near both ends (the 14-day tolerance). */
function covered(
  stored: readonly ProjectRate[],
  kind: RateKind,
  asset: string,
  taxYear: number,
): boolean {
  const fetched = stored.filter(
    (r) =>
      r.kind === kind &&
      r.asset === asset &&
      r.source !== 'manual' &&
      r.source !== 'estv',
  );
  return (
    fetched.some((r) => r.date <= `${taxYear}-01-14`) &&
    fetched.some((r) => r.date >= `${taxYear}-12-17`)
  );
}

/** Earlier symbols win per day (an asset's own name before its alias). */
function mergeByDate(
  existing: readonly RateEntry[],
  more: readonly RateEntry[],
): RateEntry[] {
  const dates = new Set(existing.map((e) => e.date));
  return [...existing, ...more.filter((e) => !dates.has(e.date))];
}

export interface ManualRateInput {
  readonly kind: RateKind;
  readonly asset: string;
  readonly currency: 'CHF' | 'USD';
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

/** F7.4: override a rate for one day (e.g. the ESTV value of USD/CHF at 31.12.). */
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
    if (rate.kind === 'fx' && rate.currency !== 'CHF') {
      throw new BadRequestException('exchange rates are in CHF');
    }
    const entry: RateEntry = {
      kind: rate.kind,
      asset: rate.asset.trim().toUpperCase(),
      currency: rate.currency,
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
