import {
  BadRequestException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  CommandBus,
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import {
  type ImportResult,
  isSuggestable,
  type KindSummary,
  kindSummary,
  type MappingSpec,
} from '@lazykoins/engine';
import { ChangeProjectFileCommand } from '../../files/application/commands/change-project-file.command';
import {
  assertOpen,
  loadOwnProjectFile,
  orUnreadable,
  readableOf,
} from '../../files/application/file-access';
import { FileAnalysisService } from '../../files/application/file-analysis.service';
import { isActive, type ProjectFile } from '../../files/domain/project-file';
import { ProjectFileRepositoryPort } from '../../files/ports/project-file.repository.port';
import type { LibraryEntryView } from '../../library/domain/library-mapping';
import { LibraryService } from '../../library/library.service';
import {
  findSameSpec,
  loadOwnMapping,
} from '../../mappings/application/mapping-access';
import type { ImportMapping } from '../../mappings/domain/import-mapping';
import { ImportMappingRepositoryPort } from '../../mappings/ports/import-mapping.repository.port';
import { loadOwnProject } from '../../projects/application/project-access';
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import {
  findStandardMapping,
  type StandardMapping,
  standardMappings,
} from '../domain/standard-mappings';
import {
  type FileSuggestions,
  fromSimilarity,
  type LibrarySuggestionState,
  MAX_SUGGESTION_FILES,
  type MappingSuggestion,
  type ProjectSuggestions,
  rankSuggestions,
  type SuggestionSource,
} from '../domain/suggestion';

// --- the standard catalogue (F5.19) ---

export interface StandardMappingView {
  readonly entry: StandardMapping;
  /** My identical copy, if I took it already. */
  readonly copyId: string | null;
}

async function copiesOf(
  mappings: ImportMappingRepositoryPort,
  userId: string,
): Promise<Map<string, string>> {
  const mine = new Map(
    (await mappings.findByOwner(userId)).map((mapping) => [
      JSON.stringify(mapping.spec),
      mapping.id,
    ]),
  );
  const out = new Map<string, string>();
  for (const entry of standardMappings()) {
    const copy = mine.get(JSON.stringify(entry.spec));
    if (copy) out.set(entry.id, copy);
  }
  return out;
}

export class ListStandardMappingsQuery {
  constructor(readonly userId: string) {}
}

/** The bundled standard mappings — the same for everyone, read-only. */
@QueryHandler(ListStandardMappingsQuery)
export class ListStandardMappingsHandler implements IQueryHandler<
  ListStandardMappingsQuery,
  StandardMappingView[]
> {
  constructor(private readonly mappings: ImportMappingRepositoryPort) {}

  async execute({
    userId,
  }: ListStandardMappingsQuery): Promise<StandardMappingView[]> {
    const copies = await copiesOf(this.mappings, userId);
    return standardMappings().map((entry) => ({
      entry,
      copyId: copies.get(entry.id) ?? null,
    }));
  }
}

export class GetStandardMappingQuery {
  constructor(
    readonly userId: string,
    readonly id: string,
  ) {}
}

@QueryHandler(GetStandardMappingQuery)
export class GetStandardMappingHandler implements IQueryHandler<
  GetStandardMappingQuery,
  StandardMappingView
> {
  constructor(private readonly mappings: ImportMappingRepositoryPort) {}

  async execute({
    userId,
    id,
  }: GetStandardMappingQuery): Promise<StandardMappingView> {
    const entry = loadStandard(id);
    const copy = await findSameSpec(this.mappings, userId, entry.spec);
    return { entry, copyId: copy?.id ?? null };
  }
}

function loadStandard(id: string): StandardMapping {
  const entry = findStandardMapping(id);
  if (!entry) throw new NotFoundException('No such standard mapping');
  return entry;
}

export class TakeStandardMappingCommand {
  constructor(
    readonly userId: string,
    readonly id: string,
    /** Assign the copy to this file of mine at once. */
    readonly target?: {
      readonly projectId: string;
      readonly projectFileId: string;
    },
  ) {}
}

export interface TakenStandardMapping {
  readonly mapping: ImportMapping;
  /** False = my identical copy was reused. */
  readonly created: boolean;
  readonly revision: number;
  readonly file: ProjectFile | null;
}

/**
 * "Übernehmen" of a standard mapping: a copy in my own mappings (origin `copied`, editable like
 * any of mine; the catalogue stays untouched). An identical copy I already have is reused. With a
 * target the file's ownership, its open project and its kind are checked **before** copying,
 * then it is assigned (as the library's take).
 */
@CommandHandler(TakeStandardMappingCommand)
export class TakeStandardMappingHandler implements ICommandHandler<
  TakeStandardMappingCommand,
  TakenStandardMapping
> {
  constructor(
    private readonly mappings: ImportMappingRepositoryPort,
    private readonly projects: ProjectRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
    private readonly commands: CommandBus,
  ) {}

  async execute({
    userId,
    id,
    target,
  }: TakeStandardMappingCommand): Promise<TakenStandardMapping> {
    const entry = loadStandard(id);
    if (target) {
      const { project, file } = await loadOwnProjectFile(
        this.projects,
        this.files,
        userId,
        target.projectId,
        target.projectFileId,
      );
      assertOpen(project);
      if (file.kind === 'pdf') {
        throw new BadRequestException(
          'A mapping reads tables (CSV, XLSX), not PDFs',
        );
      }
    }
    const existing = await findSameSpec(this.mappings, userId, entry.spec);
    const mapping =
      existing ??
      (await this.mappings.create(userId, {
        spec: entry.spec,
        origin: 'copied',
      }));
    let file: ProjectFile | null = null;
    if (target) {
      file = await this.commands.execute<ChangeProjectFileCommand, ProjectFile>(
        new ChangeProjectFileCommand(
          userId,
          target.projectId,
          target.projectFileId,
          { mode: 'mapping', mappingId: mapping.id },
        ),
      );
    }
    return {
      mapping,
      created: !existing,
      revision: entry.revision,
      file,
    };
  }
}

// --- suggestions for the files that need a mapping ---

export class ProjectMappingSuggestionsQuery {
  constructor(
    readonly userId: string,
    readonly projectId: string,
  ) {}
}

/**
 * F5.19: per file of my project that **needs a mapping** (CSV/XLSX), the ranked suggestions from
 * my own mappings (near matches included), the standard catalogue and — where available — the
 * library (web; desktop only when linked with suggestions on, F5.18). A failing library never
 * fails the answer: `library: 'unavailable'`. Closed projects get no suggestions (F4.5) — they
 * cannot be changed anyway.
 */
@QueryHandler(ProjectMappingSuggestionsQuery)
export class ProjectMappingSuggestionsHandler implements IQueryHandler<
  ProjectMappingSuggestionsQuery,
  ProjectSuggestions
> {
  private readonly logger = new Logger(ProjectMappingSuggestionsHandler.name);

  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
    private readonly mappings: ImportMappingRepositoryPort,
    private readonly analysis: FileAnalysisService,
    private readonly library: LibraryService,
  ) {}

  async execute({
    userId,
    projectId,
  }: ProjectMappingSuggestionsQuery): Promise<ProjectSuggestions> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    if (project.status === 'closed') return { files: [], library: 'off' };
    const waiting = (await this.files.listByProject(project.id))
      // F5.7a: a deactivated file gets no suggestions (it is ignored on purpose).
      .filter(
        (file) =>
          file.status === 'needs_mapping' &&
          file.kind !== 'pdf' &&
          isActive(file),
      )
      .sort((a, b) => compare(b.addedAt, a.addedAt))
      .slice(0, MAX_SUGGESTION_FILES);
    if (waiting.length === 0) return { files: [], library: 'off' };

    const own = await this.mappings.findByOwner(userId);
    const copies = await copiesOf(this.mappings, userId);
    const specs: { id: string; spec: MappingSpec }[] = [
      ...own.map((mapping) => ({
        id: `own:${mapping.id}`,
        spec: mapping.spec,
      })),
      ...standardMappings().map((entry) => ({
        id: `standard:${entry.id}`,
        spec: entry.spec,
      })),
    ];
    const { state, byFile } = await this.libraryMatches(userId, project.id);

    const out: FileSuggestions[] = [];
    for (const file of waiting) {
      const { readable } = await readableOf(this.files, file);
      let similarities;
      try {
        similarities = await this.analysis.similarities(readable, specs);
      } catch {
        continue; // unreadable now — the files area says so already
      }
      const candidates: MappingSuggestion[] = [];
      for (const mapping of own) {
        const similarity = similarities.get(`own:${mapping.id}`);
        if (similarity && isSuggestable(similarity)) {
          candidates.push(
            fromSimilarity(
              {
                source: 'own',
                id: mapping.id,
                name: mapping.name,
                platform: mapping.platform,
                description: mapping.spec.description ?? null,
              },
              similarity,
            ),
          );
        }
      }
      for (const entry of standardMappings()) {
        const similarity = similarities.get(`standard:${entry.id}`);
        // My identical copy is suggested as `own` already.
        if (!similarity || !isSuggestable(similarity) || copies.has(entry.id)) {
          continue;
        }
        candidates.push(
          fromSimilarity(
            {
              source: 'standard',
              id: entry.id,
              name: entry.name,
              platform: entry.platform,
              description: entry.description,
              revision: entry.revision,
            },
            similarity,
          ),
        );
      }
      (byFile.get(file.id) ?? []).forEach((entry, index) => {
        candidates.push(libraryCandidate(entry, index));
      });
      const ranked = rankSuggestions(candidates);
      if (ranked.length > 0) {
        out.push({
          projectFileId: file.id,
          displayName: file.displayName,
          suggestions: ranked,
        });
      }
    }
    return { files: out, library: state };
  }

  private async libraryMatches(
    userId: string,
    projectId: string,
  ): Promise<{
    state: LibrarySuggestionState;
    byFile: Map<string, readonly LibraryEntryView[]>;
  }> {
    const byFile = new Map<string, readonly LibraryEntryView[]>();
    try {
      const status = await this.library.status(userId);
      if (!status.available || !status.suggestions) {
        return { state: 'off', byFile };
      }
      for (const match of await this.library.matchesForProject(
        userId,
        projectId,
      )) {
        byFile.set(match.projectFileId, match.matches);
      }
      return { state: 'used', byFile };
    } catch (error) {
      this.logger.warn(
        `library suggestions unavailable: ${error instanceof Error ? error.message : 'error'}`,
      );
      return { state: 'unavailable', byFile };
    }
  }
}

