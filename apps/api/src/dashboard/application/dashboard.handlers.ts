import { BadRequestException, Injectable } from '@nestjs/common';
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
import { COINGECKO_IDS, RATE_ALIASES } from '../../rates/domain/project-rate';
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

export interface DashboardView extends DashboardResult {
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
  readonly view: Omit<DashboardView, 'online'>;
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
    return { ...view, online: onlineAllowed(settings, this.config) };
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

export type DashboardFetchStatus = 'fetched' | 'cached' | 'notFound' | 'failed';

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
      if (!force && covers(known, 'price', asset, from, to, quote)) {
        results.push({ asset, status: 'cached', source: null, points: 0 });
        continue;
      }
      try {
        let entries: RateEntry[] = [];
        let source: string | null = null;
        for (const symbol of [asset, ...(RATE_ALIASES[asset] ?? [])]) {
          const found = await this.usd.dailyUsd({
            asset,
            symbol,
            from: window.from,
            to: window.to,
          });
          const dates = new Set(entries.map((e) => e.date));
          entries = [...entries, ...found.filter((e) => !dates.has(e.date))];
        }
        if (entries.length > 0) source = this.usd.name;
        const coinId = settings.coingeckoIds[asset] ?? COINGECKO_IDS[asset];
        const apiKey = settings.keys.coingecko;
        if (entries.length === 0 && coinId && apiKey) {
          entries = await this.fiat.dailyFiat({
            asset,
            symbol: asset,
            from: window.from,
            to: window.to,
            coinId,
            apiKey,
            currency: quote,
          });
          if (entries.length > 0) source = this.fiat.name;
        }
        await this.userRates.upsertMany(userId, entries);
        results.push({
          asset,
          status: entries.length > 0 ? 'fetched' : 'notFound',
          source,
          points: entries.length,
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
