import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Optional,
  PayloadTooLargeException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import type { FileKind } from '@lazykoins/engine';
import { NotificationService } from '../../../notifications/application/notification.service';
import { ProjectNotifications } from '../../../notifications/application/project-notifications.service';
import {
  projectRoute,
  Topics,
} from '../../../notifications/domain/notification';
import { loadOwnProject } from '../../../projects/application/project-access';
import { ProjectRepositoryPort } from '../../../projects/ports/project.repository.port';
import {
  cleanFileName,
  FROM_PROJECT,
  MAX_FILE_BYTES,
  MEDIA_TYPES,
  type ProjectFile,
  sniffFileKind,
  UPLOADED,
} from '../../domain/project-file';
import {
  type AddProjectFileInput,
  ProjectFileRepositoryPort,
} from '../../ports/project-file.repository.port';
import { assertOpen, orUnreadable } from '../file-access';
import { FileAnalysisService } from '../file-analysis.service';

export class UploadProjectFileCommand {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly name: string,
    readonly bytes: Uint8Array,
  ) {}
}

/** The 409 body of a duplicate upload (F5.4): the entry that already holds these bytes. */
export class DuplicateFileException extends ConflictException {
  constructor(readonly existing: ProjectFile) {
    super({
      statusCode: 409,
      error: 'Conflict',
      message: 'This file is already in the project',
      existingId: existing.id,
    });
  }
}

/**
 * F5.1–F5.5: stores the original bytes unchanged (content-addressed per owner), reads them with
 * the engine and adds them to the project. The same bytes twice in one project → 409 with the
 * existing entry; the same bytes in another project of the owner → the stored file is reused
 * (no second BLOB) and the origin names that project (F4.4).
 */
@CommandHandler(UploadProjectFileCommand)
export class UploadProjectFileHandler implements ICommandHandler<
  UploadProjectFileCommand,
  ProjectFile
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
    private readonly analysis: FileAnalysisService,
    @Optional() private readonly notifications?: NotificationService,
    @Optional() private readonly projectNotifications?: ProjectNotifications,
  ) {}

  async execute({
    userId,
    projectId,
    name,
    bytes,
  }: UploadProjectFileCommand): Promise<ProjectFile> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    assertOpen(project);

    const { displayName, kind } = checkUpload(name, bytes);

    let stored: ProjectFile;
    try {
      stored = await storeInProject(this.files, this.analysis, {
        userId,
        projectId,
        displayName,
        kind,
        bytes,
      });
    } catch (error) {
      if (error instanceof UnprocessableEntityException) {
        // F11.12: "Datei konnte nicht gelesen werden" — the name only, never its content.
        await this.notifications?.raise(
          userId,
          Topics.fileReadFailed(project.id),
          {
            kind: 'error',
            projectId: project.id,
            params: { name: displayName },
            action: projectRoute(
              project.id,
              'notifications.action.toFiles',
              'files',
            ),
          },
        );
      }
      throw error;
    }
    // Needs a mapping, row errors, coverage hints, "seit dem Versand geändert" (F11.12).
    await this.projectNotifications?.filesChanged(userId, project.id);
    return stored;
  }
}

/**
 * F5.1: the name and bytes of an upload, checked — a name, not empty, at most 20 MB, and CSV,
 * XLSX or PDF recognised from the bytes (never the name). Shared by the project and the global
 * upload (F5.21).
 */
export function checkUpload(
  name: string,
  bytes: Uint8Array,
): { displayName: string; kind: FileKind } {
  const displayName = cleanFileName(name);
  if (!displayName)
    throw new BadRequestException('name: a file name is required');
  if (bytes.length === 0) throw new BadRequestException('The file is empty');
  if (bytes.length > MAX_FILE_BYTES) {
    throw new PayloadTooLargeException(
      `The file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`,
    );
  }
  const kind = sniffFileKind(bytes);
  if (!kind) {
    throw new UnsupportedMediaTypeException(
      'Only CSV, XLSX and PDF files are accepted',
    );
  }
  return { displayName, kind };
}

/**
 * Stores the bytes with their reading (or reuses the owner's stored copy, which keeps its
 * reading — F5.21) and adds them to the project — shared by the upload, files the AI derives from
 * a PDF and wallet fetches (`origin` / `source` then name where they came from). Same bytes
 * already in this project → `DuplicateFileException`.
 */
export async function storeInProject(
  files: ProjectFileRepositoryPort,
  analysis: FileAnalysisService,
  input: {
    readonly userId: string;
    readonly projectId: string;
    readonly displayName: string;
    readonly kind: FileKind;
    readonly bytes: Uint8Array;
    readonly origin?: string;
    /** The stored file's `source` when it is new (default `uploaded`). */
    readonly source?: string;
  },
): Promise<ProjectFile> {
  const { userId, projectId, displayName, kind, bytes } = input;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const stored = await files.findStoredBySha(userId, sha256);
  if (stored) {
    const existing = await files.findInProject(projectId, stored.id);
    if (existing) throw new DuplicateFileException(existing);
  }

  // F5.21: a file the owner already has keeps its reading; only new bytes are read here.
  const target: AddProjectFileInput['stored'] = stored
    ? { existingId: stored.id }
    : {
        create: {
          sha256,
          bytes,
          mediaType: MEDIA_TYPES[kind],
          kind,
          originalName: displayName,
          analysis: await orUnreadable(() =>
            analysis.analyse(userId, {
              sha256,
              name: displayName,
              kind,
              bytes,
            }),
          ),
          source: input.source ?? UPLOADED,
        },
      };
  const otherProject =
    stored && input.origin === undefined
      ? await files.firstOtherProjectUsing(stored.id, projectId)
      : undefined;

  const result = await files.add({
    ownerId: userId,
    projectId,
    stored: target,
    displayName,
    origin:
      input.origin ??
      (otherProject ? `${FROM_PROJECT}${otherProject}` : UPLOADED),
  });
  if ('duplicate' in result) throw new DuplicateFileException(result.duplicate);
  return result.created;
}
