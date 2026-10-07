import { HttpClient, httpResource } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import Decimal from 'decimal.js';
import { firstValueFrom } from 'rxjs';
import { ActivityService } from '../../../../core/activity/activity.service';
import { apiUrl } from '../../../../core/api/api-url';
import { DataChanges, reloadOn } from '../../../../core/data/data-changes';
import type {
  DashboardHolding,
  DashboardRecords,
  DashboardRefreshSummary,
  DashboardView,
  KpiKind,
} from '../../../../core/api/dashboard.types';
import { NotificationService } from '../../../../core/notifications/notification.service';
import {
  type DateRange,
  type DateRangePreset,
  sameRange,
} from '../../../../shared/components/date-range-picker/date-range';
import {
  isoDay,
  lastTwelveMonths,
  type Period,
  type PeriodPreset,
  periodOf,
  presetFrom,
  presetValue,
  taxYearPeriod,
  yearToDate,
} from '../../dashboard-period';

export type HoldingSort = 'asset' | 'quantity' | 'price' | 'value';

/** Compares decimal strings without `Number()` (null = no value, sorted last). */
function compareDecimal(a: string | null, b: string | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return new Decimal(a).comparedTo(new Decimal(b));
}

/**
 * The dashboard over all my projects (F11.4–F11.9): the period (default 01.01. → today), the
 * view from `GET /api/dashboard`, the KPI drill-down (F7.5) and "Kurse aktualisieren", which
 * fetches the missing series one asset at a time so the page can show progress. The API does
 * every calculation; figures stay decimal strings.
 */
@Injectable()
export class DashboardPageService {
  private readonly http = inject(HttpClient);
  private readonly notifications = inject(NotificationService);
  private readonly activity = inject(ActivityService);
  /** Injectable for tests. */
  today = (): Date => new Date();

  readonly preset = signal<PeriodPreset>({ key: 'ytd' });
  readonly period = signal<Period>(yearToDate(this.today()));
  /** Only this project (the compact card); undefined = all projects. */
  readonly projectId = signal<string | undefined>(undefined);
  /**
   * F4.1a: the tax currency shown — projects in different currencies are never added up, the
   * dashboard shows one currency at a time. Undefined = the newest project's (the API decides).
   */
  readonly currency = signal<string | undefined>(undefined);

  /** `from`, `to` and the project or currency, for every dashboard request. */
  private params(from: string, to: string): Record<string, string> {
    const params: Record<string, string> = { from, to };
    const project = this.projectId();
    const currency = this.currency();
    if (project) params['project'] = project;
    else if (currency) params['currency'] = currency;
    return params;
  }

  readonly view = httpResource<DashboardView>(() => {
    const { from, to } = this.period();
    if (!from || !to || from > to) return undefined;
    return { url: apiUrl('/dashboard'), params: this.params(from, to) };
  });

  constructor() {
    // Regression (07.10.2026): after "Neu berechnen" the chart kept the old values. Every change
    // reloads it: the project card on a change to its project (a calculation, a file removed,
    // a correction, the assistant …), the page on a change to any project.
    const changes = inject(DataChanges);
    reloadOn(() => {
      const project = this.projectId();
      return project
        ? changes.projectVersion(project)
        : changes.globalVersion('projects');
    }, [this.view]);
  }

  readonly isEmpty = computed(
    () => this.view.hasValue() && this.view.value().projects.length === 0,
  );

  /** The tax years of my projects, newest first — quick picks (F11.4). */
  readonly taxYears = computed(() =>
    this.view.hasValue()
      ? [...new Set(this.view.value().projects.map((p) => p.taxYear))].sort(
          (a, b) => b - a,
        )
      : [],
  );

  /** The latest day a period may reach (the Stichtag is never in the future). */
  readonly maxDay = computed(() => isoDay(this.today()));

  /**
   * The period picker's presets (F11.4): the running year, the last 12 months and the tax years
   * of my projects, newest first. Ids are the `PeriodPreset` values (`ytd`, `year:2025`).
   */
  readonly presets = computed<DateRangePreset[]>(() => {
    const today = this.today();
    return [
      {
        id: 'ytd',
        labelKey: 'dashboard.period.ytd',
        range: yearToDate(today),
      },
      {
        id: 'last12',
        labelKey: 'dashboard.period.last12',
        range: lastTwelveMonths(today),
      },
      ...this.taxYears().map((year) => ({
        id: presetValue({ key: 'year', year }),
        labelKey: 'dashboard.period.taxYear',
        labelParams: { year },
        range: taxYearPeriod(year, today),
      })),
    ];
  });

  /** A period from the picker: the preset it matches (first wins), else a custom one. */
  choosePeriod(range: DateRange): void {
    if (!range.from || !range.to) return;
    const preset = this.presets().find((p) => sameRange(p.range, range));
    if (preset) this.setPreset(presetFrom(preset.id));
    else this.setCustom({ from: range.from, to: range.to });
  }

  setPreset(preset: PeriodPreset): void {
    this.preset.set(preset);
    const period = periodOf(preset, this.today());
    if (period) this.period.set(period);
  }

  setCustom(period: Period): void {
    this.preset.set({ key: 'custom' });
    this.period.set(period);
  }

  // --- Holdings table (F11.8) ---

