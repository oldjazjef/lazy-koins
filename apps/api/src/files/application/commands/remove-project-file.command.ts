import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { ProjectRepositoryPort } from '../../../projects/ports/project.repository.port';
import { ProjectFileRepositoryPort } from '../../ports/project-file.repository.port';
import { assertOpen, loadOwnProjectFile } from '../file-access';

export class RemoveProjectFileCommand {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly projectFileId: string,
  ) {}
}

/**
 * F5.7: removes the file from the project; the original bytes are deleted only when no project
 * uses them any more (the adapter decides that in the same transaction).
 */
@CommandHandler(RemoveProjectFileCommand)
export class RemoveProjectFileHandler implements ICommandHandler<
  RemoveProjectFileCommand,
  void
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
  ) {}

  async execute({
    userId,
    projectId,
    projectFileId,
  }: RemoveProjectFileCommand): Promise<void> {
    const { project, file } = await loadOwnProjectFile(
      this.projects,
      this.files,
      userId,
      projectId,
      projectFileId,
    );
    assertOpen(project);
    await this.files.remove(file.id);
  }
}
