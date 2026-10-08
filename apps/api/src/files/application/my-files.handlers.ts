import { createHash } from 'node:crypto';
import {
  ConflictException,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import { ImportMappingRepositoryPort } from '../../mappings/ports/import-mapping.repository.port';
import { ProjectNotifications } from '../../notifications/application/project-notifications.service';
import { loadOwnProject } from '../../projects/application/project-access';
import type { Project, ProjectStatus } from '../../projects/domain/project';
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import {
  EVIDENCE_ONLY,
  MEDIA_TYPES,
  SELECTED,
  type StoredFileContent,
  UPLOADED,
  type UserFile,
} from '../domain/project-file';
import { ProjectFileRepositoryPort } from '../ports/project-file.repository.port';
import type { FileAssignment } from './commands/change-project-file.command';
import { checkUpload } from './commands/upload-project-file.command';
import { assertOpen, orUnreadable, projectsReading } from './file-access';
import { FileAnalysisService } from './file-analysis.service';
import type { FilePreview } from './queries/file-content.query';
import { type ReadableFile, SourceFileReader } from './source-file-reader';

/**
 * F5.21–F5.23: the user's files, independent of projects — list, upload, read (mapping,
 * detection, evidence only), preview, download, delete, and selecting them in a project.
 * Ownership is checked here: someone else's file reads as 404, exactly like a missing one.
 */

/** One project that selects a file, with what the files page shows of it. */
export interface FileUsageView {
  readonly projectFileId: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly taxYear: number;
  readonly projectStatus: ProjectStatus;
  /** Not deactivated in that project (F5.7a). */
  readonly active: boolean;
}

export interface UserFileView extends Omit<UserFile, 'usages'> {
  readonly mappingName: string | null;
  /** Newest tax year first. */
  readonly usedIn: readonly FileUsageView[];
}

/** The owner's stored file; someone else's or a missing one is a 404. */
async function loadOwnFile(
  files: ProjectFileRepositoryPort,
  userId: string,
  fileId: string,
): Promise<UserFile> {
  const file = await files.findStored(fileId);
  if (!file || file.ownerId !== userId) {
    throw new NotFoundException('No such file');
  }
  return file;
}

async function readableOfStored(
  files: ProjectFileRepositoryPort,
  file: UserFile,
): Promise<{ readable: ReadableFile; content: StoredFileContent }> {
  const content = await files.readContent(file.id);
  if (!content) throw new NotFoundException('No such file');
  return {
    content,
    readable: {
      sha256: content.sha256,
      name: file.originalName,
      kind: content.kind,
      bytes: content.bytes,
    },
  };
}

/** Adds the names the files page shows: the mapping and the projects. */
async function viewsOf(
  projects: ProjectRepositoryPort,
  mappings: ImportMappingRepositoryPort,
  userId: string,
  files: readonly UserFile[],
): Promise<UserFileView[]> {
  const owned = new Map<string, Project>(
    (await projects.findByOwner(userId)).map((p) => [p.id, p]),
  );
  const mappingNames = new Map<string, string>();
  if (files.some((file) => file.mappingId)) {
    for (const mapping of await mappings.findByOwner(userId)) {
      mappingNames.set(mapping.id, mapping.name);
    }
  }
  return files.map(({ usages, ...file }) => ({
    ...file,
    mappingName: file.mappingId
      ? (mappingNames.get(file.mappingId) ?? null)
      : null,
    usedIn: usages
      .flatMap((usage) => {
        const project = owned.get(usage.projectId);
        return project
          ? [
              {
                projectFileId: usage.projectFileId,
                projectId: project.id,
                projectName: project.name,
                taxYear: project.taxYear,
                projectStatus: project.status,
                active: usage.active,
              },
            ]
          : [];
      })
      .sort(
        (a, b) =>
          b.taxYear - a.taxYear || (a.projectName < b.projectName ? -1 : 1),
      ),
  }));
}

// --- List ---

export class ListMyFilesQuery {
  constructor(readonly userId: string) {}
}

/** F5.21: every file of mine, newest first, with its reading and the projects that use it. */
@QueryHandler(ListMyFilesQuery)
export class ListMyFilesHandler implements IQueryHandler<
  ListMyFilesQuery,
  UserFileView[]
> {
  constructor(
    private readonly files: ProjectFileRepositoryPort,
    private readonly projects: ProjectRepositoryPort,
    private readonly mappings: ImportMappingRepositoryPort,
  ) {}

  async execute({ userId }: ListMyFilesQuery): Promise<UserFileView[]> {
    return viewsOf(
      this.projects,
      this.mappings,
      userId,
      await this.files.listByOwner(userId),
    );
  }
}

// --- Upload ---

export class UploadMyFileCommand {
  constructor(
    readonly userId: string,
    readonly name: string,
    readonly bytes: Uint8Array,
  ) {}
}

/** The 409 of a global upload (F5.4): I already have these bytes. */
export class DuplicateUserFileException extends ConflictException {
  constructor(readonly existing: UserFile) {
    super({
      statusCode: 409,
      error: 'Conflict',
      message: 'This file is already among your files',
      code: 'duplicateFile',
      existingId: existing.id,
    });
  }
}

/** F5.21: uploads a file outside any project and reads it (standard format, my mappings). */
@CommandHandler(UploadMyFileCommand)
export class UploadMyFileHandler implements ICommandHandler<
  UploadMyFileCommand,
  UserFileView
> {
  constructor(
    private readonly files: ProjectFileRepositoryPort,
    private readonly projects: ProjectRepositoryPort,
    private readonly mappings: ImportMappingRepositoryPort,
    private readonly analysis: FileAnalysisService,
  ) {}

  async execute({
    userId,
    name,
    bytes,
  }: UploadMyFileCommand): Promise<UserFileView> {
    const { displayName, kind } = checkUpload(name, bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const known = await this.files.findStoredBySha(userId, sha256);
    if (known) {
      const existing = await this.files.findStored(known.id);
      if (existing) throw new DuplicateUserFileException(existing);
    }
    const reading = await orUnreadable(() =>
      this.analysis.analyse(userId, {
        sha256,
        name: displayName,
        kind,
        bytes,
      }),
    );
    const result = await this.files.addStored(userId, {
      sha256,
      bytes,
      mediaType: MEDIA_TYPES[kind],
      kind,
      originalName: displayName,
      analysis: reading,
      source: UPLOADED,
    });
    if ('duplicate' in result) {
      throw new DuplicateUserFileException(result.duplicate);
    }
    const [view] = await viewsOf(this.projects, this.mappings, userId, [
      result.created,
    ]);
    if (!view) throw new Error('unreachable');
    return view;
  }
}

// --- Content, preview ---

export class GetMyFileContentQuery {
  constructor(
    readonly userId: string,
    readonly fileId: string,
  ) {}
}

/** F5.3: the original bytes, unchanged. */
@QueryHandler(GetMyFileContentQuery)
export class GetMyFileContentHandler implements IQueryHandler<
  GetMyFileContentQuery,
  StoredFileContent
> {
  constructor(private readonly files: ProjectFileRepositoryPort) {}

  async execute({
    userId,
    fileId,
  }: GetMyFileContentQuery): Promise<StoredFileContent> {
    const file = await loadOwnFile(this.files, userId, fileId);
    return (await readableOfStored(this.files, file)).content;
  }
}

export class PreviewMyFileQuery {
  constructor(
    readonly userId: string,
    readonly fileId: string,
    readonly rows: number,
  ) {}
}

/** F5.6: the first rows of each table, or "a PDF — load the content". */
@QueryHandler(PreviewMyFileQuery)
export class PreviewMyFileHandler implements IQueryHandler<
  PreviewMyFileQuery,
  FilePreview
> {
  constructor(
    private readonly files: ProjectFileRepositoryPort,
    private readonly reader: SourceFileReader,
  ) {}

  async execute({
    userId,
    fileId,
    rows,
  }: PreviewMyFileQuery): Promise<FilePreview> {
    const file = await loadOwnFile(this.files, userId, fileId);
    if (file.kind === 'pdf') return { kind: 'pdf' };
    const { readable } = await readableOfStored(this.files, file);
    const source = await orUnreadable(() => this.reader.read(readable));
    if (source.kind === 'pdf') return { kind: 'pdf' };
    return {
      kind: 'table',
      sheets: source.sheets.map((sheet) => ({
        name: sheet.name,
        rows: sheet.rows.slice(0, rows + 1),
        totalRows: sheet.rows.length,
      })),
    };
  }
}

// --- How it is read ---

export class ChangeMyFileCommand {
  constructor(
    readonly userId: string,
    readonly fileId: string,
    readonly assignment: FileAssignment,
  ) {}
}

/**
 * F5.21 / F5.2: read with a mapping, detect again or keep as evidence only — for every project
 * that selects the file; 409 `usedByClosedProject` while a closed project uses it.
 */
@CommandHandler(ChangeMyFileCommand)
export class ChangeMyFileHandler implements ICommandHandler<
  ChangeMyFileCommand,
  UserFileView
> {
  constructor(
    private readonly files: ProjectFileRepositoryPort,
    private readonly projects: ProjectRepositoryPort,
    private readonly mappings: ImportMappingRepositoryPort,
    private readonly analysis: FileAnalysisService,
    @Optional() private readonly projectNotifications?: ProjectNotifications,
  ) {}

  async execute({
    userId,
    fileId,
    assignment,
  }: ChangeMyFileCommand): Promise<UserFileView> {
    const file = await loadOwnFile(this.files, userId, fileId);
    const using = await projectsReading(this.projects, this.files, file.id);
    let next;
    if (assignment.mode === 'evidenceOnly') {
      next = EVIDENCE_ONLY;
    } else {
      const { readable } = await readableOfStored(this.files, file);
      if (assignment.mode === 'automatic') {
        next = await orUnreadable(() =>
          this.analysis.analyse(userId, readable),
        );
      } else {
        const mapping = await this.mappings.findById(assignment.mappingId);
        if (!mapping || mapping.ownerId !== userId) {
          throw new NotFoundException('No such mapping');
        }
        if (readable.kind === 'pdf') {
          throw new UnprocessableEntityException(
            'A mapping reads tables (CSV, XLSX), not PDFs',
          );
        }
        next = await orUnreadable(() =>
          this.analysis.withMapping(readable, mapping),
        );
      }
    }
    const updated = await this.files.updateStoredAnalysis(file.id, next);
    if (!updated) throw new NotFoundException('No such file');
    for (const project of using) {
      await this.projectNotifications?.filesChanged(userId, project.id);
    }
    const [view] = await viewsOf(this.projects, this.mappings, userId, [
      updated,
    ]);
    if (!view) throw new Error('unreachable');
    return view;
  }
}

// --- Delete ---

export class DeleteMyFileCommand {
  constructor(
    readonly userId: string,
    readonly fileId: string,
  ) {}
}

/**
 * F5.23: deletes the bytes and takes the file out of every project — refused (409
 * `usedByClosedProject`, with the closed projects) while a closed project uses it.
 */
@CommandHandler(DeleteMyFileCommand)
export class DeleteMyFileHandler implements ICommandHandler<
  DeleteMyFileCommand,
  void
> {
  constructor(
    private readonly files: ProjectFileRepositoryPort,
    private readonly projects: ProjectRepositoryPort,
    @Optional() private readonly projectNotifications?: ProjectNotifications,
  ) {}

  async execute({ userId, fileId }: DeleteMyFileCommand): Promise<void> {
    const file = await loadOwnFile(this.files, userId, fileId);
    const using = await projectsReading(this.projects, this.files, file.id);
    await this.files.deleteStored(file.id);
    for (const project of using) {
      await this.projectNotifications?.filesChanged(userId, project.id);
    }
  }
}

// --- Selection in a project (F5.22) ---

/** One of my files as "Dateien auswählen" offers it for a project. */
export interface FileCandidate extends UserFileView {
  /** Already in the project. */
  readonly selected: boolean;
  /** Pre-ticked: its period touches the tax year, or it holds balances at 31.12. of it. */
  readonly suggested: boolean;
}

/**
 * F5.22: a file is suggested for a tax year when its period (bookings and balances) touches the
 * year, or when it holds balances dated 31.12. of it. Evidence without a period is not.
 */
export function suggestedForYear(
  file: Pick<UserFile, 'period' | 'coverage'>,
  taxYear: number,
): boolean {
  const from = `${taxYear}-01-01`;
  const to = `${taxYear}-12-31`;
  if (file.period && file.period.from <= to && file.period.to >= from) {
    return true;
  }
  return file.coverage.some((entry) => entry.holdingDates.includes(to));
}

export class ListFileCandidatesQuery {
  constructor(
    readonly userId: string,
    readonly projectId: string,
  ) {}
}

@QueryHandler(ListFileCandidatesQuery)
export class ListFileCandidatesHandler implements IQueryHandler<
  ListFileCandidatesQuery,
  FileCandidate[]
> {
  constructor(
    private readonly files: ProjectFileRepositoryPort,
    private readonly projects: ProjectRepositoryPort,
    private readonly mappings: ImportMappingRepositoryPort,
  ) {}

  async execute({
    userId,
    projectId,
  }: ListFileCandidatesQuery): Promise<FileCandidate[]> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    const files = await this.files.listByOwner(userId);
    const views = await viewsOf(this.projects, this.mappings, userId, files);
    return views.map((view, index) => ({
      ...view,
      selected:
        files[index]?.usages.some((u) => u.projectId === project.id) ?? false,
      suggested: suggestedForYear(view, project.taxYear),
    }));
  }
}

export class SelectProjectFilesCommand {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly fileIds: readonly string[],
  ) {}
}

