import { ConflictException, Optional } from '@nestjs/common';
import {
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import { missingFileHints } from '@lazykoins/engine';
import { ProjectNotifications } from '../../../notifications/application/project-notifications.service';
import { loadOwnProject } from '../../../projects/application/project-access';
import { ProjectRepositoryPort } from '../../../projects/ports/project.repository.port';
import {
  fileHints,
  fromCoverage,
  type HintState,
  type HintStatus,
  type ProjectHint,
} from '../../domain/project-hint';
import { HintStateRepositoryPort } from '../../ports/hint-state.repository.port';
import { ProjectFileRepositoryPort } from '../../ports/project-file.repository.port';

export class ListProjectHintsQuery {
  constructor(
    readonly userId: string,
    readonly projectId: string,
  ) {}
}

export interface ProjectHints {
  readonly taxYear: number;
  readonly hints: ProjectHint[];
  /** Hints still open (neither done nor ignored) — the tab's badge. */
  readonly open: number;
}

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;

/**
 * F5.8 "Hinweise": the coverage gaps of the tax year (engine, from the files' stored coverage)
 * and the file hints (no mapping, row errors), each with its stored status. Sorted by platform,
 * then severity, then key — the same data gives the same list.
 */
@QueryHandler(ListProjectHintsQuery)
export class ListProjectHintsHandler implements IQueryHandler<
  ListProjectHintsQuery,
  ProjectHints
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
    private readonly states: HintStateRepositoryPort,
  ) {}

  async execute({
    userId,
    projectId,
  }: ListProjectHintsQuery): Promise<ProjectHints> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    const files = await this.files.listByProject(project.id);
    const coverage = files
      .filter((file) => file.status === 'standard' || file.status === 'mapped')
      .flatMap((file) => file.coverage);
    const stored = new Map(
      (await this.states.listByProject(project.id)).map((s) => [s.hintKey, s]),
    );
    const hints = [
      ...missingFileHints(project.taxYear, coverage).map(fromCoverage),
      ...fileHints(files),
    ]
      .map((hint): ProjectHint => {
        const state = stored.get(hint.key);
        return {
          ...hint,
          status: state?.status ?? 'open',
          note: state?.note ?? '',
        };
      })
      .sort(
        (a, b) =>
          compareText(a.platform ?? '￿', b.platform ?? '￿') ||
          SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
          compareText(a.key, b.key),
      );
    return {
      taxYear: project.taxYear,
      hints,
      open: hints.filter((hint) => hint.status === 'open').length,
    };
  }
}

export class UpdateHintStateCommand {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly hintKey: string,
    readonly status: HintStatus,
    readonly note: string,
  ) {}
}

/**
 * "Als in Ordnung markieren" / "Ignorieren" (with an optional note) and "Wieder öffnen". Keys of
 * hints that are not (or no longer) produced may be stored too — they simply never show.
 */
@CommandHandler(UpdateHintStateCommand)
export class UpdateHintStateHandler implements ICommandHandler<
  UpdateHintStateCommand,
  HintState | null
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly states: HintStateRepositoryPort,
    @Optional() private readonly projectNotifications?: ProjectNotifications,
  ) {}

  async execute({
    userId,
    projectId,
    hintKey,
    status,
    note,
  }: UpdateHintStateCommand): Promise<HintState | null> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    if (project.status === 'closed') {
      throw new ConflictException('The project is closed: reopen it first');
    }
    let saved: HintState | null = null;
    if (status === 'open') {
      await this.states.remove(project.id, hintKey);
    } else {
      saved = await this.states.save(project.id, hintKey, {
        status,
        note: note.trim(),
      });
    }
    // A hint marked done settles its notification; reopened, it comes back (F11.11).
    await this.projectNotifications?.hintsChanged(userId, project.id);
    return saved;
  }
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
