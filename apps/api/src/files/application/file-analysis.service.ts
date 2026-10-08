import { Injectable, Logger } from '@nestjs/common';
import {
  applyMapping,
  type CsvOptions,
  coverageOf,
  defaultImporterRegistry,
  type ImportResult,
  type MappingSimilarity,
  type MappingSpec,
  mappingConfidence,
  mappingSimilarity,
  mappingImporter,
  STANDARD_IMPORTER_ID,
} from '@lazykoins/engine';
import type { ImportMapping } from '../../mappings/domain/import-mapping';
import { ImportMappingRepositoryPort } from '../../mappings/ports/import-mapping.repository.port';
import {
  EVIDENCE_ONLY,
  type FileAnalysis,
  NOT_ANALYSED,
} from '../domain/project-file';
import { type ReadableFile, SourceFileReader } from './source-file-reader';

const MAPPING_PREFIX = 'mapping:';

/** CSV options a spec fixes (otherwise detected). */
export function csvOptionsOf(spec: MappingSpec): CsvOptions {
  return { encoding: spec.source.encoding, delimiter: spec.source.delimiter };
}

/**
 * Runs the engine over a file (F5.2): the standard format directly, otherwise the owner's mapping
 * specs by fingerprint; a PDF is evidence. Only ids, counts and periods leave this class — never
 * file content (also not in logs).
 */
@Injectable()
export class FileAnalysisService {
  private readonly logger = new Logger(FileAnalysisService.name);

  constructor(
    private readonly reader: SourceFileReader,
    private readonly mappings: ImportMappingRepositoryPort,
  ) {}

  /** Automatic reading on upload: standard → mapped (best fingerprint) → needs mapping. */
  async analyse(ownerId: string, file: ReadableFile): Promise<FileAnalysis> {
    if (file.kind === 'pdf') return EVIDENCE_ONLY;
    const owned = await this.mappings.findByOwner(ownerId);
    const source = await this.reader.read(file);
    const registry = defaultImporterRegistry(
      owned.map((mapping) => mappingImporter(mapping.id, mapping.spec)),
    );
    // Not `registry.detect()`: a near-tie between two of the user's own mappings (say, the same
    // spec uploaded twice) should not leave the file unread. The standard format wins outright;
    // among mappings the surest wins, then the most recently changed, then the id.
    const candidates = registry.candidates(source);
    const standard = candidates.find(
      (candidate) => candidate.importer.id === STANDARD_IMPORTER_ID,
    );
    if (standard) {
      return summarise(
        standard.importer.parse(source),
        STANDARD_IMPORTER_ID,
        null,
        'standard',
      );
    }
    const best = candidates[0];
    if (!best) return NOT_ANALYSED;
    const mapping = owned
      .filter((candidate) =>
        candidates.some(
          (c) =>
            c.confidence === best.confidence &&
            c.importer.id === `${MAPPING_PREFIX}${candidate.id}`,
        ),
      )
      .sort(
        (a, b) => compare(b.updatedAt, a.updatedAt) || compare(b.id, a.id),
      )[0];
    if (!mapping) return NOT_ANALYSED;
    return this.withMapping(file, mapping);
  }

  /** Reads the file with one specific mapping (manual assignment, re-apply after an edit). */
  async withMapping(
    file: ReadableFile,
    mapping: ImportMapping,
  ): Promise<FileAnalysis> {
    const result = await this.apply(file, mapping.spec);
    this.logger.log(
      `mapping ${mapping.id} read ${result.bookings.length} bookings, ${result.holdings.length} balances, ${result.errors.length} row errors`,
    );
    return summarise(
      result,
      `${MAPPING_PREFIX}${mapping.id}`,
      mapping.id,
      'mapped',
      mapping.spec.platform,
    );
  }

  /**
   * F5.16: which of these specs (library entries — not the owner's) would read the file, surest
   * first. Detection only, read like an upload; nothing is applied or stored.
   */
  async matchingSpecs(
    file: ReadableFile,
    specs: readonly { readonly id: string; readonly spec: MappingSpec }[],
  ): Promise<{ id: string; confidence: number }[]> {
    if (file.kind === 'pdf' || specs.length === 0) return [];
    const source = await this.reader.read(file);
    return specs
      .map(({ id, spec }) => ({
        id,
        confidence: mappingConfidence(spec, source),
      }))
      .filter((match) => match.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence || compare(a.id, b.id));
  }

  /**
   * F5.19: how close each spec comes to reading the file (suggestions) — read like an upload,
   * once for all specs. Nothing is applied or stored; a PDF matches nothing.
   */
  async similarities(
    file: ReadableFile,
    specs: readonly { readonly id: string; readonly spec: MappingSpec }[],
  ): Promise<Map<string, MappingSimilarity>> {
    const out = new Map<string, MappingSimilarity>();
    if (file.kind === 'pdf' || specs.length === 0) return out;
    const source = await this.reader.read(file);
    for (const { id, spec } of specs) {
      out.set(id, mappingSimilarity(spec, source));
    }
    return out;
  }

  /** The standard format's full result (row errors of a standard file, F5.10). */
  async applyStandard(file: ReadableFile): Promise<ImportResult | undefined> {
    const source = await this.reader.read(file);
    const standard = defaultImporterRegistry([])
      .candidates(source)
      .find((candidate) => candidate.importer.id === STANDARD_IMPORTER_ID);
    return standard?.importer.parse(source);
  }

  /** The engine's full result for a spec — previews (nothing is stored). */
  async apply(file: ReadableFile, spec: MappingSpec): Promise<ImportResult> {
    const source = await this.reader.read(file, csvOptionsOf(spec));
    return applyMapping(spec, source);
  }
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function summarise(
  result: ImportResult,
  importerId: string,
  mappingId: string | null,
  status: FileAnalysis['status'],
  /**
   * F5.25: the mapping's platform for a file that was read but holds no record (an empty
   * order history of one year) — so it groups under its platform, not under "Ohne Plattform".
   */
  emptyPlatform: string | null = null,
): FileAnalysis {
  const platforms: string[] = [];
  for (const record of [...result.bookings, ...result.holdings]) {
    if (!platforms.includes(record.platform)) platforms.push(record.platform);
  }
  return {
    status,
    importerId,
    mappingId,
    platform: platforms.length > 0 ? platforms.join(',') : emptyPlatform,
    period: result.period,
    bookingCount: result.bookings.length,
    holdingCount: result.holdings.length,
    errorCount: result.errors.length,
    coverage: coverageOf(result.bookings, result.holdings),
  };
}
