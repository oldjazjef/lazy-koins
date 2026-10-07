import { LkDatePipe } from '../../../../shared/format/date.pipe';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { lucideLayers, lucidePencil, lucideTag } from '@ng-icons/lucide';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import type {
  CategoryTotal,
  IncomeLine,
  Position,
} from '../../../../core/api/calculation.types';
import { EmptyState } from '../../../../shared/components/empty-state';
import { ChfPipe, QuantityPipe } from '../../../../shared/format/number-format';
import { ProjectWorkspaceService } from '../project-workspace/project-workspace.service';
import { paginate, Paginator } from '../../../../shared/components/paginator';
import { Truncate } from '../../../../shared/components/truncate';
import {
  type RowAction,
  RowActions,
} from '../../../../shared/components/row-actions';

/**
 * Ergebnis (F7): Vermögen per platform → positions, Ertrag per category → bookings, Earn gaps
 * and one-off events. Every amount opens its records (F7.5); a position or booking starts a
 * correction (F9).
 */
@Component({
  selector: 'lk-project-result',
  imports: [
    LkDatePipe,
    TranslatePipe,
    Paginator,
    Truncate,
    RowActions,
    ChfPipe,
    QuantityPipe,
    EmptyState,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmSkeletonImports,
    ...HlmTableImports,
  ],
  templateUrl: './project-result.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectResult {
  protected readonly service = inject(ProjectWorkspaceService);
  private readonly translate = inject(TranslateService);

  readonly closed = input(false);

  protected readonly openPlatform = signal<string | null>(null);
  protected readonly openCategory = signal<string | null>(null);

  protected readonly result = computed(() =>
    this.service.result.hasValue() ? this.service.result.value() : undefined,
  );

  /** Positions of the open platform, income lines of the open category: 10 per page. */
  protected readonly positionsPager = paginate(
    computed(() => {
      const open = this.openPlatform();
      return open === null
        ? []
        : (this.result()?.result?.positions ?? []).filter(
            (p) => p.platform === open,
          );
    }),
    { storageKey: 'positions', resetOn: () => this.openPlatform() },
  );
  protected readonly linesPager = paginate(
    computed(() => {
      const open = this.openCategory();
      return open === null
        ? []
        : (this.result()?.result?.income ?? []).filter(
            (l) => l.category === open && l.status !== 'spam',
          );
    }),
    { storageKey: 'income-lines', resetOn: () => this.openCategory() },
  );
  protected readonly gapsPager = paginate(
    computed(() => this.result()?.result?.earnGaps ?? []),
    { storageKey: 'earn-gaps' },
  );
  protected readonly eventsPager = paginate(
    computed(() => this.result()?.result?.oneOffEvents ?? []),
    { storageKey: 'one-off-events' },
  );

  /** Corrections (F9) from a row; none while the project is closed (F4.5). */
  protected readonly positionActions = computed<
    readonly RowAction<'price' | 'quantity'>[]
  >(() => [
    {
      id: 'price',
      labelKey: 'result.actions.overridePrice',
      icon: lucideTag,
      hidden: this.closed(),
    },
    {
      id: 'quantity',
      labelKey: 'result.actions.setQuantity',
      icon: lucideLayers,
      hidden: this.closed(),
    },
  ]);
  protected readonly lineActions = computed<
    readonly RowAction<'reclassify' | 'price'>[]
  >(() => [
    {
      id: 'reclassify',
      labelKey: 'result.actions.reclassify',
      icon: lucidePencil,
      hidden: this.closed(),
    },
    {
      id: 'price',
      labelKey: 'result.actions.overridePrice',
      icon: lucideTag,
      hidden: this.closed(),
    },
  ]);

  protected positionAction(
    action: 'price' | 'quantity',
    position: Position,
  ): void {
    if (action === 'price') this.overridePrice(position);
    else this.setHolding(position);
  }

  protected lineAction(action: 'reclassify' | 'price', line: IncomeLine): void {
    if (action === 'reclassify') this.reclassify(line);
    else this.overrideIncomePrice(line);
  }

  protected sourceOf(position: Position): string {
    const quantity = this.translate.instant(
      `result.quantitySource.${position.quantitySource}`,
    );
    return position.priceOrigin
      ? `${quantity} · ${this.translate.instant(`result.priceOrigin.${position.priceOrigin}`, { currency: this.service.currency() })}`
      : quantity;
  }

  protected togglePlatform(platform: string): void {
    this.openPlatform.update((open) => (open === platform ? null : platform));
  }

  protected toggleCategory(category: string): void {
    this.openCategory.update((open) => (open === category ? null : category));
  }

  protected records(figureId: string, title: string): void {
    void this.service.showRecords(figureId, title);
  }

  protected positionTitle(position: Position): string {
    return `${position.platform} · ${position.accountId} · ${position.asset}`;
  }

  protected categoryTitle(category: CategoryTotal): string {
    return this.translate.instant(`result.category.${category.category}`);
  }

  protected overridePrice(position: Position): void {
    this.service.startCorrection({
      type: 'price_override',
      values: {
        asset: position.asset,
        date: this.result()?.result?.yearEnd ?? '',
        priceChf: position.priceChf ?? '',
      },
    });
  }

  protected setHolding(position: Position): void {
    this.service.startCorrection({
      type: 'manual_holding',
      values: {
        platform: position.platform,
        accountId: position.accountId,
        asset: position.asset,
        quantity: position.quantity,
        asOf: this.result()?.result?.yearEnd ?? '',
      },
    });
  }

  protected reclassify(line: IncomeLine): void {
    this.service.startCorrection({
      type: 'reclassify',
      values: { bookingId: line.bookingId, kind: 'transfer' },
    });
  }

  protected overrideIncomePrice(line: IncomeLine): void {
    this.service.startCorrection({
      type: 'price_override',
      values: {
        asset: line.asset,
        date: line.date,
        priceChf: line.priceChf ?? '',
      },
    });
  }

  protected calculate(): void {
    void this.service.calculate().catch(() => undefined);
  }
}
