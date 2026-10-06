import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { ProjectFileRepositoryPort } from '../../../files/ports/project-file.repository.port';
import { loadOwnProject } from '../../../projects/application/project-access';
import { ProjectRepositoryPort } from '../../../projects/ports/project.repository.port';
import type { ImportMapping } from '../../domain/import-mapping';
import { ImportMappingRepositoryPort } from '../../ports/import-mapping.repository.port';
import { loadOwnMapping } from '../mapping-access';

export class ListMappingsQuery {
  constructor(readonly userId: string) {}
}

@QueryHandler(ListMappingsQuery)
export class ListMappingsHandler implements IQueryHandler<
  ListMappingsQuery,
  ImportMapping[]
> {
  constructor(private readonly mappings: ImportMappingRepositoryPort) {}

  execute({ userId }: ListMappingsQuery): Promise<ImportMapping[]> {
    return this.mappings.findByOwner(userId);
  }
}

export class GetMappingQuery {
  constructor(
    readonly userId: string,
    readonly mappingId: string,
  ) {}
}

@QueryHandler(GetMappingQuery)
export class GetMappingHandler implements IQueryHandler<
  GetMappingQuery,
  ImportMapping
> {
  constructor(private readonly mappings: ImportMappingRepositoryPort) {}

  execute({ userId, mappingId }: GetMappingQuery): Promise<ImportMapping> {
    return loadOwnMapping(this.mappings, userId, mappingId);
  }
}

export class ListProjectMappingsQuery {
  constructor(
    readonly userId: string,
    readonly projectId: string,
  ) {}
}

export interface ProjectMapping {
  readonly mapping: ImportMapping;
  /** The project's files read with it. */
  readonly files: readonly {
    readonly id: string;
    readonly displayName: string;
  }[];
}

/** The mappings a project uses — visible in the project, with the files they read. */
@QueryHandler(ListProjectMappingsQuery)
export class ListProjectMappingsHandler implements IQueryHandler<
  ListProjectMappingsQuery,
  ProjectMapping[]
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
    private readonly mappings: ImportMappingRepositoryPort,
  ) {}

  async execute({
    userId,
    projectId,
  }: ListProjectMappingsQuery): Promise<ProjectMapping[]> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    const files = await this.files.listByProject(project.id);
    const out: ProjectMapping[] = [];
    for (const mapping of await this.mappings.findByOwner(userId)) {
      const using = files.filter((file) => file.mappingId === mapping.id);
      if (using.length === 0) continue;
      out.push({
        mapping,
        files: using.map((file) => ({
          id: file.id,
          displayName: file.displayName,
        })),
      });
    }
    return out;
  }
}
