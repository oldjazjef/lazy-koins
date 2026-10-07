import {
  BadRequestException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { projectClosed } from '../../common/http/api-errors';
import {
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import {
  type AppliedCorrection,
  calculate,
  type Check,
  CORRECTION_SOURCE_PREFIX,
  ENGINE_VERSION,
  type OpenItem,
  type RecordSummary,
  validateCorrectionData,
} from '@lazykoins/engine';
import { ProjectNotifications } from '../../notifications/application/project-notifications.service';
import { loadOwnProject } from '../../projects/application/project-access';
import type { Project } from '../../projects/domain/project';
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import type {
  FileRef,
  OpenItemState,
  SnapshotMeta,
  StoredCorrection,
  StoredResult,
} from '../domain/calculation';
import {
  CalculationSnapshotRepositoryPort,
  CorrectionRepositoryPort,
  OpenItemStateRepositoryPort,
} from '../ports/calculation.repository.port';
import { CalculationInputService } from './calculation-input.service';

/** F4.5: a closed project accepts no change — no recalculation, correction or tick either. */
export function assertProjectOpen(project: Project): void {
  if (project.status === 'closed') throw projectClosed();
}

export interface ResultView {
  readonly snapshot: SnapshotMeta | null;
  /** The data changed since the snapshot (files, mappings, corrections, rates): recalculate. */
  readonly stale: boolean;
  readonly result: StoredResult | null;
  readonly files: readonly FileRef[];
}

// --- Calculate (F7.6) ---

export class CalculateProjectCommand {
  constructor(
    readonly userId: string,
    readonly projectId: string,
  ) {}
}

/** Recalculates from the stored data and keeps the result as a snapshot with its input hash. */
@CommandHandler(CalculateProjectCommand)
export class CalculateProjectHandler implements ICommandHandler<
  CalculateProjectCommand,
  ResultView
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly inputs: CalculationInputService,
    private readonly snapshots: CalculationSnapshotRepositoryPort,
    @Optional() private readonly projectNotifications?: ProjectNotifications,
  ) {}

  async execute({
    userId,
    projectId,
  }: CalculateProjectCommand): Promise<ResultView> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    assertProjectOpen(project);
    const assembled = await this.inputs.build(project);
    const { records, ...result } = calculate(assembled.input);
    const meta = await this.snapshots.save(project.id, {
      inputHash: assembled.inputHash,
      engineVersion: ENGINE_VERSION,
      result,
      records,
    });
    // Open items, positions without a price, hints, "seit dem Versand geändert" (F11.12).
    await this.projectNotifications?.calculated(userId, project.id);
    return { snapshot: meta, stale: false, result, files: assembled.files };
  }
}

// --- Result, drill-down (F7.5) ---

export class GetResultQuery {
  constructor(
    readonly userId: string,
    readonly projectId: string,
  ) {}
}

@QueryHandler(GetResultQuery)
export class GetResultHandler implements IQueryHandler<
  GetResultQuery,
  ResultView
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly inputs: CalculationInputService,
    private readonly snapshots: CalculationSnapshotRepositoryPort,
  ) {}

  async execute({ userId, projectId }: GetResultQuery): Promise<ResultView> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    const snapshot = await this.snapshots.latest(project.id);
    const files = await this.inputs.fileRefs(project.id);
    if (!snapshot) return { snapshot: null, stale: true, result: null, files };
    const { result, ...meta } = snapshot;
    const stale = await this.inputs.isStale(project, meta);
    return { snapshot: meta, stale, result, files };
  }
}

/** The project header's line (F7.6): when it was calculated and whether that is out of date. */
export interface ResultStatus {
  /** null = never calculated. */
  readonly calculatedAt: string | null;
  /** The data changed since the latest calculation; false without one. */
  readonly stale: boolean;
}

export class GetResultStatusQuery {
  constructor(
    readonly userId: string,
    readonly projectId: string,
  ) {}
}

/** Cheap: the snapshot's figures row and the input hash — no result JSON, no file read. */
@QueryHandler(GetResultStatusQuery)
export class GetResultStatusHandler implements IQueryHandler<
  GetResultStatusQuery,
  ResultStatus
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly inputs: CalculationInputService,
    private readonly snapshots: CalculationSnapshotRepositoryPort,
  ) {}

  async execute({
    userId,
    projectId,
  }: GetResultStatusQuery): Promise<ResultStatus> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    const figures = (await this.snapshots.latestFigures([project.id])).get(
      project.id,
    );
    if (!figures) return { calculatedAt: null, stale: false };
    return {
      calculatedAt: figures.calculatedAt,
      stale: await this.inputs.isStale(project, figures),
    };
  }
}

