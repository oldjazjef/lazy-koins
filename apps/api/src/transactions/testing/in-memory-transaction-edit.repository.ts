import { randomUUID } from 'node:crypto';
import type {
  EditStatus,
  NewTransactionEdit,
  NewTransactionSuggestion,
  StoredTransactionEdit,
  SuggestionStatus,
  TransactionSuggestion,
} from '../domain/transaction-edit';
import { TransactionEditRepositoryPort } from '../ports/transaction-edit.repository.port';

/** Port double: a real in-memory implementation (CLAUDE.md, Testing). */
export class InMemoryTransactionEditRepository extends TransactionEditRepositoryPort {
  readonly edits: StoredTransactionEdit[] = [];
  readonly suggestions: TransactionSuggestion[] = [];
  private clock = Date.parse('2026-10-08T10:00:00.000Z');

  private now(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  async listByOwner(ownerId: string): Promise<StoredTransactionEdit[]> {
    return this.edits.filter((e) => e.ownerId === ownerId);
  }

  async findById(id: string): Promise<StoredTransactionEdit | undefined> {
    return this.edits.find((e) => e.id === id);
  }

  async add(
    ownerId: string,
    edits: readonly NewTransactionEdit[],
  ): Promise<StoredTransactionEdit[]> {
    const added = edits.map((edit) => ({
      id: randomUUID(),
      ownerId,
      key: edit.key,
      changes: edit.changes,
      reason: edit.reason,
      source: edit.source,
      status: 'active' as const,
      origin: null,
      createdAt: this.now(),
      decidedAt: null,
    }));
    this.edits.push(...added);
    return added;
  }

  async setStatus(
    id: string,
    status: Exclude<EditStatus, 'superseded'>,
  ): Promise<StoredTransactionEdit | undefined> {
    const index = this.edits.findIndex((e) => e.id === id);
    const current = this.edits[index];
    if (!current) return undefined;
    const next = {
      ...current,
      status,
      decidedAt: status === 'active' ? null : this.now(),
    };
    this.edits[index] = next;
    return next;
  }

  async listSuggestions(ownerId: string): Promise<TransactionSuggestion[]> {
    return this.suggestions.filter((s) => s.ownerId === ownerId);
  }

  async saveSuggestions(
    ownerId: string,
    suggestions: readonly NewTransactionSuggestion[],
  ): Promise<TransactionSuggestion[]> {
    return suggestions.map((s) => {
      const index = this.suggestions.findIndex(
        (x) => x.ownerId === ownerId && x.key === s.key,
      );
      const saved: TransactionSuggestion = {
        id: this.suggestions[index]?.id ?? randomUUID(),
        ownerId,
        ...s,
        status: 'open',
        createdAt: this.now(),
      };
      if (index >= 0) this.suggestions[index] = saved;
      else this.suggestions.push(saved);
      return saved;
    });
  }

  async setSuggestionStatus(
    ownerId: string,
    ids: readonly string[],
    status: SuggestionStatus,
  ): Promise<number> {
    let count = 0;
    this.suggestions.forEach((s, index) => {
      if (s.ownerId === ownerId && ids.includes(s.id)) {
        this.suggestions[index] = { ...s, status };
        count += 1;
      }
    });
    return count;
  }
}
