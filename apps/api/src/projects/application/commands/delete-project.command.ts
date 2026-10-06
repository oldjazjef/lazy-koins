import { ConflictException } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { ProjectRepositoryPort } from '../../ports/project.repository.port';
import { loadOwnProject } from '../project-access';

export class DeleteProjectCommand {
  constructor(
    readonly userId: string,
    readonly projectId: string,
  ) {}
}

/**
 * F4.6 (the app confirms first). A closed project is read-only (F4.5), deleting included:
 * reopen it first.
 */
@CommandHandler(DeleteProjectCommand)
export class DeleteProjectHandler implements ICommandHandler<
  DeleteProjectCommand,
  void
> {
  constructor(private readonly projects: ProjectRepositoryPort) {}

  async execute({ userId, projectId }: DeleteProjectCommand): Promise<void> {
    const existing = await loadOwnProject(this.projects, userId, projectId);
    if (existing.status === 'closed') {
      throw new ConflictException(
        'The project is closed: reopen it first, then delete it',
      );
    }
    await this.projects.delete(projectId);
  }
}
