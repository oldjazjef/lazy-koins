import { Optional } from '@nestjs/common';
import { projectClosed } from '../../../common/http/api-errors';
import {
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import { assetsNeedingPrices, missingFileHints } from '@lazykoins/engine';
import { projectRules } from '../../../calculation/application/calculation-input.service';
import { CalculationSnapshotRepositoryPort } from '../../../calculation/ports/calculation.repository.port';
import { sharedTicker } from '../../../rates/domain/coin-choice';
import { CoinMarketRepositoryPort } from '../../../rates/ports/coin-market.repository.port';
import { UserSettingsRepositoryPort } from '../../../settings/ports/user-settings.repository.port';
import { ProjectNotifications } from '../../../notifications/application/project-notifications.service';
import { loadOwnProject } from '../../../projects/application/project-access';
import { ProjectRepositoryPort } from '../../../projects/ports/project.repository.port';
import {
  fileHints,
  fromCoverage,
  type HintState,
  type HintStatus,
  type ProjectHint,
  sharedTickerHint,
} from '../../domain/project-hint';
import { readsRecords } from '../../domain/project-file';
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
    @Optional() private readonly snapshots?: CalculationSnapshotRepositoryPort,
    @Optional() private readonly market?: CoinMarketRepositoryPort,
    @Optional() private readonly settings?: UserSettingsRepositoryPort,
  ) {}

  /**
   * F7.4: the tickers of the latest calculation that several relevant coins carry (market list;
   * a chosen coin or "Passt so" settles them). Empty without a calculation or a market list.
   */
  private async sharedTickerHints(
    project: Parameters<typeof projectRules>[0] & {
      id: string;
      ownerId: string;
    },
  ): Promise<Omit<ProjectHint, 'status' | 'note'>[]> {
    if (!this.snapshots || !this.market || !this.settings) return [];
    const snapshot = await this.snapshots.latest(project.id);
    if (!snapshot) return [];
    const assets = assetsNeedingPrices(
      { ...snapshot.result, records: {} },
      projectRules(project),
    );
    const stored = await this.settings.find(project.ownerId);
    const coins = await this.market.listBySymbols('coingecko', assets);
    return assets
      .map((asset) =>
        sharedTicker(
          asset,
          coins,
          stored?.coinChoices ?? {},
          stored?.coinDismissed ?? [],
        ),
      )
      .filter((s) => s !== null)
      .map(sharedTickerHint);
  }

  async execute({
    userId,
    projectId,
  }: ListProjectHintsQuery): Promise<ProjectHints> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    const files = await this.files.listByProject(project.id);
    // F5.7a: a deactivated file covers nothing; a hint names it when it would have.
    const coverage = files
      .filter(readsRecords)
      .flatMap((file) => file.coverage);
    const stored = new Map(
      (await this.states.listByProject(project.id)).map((s) => [s.hintKey, s]),
    );
    const hints = [
      ...missingFileHints(project.taxYear, coverage).map((hint) =>
        fromCoverage(hint, files),
      ),
      ...fileHints(files),
      ...(await this.sharedTickerHints(project)),
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
      throw projectClosed('The project is closed: reopen it first');
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
