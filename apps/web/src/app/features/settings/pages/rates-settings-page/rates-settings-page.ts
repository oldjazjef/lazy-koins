import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { DatePipe } from '@angular/common';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import { z } from 'zod';
import type { UpdateSettingsRequest } from '../../../../core/api/calculation.types';
import { PageHeader } from '../../../../shared/components/page-header';
import { Truncate } from '../../../../shared/components/truncate';
import { EstvService } from '../../../../shared/estv/estv.service';
import { UserSettingsService } from '../../user-settings.service';
import { RatesSettingsPageService } from './rates-settings-page.service';

export const RatesSettingsSchema = z.object({
  onlineRates: z.boolean(),
  coingeckoKey: z.string().trim().max(200, 'profile.errors.tooLong'),
});

/** The form → the API's changes: an empty key field keeps the stored key. */
export function ratesSettingsChanges(
  value: z.infer<typeof RatesSettingsSchema>,
): UpdateSettingsRequest {
  return {
    onlineRates: value.onlineRates,
    ...(value.coingeckoKey ? { keys: { coingecko: value.coingeckoKey } } : {}),
  };
}

/**
 * Einstellungen › Kurse (F11.3, F6.7, F7.4, F7.4a): rate lookups on the internet on/off, the
 * CoinGecko key (stored encrypted, shown as a hint), the automatic ESTV Kursliste (status per
 * year, "ESTV-Kursliste aktualisieren") and the manual Kursliste import into a project.
 */
@Component({
  selector: 'lk-rates-settings-page',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    TranslatePipe,
    PageHeader,
    Truncate,
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

  protected readonly form = inject(FormBuilder).nonNullable.group({
    onlineRates: [true],
    coingeckoKey: [''],
  });

  constructor() {
    this.estv.load();
    effect(() => {
      if (!this.service.settings.hasValue()) return;
      this.form.reset({
        onlineRates: this.service.settings.value().onlineRates,
        coingeckoKey: '',
      });
    });
    effect(() => {
      const first = this.projects()[0];
      if (first && this.projectId() === '') this.projectId.set(first.id);
    });
  }

  protected submit(): void {
    const parsed = RatesSettingsSchema.safeParse(this.form.getRawValue());
    if (!parsed.success) return;
    void this.service
      .save(ratesSettingsChanges(parsed.data))
      .catch(() => undefined);
  }

  protected removeKey(): void {
    void this.service.removeKey('coingecko').catch(() => undefined);
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
