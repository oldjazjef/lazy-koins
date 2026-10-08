import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { conflict, projectClosed } from '../../common/http/api-errors';
import { loadOwnProject } from '../../projects/application/project-access';
import type { Project } from '../../projects/domain/project';
import type { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import type { ProjectFile, StoredFileContent } from '../domain/project-file';
import type { ProjectFileRepositoryPort } from '../ports/project-file.repository.port';
import type { ReadableFile } from './source-file-reader';
import { UnreadableFileError } from './source-file-reader';

/** F4.5: a closed project accepts no change to its files. */
export function assertOpen(project: Project): void {
  if (project.status === 'closed') {
    throw projectClosed(
      'The project is closed: reopen it first, then change its files',
    );
  }
}

/**
 * The project file, if `userId` owns its project. Someone else's project, a file of another
 * project and a missing file all read as 404 (as `loadOwnProject`).
 */
export async function loadOwnProjectFile(
  projects: ProjectRepositoryPort,
  files: ProjectFileRepositoryPort,
  userId: string,
  projectId: string,
  projectFileId: string,
): Promise<{ project: Project; file: ProjectFile }> {
  const project = await loadOwnProject(projects, userId, projectId);
  const file = await files.findById(projectFileId);
  if (!file || file.projectId !== project.id) {
    throw new NotFoundException('No such file in this project');
  }
  return { project, file };
}

/** The stored bytes of a project file, ready for the engine. */
export async function readableOf(
  files: ProjectFileRepositoryPort,
  file: ProjectFile,
): Promise<{ readable: ReadableFile; content: StoredFileContent }> {
  const content = await files.readContent(file.fileId);
  if (!content) throw new NotFoundException('No such file in this project');
  return {
    content,
    readable: {
      sha256: content.sha256,
      name: file.displayName,
      kind: content.kind,
      bytes: content.bytes,
    },
  };
}

/**
 * F5.21: how a file is read is the same in every project that selects it. A closed project's
 * figures must not change (F4.5), so a file it uses keeps its reading: 409 `usedByClosedProject`
 * with the closed projects. Returns every project that uses the file (to notify them after).
 */
export async function projectsReading(
  projects: ProjectRepositoryPort,
  files: ProjectFileRepositoryPort,
  storedFileId: string,
): Promise<Project[]> {
  const stored = await files.findStored(storedFileId);
  const using: Project[] = [];
  for (const usage of stored?.usages ?? []) {
    const project = await projects.findById(usage.projectId);
    if (project && !using.some((p) => p.id === project.id)) using.push(project);
  }
  const closed = using.filter((p) => p.status === 'closed');
  if (closed.length > 0) {
    throw conflict(
      'usedByClosedProject',
      'A closed project uses this file: reopen it first, then change how the file is read',
      {
        projects: closed.map((p) => ({
          id: p.id,
          name: p.name,
          taxYear: p.taxYear,
        })),
      },
    );
  }
  return using;
}

/** Maps the reader's "cannot unpack" to a 422 the user can act on. */
export async function orUnreadable<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof UnreadableFileError) {
      throw new UnprocessableEntityException(
        'The file could not be read as a spreadsheet',
      );
    }
    throw error;
  }
}