export interface FigureRecord extends RecordSummary {
  /** The project file the record comes from; null for a correction's record. */
  readonly projectFileId: string | null;
  readonly fileName: string | null;
  readonly correctionId: string | null;
}

export interface FigureRecords {
  readonly figureId: string;
  readonly total: number;
  readonly records: readonly FigureRecord[];
}

/** At most this many records per drill-down answer (`total` says how many there are). */
const MAX_FIGURE_RECORDS = 2000;

export class GetFigureRecordsQuery {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly figureId: string,
  ) {}
}

/** F7.5: amount → its records → file and row. */
@QueryHandler(GetFigureRecordsQuery)
export class GetFigureRecordsHandler implements IQueryHandler<
  GetFigureRecordsQuery,
  FigureRecords
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly inputs: CalculationInputService,
    private readonly snapshots: CalculationSnapshotRepositoryPort,
  ) {}

  async execute({
    userId,
    projectId,
    figureId,
  }: GetFigureRecordsQuery): Promise<FigureRecords> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    const snapshot = await this.snapshots.latest(project.id);
    if (!snapshot) throw new NotFoundException('Not calculated yet');
    const ids = recordIdsOf(snapshot.result, figureId);
    if (!ids) throw new NotFoundException('No such figure');
    const summaries = (await this.snapshots.records(snapshot.id)) ?? {};
    const files = new Map(
      (await this.inputs.fileRefs(project.id)).map((f) => [f.sha256, f]),
    );
    const records: FigureRecord[] = [];
    for (const id of ids.slice(0, MAX_FIGURE_RECORDS)) {
      const summary = summaries[id];
      if (!summary) continue;
      const file = files.get(summary.sourceFileId);
      records.push({
        ...summary,
        projectFileId: file?.projectFileId ?? null,
        fileName: file?.displayName ?? null,
        correctionId: summary.sourceFileId.startsWith(CORRECTION_SOURCE_PREFIX)
          ? summary.sourceFileId.slice(CORRECTION_SOURCE_PREFIX.length)
          : null,
      });
    }
    return { figureId, total: ids.length, records };
  }
}

/** The record ids behind a figure of a result, `undefined` for an unknown figure id. */
export function recordIdsOf(
  result: StoredResult,
  figureId: string,
): string[] | undefined {
  const unique = (lists: readonly (readonly string[])[]) => [
    ...new Set(lists.flat()),
  ];
  if (figureId.startsWith('plat:')) {
    const platform = figureId.slice('plat:'.length);
    if (!result.platforms.some((p) => p.platform === platform))
      return undefined;
    return unique(
      result.positions
        .filter((p) => p.platform === platform && p.status !== 'spam')
        .map((p) => p.recordIds),
    );
  }
  if (figureId.startsWith('cat:')) {
    const category = figureId.slice('cat:'.length);
    if (!result.categories.some((c) => c.category === category))
      return undefined;
    if (category === 'earn_gap')
      return unique(result.earnGaps.map((g) => g.recordIds));
    return unique(
      result.income
        .filter((l) => l.category === category)
        .map((l) => l.recordIds),
    );
  }
  const figure =
    result.positions.find((p) => p.id === figureId) ??
    result.income.find((l) => l.id === figureId) ??
    result.earnGaps.find((g) => g.id === figureId) ??
    result.oneOffEvents.find((e) => e.id === figureId) ??
    result.openItems.find((i) => i.key === figureId);
  return figure ? [...figure.recordIds] : undefined;
}

// --- Checks and open items (F8.1, F8.2) ---

export interface OpenItemView extends OpenItem {
  readonly done: boolean;
  readonly note: string;
}

export interface ChecksView {
  readonly snapshot: SnapshotMeta | null;
  readonly checks: readonly Check[];
  readonly items: readonly OpenItemView[];
  readonly comparison: StoredResult['comparison'];
}

export class GetChecksQuery {
  constructor(
    readonly userId: string,
    readonly projectId: string,
  ) {}
}

@QueryHandler(GetChecksQuery)
export class GetChecksHandler implements IQueryHandler<
  GetChecksQuery,
  ChecksView
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly snapshots: CalculationSnapshotRepositoryPort,
    private readonly states: OpenItemStateRepositoryPort,
  ) {}

  async execute({ userId, projectId }: GetChecksQuery): Promise<ChecksView> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    const snapshot = await this.snapshots.latest(project.id);
    if (!snapshot) {
      return { snapshot: null, checks: [], items: [], comparison: null };
    }
    const states = new Map(
      (await this.states.listByProject(project.id)).map((s) => [s.itemKey, s]),
    );
    const { result, ...meta } = snapshot;
    return {
      snapshot: meta,
      checks: result.checks,
      items: result.openItems.map((item) => ({
        ...item,
        done: states.get(item.key)?.done ?? false,
        note: states.get(item.key)?.note ?? '',
      })),
      comparison: result.comparison,
    };
  }
}

