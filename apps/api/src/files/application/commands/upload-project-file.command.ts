import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import type { FileKind } from '@lazykoins/engine';
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
import { ProjectFileRepositoryPort } from '../../ports/project-file.repository.port';
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
  ) {}

  async execute({
    userId,
    projectId,
    name,
    bytes,
  }: UploadProjectFileCommand): Promise<ProjectFile> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    assertOpen(project);

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

    return storeInProject(this.files, this.analysis, {
      userId,
      projectId,
      displayName,
      kind,
      bytes,
    });
  }
}

/**
 * Stores the bytes (or reuses the owner's stored copy), reads them with the engine and adds them
 * to the project — shared by the upload and by files the AI derives from a PDF (`origin` then
 * names the source). Same bytes already in this project → `DuplicateFileException`.
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
  },
): Promise<ProjectFile> {
  const { userId, projectId, displayName, kind, bytes } = input;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const stored = await files.findStoredBySha(userId, sha256);
  if (stored) {
    const existing = await files.findInProject(projectId, stored.id);
    if (existing) throw new DuplicateFileException(existing);
  }

  const fileAnalysis = await orUnreadable(() =>
    analysis.analyse(userId, { sha256, name: displayName, kind, bytes }),
  );
  const otherProject =
    stored && input.origin === undefined
      ? await files.firstOtherProjectUsing(stored.id, projectId)
      : undefined;

  const result = await files.add({
    ownerId: userId,
    projectId,
    stored: stored
      ? { existingId: stored.id }
      : {
          create: {
            sha256,
            bytes,
            mediaType: MEDIA_TYPES[kind],
            kind,
            originalName: displayName,
          },
        },
    displayName,
    origin:
      input.origin ??
      (otherProject ? `${FROM_PROJECT}${otherProject}` : UPLOADED),
    analysis: fileAnalysis,
  });
  if ('duplicate' in result) throw new DuplicateFileException(result.duplicate);
  return result.created;
}
