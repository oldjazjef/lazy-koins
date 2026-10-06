import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { PageHeader } from '../../../../shared/components/page-header';
import { UserSettingsService } from '../../user-settings.service';

/**
 * Einstellungen › Wallets (F6.7): the keys the wallet lookups will need (Etherscan API V2, one key
 * for all EVM chains). Stored encrypted, shown as a hint; the lookups themselves follow.
 */
@Component({
  selector: 'lk-wallet-settings-page',
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
  templateUrl: './wallet-settings-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WalletSettingsPage {
  protected readonly service = inject(UserSettingsService);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    etherscanKey: [''],
  });

  protected submit(): void {
    const key = this.form.getRawValue().etherscanKey.trim();
    if (!key) return;
    void this.service
      .save({ keys: { etherscan: key } })
      .then(() => this.form.reset())
      .catch(() => undefined);
  }

  protected removeKey(): void {
    void this.service.removeKey('etherscan').catch(() => undefined);
  }
}