export class UpdateOpenItemCommand {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly itemKey: string,
    readonly changes: { readonly done?: boolean; readonly note?: string },
  ) {}
}

/** F8.2: tick off / annotate. Keys are stable across recalculations of the same data. */
@CommandHandler(UpdateOpenItemCommand)
export class UpdateOpenItemHandler implements ICommandHandler<
  UpdateOpenItemCommand,
  OpenItemState
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly states: OpenItemStateRepositoryPort,
    @Optional() private readonly projectNotifications?: ProjectNotifications,
  ) {}

  async execute({
    userId,
    projectId,
    itemKey,
    changes,
  }: UpdateOpenItemCommand): Promise<OpenItemState> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    assertProjectOpen(project);
    const saved = await this.states.save(project.id, itemKey, {
      done: changes.done,
      note: changes.note?.trim(),
    });
    // The last open item ticked off resolves "offene Punkte" (F11.11).
    await this.projectNotifications?.openItemsChanged(userId, project.id);
    return saved;
  }
}

// --- Corrections (F9) ---

export interface CorrectionView extends StoredCorrection {
  /** What the latest calculation did with it (before/after), null when not calculated since. */
  readonly applied: AppliedCorrection | null;
}

export class ListCorrectionsQuery {
  constructor(
    readonly userId: string,
    readonly projectId: string,
  ) {}
}

@QueryHandler(ListCorrectionsQuery)
export class ListCorrectionsHandler implements IQueryHandler<
  ListCorrectionsQuery,
  CorrectionView[]
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly corrections: CorrectionRepositoryPort,
    private readonly snapshots: CalculationSnapshotRepositoryPort,
  ) {}

  async execute({
    userId,
    projectId,
  }: ListCorrectionsQuery): Promise<CorrectionView[]> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    const snapshot = await this.snapshots.latest(project.id);
    const applied = new Map(
      (snapshot?.result.corrections ?? []).map((a) => [a.correctionId, a]),
    );
    return (await this.corrections.listByProject(project.id)).map((c) => ({
      ...c,
      applied: c.undoneAt === null ? (applied.get(c.id) ?? null) : null,
    }));
  }
}

export class CreateCorrectionCommand {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly data: unknown,
    readonly reason: string,
  ) {}
}

/** F9.1–F9.4: validated by the engine's schema; the reason is required. */
@CommandHandler(CreateCorrectionCommand)
export class CreateCorrectionHandler implements ICommandHandler<
  CreateCorrectionCommand,
  StoredCorrection
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly corrections: CorrectionRepositoryPort,
    @Optional() private readonly projectNotifications?: ProjectNotifications,
  ) {}

  async execute({
    userId,
    projectId,
    data,
    reason,
  }: CreateCorrectionCommand): Promise<StoredCorrection> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    assertProjectOpen(project);
    const validation = validateCorrectionData(data);
    if (!validation.ok) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: 'The correction is invalid',
        code: 'invalidCorrection',
        issues: validation.issues,
      });
    }
    const trimmed = reason.trim();
    if (trimmed === '') throw new BadRequestException('reason is required');
    const created = await this.corrections.create(project.id, {
      data: validation.data,
      reason: trimmed,
    });
    // A correction after sending: "seit dem Versand geändert" (F4.7 → F11.12).
    await this.projectNotifications?.sentChanged(userId, project.id);
    return created;
  }
}

export class SetCorrectionUndoneCommand {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly correctionId: string,
    readonly undone: boolean,
  ) {}
}

/** F9.4: undo / redo — the correction stays in the history either way. */
@CommandHandler(SetCorrectionUndoneCommand)
export class SetCorrectionUndoneHandler implements ICommandHandler<
  SetCorrectionUndoneCommand,
  StoredCorrection
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly corrections: CorrectionRepositoryPort,
    @Optional() private readonly projectNotifications?: ProjectNotifications,
  ) {}

  async execute({
    userId,
    projectId,
    correctionId,
    undone,
  }: SetCorrectionUndoneCommand): Promise<StoredCorrection> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    assertProjectOpen(project);
    const existing = await this.corrections.findById(correctionId);
    if (!existing || existing.projectId !== project.id) {
      throw new NotFoundException('No such correction');
    }
    const updated = await this.corrections.setUndone(correctionId, undone);
    if (!updated) throw new NotFoundException('No such correction');
    await this.projectNotifications?.sentChanged(userId, project.id);
    return updated;
  }
}
