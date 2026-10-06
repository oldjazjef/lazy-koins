import {
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { ImportMappingRepositoryPort } from '../../../mappings/ports/import-mapping.repository.port';
import { ProjectNotifications } from '../../../notifications/application/project-notifications.service';
import { ProjectRepositoryPort } from '../../../projects/ports/project.repository.port';
import { EVIDENCE_ONLY, type ProjectFile } from '../../domain/project-file';
import { ProjectFileRepositoryPort } from '../../ports/project-file.repository.port';
import {
  assertOpen,
  loadOwnProjectFile,
  orUnreadable,
  readableOf,
} from '../file-access';
import { FileAnalysisService } from '../file-analysis.service';

/**
 * How a file is to be read from now on (F5.2 "manuell zuordnen oder als nur Beleg markieren"):
 * - `evidenceOnly`: kept as a receipt, contributes no records;
 * - `automatic`: detection again (standard format, then the owner's mappings);
 * - `mapping`: read with this mapping spec.
 */
export type FileAssignment =
  | { readonly mode: 'evidenceOnly' }
  | { readonly mode: 'automatic' }
  | { readonly mode: 'mapping'; readonly mappingId: string };

export class ChangeProjectFileCommand {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly projectFileId: string,
    readonly assignment: FileAssignment,
  ) {}
}

@CommandHandler(ChangeProjectFileCommand)
export class ChangeProjectFileHandler implements ICommandHandler<
  ChangeProjectFileCommand,
  ProjectFile
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
    private readonly mappings: ImportMappingRepositoryPort,
    private readonly analysis: FileAnalysisService,
    @Optional() private readonly projectNotifications?: ProjectNotifications,
  ) {}

  async execute({
    userId,
    projectId,
    projectFileId,
    assignment,
  }: ChangeProjectFileCommand): Promise<ProjectFile> {
    const { project, file } = await loadOwnProjectFile(
      this.projects,
      this.files,
      userId,
      projectId,
      projectFileId,
    );
    assertOpen(project);

    let next;
    if (assignment.mode === 'evidenceOnly') {
      next = EVIDENCE_ONLY;
    } else {
      const { readable } = await readableOf(this.files, file);
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
    const updated = await this.files.updateAnalysis(file.id, next);
    if (!updated) throw new NotFoundException('No such file in this project');
    // A file that got its mapping resolves its "Datei ohne Mapping" by itself (F11.11).
    await this.projectNotifications?.filesChanged(userId, project.id);
    return updated;
  }
}
