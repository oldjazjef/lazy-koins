import { HttpClient } from '@angular/common/http';
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
import { firstValueFrom } from 'rxjs';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmDialogImports } from '@lazykoins/ui/dialog';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTextareaImports } from '@lazykoins/ui/textarea';
import { apiUrl } from '../../core/api/api-url';
import type {
  Transaction,
  TransactionsPage,
} from '../../core/api/transactions.types';
import { Truncate } from '../components/truncate';
import { LkDatePipe } from '../format/date.pipe';
import { QuantityPipe } from '../format/number-format';
import { REASON_MAX } from './transaction-edit-dialog';
import { TransactionEditsService } from './transaction-edits.service';

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far apart a counter-booking may be (the transfer check's −1 h … +7 d, both ways). */
const WINDOW_DAYS = 7;

/** The candidates for a counter-booking: same asset, opposite sign, another account, ±7 days. */
export function counterCandidates(
  of: Transaction,
  rows: readonly Transaction[],
): Transaction[] {
  const outgoing = of.quantity.startsWith('-');
  const at = Date.parse(of.timestamp);
  return rows
    .filter(
      (r) =>
        r.key !== of.key &&
        r.asset === of.asset &&
        r.quantity.startsWith('-') !== outgoing &&
        (r.platform !== of.platform || r.accountId !== of.accountId) &&
        Math.abs(Date.parse(r.timestamp) - at) <= WINDOW_DAYS * DAY_MS,
    )
    .sort(
      (a, b) =>
        Math.abs(Date.parse(a.timestamp) - at) -
        Math.abs(Date.parse(b.timestamp) - at),
    );
}

/**
 * F9.8 "als intern verschoben mit Gegenbuchung verknüpfen": picks the counter-booking (same
 * asset, opposite sign, another account, ±7 days) — both then count as transfers.
 */
@Component({
  selector: 'lk-transaction-link-dialog',
  imports: [
    FormsModule,
    TranslatePipe,
    LkDatePipe,
    QuantityPipe,
    Truncate,
    ...HlmButtonImports,
    ...HlmDialogImports,
    ...HlmLabelImports,
    ...HlmSkeletonImports,
    ...HlmTextareaImports,
  ],
  templateUrl: './transaction-link-dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TransactionLinkDialog {
  private readonly http = inject(HttpClient);
  protected readonly edits = inject(TransactionEditsService);
  protected readonly reasonMax = REASON_MAX;

  readonly transaction = input<Transaction | null>(null);
  readonly closed = output<boolean>();

  protected readonly candidates = signal<Transaction[] | null>(null);
  protected readonly chosen = signal('');
  protected readonly reason = signal('');
  protected readonly locked = signal<string[]>([]);

  constructor() {
    effect(() => {
      const t = this.transaction();
      this.candidates.set(null);
      this.chosen.set('');
      this.reason.set('');
      this.locked.set([]);
      if (t) void this.load(t);
    });
  }

  private async load(t: Transaction): Promise<void> {
    const at = Date.parse(t.timestamp);
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    try {
      const page = await firstValueFrom(
        this.http.get<TransactionsPage>(apiUrl('/transactions'), {
          params: {
            asset: t.asset,
            from: day(at - WINDOW_DAYS * DAY_MS),
            to: day(at + WINDOW_DAYS * DAY_MS),
            limit: 200,
          },
        }),
      );
      const list = counterCandidates(t, page.rows);
      this.candidates.set(list);
      this.chosen.set(list[0]?.key ?? '');
    } catch {
      this.candidates.set([]);
    }
  }

  protected state(): 'open' | 'closed' {
    return this.transaction() ? 'open' : 'closed';
  }

  protected changed(state: 'open' | 'closed'): void {
    if (state === 'closed' && this.transaction()) this.closed.emit(false);
  }

  protected async save(t: Transaction): Promise<void> {
    const reason = this.reason().trim();
    if (!this.chosen() || !reason) return;
    try {
      const locked = await this.edits.edit(
        [t.key],
        { linkedKey: this.chosen() },
        reason.slice(0, REASON_MAX),
      );
      if (locked.length > 0) this.locked.set(locked);
      else this.closed.emit(true);
    } catch {
      // The action runner reported it.
    }
  }
}
