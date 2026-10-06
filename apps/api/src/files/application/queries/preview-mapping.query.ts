import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
  type ImportResult,
  type MappingSpec,
  validateMappingSpec,
} from '@lazykoins/engine';
import { ImportMappingRepositoryPort } from '../../../mappings/ports/import-mapping.repository.port';
import { ProjectRepositoryPort } from '../../../projects/ports/project.repository.port';
import { ProjectFileRepositoryPort } from '../../ports/project-file.repository.port';
import { loadOwnProjectFile, orUnreadable, readableOf } from '../file-access';
import { FileAnalysisService } from '../file-analysis.service';

/** A stored mapping by id, or a spec straight from the editor (not saved). */
export type MappingSource =
  { readonly mappingId: string } | { readonly spec: unknown };

export class PreviewMappingQuery {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly projectFileId: string,
    readonly source: MappingSource,
    readonly limit: number,
  ) {}
}

export interface MappingPreview {
  /** The first `limit` records and errors, plus the totals. Nothing is stored. */
  readonly result: ImportResult;
  readonly totals: {
    readonly bookings: number;
    readonly holdings: number;
    readonly errors: number;
    readonly notes: number;
  };
}

/** "Erst Vorschau, dann bestätigen": what a mapping would make of a file. */
@QueryHandler(PreviewMappingQuery)
export class PreviewMappingHandler implements IQueryHandler<
  PreviewMappingQuery,
  MappingPreview
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
    source,
    limit,
  }: PreviewMappingQuery): Promise<MappingPreview> {
    const { file } = await loadOwnProjectFile(
      this.projects,
      this.files,
      userId,
      projectId,
      projectFileId,
    );
    if (file.kind === 'pdf') {
      throw new UnprocessableEntityException(
        'A mapping reads tables (CSV, XLSX), not PDFs',
      );
    }
    const spec = await this.specOf(userId, source);
    const { readable } = await readableOf(this.files, file);
    const full = await orUnreadable(() => this.analysis.apply(readable, spec));
    return {
      result: {
        bookings: full.bookings.slice(0, limit),
        holdings: full.holdings.slice(0, limit),
        errors: full.errors.slice(0, limit),
        notes: full.notes.slice(0, limit),
        period: full.period,
      },
      totals: {
        bookings: full.bookings.length,
        holdings: full.holdings.length,
        errors: full.errors.length,
        notes: full.notes.length,
      },
    };
  }

  private async specOf(
    userId: string,
    source: MappingSource,
  ): Promise<MappingSpec> {
    if ('mappingId' in source) {
      const mapping = await this.mappings.findById(source.mappingId);
      if (!mapping || mapping.ownerId !== userId) {
        throw new NotFoundException('No such mapping');
      }
      return mapping.spec;
    }
    const validation = validateMappingSpec(source.spec);
    if (!validation.ok) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: 'The mapping spec is invalid',
        issues: validation.issues,
      });
    }
    return validation.spec;
  }
}
