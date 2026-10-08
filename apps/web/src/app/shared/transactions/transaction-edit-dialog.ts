import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmDialogImports } from '@lazykoins/ui/dialog';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { HlmTextareaImports } from '@lazykoins/ui/textarea';
import { BOOKING_KINDS, type BookingKind } from '../../core/api/api.types';
import type { TransactionChanges } from '../../core/api/transactions.types';
import { TransactionEditsService } from './transaction-edits.service';

/** What the edit dialog opens with. */
export interface TransactionEditRequest {
  readonly keys: readonly string[];
  /** `hide` / `show`: only the reason is asked; `edit`: kind (+ asset, note for one). */
  readonly mode: 'edit' | 'hide' | 'show';
  /** The current values when one transaction is edited. */
  readonly kind?: BookingKind;
  readonly asset?: string;
  readonly note?: string | null;
}

export const REASON_MAX = 1000;
export const NOTE_MAX = 500;

/**
 * F9.8: change one or several transactions globally — kind (bulk), asset and note (one), hide /
 * show — always with a reason. A transaction a closed project uses is refused (F9.9): the
 * dialog names the projects.
 */
@Component({
  selector: 'lk-transaction-edit-dialog',
  imports: [
    FormsModule,
    TranslatePipe,
    ...HlmButtonImports,
    ...HlmDialogImports,
    ...HlmInputImports,
    ...HlmLabelImports,
    ...HlmTextareaImports,
  ],
  templateUrl: './transaction-edit-dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TransactionEditDialog {
  protected readonly edits = inject(TransactionEditsService);
  protected readonly kinds = BOOKING_KINDS;
  protected readonly reasonMax = REASON_MAX;
  protected readonly noteMax = NOTE_MAX;

  readonly request = input<TransactionEditRequest | null>(null);
  /** Closed: `true` when something was saved. */
  readonly closed = output<boolean>();

  protected readonly kind = signal<BookingKind | ''>('');
  protected readonly asset = signal('');
  protected readonly note = signal('');
  protected readonly reason = signal('');
  protected readonly reasonMissing = signal(false);
  protected readonly locked = signal<string[]>([]);

  constructor() {
    effect(() => {
      const request = this.request();
      if (!request) return;
      this.kind.set(request.keys.length === 1 ? (request.kind ?? '') : '');
      this.asset.set(request.asset ?? '');
      this.note.set(request.note ?? '');
      this.reason.set('');
      this.reasonMissing.set(false);
      this.locked.set([]);
    });
  }

  protected state(): 'open' | 'closed' {
    return this.request() ? 'open' : 'closed';
  }

  protected changed(state: 'open' | 'closed'): void {
    if (state === 'closed' && this.request()) this.closed.emit(false);
  }

  /** The changes the form describes (only what differs for a single transaction). */
  protected changes(request: TransactionEditRequest): TransactionChanges {
    if (request.mode === 'hide') return { hidden: true };
    if (request.mode === 'show') return { hidden: false };
    const out: TransactionChanges = {};
    const kind = this.kind();
    if (kind && kind !== request.kind) out.kind = kind;
    if (request.keys.length === 1) {
      const asset = this.asset().trim().toUpperCase();
      if (asset && asset !== request.asset) out.asset = asset;
      const note = this.note().trim();
      if (note !== (request.note ?? '')) out.note = note;
    }
    return out;
  }

  protected async save(): Promise<void> {
    const request = this.request();
    if (!request) return;
    const reason = this.reason().trim();
    if (!reason) {
      this.reasonMissing.set(true);
      return;
    }
    const changes = this.changes(request);
    if (Object.keys(changes).length === 0) {
      this.closed.emit(false);
      return;
    }
    try {
      const locked = await this.edits.edit(
        request.keys,
        changes,
        reason.slice(0, REASON_MAX),
      );
      if (locked.length > 0) this.locked.set(locked);
      else this.closed.emit(true);
    } catch {
      // The action runner reported it.
    }
  }
}
