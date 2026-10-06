import { NotFoundException } from '@nestjs/common';
import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import type { ImportResult, RowError } from '@lazykoins/engine';
import { ImportMappingRepositoryPort } from '../../../mappings/ports/import-mapping.repository.port';
import { ProjectRepositoryPort } from '../../../projects/ports/project.repository.port';
import { ProjectFileRepositoryPort } from '../../ports/project-file.repository.port';
import { loadOwnProjectFile, orUnreadable, readableOf } from '../file-access';
import { FileAnalysisService } from '../file-analysis.service';

export class FileRowErrorsQuery {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly projectFileId: string,
    readonly limit: number,
  ) {}
}

export interface FileRowErrors {
  readonly total: number;
  /** The first `limit` errors (row, code, column) — never cell values. */
  readonly errors: readonly RowError[];
}

/**
 * "Zeilenfehler ansehen" (F5.10): the rows a file's own reader (standard format or its mapping)
 * could not read. A file that is not read (PDF, no mapping) has none.
 */
@QueryHandler(FileRowErrorsQuery)
export class FileRowErrorsHandler implements IQueryHandler<
  FileRowErrorsQuery,
  FileRowErrors
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
    private readonly mappings: ImportMappingRepositoryPort,
    private readonly analysis: FileAnalysisService,
  ) {}

  async execute({
    userId,
    projectId,
    projectFileId,
    limit,
  }: FileRowErrorsQuery): Promise<FileRowErrors> {
    const { file } = await loadOwnProjectFile(
      this.projects,
      this.files,
      userId,
      projectId,
      projectFileId,
    );
    let result: ImportResult | undefined;
    if (file.status === 'standard') {
      const { readable } = await readableOf(this.files, file);
      result = await orUnreadable(() => this.analysis.applyStandard(readable));
    } else if (file.status === 'mapped' && file.mappingId) {
      const mapping = await this.mappings.findById(file.mappingId);
      if (!mapping) throw new NotFoundException('No such mapping');
      const { readable } = await readableOf(this.files, file);
      result = await orUnreadable(() =>
        this.analysis.apply(readable, mapping.spec),
      );
    }
    const errors = result?.errors ?? [];
    return { total: errors.length, errors: errors.slice(0, limit) };
  }
}
