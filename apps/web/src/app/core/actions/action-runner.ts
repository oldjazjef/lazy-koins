import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { NotificationService } from '../notifications/notification.service';
import { Action, ActionEntry, defineAction } from './action';
import { extractErrorDetail } from './extract-error-detail';

interface RunOptions {
  /** Groups invocations for `status()` (e.g. an entity id) so a row can track its own action. Defaults to a fresh id per call. */
  key?: string;
  /** Suppresses the automatic success/error notification for this call. */
  silent?: boolean;
}

/**
 * Runs `Action`s and tracks their pending/success/error state per key as signals, so loaders and
 * disabled states can observe them directly — with no store or ngrx involved. Notifications are
 * fired automatically from `action.messages`; undo (when `action.undo` is defined) is just
 * another run through this same pipeline, so it gets its own pending/notify/retry state for free.
 */
@Injectable({ providedIn: 'root' })
export class ActionRunner {
  private readonly notifications = inject(NotificationService);
  private readonly store = signal<Record<string, ActionEntry<unknown>>>({});

  readonly busy = computed(() =>
    Object.values(this.store()).some((entry) => entry.state === 'pending'),
  );

  status<R>(key: string): Signal<ActionEntry<R> | undefined> {
    return computed(() => this.store()[key] as ActionEntry<R> | undefined);
  }

  async run<P, R>(
    action: Action<P, R>,
    payload: P,
    opts: RunOptions = {},
  ): Promise<R> {
    const key = opts.key ?? crypto.randomUUID();
    const retry = () => this.run(action, payload, opts);
    this.patch(key, { state: 'pending', retry });

    try {
      const result = await action.run(payload);
      const undoFn = action.undo;
      const undo = undoFn
        ? () => this.runUndo(undoFn, payload, result, key, action.messages)
        : undefined;
      this.patch(key, { state: 'success', result, retry, undo });
      if (!opts.silent && action.messages?.success) {
        if (undo) {
          this.notifications.success(action.messages.success, {
            labelKey: 'actions.undo',
            onClick: () => void undo(),
          });
        } else {
          this.notifications.success(action.messages.success);
        }
      }
      return result;
    } catch (error) {
      this.patch(key, { state: 'error', error, retry });
      if (!opts.silent && action.messages?.error) {
        // The detail is the server's own reason (e.g. "The project is closed: reopen it first")
        // — appended only when there is one, so a plain non-HTTP failure still
        // shows exactly the message it always did.
        const detail = extractErrorDetail(error);
        if (detail) {
          this.notifications.error(action.messages.error, detail);
        } else {
          this.notifications.error(action.messages.error);
        }
      }
      throw error;
    }
  }

  private runUndo<P, R>(
    undo: (payload: P, result: R) => Promise<void>,
    payload: P,
    result: R,
    key: string,
    messages: Action<P, R>['messages'],
  ): Promise<void> {
    const undoAction = defineAction<void, void>({
      run: () => undo(payload, result),
      messages: { success: messages?.undo, error: messages?.error },
    });
    return this.run(undoAction, undefined, { key: `${key}:undo` });
  }

  private patch<R>(key: string, entry: ActionEntry<R>): void {
    this.store.update((current) => ({
      ...current,
      [key]: entry as ActionEntry<unknown>,
    }));
  }
}
