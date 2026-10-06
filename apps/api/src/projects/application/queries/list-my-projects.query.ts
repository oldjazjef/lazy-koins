import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import type { ProjectFigures } from '../../../calculation/domain/calculation';
import { CalculationSnapshotRepositoryPort } from '../../../calculation/ports/calculation.repository.port';
import type { Project } from '../../domain/project';
import {
  changesSinceSent,
  NO_CHANGES,
  type SentVia,
} from '../../domain/project-sent';
import { ProjectRepositoryPort } from '../../ports/project.repository.port';
import { ProjectSentRepositoryPort } from '../../ports/project-sent.repository.port';

export class ListMyProjectsQuery {
  constructor(readonly userId: string) {}
}

/** F4.7 in the list: when and how it went to the Treuhänder, and whether it changed since. */
export interface ProjectSentSummary {
  readonly sentAt: string;
  readonly via: SentVia;
  readonly changedSince: boolean;
}

/** A project in the list, with the figures of its latest calculation (F4.2). */
export interface ProjectListEntry extends Project {
  readonly figures: ProjectFigures | null;
  readonly sent: ProjectSentSummary | null;
}

/** F4.2: my projects only, newest tax year first, with Vermögen and Ertrag (and F4.7). */
@QueryHandler(ListMyProjectsQuery)
export class ListMyProjectsHandler implements IQueryHandler<
  ListMyProjectsQuery,
  ProjectListEntry[]
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly snapshots: CalculationSnapshotRepositoryPort,
    private readonly sentStates: ProjectSentRepositoryPort,
  ) {}

  async execute({ userId }: ListMyProjectsQuery): Promise<ProjectListEntry[]> {
    const projects = await this.projects.findByOwner(userId);
    const ids = projects.map((project) => project.id);
    const figures = await this.snapshots.latestFigures(ids);
    const states = await this.sentStates.findMany(ids);
    const sentIds = ids.filter((id) => states.has(id));
    const facts =
      sentIds.length > 0
        ? await this.sentStates.changeFacts(sentIds)
        : new Map<string, never>();
    return projects.map((project) => {
      const state = states.get(project.id);
      return {
        ...project,
        figures: figures.get(project.id) ?? null,
        sent: state
          ? {
              sentAt: state.sentAt,
              via: state.via,
              changedSince:
                changesSinceSent(state, facts.get(project.id) ?? NO_CHANGES)
                  .length > 0,
            }
          : null,
      };
    });
  }
}
