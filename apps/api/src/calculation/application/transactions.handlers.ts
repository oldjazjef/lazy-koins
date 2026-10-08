import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
  BOOKING_TREATMENTS,
  type BookingTreatment,
  type BookingTreatmentRow,
  bookingTreatments,
  applyCorrections,
  calculate,
  parseDecimal,
  RateTable,
  toDecimalString,
  unitPriceChf,
} from '@lazykoins/engine';
import type { Project } from '../../projects/domain/project';

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
import { loadOwnProject } from '../../projects/application/project-access';
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import { TransactionEditRepositoryPort } from '../../transactions/ports/transaction-edit.repository.port';
import { CalculationInputService } from './calculation-input.service';

/** One page of a project's bookings; `limit` is capped here. */
export const MAX_TRANSACTIONS_PAGE = 200;

/**
 * F9.6: `year` = the bookings of the tax year (default); `all` adds the earlier ones that decide a
 * balance at 31.12. (treatment `balance`).
 */
export const TRANSACTION_SCOPES = ['year', 'all'] as const;
export type TransactionScope = (typeof TRANSACTION_SCOPES)[number];

export interface TransactionsFilter {
  readonly scope?: TransactionScope;
  /** Words that must all appear in asset, platform, account, kind, raw type, note, file or id. */
  readonly q?: string;
  readonly treatment?: BookingTreatment;
  readonly platform?: string;
  readonly offset?: number;
  readonly limit?: number;
}

export interface TransactionRow extends BookingTreatmentRow {
  /** F7.5: the project file the booking was read from (null for a manual booking). */
  readonly projectFileId: string | null;
  readonly fileName: string | null;
  /** F9.8: the stable transaction key (global edits); null for a manual booking. */
  readonly key: string | null;
  /** original / changed (a global edit) / aiSuggested (an open AI suggestion, F9.10). */
  readonly status: 'original' | 'changed' | 'aiSuggested';
  readonly hidden: boolean;
  readonly linkedKey: string | null;
  /** The reason of the latest global edit. */
  readonly editReason: string | null;
  /** The imported asset when an edit changed it, else null. */
  readonly importedAsset: string | null;
  /** |quantity| × the price of the booking's day in the tax currency; null = no price. */
  readonly marketValue: string | null;
}

export interface TransactionsView {
  readonly taxYear: number;
  /** The project's tax currency: every `valueChf` is in it (F4.1a). */
  readonly currency: string;
  /** Rows matching the filter (before paging). */
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  /** Per treatment, over every booking matching `q` and `platform` (the treatment filter aside). */
  readonly counts: Readonly<Record<BookingTreatment, number>>;
  /** Every platform with bookings, sorted. */
  readonly platforms: readonly string[];
  readonly rows: readonly TransactionRow[];
}

export class ListTransactionsQuery {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly filter: TransactionsFilter = {},
  ) {}
}

/**
 * F9.6: every booking of the project for its tax year (`all`: also the earlier ones that decide a
 * balance at 31.12.) with its treatment, key, edit state and its value at the booking's day — the
 * rows of the Transaktionen tab and of the Transaktionsnachweis (F10.13). Computed from the
 * live input with the same `calculate`.
 */
