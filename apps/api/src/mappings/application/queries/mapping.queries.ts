import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { ProjectFileRepositoryPort } from '../../../files/ports/project-file.repository.port';
import { loadOwnProject } from '../../../projects/application/project-access';
import type { ProjectFileStatus } from '../../../files/domain/project-file';
import type { ProjectStatus } from '../../../projects/domain/project';
import { ProjectRepositoryPort } from '../../../projects/ports/project.repository.port';
import type { ImportMapping } from '../../domain/import-mapping';
import { ImportMappingRepositoryPort } from '../../ports/import-mapping.repository.port';
import { loadOwnMapping } from '../mapping-access';

export class ListMappingsQuery {
  constructor(readonly userId: string) {}
}

/** A mapping in the global list (F11.0): how many files, in how many projects, it reads. */
export interface MappingSummary {
  readonly mapping: ImportMapping;
  readonly filesUsing: number;
  readonly projectsUsing: number;
}

/** All my mappings — they apply to every project of mine (F11.0) — with their usage counts. */
@QueryHandler(ListMappingsQuery)
export class ListMappingsHandler implements IQueryHandler<
  ListMappingsQuery,
  MappingSummary[]
> {
  constructor(
    private readonly mappings: ImportMappingRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
  ) {}

  async execute({ userId }: ListMappingsQuery): Promise<MappingSummary[]> {
    const mine = await this.mappings.findByOwner(userId);
    const uses = await this.files.countByMappings(mine.map((m) => m.id));
    return mine.map((mapping) => {
      const own = uses.filter((use) => use.mappingId === mapping.id);
      return {
        mapping,
        filesUsing: own.reduce((sum, use) => sum + use.files, 0),
        projectsUsing: own.length,
      };
    });
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

export class GetMappingUsageQuery {
  constructor(
    readonly userId: string,
    readonly mappingId: string,
  ) {}
}

export interface MappingUsageFile {
  readonly id: string;
  readonly displayName: string;
  readonly status: ProjectFileStatus;
}

export interface MappingUsageProject {
  readonly id: string;
  readonly name: string;
  readonly taxYear: number;
  readonly status: ProjectStatus;
  readonly files: readonly MappingUsageFile[];
}

/**
 * "Wird genutzt in" (F11.0): the projects and files a mapping reads, newest tax year first, files
 * by name. Someone else's mapping is a 404, like a missing one.
 */
@QueryHandler(GetMappingUsageQuery)
export class GetMappingUsageHandler implements IQueryHandler<
  GetMappingUsageQuery,
  MappingUsageProject[]
> {
  constructor(
    private readonly mappings: ImportMappingRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
    private readonly projects: ProjectRepositoryPort,
  ) {}

  async execute({
    userId,
    mappingId,
  }: GetMappingUsageQuery): Promise<MappingUsageProject[]> {
    const mapping = await loadOwnMapping(this.mappings, userId, mappingId);
    const files = await this.files.listByMapping(mapping.id);
    const out: MappingUsageProject[] = [];
    for (const projectId of new Set(files.map((file) => file.projectId))) {
      const project = await this.projects.findById(projectId);
      // A mapping only ever reads its owner's files; this guards the invariant.
      if (!project || project.ownerId !== userId) continue;
      out.push({
        id: project.id,
        name: project.name,
        taxYear: project.taxYear,
        status: project.status,
        files: files
          .filter((file) => file.projectId === project.id)
          .map((file) => ({
            id: file.id,
            displayName: file.displayName,
            status: file.status,
          }))
          .sort((a, b) => a.displayName.localeCompare(b.displayName, 'de')),
      });
    }
    return out.sort(
      (a, b) =>
        b.taxYear - a.taxYear ||
        a.name.localeCompare(b.name, 'de') ||
        a.id.localeCompare(b.id),
    );
  }
}
