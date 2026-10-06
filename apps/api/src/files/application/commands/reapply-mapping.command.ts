import { NotFoundException, Optional } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { ImportMappingRepositoryPort } from '../../../mappings/ports/import-mapping.repository.port';
import { ProjectNotifications } from '../../../notifications/application/project-notifications.service';
import { ProjectRepositoryPort } from '../../../projects/ports/project.repository.port';
import { ProjectFileRepositoryPort } from '../../ports/project-file.repository.port';
import { orUnreadable, readableOf } from '../file-access';
import { FileAnalysisService } from '../file-analysis.service';

export class ReapplyMappingCommand {
  constructor(
    readonly userId: string,
    readonly mappingId: string,
  ) {}
}

export interface ReapplyResult {
  readonly reapplied: number;
  /** Files in closed projects stay as they were (F4.5). */
  readonly skippedClosed: number;
}

/** After a mapping was edited and the user confirmed: reads every file it maps again. */
@CommandHandler(ReapplyMappingCommand)
export class ReapplyMappingHandler implements ICommandHandler<
  ReapplyMappingCommand,
  ReapplyResult
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
    mappingId,
  }: ReapplyMappingCommand): Promise<ReapplyResult> {
    const mapping = await this.mappings.findById(mappingId);
    if (!mapping || mapping.ownerId !== userId) {
      throw new NotFoundException('No such mapping');
    }
    let reapplied = 0;
    let skippedClosed = 0;
    const statusOf = new Map<string, string>();
    for (const file of await this.files.listByMapping(mappingId)) {
      let status = statusOf.get(file.projectId);
      if (status === undefined) {
        status = (await this.projects.findById(file.projectId))?.status ?? '';
        statusOf.set(file.projectId, status);
      }
      if (status === 'closed') {
        skippedClosed += 1;
        continue;
      }
      const { readable } = await readableOf(this.files, file);
      const next = await orUnreadable(() =>
        this.analysis.withMapping(readable, mapping),
      );
      await this.files.updateAnalysis(file.id, next);
      reapplied += 1;
    }
    for (const [projectId, status] of statusOf) {
      if (status !== 'closed') {
        await this.projectNotifications?.filesChanged(userId, projectId);
      }
    }
    return { reapplied, skippedClosed };
  }
}
