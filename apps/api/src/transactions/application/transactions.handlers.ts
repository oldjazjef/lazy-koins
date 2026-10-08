import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  CommandBus,
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import {
  BOOKING_KINDS,
  type BookingKind,
  type TransactionChanges,
  TransactionChangesSchema,
  toDecimalString,
} from '@lazykoins/engine';
import { conflict } from '../../common/http/api-errors';
import { AiGate } from '../../ai/application/ai-gate';
import {
  AiCompletionPort,
  type AiUsage,
} from '../../integrations/ai/ai-completion.port';
import { UpdateMappingCommand } from '../../mappings/application/commands/mapping.commands';
import { loadOwnMapping } from '../../mappings/application/mapping-access';
import { ImportMappingRepositoryPort } from '../../mappings/ports/import-mapping.repository.port';
import {
  AI_REVIEW_MAX,
  AI_REVIEW_SYSTEM_PROMPT,
  AiReviewAnswerSchema,
  aiReviewJsonSchema,
  type AiReviewPayload,
  aiReviewPayload,
  aiReviewUserMessage,
} from '../domain/ai-review';
import {
  EDIT_REASON_MAX,
  type EditSource,
  type EditStatus,
  type StoredTransactionEdit,
  type TransactionSuggestion,
} from '../domain/transaction-edit';
import { TransactionEditRepositoryPort } from '../ports/transaction-edit.repository.port';
import {
  type Ledger,
  type LedgerEntry,
  needsReview,
  type TransactionProject,
  TransactionLedgerService,
} from './transaction-ledger.service';

/** One page of transactions; `limit` is capped here. */
export const MAX_TRANSACTION_PAGE = 200;
/** The most transactions one edit request may change (F9.8 Massenänderung). */
export const MAX_BULK_EDIT = 500;

export type TransactionStatus = 'original' | 'changed' | 'aiSuggested';

/** F9.5: one row of the list. */
export interface TransactionView {
  readonly key: string;
  readonly timestamp: string;
  readonly platform: string;
  readonly accountId: string;
  readonly kind: BookingKind;
  /** The imported kind when an edit changed it, else null. */
  readonly originalKind: BookingKind | null;
  readonly asset: string;
  readonly originalAsset: string | null;
  /** Signed decimal string. */
  readonly quantity: string;
  readonly fee: string | null;
  readonly feeAsset: string | null;
  /** In the list's currency at the booking's day; null = no price. */
  readonly value: string | null;
  readonly group: string | null;
  readonly note: string | null;
  readonly rawType: string;
  readonly source: {
    readonly fileId: string;
    readonly fileName: string;
    readonly row: number;
    /** A wallet fetch: the wallet (the account is the network, the group the tx hash). */
    readonly walletId: string | null;
  };
  readonly status: TransactionStatus;
  readonly hidden: boolean;
  readonly linkedKey: string | null;
  readonly suggestion: SuggestionView | null;
  readonly projects: readonly TransactionProject[];
  /** F9.9: closed projects that use it — changes are refused until they are reopened. */
  readonly lockedBy: readonly TransactionProject[];
}

export interface SuggestionView {
  readonly id: string;
  readonly kind: BookingKind;
  readonly reason: string;
  readonly confidence: number;
  readonly linkedKey: string | null;
}

export interface TransactionsFilter {
  readonly from?: string;
  readonly to?: string;
  readonly platform?: string;
  readonly account?: string;
  readonly asset?: string;
  readonly kind?: BookingKind;
  /** Only changed ones. */
  readonly changed?: boolean;
  /** Only "unbekannt" / to review (an open AI suggestion included). */
  readonly review?: boolean;
  /** F9.7: only this wallet's transactions. */
  readonly walletId?: string;
  /** Words that must all appear in asset, reference, note, platform type, platform or account. */
  readonly q?: string;
  readonly offset?: number;
  readonly limit?: number;
}

export interface TransactionsPage {
  readonly currency: string;
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly rows: readonly TransactionView[];
  /** For the filters: every platform, account and asset (sorted). */
  readonly platforms: readonly string[];
  readonly accounts: readonly string[];
  readonly assets: readonly string[];
  /** Files that could not be read this time. */
  readonly unreadable: number;
}

