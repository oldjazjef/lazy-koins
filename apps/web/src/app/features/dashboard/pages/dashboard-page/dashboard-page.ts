import { LkDatePipe } from '../../../../shared/format/date.pipe';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideChevronDown,
  lucideChevronRight,
  lucideRefreshCw,
} from '@ng-icons/lucide';
import { Truncate } from '../../../../shared/components/truncate';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import {
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
}
