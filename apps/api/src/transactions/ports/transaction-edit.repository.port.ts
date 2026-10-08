import type {
  EditStatus,
  NewTransactionEdit,
  NewTransactionSuggestion,
  StoredTransactionEdit,
  SuggestionStatus,
  TransactionSuggestion,
} from '../domain/transaction-edit';

/** F9.8–F9.10: the user's global transaction edits and AI suggestions. */
export abstract class TransactionEditRepositoryPort {
  /** Every edit of the owner (all statuses), oldest first. */
  abstract listByOwner(ownerId: string): Promise<StoredTransactionEdit[]>;

  abstract findById(id: string): Promise<StoredTransactionEdit | undefined>;

  /** Stores several edits at once (one transaction), in the given order. */
  abstract add(
    ownerId: string,
    edits: readonly NewTransactionEdit[],
  ): Promise<StoredTransactionEdit[]>;

  /** Undo (`undone`) / redo (`active`); `undefined` when the edit is gone. */
  abstract setStatus(
    id: string,
    status: Exclude<EditStatus, 'superseded'>,
  ): Promise<StoredTransactionEdit | undefined>;

  abstract listSuggestions(ownerId: string): Promise<TransactionSuggestion[]>;

  /** One current suggestion per transaction: a new one replaces it (open again). */
  abstract saveSuggestions(
    ownerId: string,
    suggestions: readonly NewTransactionSuggestion[],
  ): Promise<TransactionSuggestion[]>;

  abstract setSuggestionStatus(
    ownerId: string,
    ids: readonly string[],
    status: SuggestionStatus,
  ): Promise<number>;
}
