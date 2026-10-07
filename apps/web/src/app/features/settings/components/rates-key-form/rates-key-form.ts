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
import { z } from 'zod';
import type { UpdateSettingsRequest } from '../../../../core/api/calculation.types';
import { UserSettingsService } from '../../user-settings.service';

export const RatesSettingsSchema = z.object({
  onlineRates: z.boolean(),
});

/** The form → the API's changes. */
export function ratesSettingsChanges(
  value: z.infer<typeof RatesSettingsSchema>,
): UpdateSettingsRequest {
  return { onlineRates: value.onlineRates };
}

/**
 * Rate lookups on the internet on/off (F11.3). The provider keys (CoinGecko, CoinMarketCap) are
 * typed and tested in their row of "Kursanbieter" (`lk-price-sources-form`, user request
 * 07.10.2026). Shared by Einstellungen › Kurse and the setup wizard (F11.0s); `embedded` hides
 * the save button — "Weiter" calls `submit()`.
 */
@Component({
  selector: 'lk-rates-key-form',
  imports: [ReactiveFormsModule, TranslatePipe, ...HlmButtonImports],
  templateUrl: './rates-key-form.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RatesKeyForm {
  readonly embedded = input(false);
  protected readonly service = inject(UserSettingsService);

  readonly form = inject(FormBuilder).nonNullable.group({
    onlineRates: [true],
  });

  constructor() {
    effect(() => {
      if (!this.service.settings.hasValue() || this.form.dirty) return;
      this.form.reset({
        onlineRates: this.service.settings.value().onlineRates,
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
      this.form.reset({ onlineRates: parsed.data.onlineRates });
      return true;
    } catch {
      return false;
    }
  }

  protected save(): void {
    void this.submit();
  }
}