export async function projectTransactionRows(
  inputs: CalculationInputService,
  edits: TransactionEditRepositoryPort,
  project: Project,
  scope: TransactionScope,
): Promise<{ all: TransactionRow[]; currency: string }> {
  const assembled = await inputs.build(project);
  const result = calculate(assembled.input);
  const fileOf = new Map(assembled.files.map((f) => [f.sha256, f] as const));
  const reasons = new Map(
    (await edits.listByOwner(project.ownerId)).map((e) => [e.id, e.reason]),
  );
  const suggested = new Set(
    (await edits.listSuggestions(project.ownerId))
      .filter((x) => x.status === 'open')
      .map((x) => x.key),
  );
  const rules = assembled.input.rules;
  const table = new RateTable(
    applyCorrections(
      assembled.input.bookings,
      assembled.input.holdings,
      assembled.input.corrections,
      rules.homeCurrency,
    ).rates.concat(assembled.input.rates),
    rules.homeCurrency,
  );
  const own = new Map(
    [...assembled.input.bookings, ...assembled.edits.hidden].map(
      (b) => [b.id, b] as const,
    ),
  );
  const marketValue = (row: BookingTreatmentRow): string | null => {
    const booking = own.get(row.id);
    const quantity = parseDecimal(row.quantity).abs();
    if (quantity.isZero()) return null;
    const quote = unitPriceChf(
      table,
      rules,
      row.asset,
      row.timestamp.slice(0, 10),
      { priceChf: booking?.priceChf, priceUsd: booking?.priceUsd },
    );
    return quote ? toDecimalString(quote.priceChf.times(quantity)) : null;
  };
  // F9.8: hidden bookings are not in the input — they stay listed as `excluded`.
  const hidden: BookingTreatmentRow[] = assembled.edits.hidden.map((b) => ({
    id: b.id,
    timestamp: b.timestamp,
    platform: b.platform,
    accountId: b.accountId,
    asset: b.asset,
    quantity: toDecimalString(b.quantity),
    kind: b.kind,
    importedKind: null,
    fee: b.fee === undefined ? null : toDecimalString(b.fee),
    feeAsset: b.fee === undefined ? null : (b.feeAsset ?? b.asset),
    rawType: b.rawType,
    note: b.note ?? null,
    group: b.group ?? null,
    sourceFileId: b.sourceFileId,
    row: b.row,
    manual: false,
    treatment: 'excluded',
    valueChf: null,
    incomeCategory: null,
    figureIds: [],
    correctionId: null,
    correctionReason: null,
  }));
  const cutoff = `${project.taxYear}-01-01T00:00:00.000Z`;
  const all: TransactionRow[] = [
    ...bookingTreatments(assembled.input, result),
    ...hidden,
  ]
    .filter(
      (row) =>
        row.treatment !== 'afterYear' &&
        (row.timestamp >= cutoff ||
          (scope === 'all' && row.treatment === 'balance')),
    )
    .sort(
      (a, b) =>
        compareText(b.timestamp, a.timestamp) || compareText(a.id, b.id),
    )
    .map((row) => {
      const file = fileOf.get(row.sourceFileId);
      const effect = assembled.edits.effects.get(row.id);
      const key = row.manual ? null : (assembled.keys.get(row.id) ?? row.id);
      const lastEdit = effect?.editIds[effect.editIds.length - 1];
      return {
        ...row,
        importedKind:
          row.importedKind ??
          (effect && effect.before.kind !== effect.after.kind
            ? effect.before.kind
            : null),
        importedAsset:
          effect && effect.before.asset !== effect.after.asset
            ? effect.before.asset
            : null,
        marketValue: marketValue(row),
        projectFileId: file?.projectFileId ?? null,
        fileName: file?.displayName ?? null,
        key,
        status:
          key && suggested.has(key)
            ? 'aiSuggested'
            : effect
              ? 'changed'
              : 'original',
        hidden: effect?.hidden ?? false,
        linkedKey: effect?.linkedKey ?? null,
        editReason: lastEdit ? (reasons.get(lastEdit) ?? null) : null,
      };
    });
  return { all, currency: result.currency };
}

/**
 * "Transaktionen": every booking of the project and how it counts — computed from the **live**
 * input (the same `calculate` the snapshot uses, so it is right even while the snapshot is stale),
 * never stored. Excluded bookings stay listed with their correction and reason.
 */
@QueryHandler(ListTransactionsQuery)
export class ListTransactionsHandler implements IQueryHandler<
  ListTransactionsQuery,
  TransactionsView
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly inputs: CalculationInputService,
    private readonly edits: TransactionEditRepositoryPort,
  ) {}

  async execute({
    userId,
    projectId,
    filter,
  }: ListTransactionsQuery): Promise<TransactionsView> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    const { all, currency } = await projectTransactionRows(
      this.inputs,
      this.edits,
      project,
      filter.scope ?? 'year',
    );
    const result = { currency };

    const words = (filter.q ?? '')
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 0);
    const matchesText = (row: TransactionRow) => {
      if (words.length === 0) return true;
      const text = [
        row.asset,
        row.platform,
        row.accountId,
        row.kind,
        row.rawType,
        row.note ?? '',
        row.fileName ?? '',
        row.id,
        row.correctionReason ?? '',
        row.editReason ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return words.every((w) => text.includes(w));
    };
    const scoped = all.filter(
      (row) =>
        (!filter.platform || row.platform === filter.platform) &&
        matchesText(row),
    );
    const counts = Object.fromEntries(
      BOOKING_TREATMENTS.map((t) => [t, 0]),
    ) as Record<BookingTreatment, number>;
    for (const row of scoped) counts[row.treatment] += 1;
    const matching = filter.treatment
      ? scoped.filter((row) => row.treatment === filter.treatment)
      : scoped;

    const limit = Math.min(
      Math.max(filter.limit ?? 50, 1),
      MAX_TRANSACTIONS_PAGE,
    );
    const offset = Math.max(filter.offset ?? 0, 0);
    return {
      taxYear: project.taxYear,
      currency: result.currency,
      total: matching.length,
      offset,
      limit,
      counts,
      platforms: [...new Set(all.map((row) => row.platform))].sort(),
      rows: matching.slice(offset, offset + limit),
    };
  }
}
