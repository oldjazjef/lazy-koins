import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { missingFileHints, type MissingFileHint } from '@lazykoins/engine';
import { loadOwnProject } from '../../../projects/application/project-access';
import { ProjectRepositoryPort } from '../../../projects/ports/project.repository.port';
import { ProjectFileRepositoryPort } from '../../ports/project-file.repository.port';
import { FileViews, type ProjectFileView } from '../file-views';

export class ListProjectFilesQuery {
  constructor(
    readonly userId: string,
    readonly projectId: string,
  ) {}
}

export interface ProjectFilesOverview {
  readonly files: ProjectFileView[];
  /** F5.8 for the project's tax year, from the files' coverage. */
  readonly missing: MissingFileHint[];
  readonly taxYear: number;
}

/** F5.5 + F5.8: the project's files (oldest first) and what seems to be missing. */
@QueryHandler(ListProjectFilesQuery)
export class ListProjectFilesHandler implements IQueryHandler<
  ListProjectFilesQuery,
  ProjectFilesOverview
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
    private readonly views: FileViews,
  ) {}

  async execute({
    userId,
    projectId,
  }: ListProjectFilesQuery): Promise<ProjectFilesOverview> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    const files = await this.files.listByProject(project.id);
    const coverage = files
      .filter((file) => file.status === 'standard' || file.status === 'mapped')
      .flatMap((file) => file.coverage);
    return {
      files: await this.views.of(userId, files),
      missing: missingFileHints(project.taxYear, coverage),
      taxYear: project.taxYear,
    };
  }
}
