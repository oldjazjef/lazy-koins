import { Optional } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { ProjectNotifications } from '../../../notifications/application/project-notifications.service';
import { ProjectRepositoryPort } from '../../../projects/ports/project.repository.port';
import {
  cleanFileName,
  DERIVED_FROM,
  type ProjectFile,
} from '../../domain/project-file';
import { ProjectFileRepositoryPort } from '../../ports/project-file.repository.port';
import { assertOpen, loadOwnProjectFile } from '../file-access';
import { FileAnalysisService } from '../file-analysis.service';
import { storeInProject } from './upload-project-file.command';

export class AddDerivedFileCommand {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    /** The project file the content was derived from (the PDF) — it stays as evidence. */
    readonly sourceProjectFileId: string,
    readonly name: string,
    /** Standard-format CSV bytes. */
    readonly bytes: Uint8Array,
  ) {}
}

/**
 * A standard-format CSV the AI converted from another file of the project (a PDF statement):
 * stored and read like an upload, origin `derived_from:<source project file id>`. The source
 * stays untouched (F5.3).
 */
@CommandHandler(AddDerivedFileCommand)
export class AddDerivedFileHandler implements ICommandHandler<
  AddDerivedFileCommand,
  ProjectFile
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
    private readonly analysis: FileAnalysisService,
    @Optional() private readonly projectNotifications?: ProjectNotifications,
  ) {}

  async execute({
    userId,
    projectId,
    sourceProjectFileId,
    name,
    bytes,
  }: AddDerivedFileCommand): Promise<ProjectFile> {
    const { project, file: source } = await loadOwnProjectFile(
      this.projects,
      this.files,
      userId,
      projectId,
      sourceProjectFileId,
    );
    assertOpen(project);
    const stored = await storeInProject(this.files, this.analysis, {
      userId,
      projectId: project.id,
      displayName: cleanFileName(name) || 'abgeleitet.csv',
      kind: 'csv',
      bytes,
      origin: `${DERIVED_FROM}${source.id}`,
      source: `${DERIVED_FROM}${source.fileId}`,
    });
    await this.projectNotifications?.filesChanged(userId, project.id);
    return stored;
  }
}
