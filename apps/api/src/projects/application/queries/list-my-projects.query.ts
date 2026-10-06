import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import type { Project } from '../../domain/project';
import { ProjectRepositoryPort } from '../../ports/project.repository.port';

export class ListMyProjectsQuery {
  constructor(readonly userId: string) {}
}

/** F4.2: my projects only, newest tax year first. */
@QueryHandler(ListMyProjectsQuery)
export class ListMyProjectsHandler implements IQueryHandler<
  ListMyProjectsQuery,
  Project[]
> {
  constructor(private readonly projects: ProjectRepositoryPort) {}

  execute({ userId }: ListMyProjectsQuery): Promise<Project[]> {
    return this.projects.findByOwner(userId);
  }
}
