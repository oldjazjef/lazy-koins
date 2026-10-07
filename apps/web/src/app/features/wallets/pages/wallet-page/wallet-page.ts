import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmDialogImports } from '@lazykoins/ui/dialog';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import { HlmTextareaImports } from '@lazykoins/ui/textarea';
import { lucideShieldCheck, lucideUndo2 } from '@ng-icons/lucide';
import type {
  AddressKind,
  NetworkId,
  TokenVerdict,
} from '../../../../core/api/wallets.types';
import { PageHeader } from '../../../../shared/components/page-header';
import { paginate, Paginator } from '../../../../shared/components/paginator';
import {
  type RowAction,
  RowActions,
} from '../../../../shared/components/row-actions';
import { Truncate } from '../../../../shared/components/truncate';

type TokenAction = 'notSpam' | 'reset';

interface TokenRow extends TokenVerdict {
  readonly network: NetworkId;
  readonly rowKey: string;
}
import { zodValidator } from '../../../../shared/forms/zod-validator';
import { NetworkStatus } from '../../components/network-status';
import { WalletPageService } from './wallet-page.service';
import { WalletFormSchema } from './wallet.schema';

/**
 * One wallet (F6.1): the form (label, address — fixed once saved —, networks, notes), and for a
 * saved wallet "Netzwerke prüfen" (F6.4), "Abrufen" (F6.3), the status per network, the tokens
 * with "kein Spam" (F6.6) and delete (a dialog). A seed phrase or private key is refused (F6.2):
 * the fields are emptied and a warning explains why.
 */
@Component({
  selector: 'lk-wallet-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    PageHeader,
    NetworkStatus,
    Paginator,
    RowActions,
    Truncate,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmDialogImports,
    ...HlmInputImports,
    ...HlmLabelImports,
    ...HlmSkeletonImports,
    ...HlmTableImports,
    ...HlmTextareaImports,
  ],
  providers: [WalletPageService],
  templateUrl: './wallet-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WalletPage {
  protected readonly service = inject(WalletPageService);

  /** Route param; absent on `/app/wallets/new` (no default — see CLAUDE.md). */
  readonly id = input<string>();

  protected readonly form = inject(FormBuilder).nonNullable.group(
    { label: [''], address: [''], notes: [''] },
    { validators: zodValidator(WalletFormSchema) },
  );

  /** New wallet: what the typed address is and the networks it can live on. */
  protected readonly kind = signal<AddressKind | null>(null);
  protected readonly possible = signal<readonly NetworkId[]>([]);
  protected readonly selected = signal<ReadonlySet<NetworkId>>(new Set());
  protected readonly unknownAddress = signal(false);
  protected readonly confirmDelete = signal(false);

  protected readonly isNew = computed(() => this.id() === undefined);

  /** F6.6: every token of every network in one paged table. */
  protected readonly tokenRows = computed<TokenRow[]>(() =>
    this.service.tokens.hasValue()
      ? this.service.tokens.value().flatMap((group) =>
          group.tokens.map((token) => ({
            ...token,
            network: group.network,
            rowKey: `${group.network}|${token.tokenKey}`,
          })),
        )
      : [],
  );
  protected readonly tokenPager = paginate(this.tokenRows, {
    storageKey: 'wallet-tokens',
  });
  protected readonly tokenActions = computed(
    () =>
      new Map<string, readonly RowAction<TokenAction>[]>(
        this.tokenRows().map((token) => [
          token.rowKey,
          [
            {
              id: 'notSpam',
              labelKey: 'wallets.tokens.markNotSpam',
              icon: lucideShieldCheck,
              hidden: !token.spam,
            },
            {
              id: 'reset',
              labelKey: 'wallets.tokens.undo',
              icon: lucideUndo2,
              hidden: !token.overridden,
            },
          ],
        ]),
      ),
  );

  protected tokenAct(action: string, token: TokenRow): void {
    void this.service.setToken(
      token.network,
      token.tokenKey,
      action === 'notSpam',
    );
  }

  constructor() {
    effect(() => this.service.walletId.set(this.id()));
    effect(() => {
      const wallet = this.service.wallet.hasValue()
        ? this.service.wallet.value()
        : undefined;
      if (!wallet) return;
      this.form.reset({
        label: wallet.label,
        address: wallet.address,
        notes: wallet.notes,
      });
      this.kind.set(wallet.addressKind);
      this.possible.set(wallet.possibleNetworks);
      this.selected.set(new Set(wallet.networks));
    });
  }

  protected async inspect(): Promise<void> {
    if (!this.isNew()) return;
    const result = await this.service.inspect(this.form.controls.address.value);
    if (!result) return;
    if (result.secret) {
      this.clearSecrets();
      return;
    }
    this.kind.set(result.addressKind);
    this.unknownAddress.set(result.addressKind === null);
    this.possible.set(result.networks);
    this.selected.set(new Set(result.networks));
  }

  protected toggle(network: NetworkId, event: Event): void {
    const next = new Set(this.selected());
    if ((event.target as HTMLInputElement).checked) next.add(network);
    else next.delete(network);
    this.selected.set(next);
    this.form.markAsDirty();
  }

  protected async submit(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const value = this.form.getRawValue();
    const networks = this.possible().filter((n) => this.selected().has(n));
    const ok = await this.service.save({
      label: value.label.trim(),
      address: this.isNew() ? value.address.trim() : undefined,
      networks,
      notes: value.notes,
    });
    if (!ok && this.service.refused()) this.clearSecrets();
    if (ok && !this.isNew()) this.form.markAsPristine();
  }

  /** F6.2: never keep a secret on screen — empty every field it could be in. */
  private clearSecrets(): void {
    this.form.patchValue({
      address: this.isNew() ? '' : this.form.controls.address.value,
      notes: '',
    });
    if (this.isNew()) {
      this.kind.set(null);
      this.possible.set([]);
      this.selected.set(new Set());
    }
  }

  protected deleteState(): 'open' | 'closed' {
    return this.confirmDelete() ? 'open' : 'closed';
  }

  protected deleteChanged(state: 'open' | 'closed'): void {
    if (state === 'closed') this.confirmDelete.set(false);
  }

  protected async remove(): Promise<void> {
    if (await this.service.remove()) this.confirmDelete.set(false);
  }
}