export interface EditView {
  readonly id: string;
  readonly key: string;
  readonly changes: TransactionChanges;
  readonly reason: string;
  readonly source: EditSource;
  readonly status: EditStatus;
  readonly origin: string | null;
  readonly createdAt: string;
  readonly decidedAt: string | null;
}

export interface TransactionDetail {
  readonly transaction: TransactionView;
  /** F7.5: the original row of the file, keyed by its header (never interpreted). */
  readonly raw: Readonly<Record<string, string>> | null;
  /** Every edit of it (and of links pointing at it), oldest first, undone/superseded included. */
  readonly history: readonly EditView[];
  /** The counter-booking when it is linked. */
  readonly linked: TransactionView | null;
}

function suggestionView(
  s: TransactionSuggestion | null,
): SuggestionView | null {
  return s
    ? {
        id: s.id,
        kind: s.kind,
        reason: s.reason,
        confidence: s.confidence,
        linkedKey: s.linkedKey,
      }
    : null;
}

/** A ledger entry as the API shows it. */
export function transactionView(entry: LedgerEntry): TransactionView {
  const { booking, original, effect } = entry;
  const changed = effect !== null;
  return {
    key: entry.key,
    timestamp: booking.timestamp,
    platform: booking.platform,
    accountId: booking.accountId,
    kind: effect?.after.kind ?? booking.kind,
    originalKind:
      effect && effect.after.kind !== original.kind ? original.kind : null,
    asset: effect?.after.asset ?? booking.asset,
    originalAsset:
      effect && effect.after.asset !== original.asset ? original.asset : null,
    quantity: toDecimalString(booking.quantity),
    fee: booking.fee ? toDecimalString(booking.fee) : null,
    feeAsset: booking.fee ? (booking.feeAsset ?? booking.asset) : null,
    value: entry.value,
    group: booking.group ?? null,
    note: (effect?.after.note ?? booking.note) || null,
    rawType: booking.rawType,
    source: {
      fileId: entry.file.id,
      fileName: entry.file.name,
      row: original.row,
      walletId: entry.file.walletId,
    },
    status: entry.suggestion ? 'aiSuggested' : changed ? 'changed' : 'original',
    hidden: effect?.hidden ?? false,
    linkedKey: effect?.linkedKey ?? null,
    suggestion: suggestionView(entry.suggestion),
    projects: entry.projects,
    lockedBy: entry.lockedBy,
  };
}