/** A library entry that reads the file (F5.16 match) — kept in the order the library gave. */
function libraryCandidate(
  entry: LibraryEntryView,
  index: number,
): MappingSuggestion {
  const required = entry.fingerprint.split('|').filter(Boolean).length;
  return {
    source: 'library',
    id: entry.id,
    name: entry.name,
    platform: entry.platform,
    description: entry.description,
    reads: true,
    coverage: 1,
    matched: required,
    required,
    missing: [],
    fileNameMatches: true,
    platformInName: false,
    score: Math.max(0, 1 - index * 0.01),
    revision: null,
    copyId: null,
    library: {
      version: entry.version,
      authorName: entry.authorName,
      ratingAverage: entry.ratingAverage,
      ratingCount: entry.ratingCount,
      usageCount: entry.usageCount,
    },
  };
}

// --- the preview of one suggestion ---

export class SuggestionPreviewQuery {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly projectFileId: string,
    readonly source: SuggestionSource,
    readonly id: string,
    readonly limit: number,
  ) {}
}

export interface SuggestionPreview extends KindSummary {
  /** The first `limit` records and errors (as the mapping preview), plus the totals. */
  readonly result: ImportResult;
  readonly totals: {
    readonly bookings: number;
    readonly holdings: number;
    readonly errors: number;
    readonly notes: number;
  };
}

