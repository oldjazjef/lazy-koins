import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { z } from 'zod';
import { CH_CANTONS } from '../../../../core/api/api.types';
import type { UpdateSettingsRequest } from '../../../../core/api/calculation.types';
import { PageHeader } from '../../../../shared/components/page-header';
import { zodValidator } from '../../../../shared/forms/zod-validator';
import { SettingsPageService } from './settings-page.service';

export const SettingsSchema = z.object({
  displayName: z.string().trim().max(120, 'settings.errors.tooLong'),
  canton: z.union([z.literal(''), z.enum(CH_CANTONS)]),
  advisorName: z.string().trim().max(120, 'settings.errors.tooLong'),
  advisorEmail: z.union([
    z.literal(''),
    z.string().trim().email('settings.errors.email').max(200),
  ]),
  onlineRates: z.boolean(),
  coingeckoKey: z.string().trim().max(200, 'settings.errors.tooLong'),
  etherscanKey: z.string().trim().max(200, 'settings.errors.tooLong'),
});

/** The form → the API's changes: an empty key field keeps the stored key. */
export function settingsChanges(
  value: z.infer<typeof SettingsSchema>,
): UpdateSettingsRequest {
  const keys: UpdateSettingsRequest['keys'] = {};
  if (value.coingeckoKey) keys.coingecko = value.coingeckoKey;
  if (value.etherscanKey) keys.etherscan = value.etherscanKey;
  return {
    displayName: value.displayName,
    canton: value.canton,
    advisorName: value.advisorName,
    advisorEmail: value.advisorEmail,
    onlineRates: value.onlineRates,
    ...(Object.keys(keys).length > 0 ? { keys } : {}),
  };
}

/** F11.1–F11.3, F6.7. */
@Component({
  selector: 'lk-settings-page',
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    PageHeader,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmInputImports,
    ...HlmLabelImports,
    ...HlmSkeletonImports,
  ],
  templateUrl: './settings-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPage {
  protected readonly service = inject(SettingsPageService);
  protected readonly cantons = CH_CANTONS;

  protected readonly form = inject(FormBuilder).nonNullable.group(
    {
      displayName: [''],
      canton: [''],
      advisorName: [''],
      advisorEmail: [''],
      onlineRates: [true],
      coingeckoKey: [''],
      etherscanKey: [''],
    },
    { validators: zodValidator(SettingsSchema) },
  );

  constructor() {
    effect(() => {
      if (!this.service.settings.hasValue()) return;
      const settings = this.service.settings.value();
      this.form.reset({
        displayName: settings.displayName,
        canton: settings.canton,
        advisorName: settings.advisorName,
        advisorEmail: settings.advisorEmail,
        onlineRates: settings.onlineRates,
        coingeckoKey: '',
        etherscanKey: '',
      });
    });
  }

  protected submit(): void {
    this.form.markAllAsTouched();
    const parsed = SettingsSchema.safeParse(this.form.getRawValue());
    if (!parsed.success) return;
    void this.service.save(settingsChanges(parsed.data)).catch(() => undefined);
  }

  protected remove(name: 'coingecko' | 'etherscan'): void {
    void this.service.removeKey(name).catch(() => undefined);
  }
}
