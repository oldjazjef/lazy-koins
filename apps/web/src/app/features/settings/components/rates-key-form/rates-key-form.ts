import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { z } from 'zod';
import type { UpdateSettingsRequest } from '../../../../core/api/calculation.types';
import { UserSettingsService } from '../../user-settings.service';
import { KeyCheckResultPanel } from '../key-check-result/key-check-result';

/** Where a free CoinGecko demo key comes from (F11.0s "Wo bekomme ich den Schlüssel?"). */
export const COINGECKO_KEY_PAGE =
  'https://www.coingecko.com/en/developers/dashboard';

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
 * Rate lookups on the internet on/off (F11.3) and the CoinGecko key (F6.7) with "Testen". Shared
 * by Einstellungen › Kurse and the setup wizard (F11.0s); `embedded` hides the save button —
 * "Weiter" calls `submit()`.
 */
@Component({
  selector: 'lk-rates-key-form',
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    KeyCheckResultPanel,
    ...HlmButtonImports,
    ...HlmInputImports,
    ...HlmLabelImports,
  ],
  templateUrl: './rates-key-form.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RatesKeyForm {
  readonly embedded = input(false);
  protected readonly service = inject(UserSettingsService);
  protected readonly keyPage = COINGECKO_KEY_PAGE;

  readonly form = inject(FormBuilder).nonNullable.group({
    onlineRates: [true],
    coingeckoKey: [''],
  });

  constructor() {
    effect(() => {
      if (!this.service.settings.hasValue() || this.form.dirty) return;
      this.form.reset({
        onlineRates: this.service.settings.value().onlineRates,
        coingeckoKey: '',
      });
    });
  }

  /** Saves the form; true when saved or nothing changed. */
  async submit(): Promise<boolean> {
    const parsed = RatesSettingsSchema.safeParse(this.form.getRawValue());
    if (!parsed.success) return false;
    if (this.form.pristine) return true;
    try {
      await this.service.save(ratesSettingsChanges(parsed.data), {
        quiet: this.embedded(),
      });
      this.form.reset({
        onlineRates: parsed.data.onlineRates,
        coingeckoKey: '',
      });
      return true;
    } catch {
      return false;
    }
  }

  protected save(): void {
    void this.submit();
  }

  /** Tests the typed key (never stored), else the stored one. */
  protected test(): void {
    void this.service.testCoingeckoKey(this.form.getRawValue().coingeckoKey);
  }

  protected removeKey(): void {
    void this.service.removeKey('coingecko').catch(() => undefined);
  }
}
