import { NotFoundException, Optional } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { ImportMappingRepositoryPort } from '../../../mappings/ports/import-mapping.repository.port';
import { ProjectNotifications } from '../../../notifications/application/project-notifications.service';
import { ProjectRepositoryPort } from '../../../projects/ports/project.repository.port';
import { ProjectFileRepositoryPort } from '../../ports/project-file.repository.port';
import { orUnreadable } from '../file-access';
import { FileAnalysisService } from '../file-analysis.service';

export class ReapplyMappingCommand {
  constructor(
    readonly userId: string,
    readonly mappingId: string,
  ) {}
}

export interface ReapplyResult {
  readonly reapplied: number;
  /** Files a closed project uses stay as they were (F4.5) — counted per file. */
  readonly skippedClosed: number;
}

/**
 * After a mapping was edited and the user confirmed: reads every file it maps again — once per
 * file (F5.21: the reading is the file's), every project selecting it follows.
 */
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
    const touched = new Set<string>();
    for (const file of await this.files.listStoredByMapping(mappingId)) {
      const projectIds = [...new Set(file.usages.map((u) => u.projectId))];
      for (const projectId of projectIds) {
        if (!statusOf.has(projectId)) {
          statusOf.set(
            projectId,
            (await this.projects.findById(projectId))?.status ?? '',
          );
        }
      }
      if (projectIds.some((id) => statusOf.get(id) === 'closed')) {
        skippedClosed += 1;
        continue;
      }
      const content = await this.files.readContent(file.id);
      if (!content) continue;
      const next = await orUnreadable(() =>
        this.analysis.withMapping(
          {
            sha256: content.sha256,
            name: file.originalName,
            kind: content.kind,
            bytes: content.bytes,
          },
          mapping,
        ),
      );
      await this.files.updateStoredAnalysis(file.id, next);
      reapplied += 1;
      for (const id of projectIds) touched.add(id);
    }
    for (const projectId of touched) {
      await this.projectNotifications?.filesChanged(userId, projectId);
    }
    return { reapplied, skippedClosed };
  }
}