function editView(edit: StoredTransactionEdit): EditView {
  return {
    id: edit.id,
    key: edit.key,
    changes: edit.changes,
    reason: edit.reason,
    source: edit.source,
    status: edit.status,
    origin: edit.origin,
    createdAt: edit.createdAt,
    decidedAt: edit.decidedAt,
  };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Applies the list filter (F9.5) to the ledger's entries (newest first). */
export function filterEntries(
  entries: readonly LedgerEntry[],
  filter: TransactionsFilter,
): LedgerEntry[] {
  const words = (filter.q ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  return entries.filter((entry) => {
    const view = transactionView(entry);
    const day = view.timestamp.slice(0, 10);
    if (filter.from && day < filter.from) return false;
    if (filter.to && day > filter.to) return false;
    if (filter.platform && view.platform !== filter.platform) return false;
    if (filter.account && view.accountId !== filter.account) return false;
    if (filter.asset && view.asset !== filter.asset) return false;
    if (filter.kind && view.kind !== filter.kind) return false;
    if (filter.walletId && view.source.walletId !== filter.walletId) {
      return false;
    }
    if (filter.changed && view.status === 'original') return false;
    if (
      filter.review &&
      !(needsReview(view.kind) && !view.hidden) &&
      view.suggestion === null
    ) {
      return false;
    }
    if (words.length > 0) {
      const text = [
        view.asset,
        view.group ?? '',
        view.note ?? '',
        view.rawType,
        view.platform,
        view.accountId,
      ]
        .join(' ')
        .toLowerCase();
      if (!words.every((w) => text.includes(w))) return false;
    }
    return true;
  });
}

function page<T>(
  rows: readonly T[],
  offset?: number,
  limit?: number,
): { rows: T[]; offset: number; limit: number } {
  const size = Math.min(Math.max(limit ?? 50, 1), MAX_TRANSACTION_PAGE);
  const start = Math.max(offset ?? 0, 0);
  return { rows: rows.slice(start, start + size), offset: start, limit: size };
}

/** F9.9: refuses a change while a closed project uses one of the transactions. */
function assertUnlocked(entries: readonly LedgerEntry[]): void {
  const closed = new Map<string, TransactionProject>();
  for (const entry of entries) {
    for (const project of entry.lockedBy)
      closed.set(project.projectId, project);
  }
  if (closed.size > 0) {
    throw conflict(
      'transactionLocked',
      'A closed project uses this transaction: reopen it first, then change it',
      {
        projects: [...closed.values()].map((p) => ({
          id: p.projectId,
          name: p.name,
          taxYear: p.taxYear,
        })),
      },
    );
  }
}

function entriesOf(ledger: Ledger, keys: readonly string[]): LedgerEntry[] {
  return keys.map((key) => {
    const entry = ledger.byKey.get(key);
    if (!entry) throw new NotFoundException('No such transaction');
    return entry;
  });
}

function cleanReason(reason: unknown): string {
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (text.length === 0 || text.length > EDIT_REASON_MAX) {
    throw new BadRequestException({
      statusCode: 400,
      message: `A reason (1–${EDIT_REASON_MAX} characters) is required`,
      code: 'reasonRequired',
    });
  }
  return text;
}

// ---------------------------------------------------------------- queries

export class ListUserTransactionsQuery {
  constructor(
    readonly userId: string,
    readonly filter: TransactionsFilter = {},
  ) {}
}

/** F9.5: every transaction of the user, filtered and paged. */
@QueryHandler(ListUserTransactionsQuery)
export class ListUserTransactionsHandler implements IQueryHandler<
  ListUserTransactionsQuery,
  TransactionsPage
> {
  constructor(private readonly ledgers: TransactionLedgerService) {}

  async execute({
    userId,
    filter,
  }: ListUserTransactionsQuery): Promise<TransactionsPage> {
    const ledger = await this.ledgers.ledger(userId);
    const matching = filterEntries(ledger.entries, filter);
    const paged = page(matching, filter.offset, filter.limit);
    const views = ledger.entries.map(transactionView);
    const distinct = (values: string[]) =>
      [...new Set(values)].sort(compareText);
    return {
      currency: ledger.currency,
      total: matching.length,
      offset: paged.offset,
      limit: paged.limit,
      rows: paged.rows.map(transactionView),
      platforms: distinct(views.map((v) => v.platform)),
      accounts: distinct(views.map((v) => v.accountId)),
      assets: distinct(views.map((v) => v.asset)),
      unreadable: ledger.unreadable,
    };
  }
}

export class GetTransactionQuery {
  constructor(
    readonly userId: string,
    readonly key: string,
  ) {}
}

/** F9.5 detail: the original row and the history of edits. */
@QueryHandler(GetTransactionQuery)
export class GetTransactionHandler implements IQueryHandler<
  GetTransactionQuery,
  TransactionDetail
> {
  constructor(private readonly ledgers: TransactionLedgerService) {}

  async execute({
    userId,
    key,
  }: GetTransactionQuery): Promise<TransactionDetail> {
    const ledger = await this.ledgers.ledger(userId);
    const [entry] = entriesOf(ledger, [key]);
    const view = transactionView(entry as LedgerEntry);
    const linked = view.linkedKey ? ledger.byKey.get(view.linkedKey) : null;
    return {
      transaction: view,
      raw: (entry as LedgerEntry).original.raw ?? null,
      history: ledger.edits
        .filter((e) => e.key === key || e.changes.linkedKey === key)
        .map(editView),
      linked: linked ? transactionView(linked) : null,
    };
  }
}

// ---------------------------------------------------------------- edits

export class EditTransactionsCommand {
  constructor(
    readonly userId: string,
    readonly keys: readonly string[],
    readonly changes: unknown,
    readonly reason: unknown,
    readonly source: EditSource = 'user',
  ) {}
}

export interface EditResult {
  readonly edited: number;
  /** Projects whose figures depend on the changed transactions (they are stale now). */
  readonly projectIds: readonly string[];
}

/**
 * F9.8: one edit per transaction (bulk = the same change for each), with its reason — global,
 * in every project that reads the transaction. F9.9: refused while a closed project uses one.
 */
@CommandHandler(EditTransactionsCommand)
export class EditTransactionsHandler implements ICommandHandler<
  EditTransactionsCommand,
  EditResult
> {
  constructor(
    private readonly ledgers: TransactionLedgerService,
    private readonly edits: TransactionEditRepositoryPort,
  ) {}

  async execute({
    userId,
    keys,
    changes,
    reason,
    source,
  }: EditTransactionsCommand): Promise<EditResult> {
    const parsed = TransactionChangesSchema.safeParse(changes);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'The changes are invalid',
        code: 'invalidChanges',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    const text = cleanReason(reason);
    const unique = [...new Set(keys)];
    if (unique.length === 0 || unique.length > MAX_BULK_EDIT) {
      throw new BadRequestException(`Choose 1–${MAX_BULK_EDIT} transactions`);
    }
    const ledger = await this.ledgers.ledger(userId);
    const touched = entriesOf(ledger, unique);
    const link = parsed.data.linkedKey;
    if (link) {
      if (unique.length !== 1 || link === unique[0]) {
        throw new BadRequestException(
          'A link joins exactly one transaction with another one',
        );
      }
      touched.push(...entriesOf(ledger, [link]));
    }
    assertUnlocked(touched);
    await this.edits.add(
      userId,
      unique.map((key) => ({
        key,
        changes: parsed.data,
        reason: text,
        source,
      })),
    );
    return {
      edited: unique.length,
      projectIds: [
        ...new Set(touched.flatMap((e) => e.projects.map((p) => p.projectId))),
      ],
    };
  }
}

export class SetTransactionEditUndoneCommand {
  constructor(
    readonly userId: string,
    readonly editId: string,
    readonly undone: boolean,
  ) {}
}

/** F9.4 for global edits: undo / redo (also of a superseded migrated one, F9.11). */
@CommandHandler(SetTransactionEditUndoneCommand)
export class SetTransactionEditUndoneHandler implements ICommandHandler<
  SetTransactionEditUndoneCommand,
  EditView
> {
  constructor(
    private readonly ledgers: TransactionLedgerService,
    private readonly edits: TransactionEditRepositoryPort,
  ) {}

  async execute({
    userId,
    editId,
    undone,
  }: SetTransactionEditUndoneCommand): Promise<EditView> {
    const edit = await this.edits.findById(editId);
    if (!edit || edit.ownerId !== userId) {
      throw new NotFoundException('No such edit');
    }
    if ((edit.status === 'active') !== undone) {
      throw conflict(
        'alreadyDecided',
        undone ? 'The edit is not active' : 'The edit is already active',
      );
    }
    const ledger = await this.ledgers.ledger(userId);
    assertUnlocked(
      [edit.key, edit.changes.linkedKey]
        .filter((k): k is string => !!k)
        .flatMap((k) => {
          const entry = ledger.byKey.get(k);
          return entry ? [entry] : [];
        }),
    );
    const updated = await this.edits.setStatus(
      editId,
      undone ? 'undone' : 'active',
    );
    if (!updated) throw new NotFoundException('No such edit');
    return editView(updated);
  }
}

// ---------------------------------------------------------------- AI (F9.10)

export class TransactionAiPayloadQuery {
  constructor(
    readonly userId: string,
    readonly keys: readonly string[],
  ) {}
}

export interface TransactionAiPayloadView {
  /** Exactly what is sent (F5.14). */
  readonly payload: AiReviewPayload;
  readonly count: number;
}

async function chooseForReview(
  ledgers: TransactionLedgerService,
  userId: string,
  keys: readonly string[],
): Promise<{
  ledger: Ledger;
  payload: AiReviewPayload;
  refs: Map<string, string>;
}> {
  const ledger = await ledgers.ledger(userId);
  const chosen =
    keys.length > 0
      ? entriesOf(ledger, [...new Set(keys)].slice(0, AI_REVIEW_MAX))
      : ledger.entries
          .filter(
            (e) => needsReview(transactionView(e).kind) && !e.effect?.hidden,
          )
          .slice(0, AI_REVIEW_MAX);
  if (chosen.length === 0) {
    throw new UnprocessableEntityException({
      statusCode: 422,
      message: 'Nothing to review',
      code: 'nothingToReview',
    });
  }
  const { payload, refs } = aiReviewPayload(
    chosen.map((e) => ({ key: e.key, booking: e.booking })),
    ledger.entries
      .filter((e) => !e.effect?.hidden)
      .map((e) => ({ key: e.key, booking: e.booking })),
  );
  return { ledger, payload, refs };
}

@QueryHandler(TransactionAiPayloadQuery)
export class TransactionAiPayloadHandler implements IQueryHandler<
  TransactionAiPayloadQuery,
  TransactionAiPayloadView
> {
  constructor(private readonly ledgers: TransactionLedgerService) {}

  async execute({
    userId,
    keys,
  }: TransactionAiPayloadQuery): Promise<TransactionAiPayloadView> {
    const { payload } = await chooseForReview(this.ledgers, userId, keys);
    return { payload, count: payload.transactions.length };
  }
}

export class SuggestTransactionsCommand {
  constructor(
    readonly userId: string,
    readonly keys: readonly string[],
    readonly consent: boolean,
  ) {}
}

export interface SuggestResult {
  readonly suggested: number;
  readonly model: string;
  readonly usage: AiUsage | null;
}

/**
 * F9.10: the AI suggests a kind per transaction; stored as "von AI vorgeschlagen" — nothing
 * changes until the user accepts. One repair round for an invalid answer.
 */
@CommandHandler(SuggestTransactionsCommand)
export class SuggestTransactionsHandler implements ICommandHandler<
  SuggestTransactionsCommand,
  SuggestResult
> {
  constructor(
    private readonly ledgers: TransactionLedgerService,
    private readonly edits: TransactionEditRepositoryPort,
    private readonly gate: AiGate,
    private readonly ai: AiCompletionPort,
  ) {}

  async execute({
    userId,
    keys,
    consent,
  }: SuggestTransactionsCommand): Promise<SuggestResult> {
    const { payload, refs } = await chooseForReview(this.ledgers, userId, keys);
    const connection = await this.gate.connect(userId, consent);
    const messages: { role: 'user' | 'assistant'; content: string }[] = [
      { role: 'user', content: aiReviewUserMessage(payload) },
    ];
    let model = connection.model;
    const total = { inputTokens: 0, outputTokens: 0, reported: false };
    for (let round = 0; round < 2; round += 1) {
      const answer = await this.gate.call(
        () =>
          this.ai.complete(connection, {
            system: AI_REVIEW_SYSTEM_PROMPT,
            messages,
            output: {
              name: 'transaction_kinds',
              description: 'One suggested kind per listed transaction.',
              schema: aiReviewJsonSchema(),
            },
          }),
        connection,
        { userId },
      );
      model = answer.model;
      if (answer.usage) {
        total.inputTokens += answer.usage.inputTokens;
        total.outputTokens += answer.usage.outputTokens;
        total.reported = true;
      }
      const usage: AiUsage | null = total.reported
        ? { inputTokens: total.inputTokens, outputTokens: total.outputTokens }
        : null;
      const parsed = AiReviewAnswerSchema.safeParse(answer.json);
      if (parsed.success) {
        const suggestions = parsed.data.suggestions.flatMap((s) => {
          const key = refs.get(s.ref);
          if (!key || !s.ref.startsWith('t')) return [];
          const linkedKey = s.counterRef ? refs.get(s.counterRef) : undefined;
          return [
            {
              key,
              kind: s.kind,
              reason: s.reason.slice(0, EDIT_REASON_MAX),
              confidence: Math.round(s.confidence),
              linkedKey:
                s.kind === 'transfer' && linkedKey && linkedKey !== key
                  ? linkedKey
                  : null,
            },
          ];
        });
        const unique = [
          ...new Map(suggestions.map((s) => [s.key, s] as const)).values(),
        ];
        await this.edits.saveSuggestions(userId, unique);
        return { suggested: unique.length, model, usage };
      }
      messages.push(
        { role: 'assistant', content: answer.text },
        {
          role: 'user',
          content: `The answer did not match the schema (${parsed.error.issues
            .slice(0, 5)
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ')}). Answer again with valid JSON only.`,
        },
      );
    }
    throw new UnprocessableEntityException({
      statusCode: 422,
      message: 'The AI answer could not be used',
      code: 'badAnswer',
    });
  }
}

export class DecideSuggestionsCommand {
  constructor(
    readonly userId: string,
    readonly ids: readonly string[],
    readonly accept: boolean,
    readonly reason?: string,
  ) {}
}

/** F9.10: confirm (→ edits with source `ai`) or dismiss suggestions, singly or together. */
@CommandHandler(DecideSuggestionsCommand)
export class DecideSuggestionsHandler implements ICommandHandler<
  DecideSuggestionsCommand,
  EditResult
> {
  constructor(
    private readonly ledgers: TransactionLedgerService,
    private readonly edits: TransactionEditRepositoryPort,
  ) {}

  async execute({
    userId,
    ids,
    accept,
    reason,
  }: DecideSuggestionsCommand): Promise<EditResult> {
    const open = (await this.edits.listSuggestions(userId)).filter(
      (s) => s.status === 'open' && ids.includes(s.id),
    );
    if (open.length === 0) throw new NotFoundException('No such suggestion');
    if (!accept) {
      await this.edits.setSuggestionStatus(
        userId,
        open.map((s) => s.id),
        'dismissed',
      );
      return { edited: 0, projectIds: [] };
    }
    const ledger = await this.ledgers.ledger(userId);
    const touched = open.flatMap((s) => {
      const entry = ledger.byKey.get(s.key);
      return entry ? [entry] : [];
    });
    assertUnlocked(touched);
    const own = reason?.trim();
    await this.edits.add(
      userId,
      open
        .filter((s) => ledger.byKey.has(s.key))
        .map((s) => ({
          key: s.key,
          changes: s.linkedKey
            ? { kind: s.kind, linkedKey: s.linkedKey }
            : { kind: s.kind },
          reason: (own ? own : `AI: ${s.reason}`).slice(0, EDIT_REASON_MAX),
          source: 'ai' as const,
        })),
    );
    await this.edits.setSuggestionStatus(
      userId,
      open.map((s) => s.id),
      'accepted',
    );
    return {
      edited: touched.length,
      projectIds: [
        ...new Set(touched.flatMap((e) => e.projects.map((p) => p.projectId))),
      ],
    };
  }
}

export class AddKindRuleCommand {
  constructor(
    readonly userId: string,
    readonly key: string,
    readonly kind: BookingKind,
  ) {}
}

/**
 * F9.10 "als Regel ins Mapping übernehmen": the transaction's platform type → kind becomes the
 * first kind rule of the mapping that read it, so future files of that platform read the same.
 * Files already read keep their reading until the user re-applies the mapping (F5).
 */
@CommandHandler(AddKindRuleCommand)
export class AddKindRuleHandler implements ICommandHandler<
  AddKindRuleCommand,
  { mappingId: string; filesUsing: number }
> {
  constructor(
    private readonly ledgers: TransactionLedgerService,
    private readonly mappings: ImportMappingRepositoryPort,
    private readonly commands: CommandBus,
  ) {}

  async execute({
    userId,
    key,
    kind,
  }: AddKindRuleCommand): Promise<{ mappingId: string; filesUsing: number }> {
    if (!(BOOKING_KINDS as readonly string[]).includes(kind)) {
      throw new BadRequestException('Unknown kind');
    }
    const ledger = await this.ledgers.ledger(userId);
    const [entry] = entriesOf(ledger, [key]);
    const mappingId = (entry as LedgerEntry).file.mappingId;
    const raw = (entry as LedgerEntry).original.raw;
    if (!mappingId || !raw) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        message: 'This transaction is not read with a mapping',
        code: 'noMapping',
      });
    }
    const mapping = await loadOwnMapping(this.mappings, userId, mappingId);
    const spec = mapping.spec;
    if (!spec.bookings) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        message: 'The mapping reads no bookings',
        code: 'noMapping',
      });
    }
    const values = spec.bookings.kind.columns.map(
      (column) => raw[column] ?? '',
    );
    const rule = { equals: values, kind };
    const rules = spec.bookings.kind.rules.filter(
      (r) => JSON.stringify(r.equals) !== JSON.stringify(values),
    );
    const updated = (await this.commands.execute(
      new UpdateMappingCommand(userId, mapping.id, {
        ...spec,
        bookings: {
          ...spec.bookings,
          kind: { ...spec.bookings.kind, rules: [rule, ...rules] },
        },
      }),
    )) as { mapping: { id: string }; filesUsing: number };
    return { mappingId: updated.mapping.id, filesUsing: updated.filesUsing };
  }
}
