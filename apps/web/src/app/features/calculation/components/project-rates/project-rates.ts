import { LkDatePipe } from '../../../../shared/format/date.pipe';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  lucideCheck,
  lucideCoins,
  lucidePencil,
  lucideTrash2,
} from '@ng-icons/lucide';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import { z } from 'zod';
import type {
  RateSeries,
  RefreshSummary,
} from '../../../../core/api/calculation.types';
import type { AssetPricing } from '../../../../core/api/coin.types';
import {
  CoinPicker,
  CoinsService,
  type PickedCoin,
} from '../../../../shared/coins';
import { EmptyState } from '../../../../shared/components/empty-state';
import { PriceAttribution } from '../../../../shared/components/price-attribution';
import { QuantityPipe } from '../../../../shared/format/number-format';
import { ProjectWorkspaceService } from '../project-workspace/project-workspace.service';
import { paginate, Paginator } from '../../../../shared/components/paginator';
import { Truncate } from '../../../../shared/components/truncate';
import { DateField } from '../../../../shared/components/date-field';
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
  /** The project's tax currency or USD (F4.1a). */
  currency: z.string().regex(/^[A-Z]{3}$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'rates.errors.date'),
  value: z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/, 'rates.errors.value'),
});

/**
 * Kurse (F7.4): the stored series with their source and the value used for 31.12., overrides
 * and ESTV values, "Kurse aktualisieren" (only with rate lookups on, F11.3) and the Kursliste
 * import. F7.4a: the automatic ESTV Kursliste of the tax year — the version in use, a newer one,
 * "ESTV-Kursliste aktualisieren" and ambiguous assets (no value; set an override).
 */
