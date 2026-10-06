import { ConflictException, NotFoundException } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { ProjectFileRepositoryPort } from '../../../files/ports/project-file.repository.port';
import { ProjectRepositoryPort } from '../../../projects/ports/project.repository.port';
import type { ImportMapping, MappingOrigin } from '../../domain/import-mapping';
import { ImportMappingRepositoryPort } from '../../ports/import-mapping.repository.port';
import { loadOwnMapping, specOr400 } from '../mapping-access';

export class CreateMappingCommand {
  constructor(
    readonly userId: string,
    readonly spec: unknown,
    readonly origin: MappingOrigin,
  ) {}
}

/** A new mapping from JSON (editor, uploaded `.json`; later an AI proposal). */
@CommandHandler(CreateMappingCommand)
export class CreateMappingHandler implements ICommandHandler<
  CreateMappingCommand,
  ImportMapping
> {
  constructor(private readonly mappings: ImportMappingRepositoryPort) {}

  async execute({
    userId,
    spec,
    origin,
  }: CreateMappingCommand): Promise<ImportMapping> {
    return this.mappings.create(userId, { spec: specOr400(spec), origin });
  }
}

export class UpdateMappingCommand {
  constructor(
    readonly userId: string,
    readonly mappingId: string,
    readonly spec: unknown,
  ) {}
}

export interface UpdatedMapping {
  readonly mapping: ImportMapping;
  /** Files read with it — the app offers to re-apply (`ReapplyMappingCommand`). */
  readonly filesUsing: number;
}

/**
 * Replaces the spec. Files read with it keep their results until the user confirms re-applying
 * (they may not want to touch a reviewed project); the response says how many there are.
 */
@CommandHandler(UpdateMappingCommand)
export class UpdateMappingHandler implements ICommandHandler<
  UpdateMappingCommand,
  UpdatedMapping
> {
  constructor(
    private readonly mappings: ImportMappingRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
  ) {}

  async execute({
    userId,
    mappingId,
    spec,
  }: UpdateMappingCommand): Promise<UpdatedMapping> {
    const existing = await loadOwnMapping(this.mappings, userId, mappingId);
    const updated = await this.mappings.update(existing.id, {
      spec: specOr400(spec),
      origin: existing.origin,
    });
    if (!updated) throw new NotFoundException('No such mapping');
    const filesUsing = (await this.files.listByMapping(existing.id)).length;
    return { mapping: updated, filesUsing };
  }
}

export class DeleteMappingCommand {
  constructor(
    readonly userId: string,
    readonly mappingId: string,
  ) {}
}

/**
 * Deletes a mapping; the files it read go back to "needs mapping". Refused (409) while a closed
 * project holds such a file — that project is read-only (F4.5).
 */
@CommandHandler(DeleteMappingCommand)
export class DeleteMappingHandler implements ICommandHandler<
  DeleteMappingCommand,
  number
> {
  constructor(
    private readonly mappings: ImportMappingRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
    private readonly projects: ProjectRepositoryPort,
  ) {}

  async execute({ userId, mappingId }: DeleteMappingCommand): Promise<number> {
    const mapping = await loadOwnMapping(this.mappings, userId, mappingId);
    const projectIds = new Set(
      (await this.files.listByMapping(mapping.id)).map(
        (file) => file.projectId,
      ),
    );
    for (const projectId of projectIds) {
      if ((await this.projects.findById(projectId))?.status === 'closed') {
        throw new ConflictException(
          'A closed project uses this mapping: reopen it first, then delete the mapping',
        );
      }
    }
    return this.mappings.delete(mapping.id);
  }
}
