import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { ReapplyResult } from '../files/application/commands/reapply-mapping.command';
import { FilesService } from '../files/files.service';
import {
  CreateMappingCommand,
  DeleteMappingCommand,
  UpdateMappingCommand,
  type UpdatedMapping,
} from './application/commands/mapping.commands';
import {
  GetMappingQuery,
  GetMappingUsageQuery,
  ListMappingsQuery,
  ListProjectMappingsQuery,
  type MappingSummary,
  type MappingUsageProject,
  type ProjectMapping,
} from './application/queries/mapping.queries';
import type { ImportMapping, MappingOrigin } from './domain/import-mapping';

/** Thin façade over the buses — no logic here; it lives in the handlers. */
@Injectable()
export class MappingsService {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
    private readonly files: FilesService,
  ) {}

  listMine(userId: string): Promise<MappingSummary[]> {
    return this.queries.execute(new ListMappingsQuery(userId));
  }

  usage(userId: string, mappingId: string): Promise<MappingUsageProject[]> {
    return this.queries.execute(new GetMappingUsageQuery(userId, mappingId));
  }

  get(userId: string, mappingId: string): Promise<ImportMapping> {
    return this.queries.execute(new GetMappingQuery(userId, mappingId));
  }

  listForProject(userId: string, projectId: string): Promise<ProjectMapping[]> {
    return this.queries.execute(
      new ListProjectMappingsQuery(userId, projectId),
    );
  }

  create(
    userId: string,
    spec: unknown,
    origin: MappingOrigin,
  ): Promise<ImportMapping> {
    return this.commands.execute(
      new CreateMappingCommand(userId, spec, origin),
    );
  }

  update(
    userId: string,
    mappingId: string,
    spec: unknown,
  ): Promise<UpdatedMapping> {
    return this.commands.execute(
      new UpdateMappingCommand(userId, mappingId, spec),
    );
  }

  remove(userId: string, mappingId: string): Promise<number> {
    return this.commands.execute(new DeleteMappingCommand(userId, mappingId));
  }

  reapply(userId: string, mappingId: string): Promise<ReapplyResult> {
    return this.files.reapplyMapping(userId, mappingId);
  }
}
