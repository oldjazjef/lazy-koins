import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { conflict } from '../../common/http/api-errors';
import { ConfigService } from '@nestjs/config';
import {
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import {
  bookingSummary,
  CORRECTION_SOURCE_PREFIX,
  dashboard,
  type DashboardResult,
  isKpiKind,
  type KpiKind,
  type RateEntry,
  RateTable,
  type RecordSummary,
} from '@lazykoins/engine';
import type { Env } from '../../config/env';
import { fetchPrices, seriesCounts } from '../../rates/application/price-fetch';
import { CoinMarketService } from '../../rates/application/coin-market.service';
import {
  type CoinChoice,
  type PricePlan,
  pricePlan,
  type SharedTicker,
} from '../../rates/domain/coin-choice';
import {
  FiatPriceSourcePort,
  FxRateSourcePort,
  fxBasesFor,
  UsdPriceSourcePort,
} from '../../rates/ports/rate-source.port';
import { SettingsReader } from '../../settings/application/settings.handlers';
import { UserRateRepositoryPort } from '../ports/user-rate.repository.port';
import {
  type DashboardFileRef,
  DashboardInputService,
} from './dashboard-input.service';

/** At most this many days per dashboard period (10 years). */
export const MAX_PERIOD_DAYS = 3660;
const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A valid period, or 400. */
export function checkPeriod(from: string, to: string): void {
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    throw new BadRequestException('from/to must be ISO dates (YYYY-MM-DD)');
  }
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) {
    throw new BadRequestException('from must be on or before to');
  }
  if ((b - a) / DAY_MS > MAX_PERIOD_DAYS) {
    throw new BadRequestException(
      `The period may span at most ${MAX_PERIOD_DAYS} days`,
    );
  }
}

/** A holding with how its price is looked up (F7.4). */
export type DashboardViewHolding = DashboardResult['holdings'][number] & {
  /** `chosen` = the user's coin, `ambiguous` = ticker of several coins (no price), `ticker`. */
  readonly pricing: PricePlan['kind'];
  readonly coin: CoinChoice | null;
  /** Other relevant coins carry the same ticker ("Kürzel wird von mehreren Coins verwendet"). */
  readonly shared: SharedTicker | null;
};

export interface DashboardView extends Omit<DashboardResult, 'holdings'> {
  readonly holdings: readonly DashboardViewHolding[];
  /** The user's projects (newest tax year first) — the quick picks of the period picker. */
  readonly projects: readonly {
    readonly id: string;
    readonly name: string;
    readonly taxYear: number;
  }[];
  /** F11.3: whether "Kurse aktualisieren" may go to the internet. */
  readonly online: boolean;
  /**
   * F4.1a: every tax currency among the user's projects; with more than one, the dashboard shows
   * one at a time (`currency`) — never a sum across currencies.
   */
  readonly currencies: readonly string[];
  /** Files that could not be read this time (counted only). */
  readonly unreadable: number;
}

export interface DashboardRecord extends RecordSummary {
  readonly projectId: string | null;
  readonly projectFileId: string | null;
  readonly fileName: string | null;
  readonly correctionId: string | null;
}

export interface DashboardRecords {
  readonly figureId: string;
  readonly total: number;
  readonly records: readonly DashboardRecord[];
}

interface Cached {
  readonly view: Omit<DashboardView, 'online' | 'holdings'> &
    Pick<DashboardResult, 'holdings'>;
  readonly summaries: ReadonlyMap<string, RecordSummary>;
  readonly fileRefs: ReadonlyMap<string, DashboardFileRef>;
}

/**
 * The computed dashboards, per user and input hash (files, mappings, corrections, rates,
 * period, engine version): same hash, same answer — the files are not read again. In memory, a
 * handful of entries (one API instance per database file, CLAUDE.md).
 */
@Injectable()
export class DashboardCache {
  private readonly entries = new Map<string, Cached>();
  private static readonly MAX = 16;

  get(key: string): Cached | undefined {
    const found = this.entries.get(key);
    if (found) {
      this.entries.delete(key);
      this.entries.set(key, found);
    }
    return found;
  }

