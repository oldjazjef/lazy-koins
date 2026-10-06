import { Injectable } from '@nestjs/common';
import { ImportMappingRepositoryPort } from '../../mappings/ports/import-mapping.repository.port';
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import {
  derivedFromId,
  originProjectId,
  type ProjectFile,
} from '../domain/project-file';
import { ProjectFileRepositoryPort } from '../ports/project-file.repository.port';

/** A project file with the names the overview shows (F5.5 "Herkunft", "gelesen mit …"). */
export interface ProjectFileView extends ProjectFile {
  readonly mappingName: string | null;
  /** Name of the project in `from_project:<id>`; null when it is gone or not the owner's. */
  readonly originProjectName: string | null;
  /** Name of the project file in `derived_from:<id>` (the PDF); null when it is gone. */
  readonly derivedFromName: string | null;
}

@Injectable()
export class FileViews {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly mappings: ImportMappingRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
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
    const derivedNames = new Map<string, string | null>();
    for (const file of files) {
      const id = derivedFromId(file.origin);
      if (id && !derivedNames.has(id)) {
        const source = await this.files.findById(id);
        derivedNames.set(
          id,
          source?.projectId === file.projectId ? source.displayName : null,
        );
      }
    }
    return files.map((file) => {
      const originId = originProjectId(file.origin);
      const derivedId = derivedFromId(file.origin);
      return {
        ...file,
        mappingName: file.mappingId
          ? (mappingNames.get(file.mappingId) ?? null)
          : null,
        originProjectName: originId
          ? (projectNames.get(originId) ?? null)
          : null,
        derivedFromName: derivedId
          ? (derivedNames.get(derivedId) ?? null)
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