  readonly search = signal('');
  readonly sort = signal<{ column: HoldingSort; descending: boolean }>({
    column: 'value',
    descending: true,
  });
  readonly expanded = signal<ReadonlySet<string>>(new Set());

  readonly holdings = computed<readonly DashboardHolding[]>(() => {
    if (!this.view.hasValue()) return [];
    const query = this.search().trim().toUpperCase();
    const { column, descending } = this.sort();
    const rows = this.view
      .value()
      .holdings.filter(
        (h) =>
          query === '' ||
          h.asset.toUpperCase().includes(query) ||
          h.accounts.some((a) => a.platform.toUpperCase().includes(query)),
      );
    const valueOf = (h: DashboardHolding) =>
      column === 'quantity'
        ? h.quantity
        : column === 'price'
          ? h.priceChf
          : h.valueChf;
    const sorted = [...rows].sort((a, b) => {
      // Rows without a value stay at the end in both directions.
      if (column !== 'asset') {
        const missingA = valueOf(a) === null;
        const missingB = valueOf(b) === null;
        if (missingA !== missingB) return missingA ? 1 : -1;
      }
      const order =
        column === 'asset'
          ? a.asset.localeCompare(b.asset)
          : column === 'quantity'
            ? compareDecimal(a.quantity, b.quantity)
            : column === 'price'
              ? compareDecimal(a.priceChf, b.priceChf)
              : compareDecimal(a.valueChf, b.valueChf);
      return descending ? -order : order;
    });
    return sorted;
  });

  sortBy(column: HoldingSort): void {
    this.sort.update((current) =>
      current.column === column
        ? { column, descending: !current.descending }
        : { column, descending: column !== 'asset' },
    );
  }

  toggle(asset: string): void {
    this.expanded.update((set) => {
      const next = new Set(set);
      if (next.has(asset)) next.delete(asset);
      else next.add(asset);
      return next;
    });
  }

  // --- KPI drill-down (F11.6 → F7.5) ---

  readonly recordsOf = signal<{ kind: KpiKind; title: string } | null>(null);
  readonly records = signal<DashboardRecords | null>(null);

  async showRecords(kind: KpiKind, title: string): Promise<void> {
    const { from, to } = this.period();
    this.records.set(null);
    this.recordsOf.set({ kind, title });
    try {
      this.records.set(
        await firstValueFrom(
          this.http.get<DashboardRecords>(apiUrl('/dashboard/records'), {
            params: { ...this.params(from, to), kpi: kind },
          }),
        ),
      );
    } catch {
      this.recordsOf.set(null);
      this.notifications.error('dashboard.recordsFailed');
    }
  }

  closeRecords(): void {
    this.recordsOf.set(null);
    this.records.set(null);
  }

  // --- "Kurse aktualisieren" (F11.4, F11.3) ---

  /** Progress of a running refresh; null when idle. */
  readonly refreshing = signal<{
    readonly done: number;
    readonly total: number;
    readonly asset: string | null;
  } | null>(null);
  readonly lastRefresh = signal<DashboardRefreshSummary['assets'] | null>(null);

  /** The assets the shown period lacks prices for. */
  readonly missingAssets = computed(() =>
    this.view.hasValue() ? this.view.value().missingPrices : [],
  );

  /**
   * FX first, then each asset without a price on its own request (progress, rate limits — the
   * sources are serialised in the API anyway); finally the view reloads.
   */
  async refreshRates(): Promise<void> {
    if (this.refreshing()) return;
    // Shown in the app-wide activity indicator ("Kurse werden aktualisiert (3/7) …").
    await this.activity.track('activity.rates', () => this.refreshAll(), {
      progress: computed(() => {
        const progress = this.refreshing();
        return progress ? { done: progress.done, total: progress.total } : null;
      }),
    });
  }

  private async refreshAll(): Promise<void> {
    const { from, to } = this.period();
    const assets = [...this.missingAssets()];
    const results: DashboardRefreshSummary['assets'][number][] = [];
    this.refreshing.set({ done: 0, total: assets.length + 1, asset: null });
    try {
      await this.refreshCall(from, to, []);
      for (const [index, asset] of assets.entries()) {
        this.refreshing.set({
          done: index + 1,
          total: assets.length + 1,
          asset,
        });
        const summary = await this.refreshCall(from, to, [asset]);
        results.push(...summary.assets);
      }
      this.lastRefresh.set(results);
      const fetched = results.filter((r) => r.status === 'fetched').length;
      this.notifications.info('dashboard.rates.done', {
        fetched,
        missing: results.length - fetched,
      });
    } catch (error) {
      const status = (error as { status?: number }).status;
      this.notifications.error(
        status === 409 ? 'dashboard.rates.offline' : 'dashboard.rates.failed',
      );
    } finally {
      this.refreshing.set(null);
      this.view.reload();
    }
  }

  private refreshCall(
    from: string,
    to: string,
    assets: string[],
  ): Promise<DashboardRefreshSummary> {
    return firstValueFrom(
      this.http.post<DashboardRefreshSummary>(
        apiUrl('/dashboard/rates/refresh'),
        {
          from,
          to,
          assets,
          ...(this.currency() ? { currency: this.currency() } : {}),
        },
      ),
    );
  }
}
