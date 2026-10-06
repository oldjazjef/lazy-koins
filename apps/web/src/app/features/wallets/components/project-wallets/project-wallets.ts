import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import type {
  NetworkId,
  ProjectWallet,
} from '../../../../core/api/wallets.types';
import { EmptyState } from '../../../../shared/components/empty-state';
import { QuantityPipe } from '../../../../shared/format/number-format';
import { NetworkStatus } from '../network-status';
import { ProjectWalletsService } from './project-wallets.service';

/** The manual-balance form of one wallet (F6.5). */
interface BalanceDraft {
  network: NetworkId | '';
  asset: string;
  quantity: string;
  evidenceFileId: string;
  note: string;
}

const EMPTY_DRAFT: BalanceDraft = {
  network: '',
  asset: '',
  quantity: '',
  evidenceFileId: '',
  note: '',
};

/**
 * The project's "Wallets" tab (F6): include wallets, check and fetch them, see per network what
 * arrived, and enter balances at 31.12. by hand with a PDF receipt where nothing (or only
 * income) can be fetched. The fetched records reach the calculation as derived files.
 */
@Component({
  selector: 'lk-project-wallets',
  imports: [
    FormsModule,
    RouterLink,
    TranslatePipe,
    QuantityPipe,
    EmptyState,
    NetworkStatus,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmInputImports,
    ...HlmLabelImports,
    ...HlmSkeletonImports,
    ...HlmTableImports,
  ],
  providers: [ProjectWalletsService],
  templateUrl: './project-wallets.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectWallets {
  protected readonly service = inject(ProjectWalletsService);

  readonly projectId = input.required<string>();
  readonly closed = input(false);

  protected readonly toAdd = signal('');
  /** The wallet whose balance form is open, and its values. */
  protected readonly editing = signal<string | null>(null);
  protected readonly draft = signal<BalanceDraft>({ ...EMPTY_DRAFT });

  constructor() {
    effect(() => this.service.projectId.set(this.projectId()));
  }

  protected async add(): Promise<void> {
    const id = this.toAdd();
    if (!id) return;
    if (await this.service.add(id)) this.toAdd.set('');
  }

  protected openBalance(entry: ProjectWallet): void {
    const manual = entry.wallet.perNetwork.find(
      (n) => n.selected && n.coverage !== 'history',
    );
    this.draft.set({
      ...EMPTY_DRAFT,
      network: manual?.network ?? entry.wallet.possibleNetworks[0] ?? '',
    });
    this.editing.set(entry.wallet.id);
  }

  protected patch(changes: Partial<BalanceDraft>): void {
    this.draft.set({ ...this.draft(), ...changes });
  }

  protected async receiptPicked(event: Event): Promise<void> {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    target.value = '';
    if (!file) return;
    const stored = await this.service.uploadReceipt(file);
    if (stored) this.patch({ evidenceFileId: stored.id });
  }

  protected canSave(): boolean {
    const d = this.draft();
    return (
      d.network !== '' &&
      d.asset.trim() !== '' &&
      /^\d+([.,]\d+)?$/.test(d.quantity.trim()) &&
      d.evidenceFileId !== ''
    );
  }

  protected async saveBalance(walletId: string): Promise<void> {
    const d = this.draft();
    if (!this.canSave() || d.network === '') return;
    const ok = await this.service.addBalance(walletId, {
      network: d.network,
      asset: d.asset.trim(),
      quantity: d.quantity.trim().replace(',', '.'),
      evidenceFileId: d.evidenceFileId,
      note: d.note.trim() || undefined,
    });
    if (ok) this.editing.set(null);
  }
}
