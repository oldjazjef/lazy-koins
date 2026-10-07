import { LkDatePipe } from '../../../../shared/format/date.pipe';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCheck,
  lucideChevronDown,
  lucideChevronRight,
  lucideCoins,
  lucideRefreshCw,
} from '@ng-icons/lucide';
import { CoinPicker, type PickedCoin } from '../../../../shared/coins';
import {
  type RowAction,
  RowActions,
} from '../../../../shared/components/row-actions';
import { Truncate } from '../../../../shared/components/truncate';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import {
  type DashboardHolding,
  KPI_KINDS,
  type Kpi,
  type KpiKind,
} from '../../../../core/api/dashboard.types';
import { AllocationBar, LineChart, Sparkline } from '../../../../shared/charts';
import { EmptyState } from '../../../../shared/components/empty-state';
import { PageHeader } from '../../../../shared/components/page-header';
import { RecordsDialog } from '../../../../shared/components/records-dialog';
import {
  ChfPipe,
  isNegative,
  QuantityPipe,
} from '../../../../shared/format/number-format';
import { DateRangePicker } from '../../../../shared/components/date-range-picker';
import { PriceAttribution } from '../../../../shared/components/price-attribution';
import { RATE_SOURCES } from '../../../../core/api/calculation.types';
import {
  DashboardPageService,
  type HoldingSort,
} from './dashboard-page.service';

/**
 * The start page after sign-in (F11.4): wealth across all my projects over a period — value and
 * change (F11.5), KPIs with drill-down (F11.6), allocation (F11.7), holdings with sparklines
 * (F11.8) — from the same data and rates as the tax calculation (F11.9).
 */
