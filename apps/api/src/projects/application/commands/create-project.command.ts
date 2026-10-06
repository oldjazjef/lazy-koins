import { BadRequestException } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import {
  type CreateProjectInput,
  isCanton,
  type Project,
} from '../../domain/project';
import { ProjectRepositoryPort } from '../../ports/project.repository.port';

export class CreateProjectCommand {
  constructor(
    readonly ownerId: string,
    readonly input: CreateProjectInput,
  ) {}
}

/** F4.1 / F4.3: a new project starts `in_progress`. */
@CommandHandler(CreateProjectCommand)
export class CreateProjectHandler implements ICommandHandler<
  CreateProjectCommand,
  Project
> {
  constructor(private readonly projects: ProjectRepositoryPort) {}

  async execute({ ownerId, input }: CreateProjectCommand): Promise<Project> {
    if (!isCanton(input.country, input.canton)) {
      throw new BadRequestException(
        `canton: ${input.canton} is not a canton of ${input.country}`,
      );
    }
    return this.projects.create(ownerId, {
      ...input,
      name: input.name.trim(),
      notes: input.notes.trim(),
    });
  }
}
