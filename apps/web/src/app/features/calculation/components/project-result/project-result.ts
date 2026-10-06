import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import type {
  CategoryTotal,
  IncomeLine,
  PlatformTotal,
  Position,
} from '../../../../core/api/calculation.types';
import { EmptyState } from '../../../../shared/components/empty-state';
import { ChfPipe, QuantityPipe } from '../../../../shared/format/number-format';
import { ProjectWorkspaceService } from '../project-workspace/project-workspace.service';

/**
 * Ergebnis (F7): Vermögen per platform → positions, Ertrag per category → bookings, Earn gaps
 * and one-off events. Every amount opens its records (F7.5); a position or booking starts a
 * correction (F9).
 */
@Component({
  selector: 'lk-project-result',
  imports: [
    DatePipe,
    TranslatePipe,
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

  protected positionsOf(platform: PlatformTotal): Position[] {
    return (this.result()?.result?.positions ?? []).filter(
      (p) => p.platform === platform.platform,
    );
  }

  protected linesOf(category: CategoryTotal): IncomeLine[] {
    return (this.result()?.result?.income ?? []).filter(
      (l) => l.category === category.category && l.status !== 'spam',
    );
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
