import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
  BOOKING_TREATMENTS,
  type BookingTreatment,
  type BookingTreatmentRow,
  bookingTreatments,
  calculate,
} from '@lazykoins/engine';
import { loadOwnProject } from '../../projects/application/project-access';
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import { CalculationInputService } from './calculation-input.service';

/** One page of a project's bookings; `limit` is capped here. */
export const MAX_TRANSACTIONS_PAGE = 200;

export interface TransactionsFilter {
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
  ) {}

  async execute({
    userId,
    projectId,
    filter,
  }: ListTransactionsQuery): Promise<TransactionsView> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    const assembled = await this.inputs.build(project);
    const result = calculate(assembled.input);
    const fileOf = new Map(assembled.files.map((f) => [f.sha256, f] as const));
    const all: TransactionRow[] = bookingTreatments(
      assembled.input,
      result,
    ).map((row) => {
      const file = fileOf.get(row.sourceFileId);
      return {
        ...row,
        projectFileId: file?.projectFileId ?? null,
        fileName: file?.displayName ?? null,
      };
    });

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
