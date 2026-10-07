import {
  BadRequestException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { ProjectNotifications } from '../../../notifications/application/project-notifications.service';
import { ProjectRepositoryPort } from '../../../projects/ports/project.repository.port';
import { FILE_NOTE_MAX, type ProjectFile } from '../../domain/project-file';
import { ProjectFileRepositoryPort } from '../../ports/project-file.repository.port';
import { assertOpen, loadOwnProjectFile } from '../file-access';

export class SetFileActiveCommand {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly projectFileId: string,
    /** false = deactivate ("Deaktivieren"), true = activate again ("Aktivieren"). */
    readonly active: boolean,
    /** Optional reason for a deactivation (ignored when activating). */
    readonly note = '',
  ) {}
}

/**
 * F5.7a "Datei deaktivieren": the file stays in the project (stored, downloadable, previewable,
 * its mapping status unchanged) but nothing reads its records any more — calculation, dashboard,
 * F5.8 hints, checks and exports skip it until it is activated again. Per project file: the same
 * stored file in another project is unaffected. The calculation's input hash changes, so the
 * snapshot becomes stale (no silent recalculation). Closed projects: 409 (F4.5).
 */
@CommandHandler(SetFileActiveCommand)
export class SetFileActiveHandler implements ICommandHandler<
  SetFileActiveCommand,
  ProjectFile
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
    @Optional() private readonly projectNotifications?: ProjectNotifications,
  ) {}

  async execute({
    userId,
    projectId,
    projectFileId,
    active,
    note,
  }: SetFileActiveCommand): Promise<ProjectFile> {
    const { project, file } = await loadOwnProjectFile(
      this.projects,
      this.files,
      userId,
      projectId,
      projectFileId,
    );
    assertOpen(project);
    const trimmed = note.trim();
    if (trimmed.length > FILE_NOTE_MAX) {
      throw new BadRequestException(
        `note must be at most ${FILE_NOTE_MAX} characters`,
      );
    }
    // Already in the wanted state: a deactivation keeps its first date, only the note changes.
    const state = active
      ? null
      : {
          at: file.disabledAt ?? new Date().toISOString(),
          note: trimmed === '' ? null : trimmed,
        };
    const updated = await this.files.setDeactivation(file.id, state);
    if (!updated) throw new NotFoundException('No such file in this project');
    // A deactivated file nags no more ("ohne Mapping", "Zeilenfehler"); activated, it may again.
    await this.projectNotifications?.filesChanged(userId, project.id);
    return updated;
  }
}
