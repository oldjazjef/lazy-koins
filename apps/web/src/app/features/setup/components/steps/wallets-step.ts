import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { z } from 'zod';
import { UserSettingsService } from '../../../settings/user-settings.service';
import { provideSetupStep, SetupStepComponent } from '../setup-step';

/** Where the Etherscan API key comes from (one key for every EVM chain, API V2). */
export const ETHERSCAN_KEY_PAGE = 'https://etherscan.io/myapikey';

const WalletKeySchema = z.object({
  etherscanKey: z.string().trim().max(200, 'profile.errors.tooLong'),
});

/**
 * Wallets & Netzwerke (F6.3, F6.7, optional): the Etherscan key the wallet lookups use — stored
 * sealed like every key, shown as a hint. The wallet lookups themselves (with a key test per
 * network) come with the wallets feature; until then this step only stores the key.
 */
@Component({
  selector: 'lk-setup-wallets-step',
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    ...HlmButtonImports,
    ...HlmInputImports,
    ...HlmLabelImports,
  ],
  providers: [provideSetupStep(() => WalletsStep)],
  template: `
    @if (service.settings.hasValue()) {
      @let settings = service.settings.value();
      <form
        class="flex flex-col gap-4"
        [formGroup]="form"
        (ngSubmit)="$event.preventDefault()"
      >
        @if (!settings.keyStorageAvailable) {
          <p class="text-destructive text-sm" role="note">
            {{ 'settings.keysUnavailable' | translate }}
          </p>
        }
        <div class="flex flex-col gap-2">
          <label hlmLabel for="setup-etherscan">{{
            'settings.fields.etherscanKey' | translate
          }}</label>
          <input
            hlmInput
            id="setup-etherscan"
            type="password"
            autocomplete="off"
            formControlName="etherscanKey"
            [placeholder]="
              settings.keys.etherscan ?? ('settings.noKey' | translate)
            "
          />
          <p class="text-muted-foreground text-xs">
            {{ 'settings.wallets.hint' | translate }}
            <a
              class="text-primary hover:underline"
              [href]="keyPage"
              target="_blank"
              rel="noopener noreferrer"
              >{{ 'setup.whereKey' | translate }}</a
            >
          </p>
        </div>
        @if (settings.keys.etherscan) {
          <div class="flex justify-end">
            <button hlmBtn variant="ghost" type="button" (click)="removeKey()">
              {{ 'settings.removeKey' | translate }}
            </button>
          </div>
        }
        <p class="text-muted-foreground text-sm" role="note">
          {{ 'setup.wallets.note' | translate }}
        </p>
      </form>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WalletsStep extends SetupStepComponent {
  protected readonly service = inject(UserSettingsService);
  protected readonly keyPage = ETHERSCAN_KEY_PAGE;

  readonly form = inject(FormBuilder).nonNullable.group({ etherscanKey: [''] });

  protected removeKey(): void {
    void this.service.removeKey('etherscan').catch(() => undefined);
  }

  async submit(): Promise<boolean> {
    const parsed = WalletKeySchema.safeParse(this.form.getRawValue());
    if (!parsed.success) return false;
    if (!parsed.data.etherscanKey) return true;
    try {
      await this.service.save(
        { keys: { etherscan: parsed.data.etherscanKey } },
        { quiet: true },
      );
      this.form.reset();
      return true;
    } catch {
      return false;
    }
  }
}
