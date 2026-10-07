import { NotFoundException, Optional } from '@nestjs/common';
import { conflict } from '../../../common/http/api-errors';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { ProjectFileRepositoryPort } from '../../../files/ports/project-file.repository.port';
import { ProjectNotifications } from '../../../notifications/application/project-notifications.service';
import { ProjectRepositoryPort } from '../../../projects/ports/project.repository.port';
import type { ImportMapping, MappingOrigin } from '../../domain/import-mapping';
import { ImportMappingRepositoryPort } from '../../ports/import-mapping.repository.port';
import { findSameSpec, loadOwnMapping, specOr400 } from '../mapping-access';

export class CreateMappingCommand {
  constructor(
    readonly userId: string,
    readonly spec: unknown,
    readonly origin: MappingOrigin,
    /** F11.0u (several `.json` at once): refuse a spec I already have — 409 `duplicateMapping`. */
    readonly rejectDuplicate = false,
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
    rejectDuplicate,
  }: CreateMappingCommand): Promise<ImportMapping> {
    const valid = specOr400(spec);
    if (rejectDuplicate) {
      const same = await findSameSpec(this.mappings, userId, valid);
      if (same) {
        throw conflict(
          'duplicateMapping',
          'You already have a mapping with exactly this spec',
          { existingId: same.id, existingName: same.name },
        );
      }
    }
    return this.mappings.create(userId, { spec: valid, origin });
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
    @Optional() private readonly projectNotifications?: ProjectNotifications,
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
        throw conflict(
          'usedByClosedProject',
          'A closed project uses this mapping: reopen it first, then delete the mapping',
        );
      }
    }
    const reset = await this.mappings.delete(mapping.id);
    // Its files need a mapping again (F11.12).
    for (const projectId of projectIds) {
      await this.projectNotifications?.filesChanged(userId, projectId);
    }
    return reset;
  }
}
