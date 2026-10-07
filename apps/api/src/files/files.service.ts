import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  ChangeProjectFileCommand,
  type FileAssignment,
} from './application/commands/change-project-file.command';
import {
  ReapplyMappingCommand,
  type ReapplyResult,
} from './application/commands/reapply-mapping.command';
import { RemoveProjectFileCommand } from './application/commands/remove-project-file.command';
import { SetFileActiveCommand } from './application/commands/set-file-active.command';
import { UploadProjectFileCommand } from './application/commands/upload-project-file.command';
import { FileViews, type ProjectFileView } from './application/file-views';
import {
  type FilePreview,
  GetFileContentQuery,
  PreviewFileQuery,
} from './application/queries/file-content.query';
import {
  ListProjectFilesQuery,
  type ProjectFilesOverview,
} from './application/queries/list-project-files.query';
import {
  type MappingPreview,
  type MappingSource,
  PreviewMappingQuery,
} from './application/queries/preview-mapping.query';
import {
  ListProjectHintsQuery,
  type ProjectHints,
  UpdateHintStateCommand,
} from './application/queries/project-hints.query';
import {
  type FileRowErrors,
  FileRowErrorsQuery,
} from './application/queries/row-errors.query';
import type { ProjectFile, StoredFileContent } from './domain/project-file';
import type { HintState, HintStatus } from './domain/project-hint';

/** Thin façade over the buses — no logic here; it lives in the handlers. */
@Injectable()
export class FilesService {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
    private readonly views: FileViews,
  ) {}

  async upload(
    userId: string,
    projectId: string,
    name: string,
    bytes: Uint8Array,
  ): Promise<ProjectFileView> {
    const file: ProjectFile = await this.commands.execute(
      new UploadProjectFileCommand(userId, projectId, name, bytes),
    );
    return this.views.one(userId, file);
  }

  view(userId: string, file: ProjectFile): Promise<ProjectFileView> {
    return this.views.one(userId, file);
  }

  list(userId: string, projectId: string): Promise<ProjectFilesOverview> {
    return this.queries.execute(new ListProjectFilesQuery(userId, projectId));
  }

  content(
    userId: string,
    projectId: string,
    fileId: string,
  ): Promise<StoredFileContent> {
    return this.queries.execute(
      new GetFileContentQuery(userId, projectId, fileId),
    );
  }

  preview(
    userId: string,
    projectId: string,
    fileId: string,
    rows: number,
  ): Promise<FilePreview> {
    return this.queries.execute(
      new PreviewFileQuery(userId, projectId, fileId, rows),
    );
  }

  previewMapping(
    userId: string,
    projectId: string,
    fileId: string,
    source: MappingSource,
    limit: number,
  ): Promise<MappingPreview> {
    return this.queries.execute(
      new PreviewMappingQuery(userId, projectId, fileId, source, limit),
    );
  }

  async change(
    userId: string,
    projectId: string,
    fileId: string,
    assignment: FileAssignment,
  ): Promise<ProjectFileView> {
    const file: ProjectFile = await this.commands.execute(
      new ChangeProjectFileCommand(userId, projectId, fileId, assignment),
    );
    return this.views.one(userId, file);
  }

  /** F5.7a: deactivate (`active: false`, optional note) or activate a file of the project. */
  async setActive(
    userId: string,
    projectId: string,
    fileId: string,
    active: boolean,
    note = '',
  ): Promise<ProjectFileView> {
    const file: ProjectFile = await this.commands.execute(
      new SetFileActiveCommand(userId, projectId, fileId, active, note),
    );
    return this.views.one(userId, file);
  }

  remove(userId: string, projectId: string, fileId: string): Promise<void> {
    return this.commands.execute(
      new RemoveProjectFileCommand(userId, projectId, fileId),
    );
  }

  reapplyMapping(userId: string, mappingId: string): Promise<ReapplyResult> {
    return this.commands.execute(new ReapplyMappingCommand(userId, mappingId));
  }

  rowErrors(
    userId: string,
    projectId: string,
    fileId: string,
    limit: number,
  ): Promise<FileRowErrors> {
    return this.queries.execute(
      new FileRowErrorsQuery(userId, projectId, fileId, limit),
    );
  }

  hints(userId: string, projectId: string): Promise<ProjectHints> {
    return this.queries.execute(new ListProjectHintsQuery(userId, projectId));
  }

  updateHint(
    userId: string,
    projectId: string,
    hintKey: string,
    status: HintStatus,
    note: string,
  ): Promise<HintState | null> {
    return this.commands.execute(
      new UpdateHintStateCommand(userId, projectId, hintKey, status, note),
    );
  }
}