@Component({
  selector: 'lk-project-rates',
  imports: [
    LkDatePipe,
    DateField,
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    Paginator,
    Truncate,
    RowActions,
    QuantityPipe,
    EmptyState,
    CoinPicker,
    PriceAttribution,
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

  /** F4.1a: overrides are in the tax currency (prices also in USD). */
  protected readonly currency = computed(
    () => this.view()?.currency ?? this.service.projectCurrency(),
  );
  protected readonly currencies = computed(() => [
    ...new Set([this.currency(), 'USD']),
  ]);

  /** Sources of the priced assets (attribution: CoinGecko / CoinMarketCap data shown). */
  protected readonly pricingSources = computed(() =>
    (this.view()?.assets ?? []).flatMap((a) => a.sources),
  );
  protected readonly seriesSources = computed(() =>
    (this.view()?.series ?? []).map((s) => s.source),
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
    currency: ['CHF'],
    date: [''],
    value: [''],
  });

  constructor() {
    // The override form starts in the project's tax currency.
    effect(() => {
      const currency = this.currency();
      const control = untracked(() => this.form.controls.currency);
      if (control.pristine) control.setValue(currency);
    });
  }

  protected refresh(force: boolean): void {
    void this.service.refreshRates(force).catch(() => undefined);
  }

  protected prefill(series: RateSeries): void {
    this.form.reset({
      kind: series.kind,
      asset: series.asset,
      currency: series.kind === 'fx' ? this.currency() : series.currency,
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
      .then(() => this.form.reset({ currency: this.currency() }))
      .catch(() => undefined);
  }

  protected picked(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    target.value = '';
    if (file) void this.service.importKursliste(file).catch(() => undefined);
  }

  /** F7.4a: download the tax year's Kursliste if newer, then take it into the project. */
  protected updateEstv(): void {
    void this.service.updateEstv(this.taxYear()).catch(() => undefined);
  }

  protected applyEstv(): void {
    void this.service.applyEstv().catch(() => undefined);
  }

  protected candidateNames(
    candidates: readonly { name: string; valorNumber: string | null }[],
  ): string {
    return candidates
      .map((c) => (c.valorNumber ? `${c.name} (${c.valorNumber})` : c.name))
      .join(', ');
  }

  protected search(event: Event): void {
    this.filter.set((event.target as HTMLInputElement).value);
  }

  // --- F7.4: price source per asset, "Falscher Kurs? Coin wählen", shared tickers ---

  private readonly coins = inject(CoinsService);
  private readonly translate = inject(TranslateService);

  protected readonly assetRows = computed(() => {
    const term = this.filter().trim().toUpperCase();
    return (this.view()?.assets ?? []).filter(
      (a) => term === '' || a.asset.includes(term),
    );
  });
  protected readonly assetPager = paginate(this.assetRows, {
    storageKey: 'rate-assets',
    resetOn: () => this.filter(),
  });

  /** Per asset: choose a coin (online only), "Passt so" for a warning, remove a chosen coin. */
  protected readonly assetActions = computed(() => {
    const closed = this.closed();
    const online = this.view()?.online ?? false;
    return new Map(
      (this.view()?.assets ?? []).map((a) => [
        a.asset,
        [
          {
            id: 'choose',
            labelKey: 'rates.pricing.choose',
            icon: lucideCoins,
            hidden: closed || !online,
          },
          {
            id: 'dismiss',
            labelKey: 'rates.pricing.dismiss',
            icon: lucideCheck,
            hidden: closed || a.shared?.level !== 'warning',
          },
          {
            id: 'removeCoin',
            labelKey: 'rates.pricing.removeCoin',
            icon: lucideTrash2,
            danger: true,
            hidden: closed || a.coin === null,
          },
        ] satisfies readonly RowAction<AssetActionId>[],
      ]),
    );
  });

  /** The asset the coin picker is open for; null = closed. */
  protected readonly picking = signal<AssetPricing | null>(null);
  protected readonly savingCoin = signal(false);

  protected assetAction(id: AssetActionId, row: AssetPricing): void {
    if (id === 'choose') {
      this.picking.set(row);
    } else if (id === 'dismiss') {
      void this.coins.dismiss(row.asset).catch(() => undefined);
    } else {
      void this.coins.removeChoice(row.asset).catch(() => undefined);
    }
  }

  /** Stores the coin, removes the old series everywhere and refetches this asset (force). */
  protected async pickCoin(pick: PickedCoin): Promise<void> {
    const projectId = this.service.projectId();
    if (!projectId) return;
    this.savingCoin.set(true);
    try {
      await this.coins.chooseForProject(projectId, pick.symbol, {
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

  /** "Binance, CoinGecko" — translated source names. */
  protected sourceNames(sources: readonly string[]): string {
    this.translate.currentLang();
    return sources
      .map((s) => this.translate.instant(`rates.source.${s}`) as string)
      .join(', ');
  }

  /** Where the asset's price comes from, as one line. */
  protected sourceLine(row: AssetPricing): string {
    this.translate.currentLang();
    if (row.pricing === 'ambiguous') {
      return this.translate.instant('rates.pricing.ambiguous') as string;
    }
    if (row.pricing === 'chosen' && row.coin) {
      return this.translate.instant('rates.pricing.chosen', {
        name: row.coin.name ?? row.coin.id,
        provider: this.translate.instant(`coins.provider.${row.coin.provider}`),
      }) as string;
    }
    return row.sources.length > 0
      ? `${this.sourceNames(row.sources)} · ${this.translate.instant('rates.pricing.byTicker')}`
      : (this.translate.instant('rates.pricing.noSource') as string);
  }

  /** The shared-ticker note ("Kürzel … wird von mehreren Coins verwendet …"), or null. */
  protected sharedLine(row: AssetPricing): string | null {
    this.translate.currentLang();
    const shared = row.shared;
    if (!shared) return null;
    if (shared.level === 'ambiguous') {
      return this.translate.instant('rates.pricing.sharedAmbiguous', {
        symbol: shared.symbol,
      }) as string;
    }
    return this.translate.instant('rates.pricing.shared', {
      symbol: shared.symbol,
      name: shared.candidates[0]?.name ?? shared.symbol,
      source:
        row.sources.length > 0
          ? this.sourceNames(row.sources)
          : this.translate.instant('rates.pricing.byTicker'),
    }) as string;
  }

  /** Assets nobody could price, with the first provider that failed and its code. */
  protected failures(summary: RefreshSummary): {
    asset: string;
    provider: string;
    code: string;
  }[] {
    return summary.assets.flatMap((a) =>
      a.status === 'failed' && a.error
        ? [{ asset: a.asset, provider: a.error.provider, code: a.error.code }]
        : [],
    );
  }

  protected contractAssets(summary: RefreshSummary): string {
    return (summary.contracts ?? [])
      .map((c) => `${c.asset} → ${c.choice.name ?? c.choice.id}`)
      .join(', ');
  }

  protected candidatesLine(row: AssetPricing): string | null {
    const candidates = row.shared?.candidates ?? [];
    if (candidates.length === 0) return null;
    this.translate.currentLang();
    return this.translate.instant('rates.pricing.candidates', {
      coins: candidates
        .map((c) => `${c.name} (#${c.marketCapRank})`)
        .join(', '),
    }) as string;
  }
}

type AssetActionId = 'choose' | 'dismiss' | 'removeCoin';
