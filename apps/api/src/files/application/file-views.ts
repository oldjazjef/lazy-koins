import { Injectable } from '@nestjs/common';
import { ImportMappingRepositoryPort } from '../../mappings/ports/import-mapping.repository.port';
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import { originProjectId, type ProjectFile } from '../domain/project-file';

/** A project file with the names the overview shows (F5.5 "Herkunft", "gelesen mit …"). */
export interface ProjectFileView extends ProjectFile {
  readonly mappingName: string | null;
  /** Name of the project in `from_project:<id>`; null when it is gone or not the owner's. */
  readonly originProjectName: string | null;
}

@Injectable()
export class FileViews {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly mappings: ImportMappingRepositoryPort,
  ) {}

  async of(
    userId: string,
    files: readonly ProjectFile[],
  ): Promise<ProjectFileView[]> {
    const mappingNames = new Map<string, string>();
    if (files.some((file) => file.mappingId)) {
      for (const mapping of await this.mappings.findByOwner(userId)) {
        mappingNames.set(mapping.id, mapping.name);
      }
    }
    const projectNames = new Map<string, string | null>();
    for (const file of files) {
      const id = originProjectId(file.origin);
      if (id && !projectNames.has(id)) {
        const project = await this.projects.findById(id);
        projectNames.set(id, project?.ownerId === userId ? project.name : null);
      }
    }
    return files.map((file) => {
      const originId = originProjectId(file.origin);
      return {
        ...file,
        mappingName: file.mappingId
          ? (mappingNames.get(file.mappingId) ?? null)
          : null,
        originProjectName: originId
          ? (projectNames.get(originId) ?? null)
          : null,
      };
    });
  }

  async one(userId: string, file: ProjectFile): Promise<ProjectFileView> {
    const [view] = await this.of(userId, [file]);
    if (!view) throw new Error('unreachable');
    return view;
  }
}
