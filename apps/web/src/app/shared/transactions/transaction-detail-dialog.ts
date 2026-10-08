import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmDialogImports } from '@lazykoins/ui/dialog';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import type {
  Transaction,
  TransactionChanges,
  TransactionDetail,
  TransactionEdit,
} from '../../core/api/transactions.types';
import { Truncate } from '../components/truncate';
import { LkDatePipe } from '../format/date.pipe';
import { ChfPipe, QuantityPipe } from '../format/number-format';
import type { TransactionEditRequest } from './transaction-edit-dialog';
import { TransactionEditsService } from './transaction-edits.service';

/** The changes of one edit as (label key, value) pairs for the history. */
export function changeLines(
  changes: TransactionChanges,
): { key: string; value: string | boolean | null; kind?: boolean }[] {
  const lines: {
    key: string;
    value: string | boolean | null;
    kind?: boolean;
  }[] = [];
  if (changes.kind !== undefined) {
    lines.push({ key: 'txEdit.kind', value: changes.kind, kind: true });
  }
  if (changes.asset !== undefined) {
    lines.push({ key: 'txEdit.asset', value: changes.asset });
  }
  if (changes.note !== undefined) {
    lines.push({ key: 'txEdit.note', value: changes.note });
  }
  if (changes.hidden !== undefined) {
    lines.push({
      key: changes.hidden ? 'txEdit.history.hidden' : 'txEdit.history.shown',
      value: null,
    });
  }
  if (changes.linkedKey !== undefined) {
    lines.push({
      key: changes.linkedKey
        ? 'txEdit.history.linked'
        : 'txEdit.history.unlinked',
      value: null,
    });
  }
  return lines;
}

/**
 * F9.5 detail: the transaction, its original file row (F7.5), the AI's suggestion (F9.10) and the
 * history of its global edits with undo / redo (F9.4, F9.11 superseded ones included).
 */
@Component({
  selector: 'lk-transaction-detail-dialog',
  imports: [
    RouterLink,
    TranslatePipe,
    LkDatePipe,
    ChfPipe,
    QuantityPipe,
    Truncate,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmDialogImports,
    ...HlmSkeletonImports,
    ...HlmTableImports,
  ],
  templateUrl: './transaction-detail-dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TransactionDetailDialog {
  protected readonly edits = inject(TransactionEditsService);
  protected readonly changeLines = changeLines;

  readonly key = input<string | null>(null);
  readonly currency = input('CHF');
  readonly closed = output<void>();
  /** "Bearbeiten" / "Ausblenden" / "Einblenden": the host opens the edit dialog. */
  readonly edit = output<TransactionEditRequest>();
  /** "Mit Gegenbuchung verknüpfen": the host opens the link dialog. */
  readonly link = output<Transaction>();

  protected readonly detail = signal<TransactionDetail | null>(null);
  protected readonly failed = signal(false);
  protected readonly locked = signal<string[]>([]);

  constructor() {
    effect(() => {
      const key = this.key();
      this.detail.set(null);
      this.failed.set(false);
      this.locked.set([]);
      if (key) void this.load(key);
    });
  }

  /** Loads (again) — also after an undo or an accepted suggestion. */
  async load(key = this.key()): Promise<void> {
    if (!key) return;
    try {
      this.detail.set(await this.edits.detail(key));
    } catch {
      this.failed.set(true);
    }
  }

  protected state(): 'open' | 'closed' {
    return this.key() ? 'open' : 'closed';
  }

  protected changed(state: 'open' | 'closed'): void {
    if (state === 'closed' && this.key()) this.closed.emit();
  }

  protected async undo(edit: TransactionEdit): Promise<void> {
    try {
      const locked = await this.edits.setUndone(
        edit.id,
        edit.status === 'active',
      );
      this.locked.set(locked);
      await this.load();
    } catch {
      // The action runner reported it.
    }
  }

  protected async decide(accept: boolean): Promise<void> {
    const suggestion = this.detail()?.transaction.suggestion;
    if (!suggestion) return;
    try {
      this.locked.set(await this.edits.decide([suggestion.id], accept));
      await this.load();
    } catch {
      // The action runner reported it.
    }
  }

  protected rule(t: Transaction): void {
    void this.edits.addRule(t.key, t.kind).catch(() => undefined);
  }

  protected request(
    t: Transaction,
    mode: TransactionEditRequest['mode'],
  ): TransactionEditRequest {
    return {
      keys: [t.key],
      mode,
      kind: t.kind,
      asset: t.asset,
      note: t.note,
    };
  }

  protected names(projects: Transaction['lockedBy']): string {
    return projects.map((p) => `${p.name} ${p.taxYear}`).join(', ');
  }

  protected rawEntries(raw: Record<string, string>): [string, string][] {
    return Object.entries(raw);
  }
}
