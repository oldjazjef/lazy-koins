import { BadRequestException, NotFoundException } from '@nestjs/common';
import { projectClosed } from '../../../common/http/api-errors';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import {
  closedProjectProblem,
  isCanton,
  type Project,
  type UpdateProjectInput,
} from '../../domain/project';
import { ProjectRepositoryPort } from '../../ports/project.repository.port';
import { loadOwnProject } from '../project-access';

export class UpdateProjectCommand {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly input: UpdateProjectInput,
  ) {}
}

/**
 * Rename, notes, status, canton (F4.1, F4.6). A closed project only accepts being reopened
 * (F4.5) — anything else is a 409.
 */
@CommandHandler(UpdateProjectCommand)
export class UpdateProjectHandler implements ICommandHandler<
  UpdateProjectCommand,
  Project
> {
  constructor(private readonly projects: ProjectRepositoryPort) {}

  async execute({
    userId,
    projectId,
    input,
  }: UpdateProjectCommand): Promise<Project> {
    const existing = await loadOwnProject(this.projects, userId, projectId);

    const problem = closedProjectProblem(existing, input);
    if (problem) throw projectClosed(problem);

    if (
      input.canton !== undefined &&
      !isCanton(existing.country, input.canton)
    ) {
      throw new BadRequestException(
        `canton: ${input.canton} is not a canton of ${existing.country}`,
      );
    }

    const updated = await this.projects.update(projectId, {
      ...input,
      name: input.name?.trim(),
      notes: input.notes?.trim(),
    });
    if (!updated) throw new NotFoundException('No such project');
    return updated;
  }
}
