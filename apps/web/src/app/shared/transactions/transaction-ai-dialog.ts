import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmDialogImports } from '@lazykoins/ui/dialog';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import type { TransactionAiPayload } from '../../core/api/transactions.types';
import { NotificationService } from '../../core/notifications/notification.service';
import { AiErrorPanel } from '../ai/ai-error-panel';
import { type AiErrorInfo, aiErrorInfo } from '../ai/ai-error-details';
import { TransactionEditsService } from './transaction-edits.service';

/**
 * F9.10 "Mit AI analysieren": shows exactly what will be sent (F5.14), asks for consent the first
 * time, then lets the AI suggest a kind per transaction — stored as suggestions ("von AI
 * vorgeschlagen"), nothing changes until they are accepted.
 */
@Component({
  selector: 'lk-transaction-ai-dialog',
  imports: [
    TranslatePipe,
    AiErrorPanel,
    ...HlmButtonImports,
    ...HlmDialogImports,
    ...HlmSkeletonImports,
  ],
  templateUrl: './transaction-ai-dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TransactionAiDialog {
  protected readonly edits = inject(TransactionEditsService);
  private readonly notifications = inject(NotificationService);

  /** `null` = closed; `[]` = every "unbekannt"; else the chosen keys. */
  readonly keys = input<readonly string[] | null>(null);
  readonly closed = output<boolean>();

  protected readonly payload = signal<TransactionAiPayload | null>(null);
  protected readonly loadError = signal<AiErrorInfo | null>(null);
  protected readonly runError = signal<AiErrorInfo | null>(null);
  protected readonly consent = signal(false);
  protected readonly json = computed(() => {
    const p = this.payload();
    return p ? JSON.stringify(p.payload, null, 2) : '';
  });
  protected readonly canRun = computed(() => {
    const p = this.payload();
    return !!p && (p.consentGiven || this.consent()) && !this.edits.isBusy();
  });

  constructor() {
    effect(() => {
      const keys = this.keys();
      this.payload.set(null);
      this.loadError.set(null);
      this.runError.set(null);
      this.consent.set(false);
      if (keys) void this.load(keys);
    });
  }

  private async load(keys: readonly string[]): Promise<void> {
    try {
      this.payload.set(await this.edits.aiPayload(keys));
    } catch (error) {
      this.loadError.set(aiErrorInfo(error));
    }
  }

  protected state(): 'open' | 'closed' {
    return this.keys() ? 'open' : 'closed';
  }

  protected changed(state: 'open' | 'closed'): void {
    if (state === 'closed' && this.keys()) this.closed.emit(false);
  }

  protected async run(): Promise<void> {
    const keys = this.keys();
    if (!keys || !this.canRun()) return;
    this.runError.set(null);
    try {
      const result = await this.edits.suggest(keys, true);
      this.notifications.info('txAi.done', { count: result.suggested });
      this.closed.emit(true);
    } catch (error) {
      this.runError.set(aiErrorInfo(error));
    }
  }
}