/**
 * What a suggestion would make of the file — kind counts, unknown values, row errors and the
 * first records (the mapping preview). Nothing is stored or assigned.
 */
@QueryHandler(SuggestionPreviewQuery)
export class SuggestionPreviewHandler implements IQueryHandler<
  SuggestionPreviewQuery,
  SuggestionPreview
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
    private readonly mappings: ImportMappingRepositoryPort,
    private readonly analysis: FileAnalysisService,
    private readonly library: LibraryService,
  ) {}

  async execute(query: SuggestionPreviewQuery): Promise<SuggestionPreview> {
    const { file } = await loadOwnProjectFile(
      this.projects,
      this.files,
      query.userId,
      query.projectId,
      query.projectFileId,
    );
    if (file.kind === 'pdf') {
      throw new UnprocessableEntityException(
        'A mapping reads tables (CSV, XLSX), not PDFs',
      );
    }
    const spec = await this.specOf(query.userId, query.source, query.id);
    const { readable } = await readableOf(this.files, file);
    const full = await orUnreadable(() => this.analysis.apply(readable, spec));
    const limit = query.limit;
    return {
      ...kindSummary(full),
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
    source: SuggestionSource,
    id: string,
  ): Promise<MappingSpec> {
    switch (source) {
      case 'own':
        return (await loadOwnMapping(this.mappings, userId, id)).spec;
      case 'standard':
        return loadStandard(id).spec;
      case 'library':
        // Web: this deployment's entry; desktop: the linked server's (validated there).
        return (await this.library.get(userId, id)).spec;
    }
  }
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
