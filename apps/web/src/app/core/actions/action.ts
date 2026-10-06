/**
 * An async operation, decoupled from any state store — `run` performs the work and returns its
 * result; applying that result to signals/state is the caller's job, not the action's.
 *
 * `messages` are i18n keys (never raw strings, per the repo's i18n convention), resolved by
 * `NotificationService` when `ActionRunner.run()` reports the outcome.
 */
export interface Action<P, R> {
  run(payload: P): Promise<R>;
  /** Inverse operation; exposed via `ActionEntry.undo` for a call site to wire up if it wants one. */
  undo?(payload: P, result: R): Promise<void>;
  messages?: {
    success?: string;
    error?: string;
    /** Shown when `undo` succeeds; falls back to no notification if omitted. */
    undo?: string;
  };
}

/**
 * Identity function — exists only so `defineAction({...})` infers `P`/`R` from the object
 * literal at the call site instead of needing an explicit `Action<P, R>` annotation.
 */
export function defineAction<P, R>(action: Action<P, R>): Action<P, R> {
  return action;
}

export type ActionState = 'idle' | 'pending' | 'success' | 'error';

/** Per-key tracking entry surfaced by `ActionRunner.status()` for loaders, retry and undo affordances. */
export interface ActionEntry<R> {
  state: ActionState;
  error?: unknown;
  result?: R;
  retry: () => Promise<R>;
  undo?: () => Promise<void>;
}
