import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { LkDatePipe } from '../../../../shared/format/date.pipe';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import { PageHeader } from '../../../../shared/components/page-header';
import { Truncate } from '../../../../shared/components/truncate';
import { EstvService } from '../../../../shared/estv/estv.service';
import { RatesKeyForm } from '../../components/rates-key-form/rates-key-form';
import { lucidePencil, lucideTrash2 } from '@ng-icons/lucide';
import type { CoinChoice } from '../../../../core/api/coin.types';
import {
  CoinPicker,
  CoinsService,
  type PickedCoin,
} from '../../../../shared/coins';
import {
  type RowAction,
  RowActions,
} from '../../../../shared/components/row-actions';
import { UserSettingsService } from '../../user-settings.service';
import { RatesSettingsPageService } from './rates-settings-page.service';

/**
 * Einstellungen › Kurse (F11.3, F6.7, F7.4, F7.4a): rate lookups on the internet on/off and the
 * CoinGecko key with "Testen" (`lk-rates-key-form`, shared with the setup wizard), the automatic
 * ESTV Kursliste (status per year, "ESTV-Kursliste aktualisieren") and the manual Kursliste import
 * into a project.
 */
@Component({
  selector: 'lk-rates-settings-page',
  imports: [
    LkDatePipe,
    TranslatePipe,
    PageHeader,
    Truncate,
    RatesKeyForm,
    CoinPicker,
    RowActions,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmInputImports,
    ...HlmLabelImports,
    ...HlmSkeletonImports,
    ...HlmTableImports,
  ],
  templateUrl: './rates-settings-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RatesSettingsPage {
  protected readonly service = inject(UserSettingsService);
  protected readonly page = inject(RatesSettingsPageService);

  protected readonly estv = inject(EstvService);
  private readonly coins = inject(CoinsService);

  /** F7.4: symbol → chosen coin, sorted by symbol. */
  protected readonly coinRows = computed(() =>
    Object.entries(
      this.service.settings.hasValue()
        ? this.service.settings.value().coinChoices
        : {},
    )
      .map(([symbol, coin]) => ({ symbol, coin }))
      .sort((a, b) => (a.symbol < b.symbol ? -1 : 1)),
  );
  protected readonly coinActions: readonly RowAction<'change' | 'remove'>[] = [
    { id: 'change', labelKey: 'coins.change', icon: lucidePencil },
    {
      id: 'remove',
      labelKey: 'coins.remove',
      icon: lucideTrash2,
      danger: true,
    },
  ];
  /** The ticker the picker is open for (`''` = a new one), `null` = closed. */
  protected readonly picking = signal<string | null>(null);
  protected readonly pickingCurrent = signal<CoinChoice | null>(null);
  protected readonly savingCoin = signal(false);

  protected readonly projectId = signal('');
  protected readonly projects = computed(() =>
    this.page.projects.hasValue()
      ? this.page.projects.value().filter((p) => p.status !== 'closed')
      : [],
  );

  constructor() {
    this.estv.load();
    effect(() => {
      const first = this.projects()[0];
      if (first && this.projectId() === '') this.projectId.set(first.id);
    });
  }

  protected addCoin(): void {
    this.pickingCurrent.set(null);
    this.picking.set('');
  }

  protected coinAction(
    id: 'change' | 'remove',
    row: { symbol: string; coin: CoinChoice },
  ): void {
    if (id === 'remove') {
      void this.coins
        .removeChoice(row.symbol)
        .then(() => this.service.settings.reload())
        .catch(() => undefined);
      return;
    }
    this.pickingCurrent.set(row.coin);
    this.picking.set(row.symbol);
  }

  /** Stores the pick (validated by the API) and closes the picker. */
  protected async pickCoin(pick: PickedCoin): Promise<void> {
    this.savingCoin.set(true);
    try {
      await this.coins.setChoice(pick.symbol, {
        provider: pick.provider,
        id: pick.id,
      });
      this.picking.set(null);
      this.service.settings.reload();
    } catch {
      // The runner's toast says why; the picker stays open.
    } finally {
      this.savingCoin.set(false);
    }
  }

  /** F7.4a: every stored year and last year; progress and outcome come from the service. */
  protected updateEstv(): void {
    void this.estv.update().catch(() => undefined);
  }

  protected selectProject(event: Event): void {
    this.projectId.set((event.target as HTMLSelectElement).value);
  }

  protected picked(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    target.value = '';
    const projectId = this.projectId();
    if (file && projectId) {
      void this.page.importKursliste(projectId, file).catch(() => undefined);
    }
  }
}
