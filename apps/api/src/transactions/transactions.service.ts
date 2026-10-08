import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { BookingKind } from '@lazykoins/engine';
import {
  AddKindRuleCommand,
  DecideSuggestionsCommand,
  type EditResult,
  EditTransactionsCommand,
  type EditView,
  GetTransactionQuery,
  ListUserTransactionsQuery,
  SetTransactionEditUndoneCommand,
  SuggestTransactionsCommand,
  type SuggestResult,
  TransactionAiPayloadQuery,
  type TransactionAiPayloadView,
  type TransactionDetail,
  type TransactionsFilter,
  type TransactionsPage,
} from './application/transactions.handlers';
import type { EditSource } from './domain/transaction-edit';

/** Façade of the transactions slice (F9.5–F9.12) — controller and tools call it. */
@Injectable()
export class TransactionsService {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  list(userId: string, filter: TransactionsFilter): Promise<TransactionsPage> {
    return this.queries.execute(new ListUserTransactionsQuery(userId, filter));
  }

  detail(userId: string, key: string): Promise<TransactionDetail> {
    return this.queries.execute(new GetTransactionQuery(userId, key));
  }

  edit(
    userId: string,
    keys: readonly string[],
    changes: unknown,
    reason: unknown,
    source: EditSource = 'user',
  ): Promise<EditResult> {
    return this.commands.execute(
      new EditTransactionsCommand(userId, keys, changes, reason, source),
    );
  }

  setUndone(
    userId: string,
    editId: string,
    undone: boolean,
  ): Promise<EditView> {
    return this.commands.execute(
      new SetTransactionEditUndoneCommand(userId, editId, undone),
    );
  }

  aiPayload(
    userId: string,
    keys: readonly string[],
  ): Promise<TransactionAiPayloadView> {
    return this.queries.execute(new TransactionAiPayloadQuery(userId, keys));
  }

  suggest(
    userId: string,
    keys: readonly string[],
    consent: boolean,
  ): Promise<SuggestResult> {
    return this.commands.execute(
      new SuggestTransactionsCommand(userId, keys, consent),
    );
  }

  decide(
    userId: string,
    ids: readonly string[],
    accept: boolean,
    reason?: string,
  ): Promise<EditResult> {
    return this.commands.execute(
      new DecideSuggestionsCommand(userId, ids, accept, reason),
    );
  }

  kindRule(
    userId: string,
    key: string,
    kind: BookingKind,
  ): Promise<{ mappingId: string; filesUsing: number }> {
    return this.commands.execute(new AddKindRuleCommand(userId, key, kind));
  }
}
