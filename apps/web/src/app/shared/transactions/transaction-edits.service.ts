import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { defineAction } from '../../core/actions/action';
import { ActionRunner } from '../../core/actions/action-runner';
import type { BookingKind } from '../../core/api/api.types';
import { apiUrl } from '../../core/api/api-url';
import type {
  EditResult,
  TransactionAiPayload,
  TransactionAiResult,
  TransactionChanges,
  TransactionDetail,
  TransactionEdit,
} from '../../core/api/transactions.types';

/** F9.9: the closed projects named by a 409 `transactionLocked` ("Name 2024"). */
export function lockedProjectsOf(error: unknown): string[] {
  if (!(error instanceof HttpErrorResponse) || error.status !== 409) return [];
  const body = error.error as { code?: unknown; projects?: unknown } | null;
  if (body?.code !== 'transactionLocked' || !Array.isArray(body.projects)) {
    return [];
  }
  return body.projects.flatMap((p) =>
    p && typeof p === 'object' && 'name' in p && 'taxYear' in p
      ? [`${String(p.name)} ${String(p.taxYear)}`]
      : [],
  );
}

/**
 * F9.8–F9.10: the one way the app changes transactions — global edits (every project and the
 * dashboard that read the transaction), undo/redo, the AI's suggestions and the mapping rule.
 * Used by the Transaktionen page, the project tab and the detail dialog; DataChanges refreshes
 * every affected view (scope `transactions` + every project).
 */
@Injectable({ providedIn: 'root' })
export class TransactionEditsService {
  private readonly http = inject(HttpClient);
  private readonly actions = inject(ActionRunner);

  private readonly editAction = defineAction<
    { keys: readonly string[]; changes: TransactionChanges; reason: string },
    EditResult
  >({
    run: (body) =>
      firstValueFrom(
        this.http.post<EditResult>(apiUrl('/transactions/edits'), body),
      ),
    messages: { success: 'txEdit.saved', error: 'txEdit.saveFailed' },
  });

  private readonly undoAction = defineAction<
    { id: string; undo: boolean },
    TransactionEdit
  >({
    run: ({ id, undo }) =>
      firstValueFrom(
        this.http.post<TransactionEdit>(
          apiUrl(
            `/transactions/edits/${encodeURIComponent(id)}/${undo ? 'undo' : 'redo'}`,
          ),
          {},
        ),
      ),
    messages: { success: 'txEdit.undoDone', error: 'txEdit.undoFailed' },
  });

  private readonly decideAction = defineAction<
    { ids: readonly string[]; accept: boolean },
    EditResult
  >({
    run: ({ ids, accept }) =>
      firstValueFrom(
        this.http.post<EditResult>(
          apiUrl(`/transactions/suggestions/${accept ? 'accept' : 'dismiss'}`),
          { ids },
        ),
      ),
    messages: {
      success: 'txEdit.suggestionsDecided',
      error: 'txEdit.suggestionsFailed',
    },
  });

  private readonly ruleAction = defineAction<
    { key: string; kind: BookingKind },
    { mappingId: string; filesUsing: number }
  >({
    run: (body) =>
      firstValueFrom(
        this.http.post<{ mappingId: string; filesUsing: number }>(
          apiUrl('/transactions/mapping-rule'),
          body,
        ),
      ),
    messages: { success: 'txEdit.ruleAdded', error: 'txEdit.ruleFailed' },
  });

  private readonly suggestAction = defineAction<
    { keys: readonly string[]; consent: boolean },
    TransactionAiResult
  >({
    run: (body) =>
      firstValueFrom(
        this.http.post<TransactionAiResult>(
          apiUrl('/transactions/ai/suggest'),
          body,
        ),
      ),
    // Failures are shown in the dialog (AI error panel), not as a toast.
  });

  private readonly status = this.actions.status<unknown>('tx-edits');
  readonly isBusy = computed(() => this.status()?.state === 'pending');

  /**
   * Saves one edit per key. Resolves to `[]` on success, or the closed projects that lock a
   * transaction (F9.9); other failures are reported by the runner and rethrown.
   */
  async edit(
    keys: readonly string[],
    changes: TransactionChanges,
    reason: string,
  ): Promise<string[]> {
    try {
      await this.actions.run(
        this.editAction,
        { keys, changes, reason },
        { key: 'tx-edits' },
      );
      return [];
    } catch (error) {
      const locked = lockedProjectsOf(error);
      if (locked.length > 0) return locked;
      throw error;
    }
  }

  async setUndone(id: string, undo: boolean): Promise<string[]> {
    try {
      await this.actions.run(
        this.undoAction,
        { id, undo },
        { key: 'tx-edits' },
      );
      return [];
    } catch (error) {
      const locked = lockedProjectsOf(error);
      if (locked.length > 0) return locked;
      throw error;
    }
  }

  async decide(ids: readonly string[], accept: boolean): Promise<string[]> {
    try {
      await this.actions.run(
        this.decideAction,
        { ids, accept },
        { key: 'tx-edits' },
      );
      return [];
    } catch (error) {
      const locked = lockedProjectsOf(error);
      if (locked.length > 0) return locked;
      throw error;
    }
  }

  addRule(key: string, kind: BookingKind): Promise<unknown> {
    return this.actions.run(
      this.ruleAction,
      { key, kind },
      { key: 'tx-edits' },
    );
  }

  detail(key: string): Promise<TransactionDetail> {
    return firstValueFrom(
      this.http.get<TransactionDetail>(apiUrl('/transactions/detail'), {
        params: { key },
      }),
    );
  }

  /** Exactly what "Mit AI analysieren" would send (F5.14). Empty keys = every "unbekannt". */
  aiPayload(keys: readonly string[]): Promise<TransactionAiPayload> {
    return firstValueFrom(
      this.http.post<TransactionAiPayload>(apiUrl('/transactions/ai/payload'), {
        keys,
      }),
    );
  }

  suggest(
    keys: readonly string[],
    consent: boolean,
  ): Promise<TransactionAiResult> {
    return this.actions.run(
      this.suggestAction,
      { keys, consent },
      {
        key: 'tx-edits',
        silent: true,
        activity: { label: 'activity.transactionAi' },
      },
    );
  }
}
