import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { lucidePencil, lucideTrash2 } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import { z } from 'zod';
import type { RateSeries } from '../../../../core/api/calculation.types';
import { EmptyState } from '../../../../shared/components/empty-state';
import { QuantityPipe } from '../../../../shared/format/number-format';
import { ProjectWorkspaceService } from '../project-workspace/project-workspace.service';
import { paginate, Paginator } from '../../../../shared/components/paginator';
import { Truncate } from '../../../../shared/components/truncate';
import {
  type RowAction,
  RowActions,
} from '../../../../shared/components/row-actions';

const ManualRateSchema = z.object({
  kind: z.enum(['price', 'fx']),
  asset: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9.]{1,40}$/, 'rates.errors.asset'),
  currency: z.enum(['CHF', 'USD']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'rates.errors.date'),
  value: z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/, 'rates.errors.value'),
});

/**
 * Kurse (F7.4): the stored series with their source and the value used for 31.12., overrides
 * and ESTV values, "Kurse aktualisieren" (only with rate lookups on, F11.3) and the Kursliste
 * import.
 */
@Component({
  selector: 'lk-project-rates',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    TranslatePipe,
    Paginator,
    Truncate,
    RowActions,
    QuantityPipe,
    EmptyState,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmInputImports,
    ...HlmLabelImports,
    ...HlmSkeletonImports,
    ...HlmTableImports,
  ],
  templateUrl: './project-rates.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectRates {
  protected readonly service = inject(ProjectWorkspaceService);

  readonly closed = input(false);
  readonly taxYear = input.required<number>();

  protected readonly error = signal<string | null>(null);
  protected readonly filter = signal('');

  protected readonly view = computed(() =>
    this.service.rates.hasValue() ? this.service.rates.value() : undefined,
  );

  protected readonly series = computed(() => {
    const term = this.filter().trim().toUpperCase();
    return (this.view()?.series ?? []).filter(
      (s) => term === '' || s.asset.includes(term),
    );
  });

  protected readonly manualPager = paginate(
    computed(() => this.view()?.manual ?? []),
    { storageKey: 'manual-rates' },
  );
  protected readonly seriesPager = paginate(this.series, {
    storageKey: 'rate-series',
    resetOn: () => this.filter(),
  });

  /** One action each; none while the project is closed (F4.5). */
  protected readonly manualActions = computed<readonly RowAction[]>(() => [
    {
      id: 'remove',
      labelKey: 'rates.remove',
      icon: lucideTrash2,
      danger: true,
      hidden: this.closed(),
    },
  ]);
  protected readonly seriesActions = computed<readonly RowAction[]>(() => [
    {
      id: 'override',
      labelKey: 'rates.override',
      icon: lucidePencil,
      hidden: this.closed(),
    },
  ]);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    kind: ['price' as 'price' | 'fx'],
    asset: [''],
    currency: ['CHF' as 'CHF' | 'USD'],
    date: [''],
    value: [''],
  });

  protected refresh(force: boolean): void {
    void this.service.refreshRates(force).catch(() => undefined);
  }

  protected prefill(series: RateSeries): void {
    this.form.reset({
      kind: series.kind,
      asset: series.asset,
      currency: series.kind === 'fx' ? 'CHF' : series.currency,
      date: `${this.taxYear()}-12-31`,
      value: series.yearEnd?.value ?? '',
    });
  }

  protected submit(): void {
    const values = this.form.getRawValue();
    const parsed = ManualRateSchema.safeParse({
      ...values,
      date: values.date || `${this.taxYear()}-12-31`,
    });
    if (!parsed.success) {
      this.error.set(parsed.error.issues[0]?.message ?? 'rates.errors.value');
      return;
    }
    this.error.set(null);
    void this.service
      .setManualRate(parsed.data)
      .then(() => this.form.reset())
      .catch(() => undefined);
  }

  protected picked(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    target.value = '';
    if (file) void this.service.importKursliste(file).catch(() => undefined);
  }

  protected search(event: Event): void {
    this.filter.set((event.target as HTMLInputElement).value);
  }
}
