import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import type { Project } from '../../domain/project';
import { ProjectRepositoryPort } from '../../ports/project.repository.port';
import { loadOwnProject } from '../project-access';

export class GetProjectQuery {
  constructor(
    readonly userId: string,
    readonly projectId: string,
  ) {}
}

/** Someone else's project is a 404 (`loadOwnProject`). */
@QueryHandler(GetProjectQuery)
export class GetProjectHandler implements IQueryHandler<
  GetProjectQuery,
  Project
> {
  constructor(private readonly projects: ProjectRepositoryPort) {}

  execute({ userId, projectId }: GetProjectQuery): Promise<Project> {
    return loadOwnProject(this.projects, userId, projectId);
  }
}
