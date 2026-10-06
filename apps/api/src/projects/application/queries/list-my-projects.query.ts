import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import type { ProjectFigures } from '../../../calculation/domain/calculation';
import { CalculationSnapshotRepositoryPort } from '../../../calculation/ports/calculation.repository.port';
import type { Project } from '../../domain/project';
import { ProjectRepositoryPort } from '../../ports/project.repository.port';

export class ListMyProjectsQuery {
  constructor(readonly userId: string) {}
}

/** A project in the list, with the figures of its latest calculation (F4.2). */
export interface ProjectListEntry extends Project {
  readonly figures: ProjectFigures | null;
}

/** F4.2: my projects only, newest tax year first, with Vermögen and Ertrag. */
@QueryHandler(ListMyProjectsQuery)
export class ListMyProjectsHandler implements IQueryHandler<
  ListMyProjectsQuery,
  ProjectListEntry[]
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly snapshots: CalculationSnapshotRepositoryPort,
  ) {}

  async execute({ userId }: ListMyProjectsQuery): Promise<ProjectListEntry[]> {
    const projects = await this.projects.findByOwner(userId);
    const figures = await this.snapshots.latestFigures(
      projects.map((project) => project.id),
    );
    return projects.map((project) => ({
      ...project,
      figures: figures.get(project.id) ?? null,
    }));
  }
}