export interface SelectResult {
  /** Files newly added to the project. */
  readonly added: number;
  /** Already in the project — nothing changed. */
  readonly alreadySelected: number;
}

/** F5.22: adds my files to the project (origin `selected`); closed project = 409. */
@CommandHandler(SelectProjectFilesCommand)
export class SelectProjectFilesHandler implements ICommandHandler<
  SelectProjectFilesCommand,
  SelectResult
> {
  constructor(
    private readonly files: ProjectFileRepositoryPort,
    private readonly projects: ProjectRepositoryPort,
    @Optional() private readonly projectNotifications?: ProjectNotifications,
  ) {}

  async execute({
    userId,
    projectId,
    fileIds,
  }: SelectProjectFilesCommand): Promise<SelectResult> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    assertOpen(project);
    // Every id must be mine before anything is linked (no partial selection on a 404).
    const chosen: UserFile[] = [];
    for (const id of new Set(fileIds)) {
      chosen.push(await loadOwnFile(this.files, userId, id));
    }
    let added = 0;
    let alreadySelected = 0;
    for (const file of chosen) {
      if (file.usages.some((u) => u.projectId === project.id)) {
        alreadySelected += 1;
        continue;
      }
      const result = await this.files.add({
        ownerId: userId,
        projectId: project.id,
        stored: { existingId: file.id },
        displayName: file.originalName,
        origin: SELECTED,
      });
      if ('created' in result) added += 1;
      else alreadySelected += 1;
    }
    if (added > 0) {
      await this.projectNotifications?.filesChanged(userId, project.id);
    }
    return { added, alreadySelected };
  }
}