@Component({
  selector: 'lk-dashboard-page',
  imports: [
    Truncate,
    LkDatePipe,
    RouterLink,
    NgIcon,
    TranslatePipe,
    ChfPipe,
    QuantityPipe,
    PageHeader,
    EmptyState,
    RecordsDialog,
    LineChart,
    Sparkline,
    AllocationBar,
    DateRangePicker,
    CoinPicker,
    RowActions,
    PriceAttribution,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmInputImports,
    ...HlmLabelImports,
    ...HlmSkeletonImports,
    ...HlmTableImports,
  ],
  providers: [
    DashboardPageService,
    provideIcons({ lucideChevronDown, lucideChevronRight, lucideRefreshCw }),
  ],
  templateUrl: './dashboard-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardPage {
  protected readonly service = inject(DashboardPageService);
  private readonly translate = inject(TranslateService);
  protected readonly kpiKinds = KPI_KINDS;
  protected readonly isNegative = isNegative;

  /** Price sources of the shown holdings (CoinGecko / CoinMarketCap data needs attribution). */
  protected readonly holdingSources = computed(() =>
    this.service.holdings().map((h) => h.priceSource),
  );

  protected readonly points = computed(() =>
    this.service.view.hasValue()
      ? this.service.view.value().series.map((p) => ({
          date: p.date,
          value: p.valueChf,
          missing: p.missing,
        }))
      : [],
  );

  protected kpi(kind: KpiKind): Kpi | undefined {
    return this.service.view.hasValue()
      ? this.service.view.value().kpis.find((k) => k.kind === kind)
      : undefined;
  }

  protected openKpi(kind: KpiKind): void {
    void this.service.showRecords(
      kind,
      this.translate.instant(`dashboard.kpi.${kind}`),
    );
  }

  protected sortBy(column: HoldingSort): void {
    this.service.sortBy(column);
  }

  protected ariaSort(column: HoldingSort): 'ascending' | 'descending' | null {
    const sort = this.service.sort();
    if (sort.column !== column) return null;
    return sort.descending ? 'descending' : 'ascending';
  }

  protected search(event: Event): void {
    this.service.search.set((event.target as HTMLInputElement).value);
  }

  protected refresh(): void {
    void this.service.refreshRates();
  }

  // --- F7.4: price source per holding, "Falscher Kurs? Coin wählen", shared tickers ---

  /** Per holding: choose a coin (online only), "Passt so" for a shared-ticker warning. */
  protected readonly holdingActions = computed(() => {
    const view = this.service.view.hasValue()
      ? this.service.view.value()
      : undefined;
    return new Map(
      (view?.holdings ?? []).map((h) => [
        h.asset,
        [
          {
            id: 'choose',
            labelKey: 'rates.pricing.choose',
            icon: lucideCoins,
            hidden: !view?.online,
          },
          {
            id: 'dismiss',
            labelKey: 'rates.pricing.dismiss',
            icon: lucideCheck,
            hidden: h.shared?.level !== 'warning',
          },
        ] satisfies readonly RowAction<'choose' | 'dismiss'>[],
      ]),
    );
  });

  protected readonly picking = signal<DashboardHolding | null>(null);
  protected readonly savingCoin = signal(false);

  protected holdingAction(
    id: 'choose' | 'dismiss',
    holding: DashboardHolding,
  ): void {
    if (id === 'choose') this.picking.set(holding);
    else void this.service.dismissShared(holding.asset).catch(() => undefined);
  }

  protected async pickCoin(pick: PickedCoin): Promise<void> {
    this.savingCoin.set(true);
    try {
      await this.service.chooseCoin(pick.symbol, {
        provider: pick.provider,
        id: pick.id,
      });
      this.picking.set(null);
    } catch {
      // The runner's toast says why; the picker stays open.
    } finally {
      this.savingCoin.set(false);
    }
  }

  /** "Kurs von Binance", "OPEN Ticketing Ecosystem (CoinGecko)", "Kurs mehrdeutig – …". */
  protected sourceLine(holding: DashboardHolding): string | null {
    this.translate.currentLang();
    const source = holding.priceSource;
    // Priced anyway (override, ESTV, the file's price, a peg): the source says where from.
    if (holding.pricing === 'ambiguous' && source === null) {
      return this.translate.instant('rates.pricing.ambiguous') as string;
    }
    if (source === null) {
      // A chosen coin without a price yet still says which coin it is.
      return holding.coin
        ? (this.translate.instant('rates.pricing.chosen', {
            name: holding.coin.name ?? holding.coin.id,
            provider: this.translate.instant(
              `coins.provider.${holding.coin.provider}`,
            ),
          }) as string)
        : null;
    }
    const name =
      holding.coin && source === holding.coin.provider
        ? (this.translate.instant('rates.pricing.chosen', {
            name: holding.coin.name ?? holding.coin.id,
            provider: this.translate.instant(
              `coins.provider.${holding.coin.provider}`,
            ),
          }) as string)
        : (this.translate.instant(
            PRICE_SOURCES.has(source)
              ? `rates.source.${source}`
              : `dashboard.holdings.priceSource.${source}`,
          ) as string);
    return this.translate.instant('dashboard.holdings.sourceOf', {
      source: name,
    }) as string;
  }

  /** The shared-ticker note, or null. */
  protected sharedLine(holding: DashboardHolding): string | null {
    this.translate.currentLang();
    const shared = holding.shared;
    if (!shared) return null;
    if (shared.level === 'ambiguous') {
      return this.translate.instant('rates.pricing.sharedAmbiguous', {
        symbol: shared.symbol,
      }) as string;
    }
    const source = holding.priceSource;
    return this.translate.instant('rates.pricing.shared', {
      symbol: shared.symbol,
      name: shared.candidates[0]?.name ?? shared.symbol,
      source:
        source && PRICE_SOURCES.has(source)
          ? this.translate.instant(`rates.source.${source}`)
          : this.translate.instant('rates.pricing.byTicker'),
    }) as string;
  }

  protected candidatesLine(holding: DashboardHolding): string {
    return (holding.shared?.candidates ?? [])
      .map((c) => `${c.name} (#${c.marketCapRank})`)
      .join(', ');
  }
}

/** Sources with a `rates.source.*` text; the others have `dashboard.holdings.priceSource.*`. */
const PRICE_SOURCES = new Set<string>(RATE_SOURCES);
