import type {
  BookingKind,
  TransactionChanges,
  TransactionEdit,
} from '@lazykoins/engine';

/** F9.8/F9.10/F9.11: who made an edit. */
export const EDIT_SOURCES = ['user', 'ai', 'migrated'] as const;
export type EditSource = (typeof EDIT_SOURCES)[number];

/** `superseded` = a former project correction that lost against a newer project's (F9.11). */
export const EDIT_STATUSES = ['active', 'undone', 'superseded'] as const;
export type EditStatus = (typeof EDIT_STATUSES)[number];

/** One stored global edit of a transaction (F9.8). */
export interface StoredTransactionEdit {
  readonly id: string;
  readonly ownerId: string;
  readonly key: string;
  readonly changes: TransactionChanges;
  readonly reason: string;
  readonly source: EditSource;
  readonly status: EditStatus;
  /** F9.11: "<project> <year>" of a migrated project correction. */
  readonly origin: string | null;
  readonly createdAt: string;
  readonly decidedAt: string | null;
}

export interface NewTransactionEdit {
  readonly key: string;
  readonly changes: TransactionChanges;
  readonly reason: string;
  readonly source: EditSource;
}

export const SUGGESTION_STATUSES = ['open', 'accepted', 'dismissed'] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

/** F9.10: the AI's proposal for one transaction ("von AI vorgeschlagen"). */
export interface TransactionSuggestion {
  readonly id: string;
  readonly ownerId: string;
  readonly key: string;
  readonly kind: BookingKind;
  readonly reason: string;
  /** 0–100. */
  readonly confidence: number;
  readonly linkedKey: string | null;
  readonly status: SuggestionStatus;
  readonly createdAt: string;
}

export interface NewTransactionSuggestion {
  readonly key: string;
  readonly kind: BookingKind;
  readonly reason: string;
  readonly confidence: number;
  readonly linkedKey: string | null;
}

/** The longest reason (mirrored by a CHECK). */
export const EDIT_REASON_MAX = 1000;

/** The engine's view of the active edits. */
export function engineEdits(
  edits: readonly StoredTransactionEdit[],
): TransactionEdit[] {
  return edits
    .filter((e) => e.status === 'active')
    .map((e) => ({
      id: e.id,
      key: e.key,
      createdAt: e.createdAt,
      reason: e.reason,
      changes: e.changes,
    }));
}
