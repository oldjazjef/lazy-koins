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
import type {
  ChainService,
  ChainSettingsRequest,
} from '../../../../core/api/wallets.types';
import { PageHeader } from '../../../../shared/components/page-header';
import { WalletSettingsPageService } from './wallet-settings-page.service';

type KeyField = 'etherscanKey' | 'heliusKey' | 'subscanKey';
type UrlField = 'solanaRpcUrl' | 'esploraUrl' | 'koiosUrl' | 'cosmosLcdUrl';

/** One block of the page: a service, its key and/or URL, and its "Testen". */
interface ServiceBlock {
  readonly service: ChainService;
  readonly key?: { field: KeyField; hint: 'etherscan' | 'helius' | 'subscan' };
  readonly url?: {
    field: UrlField;
    fallback: 'solanaRpcUrl' | 'esploraUrl' | 'koiosUrl' | 'cosmosLcdUrl';
  };
}

const BLOCKS: readonly ServiceBlock[] = [
  { service: 'etherscan', key: { field: 'etherscanKey', hint: 'etherscan' } },
  {
    service: 'solana',
    key: { field: 'heliusKey', hint: 'helius' },
    url: { field: 'solanaRpcUrl', fallback: 'solanaRpcUrl' },
  },
  { service: 'esplora', url: { field: 'esploraUrl', fallback: 'esploraUrl' } },
  { service: 'koios', url: { field: 'koiosUrl', fallback: 'koiosUrl' } },
  { service: 'subscan', key: { field: 'subscanKey', hint: 'subscan' } },
  {
    service: 'cosmos',
    url: { field: 'cosmosLcdUrl', fallback: 'cosmosLcdUrl' },
  },
];

/**
 * Einstellungen › Wallets & Netzwerke (F6.7): keys (stored encrypted, shown as a hint) and
 * addresses for every network adapter, each with "Testen" on the values in the form — saved or
 * not — and the precise error (code, HTTP status, the provider's words) when it fails.
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
  protected readonly service = inject(WalletSettingsPageService);
  protected readonly blocks = BLOCKS;

  protected readonly form = inject(FormBuilder).nonNullable.group({
    etherscanKey: [''],
    heliusKey: [''],
    subscanKey: [''],
    solanaRpcUrl: [''],
    esploraUrl: [''],
    koiosUrl: [''],
    cosmosLcdUrl: [''],
  });

  constructor() {
    effect(() => {
      if (!this.service.settings.hasValue()) return;
      const s = this.service.settings.value();
      this.form.reset({
        etherscanKey: '',
        heliusKey: '',
        subscanKey: '',
        solanaRpcUrl: s.solanaRpcUrl,
        esploraUrl: s.esploraUrl,
        koiosUrl: s.koiosUrl,
        cosmosLcdUrl: s.cosmosLcdUrl,
      });
    });
  }

  /** The form as a request: typed keys only (an empty key field keeps the stored key). */
  private request(): ChainSettingsRequest {
    const v = this.form.getRawValue();
    const key = (value: string) =>
      value.trim() === '' ? undefined : value.trim();
    return {
      etherscanKey: key(v.etherscanKey),
      heliusKey: key(v.heliusKey),
      subscanKey: key(v.subscanKey),
      solanaRpcUrl: v.solanaRpcUrl.trim(),
      esploraUrl: v.esploraUrl.trim(),
      koiosUrl: v.koiosUrl.trim(),
      cosmosLcdUrl: v.cosmosLcdUrl.trim(),
    };
  }

  protected async submit(): Promise<void> {
    if (await this.service.save(this.request())) this.form.markAsPristine();
  }

  protected test(service: ChainService): void {
    void this.service.test(service, this.request());
  }

  protected removeKey(field: KeyField): void {
    void this.service.save({ [field]: null });
  }
}