  set(key: string, value: Cached): void {
    this.entries.set(key, value);
    while (this.entries.size > DashboardCache.MAX) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

/** Computes (or takes from the cache) the dashboard of a period. */
@Injectable()
export class DashboardCalculator {
  constructor(
    private readonly inputs: DashboardInputService,
    private readonly cache: DashboardCache,
  ) {}

  async compute(
    userId: string,
    from: string,
    to: string,
    projectId?: string,
    currency?: string,
  ): Promise<Cached> {
    checkPeriod(from, to);
    const sources = await this.inputs.sources(userId, projectId, currency);
    const key = `${userId}|${this.inputs.hash(sources, from, to)}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const records = await this.inputs.records(sources);
    const result = dashboard({
      rules: records.rules,
      bookings: records.bookings,
      holdings: records.holdings,
      corrections: records.corrections,
      rates: records.rates,
      from,
      to,
    });
    const wanted = new Set(result.kpis.flatMap((k) => k.recordIds));
    const summaries = new Map<string, RecordSummary>();
    for (const booking of records.bookings) {
      if (wanted.has(booking.id) && !summaries.has(booking.id))
        summaries.set(booking.id, bookingSummary(booking));
    }
    for (const c of records.corrections) {
      // Manual bookings are created by the engine; summarise them from the correction.
      const id = `${CORRECTION_SOURCE_PREFIX}${c.id}`;
      if (!wanted.has(id) || c.data.type !== 'manual_booking') continue;
      const b = c.data.booking;
      summaries.set(id, {
        id,
        type: 'booking',
        sourceFileId: id,
        row: 0,
        platform: b.platform,
        accountId: b.accountId,
        asset: b.asset,
        quantity: b.quantity,
        at: b.timestamp,
        kind: b.kind,
        fee: b.fee ?? null,
        feeAsset: b.fee ? (b.feeAsset ?? b.asset) : null,
        rawType: 'manual',
        raw: null,
      });
    }
    const entry: Cached = {
      view: {
        ...result,
        projects: sources.projects.map((p) => ({
          id: p.id,
          name: p.name,
          taxYear: p.taxYear,
        })),
        currencies: sources.currencies,
        unreadable: records.unreadable,
      },
      summaries,
      fileRefs: records.fileRefs,
    };
    this.cache.set(key, entry);
    return entry;
  }
}

function onlineAllowed(
  settings: { onlineRates: boolean },
  config: ConfigService<Env, true>,
): boolean {
  return (
    settings.onlineRates &&
    config.get('RATES_ONLINE', { infer: true }) !== 'false'
  );
}

// --- GET /dashboard ---

export class GetDashboardQuery {
  constructor(
    readonly userId: string,
    readonly from: string,
    readonly to: string,
    /** Only this project (the card on the project detail). */
    readonly projectId?: string,
    /** F4.1a: the tax currency to show (absent = the newest project's). */
    readonly currency?: string,
  ) {}
}

@QueryHandler(GetDashboardQuery)
export class GetDashboardHandler implements IQueryHandler<
  GetDashboardQuery,
  DashboardView
> {
  constructor(
    private readonly calculator: DashboardCalculator,
    private readonly settings: SettingsReader,
    private readonly config: ConfigService<Env, true>,
    @Optional() private readonly markets?: CoinMarketService,
  ) {}

  async execute({
    userId,
    from,
    to,
    projectId,
    currency,
  }: GetDashboardQuery): Promise<DashboardView> {
    const { view } = await this.calculator.compute(
      userId,
      from,
      to,
      projectId,
      currency,
    );
    const settings = await this.settings.resolve(userId);
    // F7.4: per holding how its price is looked up (chosen coin, ambiguous ticker, by ticker) —
    // the app shows the source and offers "Falscher Kurs? Coin wählen".
    const shared =
      (await this.markets?.shared(
        view.holdings.map((h) => h.asset),
        settings.coinChoices,
        settings.coinDismissed,
      )) ?? new Map<string, SharedTicker>();
    const holdings = view.holdings.map((h) => {
      const found = shared.get(h.asset) ?? null;
      const plan = pricePlan(
        h.asset,
        settings.coinChoices,
        found?.level === 'ambiguous' && found.basis === 'market'
          ? new Map([[found.symbol, found.candidates.map((c) => c.id)]])
          : undefined,
      );
      return {
        ...h,
        pricing: plan.kind,
        coin: plan.kind === 'chosen' ? plan.choice : null,
        shared: found,
      };
    });
    return { ...view, holdings, online: onlineAllowed(settings, this.config) };
  }
}

// --- GET /dashboard/records (F11.6 → F7.5) ---

export class GetDashboardRecordsQuery {
  constructor(
    readonly userId: string,
    readonly from: string,
    readonly to: string,
    readonly kpi: string,
    readonly projectId?: string,
    readonly currency?: string,
  ) {}
}

const MAX_RECORDS = 2000;

@QueryHandler(GetDashboardRecordsQuery)
export class GetDashboardRecordsHandler implements IQueryHandler<
  GetDashboardRecordsQuery,
  DashboardRecords
> {
  constructor(private readonly calculator: DashboardCalculator) {}

  async execute({
    userId,
    from,
    to,
    kpi,
    projectId,
    currency,
  }: GetDashboardRecordsQuery): Promise<DashboardRecords> {
    if (!isKpiKind(kpi)) throw new BadRequestException('Unknown figure');
    const cached = await this.calculator.compute(
      userId,
      from,
      to,
      projectId,
      currency,
    );
    const figure = cached.view.kpis.find((k) => k.kind === (kpi as KpiKind));
    const ids = figure?.recordIds ?? [];
    const records: DashboardRecord[] = [];
    for (const id of ids.slice(0, MAX_RECORDS)) {
      const summary = cached.summaries.get(id);
      if (!summary) continue;
      const file = cached.fileRefs.get(summary.sourceFileId);
      records.push({
        ...summary,
        projectId: file?.projectId ?? null,
        projectFileId: file?.projectFileId ?? null,
        fileName: file?.displayName ?? null,
        correctionId: summary.sourceFileId.startsWith(CORRECTION_SOURCE_PREFIX)
          ? summary.sourceFileId.slice(CORRECTION_SOURCE_PREFIX.length)
          : null,
      });
    }
    return { figureId: `kpi:${kpi}`, total: ids.length, records };
  }
}

// --- POST /dashboard/rates/refresh ---

/** As a project's refresh (`AssetFetchStatus`): `ambiguous` = no coin chosen, `noKey` = key needed. */
export type DashboardFetchStatus =
  'fetched' | 'cached' | 'notFound' | 'failed' | 'ambiguous' | 'noKey';

export interface DashboardRefreshSummary {
  readonly fx: number;
  readonly assets: readonly {
    readonly asset: string;
    readonly status: DashboardFetchStatus;
    readonly source: string | null;
    readonly points: number;
  }[];
}

export class RefreshDashboardRatesCommand {
  constructor(
    readonly userId: string,
    readonly from: string,
    readonly to: string,
    /** The assets to fetch now (the app asks one at a time to show progress); empty = FX only. */
    readonly assets: readonly string[],
    readonly force: boolean,
    /** F4.1a: the tax currency shown (absent = the newest project's). */
    readonly currency?: string,
  ) {}
}

/**
 * "Kurse aktualisieren" on the dashboard (F11.4, F11.9): fetches the daily series missing for
 * the shown period into the user's rate cache — USD and EUR in the shown tax currency T from the
 * ECB (USD/CHF, EUR/CHF for CHF; F4.1a), then Binance USD closes, CoinGecko in T as the fallback
 * with the user's key. A series that already covers the
 * period (project rates or cache, within the 14-day tolerance at both ends) is skipped unless
 * `force`. Refused (409) when rate lookups are off (F11.3); the sources are serialised.
 */
@CommandHandler(RefreshDashboardRatesCommand)
export class RefreshDashboardRatesHandler implements ICommandHandler<
  RefreshDashboardRatesCommand,
  DashboardRefreshSummary
> {
  constructor(
    private readonly inputs: DashboardInputService,
    private readonly userRates: UserRateRepositoryPort,
    private readonly settings: SettingsReader,
    private readonly usd: UsdPriceSourcePort,
    private readonly fiat: FiatPriceSourcePort,
    private readonly fx: FxRateSourcePort,
    private readonly config: ConfigService<Env, true>,
    @Optional() private readonly markets?: CoinMarketService,
  ) {}

  async execute({
    userId,
    from,
    to,
    assets,
    force,
    currency,
  }: RefreshDashboardRatesCommand): Promise<DashboardRefreshSummary> {
    checkPeriod(from, to);
    if (assets.length > 50) {
      throw new BadRequestException('At most 50 assets per request');
    }
    const settings = await this.settings.resolve(userId);
    if (!onlineAllowed(settings, this.config)) {
      throw conflict(
        'offline',
        'Rate lookups on the internet are switched off (settings)',
      );
    }
    const window = {
      from: new Date(Date.parse(`${from}T00:00:00Z`) - 15 * DAY_MS)
        .toISOString()
        .slice(0, 10),
      to,
    };
    await this.markets?.refreshBriefly(settings.keys.coingecko);
    const marketAmbiguous =
      (await this.markets?.marketAmbiguous(
        assets.map((a) => a.trim().toUpperCase()),
        settings.coinChoices,
      )) ?? new Map<string, readonly string[]>();
    const sources = await this.inputs.sources(userId, undefined, currency);
    const quote = sources.currency;
    const known: RateEntry[] = [
      ...sources.projectRates.flatMap((p) => p.rates),
      ...sources.userRates,
    ];
    let fx = 0;
    for (const base of fxBasesFor(quote)) {
      if (!force && covers(known, 'fx', base, from, to, quote)) continue;
      const entries = await this.fx
        .daily(base, quote, window.from, window.to)
        .catch(() => []);
      fx += await this.userRates.upsertMany(userId, entries);
    }
    const results: DashboardRefreshSummary['assets'][number][] = [];
    for (const raw of assets) {
      const asset = raw.trim().toUpperCase();
      if (!asset) continue;
      const choices = settings.coinChoices;
      const plan = pricePlan(asset, choices, marketAmbiguous);
      if (plan.kind === 'ambiguous') {
        // F7.4: a ticker of several coins gets no by-ticker series until a coin is chosen;
        // old cached rows of it are dropped (they are ignored at read time anyway).
        await this.userRates.deletePrices(userId, asset);
        results.push({ asset, status: 'ambiguous', source: null, points: 0 });
        continue;
      }
      const counting = known.filter(
        (r) =>
          r.kind !== 'price' ||
          seriesCounts(r.asset, r.source, choices, marketAmbiguous),
      );
      if (!force && covers(counting, 'price', asset, from, to, quote)) {
        results.push({ asset, status: 'cached', source: null, points: 0 });
        continue;
      }
      try {
        const found = await fetchPrices(
          { usd: this.usd, fiat: this.fiat },
          {
            asset,
            from: window.from,
            to: window.to,
            currency: quote,
            choices,
            apiKey: settings.keys.coingecko,
            marketAmbiguous,
          },
        );
        if (plan.kind === 'chosen') {
          // The chosen coin's series replaces the cached by-ticker one.
          await this.userRates.deletePrices(userId, asset);
        }
        await this.userRates.upsertMany(userId, found.entries);
        results.push({
          asset,
          status: found.status,
          source: found.source,
          points: found.entries.length,
        });
      } catch {
        results.push({ asset, status: 'failed', source: null, points: 0 });
      }
    }
    return { fx, assets: results };
  }
}

/**
 * A stored series covers the period when it has a point near both ends (14-day tolerance) — in
 * the tax currency `quote` (or USD for a price).
 */
function covers(
  known: readonly RateEntry[],
  kind: 'price' | 'fx',
  asset: string,
  from: string,
  to: string,
  quote: string,
): boolean {
  const table = new RateTable(
    known.filter(
      (r) => r.kind === kind && r.source !== 'manual' && r.source !== 'estv',
    ),
    quote,
  );
  const currencies = kind === 'fx' ? [quote] : ['USD', quote];
  return currencies.some(
    (currency) =>
      table.lookup(kind, asset, currency, from, 14) !== undefined &&
      table.lookup(kind, asset, currency, to, 14) !== undefined,
  );
}
