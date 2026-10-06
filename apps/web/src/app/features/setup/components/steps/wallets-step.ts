import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import type {
  ChainService,
  ChainSettingsRequest,
} from '../../../../core/api/wallets.types';
import { WalletSettingsPageService } from '../../../settings/pages/wallet-settings-page/wallet-settings-page.service';
import { provideSetupStep, SetupStepComponent } from '../setup-step';

/** Where the keys come from (the providers' own pages). */
export const WALLET_KEY_PAGES = {
  etherscan: 'https://etherscan.io/myapikey',
  helius: 'https://dashboard.helius.dev/',
} as const;

/** The keys this step asks for; the rest (Subscan, own addresses) stays in the settings. */
const KEYS: ReadonlyArray<{
  service: ChainService;
  field: 'etherscanKey' | 'heliusKey';
  hint: 'etherscan' | 'helius';
}> = [
  { service: 'etherscan', field: 'etherscanKey', hint: 'etherscan' },
  { service: 'solana', field: 'heliusKey', hint: 'helius' },
];

/**
 * Wallets & Netzwerke (F6.3, F6.7, optional): the Etherscan key (every EVM chain) and the Helius
 * key (Solana), each with "Testen" — the settings' own service and endpoints
 * (`/api/settings/wallets`). Further networks and own addresses live in Einstellungen › Wallets
 * & Netzwerke; the first wallet addresses on the Wallets page.
 */
@Component({
  selector: 'lk-setup-wallets-step',
  imports: [
    ReactiveFormsModule,
    RouterLink,
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
        class="flex flex-col gap-5"
        [formGroup]="form"
        (ngSubmit)="$event.preventDefault()"
      >
        @if (!settings.keyStorageAvailable) {
          <p class="text-destructive text-sm" role="note">
            {{ 'settings.keysUnavailable' | translate }}
          </p>
        }
        @for (key of keys; track key.field) {
          <div class="flex flex-col gap-2">
            <label hlmLabel [for]="'setup-' + key.field">{{
              'settings.wallets.fields.' + key.field | translate
            }}</label>
            <div class="flex flex-wrap gap-2">
              <input
                hlmInput
                class="min-w-64 flex-1"
                [id]="'setup-' + key.field"
                type="password"
                autocomplete="off"
                [formControlName]="key.field"
                [placeholder]="
                  settings.keys[key.hint] ?? ('settings.noKey' | translate)
                "
              />
              <button
                hlmBtn
                variant="outline"
                type="button"
                [disabled]="service.testing() !== null"
                (click)="test(key.service)"
              >
                {{
                  (service.testing() === key.service
                    ? 'settings.wallets.testing'
                    : 'settings.wallets.test'
                  ) | translate
                }}
              </button>
            </div>
            <p class="text-muted-foreground text-xs">
              {{
                'settings.wallets.services.' + key.service + '.hint' | translate
              }}
              <a
                class="text-primary hover:underline"
                [href]="keyPages[key.hint]"
                target="_blank"
                rel="noopener noreferrer"
                >{{ 'setup.whereKey' | translate }}</a
              >
            </p>
            @if (service.results()[key.service]; as result) {
              @if (result.ok) {
                <p class="text-sm" role="status">
                  {{
                    'settings.wallets.testOk'
                      | translate
                        : { detail: result.detail, millis: result.millis }
                  }}
                </p>
              } @else {
                <p class="text-destructive text-sm" role="alert">
                  {{ result.key | translate }}
                  @if (result.detail) {
                    <span class="block text-xs break-all">{{
                      result.detail
                    }}</span>
                  }
                </p>
              }
            }
          </div>
        }
        <p class="text-muted-foreground text-sm">
          {{ 'setup.wallets.note' | translate }}
          <a class="text-primary hover:underline" routerLink="/app/wallets">{{
            'setup.wallets.addresses' | translate
          }}</a>
        </p>
      </form>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WalletsStep extends SetupStepComponent {
  protected readonly service = inject(WalletSettingsPageService);
  protected readonly keys = KEYS;
  protected readonly keyPages = WALLET_KEY_PAGES;

  readonly form = inject(FormBuilder).nonNullable.group({
    etherscanKey: [''],
    heliusKey: [''],
  });

  /** The typed keys; an empty field keeps the stored key. */
  private request(): ChainSettingsRequest {
    const { etherscanKey, heliusKey } = this.form.getRawValue();
    return {
      ...(etherscanKey.trim() ? { etherscanKey: etherscanKey.trim() } : {}),
      ...(heliusKey.trim() ? { heliusKey: heliusKey.trim() } : {}),
    };
  }

  /** "Testen" with what is typed (never stored) over the saved values. */
  protected test(service: ChainService): void {
    void this.service.test(service, this.request());
  }

  async submit(): Promise<boolean> {
    const request = this.request();
    if (Object.keys(request).length === 0) return true;
    const saved = await this.service.save(request, { quiet: true });
    if (saved) this.form.reset();
    return saved;
  }
}
