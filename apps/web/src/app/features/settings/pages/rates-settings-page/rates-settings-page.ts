import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { DatePipe } from '@angular/common';
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
    DatePipe,
    TranslatePipe,
    PageHeader,
    Truncate,
    RatesKeyForm,
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
