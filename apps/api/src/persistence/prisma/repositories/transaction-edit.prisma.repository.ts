import { Injectable } from '@nestjs/common';
import type { BookingKind, TransactionChanges } from '@lazykoins/engine';
import type {
  TransactionEdit as EditRow,
  TransactionSuggestion as SuggestionRow,
} from '../../../generated/prisma/client';
import type {
  EditSource,
  EditStatus,
  NewTransactionEdit,
  NewTransactionSuggestion,
  StoredTransactionEdit,
  SuggestionStatus,
  TransactionSuggestion,
} from '../../../transactions/domain/transaction-edit';
import { TransactionEditRepositoryPort } from '../../../transactions/ports/transaction-edit.repository.port';
import { toIsoString } from '../mappers/scalar.mapper';
import { PrismaService } from '../prisma.service';

function toEdit(row: EditRow): StoredTransactionEdit {
  return {
    id: row.id,
    ownerId: row.ownerId,
    key: row.txKey,
    changes: JSON.parse(row.changes) as TransactionChanges,
    reason: row.reason,
    source: row.source as EditSource,
    status: row.status as EditStatus,
    origin: row.origin,
    createdAt: toIsoString(row.createdAt),
    decidedAt: row.decidedAt ? toIsoString(row.decidedAt) : null,
  };
}

function toSuggestion(row: SuggestionRow): TransactionSuggestion {
  return {
    id: row.id,
    ownerId: row.ownerId,
    key: row.txKey,
    kind: row.kind as BookingKind,
    reason: row.reason,
    confidence: row.confidence,
    linkedKey: row.linkedKey,
    status: row.status as SuggestionStatus,
    createdAt: toIsoString(row.createdAt),
  };
}

@Injectable()
export class TransactionEditPrismaRepository extends TransactionEditRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listByOwner(ownerId: string): Promise<StoredTransactionEdit[]> {
    const rows = await this.prisma.transactionEdit.findMany({
      where: { ownerId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toEdit);
  }

  async findById(id: string): Promise<StoredTransactionEdit | undefined> {
    const row = await this.prisma.transactionEdit.findUnique({ where: { id } });
    return row ? toEdit(row) : undefined;
  }

  async add(
    ownerId: string,
    edits: readonly NewTransactionEdit[],
  ): Promise<StoredTransactionEdit[]> {
    // One timestamp per batch, in order: the edits apply in creation order (then id).
    const base = Date.now();
    const rows = await this.prisma.$transaction(
      edits.map((edit, index) =>
        this.prisma.transactionEdit.create({
          data: {
            ownerId,
            txKey: edit.key,
            changes: JSON.stringify(edit.changes),
            reason: edit.reason,
            source: edit.source,
            createdAt: new Date(base + index),
          },
        }),
      ),
    );
    return rows.map(toEdit);
  }

  async setStatus(
    id: string,
    status: Exclude<EditStatus, 'superseded'>,
  ): Promise<StoredTransactionEdit | undefined> {
    const { count } = await this.prisma.transactionEdit.updateMany({
      where: { id },
      data: {
        status,
        decidedAt: status === 'active' ? null : new Date(),
      },
    });
    return count === 0 ? undefined : this.findById(id);
  }

  async listSuggestions(ownerId: string): Promise<TransactionSuggestion[]> {
    const rows = await this.prisma.transactionSuggestion.findMany({
      where: { ownerId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toSuggestion);
  }

  async saveSuggestions(
    ownerId: string,
    suggestions: readonly NewTransactionSuggestion[],
  ): Promise<TransactionSuggestion[]> {
    const rows = await this.prisma.$transaction(
      suggestions.map((s) =>
        this.prisma.transactionSuggestion.upsert({
          where: { ownerId_txKey: { ownerId, txKey: s.key } },
          create: {
            ownerId,
            txKey: s.key,
            kind: s.kind,
            reason: s.reason,
            confidence: s.confidence,
            linkedKey: s.linkedKey,
          },
          update: {
            kind: s.kind,
            reason: s.reason,
            confidence: s.confidence,
            linkedKey: s.linkedKey,
            status: 'open',
            createdAt: new Date(),
          },
        }),
      ),
    );
    return rows.map(toSuggestion);
  }

  async setSuggestionStatus(
    ownerId: string,
    ids: readonly string[],
    status: SuggestionStatus,
  ): Promise<number> {
    const { count } = await this.prisma.transactionSuggestion.updateMany({
      where: { ownerId, id: { in: [...ids] } },
      data: { status },
    });
    return count;
  }
}
