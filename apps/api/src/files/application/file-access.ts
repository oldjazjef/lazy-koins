import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { projectClosed } from '../../common/http/api-errors';
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
