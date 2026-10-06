import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  applyMapping,
  type Booking,
  type CalculationInput,
  type Correction,
  countryRules,
  ENGINE_VERSION,
  type Holding,
  parseStandardFile,
  type PreviousYear,
  type RateEntry,
} from '@lazykoins/engine';
import { readableOf } from '../../files/application/file-access';
import {
  SourceFileReader,
  UnreadableFileError,
} from '../../files/application/source-file-reader';
import type { ProjectFile } from '../../files/domain/project-file';
import { ProjectFileRepositoryPort } from '../../files/ports/project-file.repository.port';
import type { ImportMapping } from '../../mappings/domain/import-mapping';
import { ImportMappingRepositoryPort } from '../../mappings/ports/import-mapping.repository.port';
import type { Project } from '../../projects/domain/project';
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import { ProjectRateRepositoryPort } from '../../rates/ports/project-rate.repository.port';
import type { FileRef, StoredCorrection } from '../domain/calculation';
import {
  CalculationSnapshotRepositoryPort,
  CorrectionRepositoryPort,
} from '../ports/calculation.repository.port';

/** What a calculation needs, assembled from storage — and its hash (F7.6). */
export interface AssembledInput {
  readonly input: CalculationInput;
  readonly files: readonly FileRef[];
  readonly inputHash: string;
  /** Project files that could not be read this time (counted, never their content). */
  readonly unreadable: number;
}

interface Sources {
  readonly files: readonly ProjectFile[];
  readonly mappings: ReadonlyMap<string, ImportMapping>;
  readonly corrections: readonly StoredCorrection[];
  readonly rates: readonly RateEntry[];
  readonly previous: PreviousYear | undefined;
  readonly previousRef: string | null;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Collects the calculation's input for a project: the standard records of every readable file
 * (standard format or its mapping — read again from the original bytes, bookings are not stored
 * as rows), the active corrections, the stored rates and the previous year's closing figures.
 *
 * The **input hash** covers what decides the result without reading file contents: the files'
 * SHA-256 + how they are read (mapping id + version time), corrections, rates, the previous
 * year's snapshot and the engine version. Same hash → same result.
 */
@Injectable()
export class CalculationInputService {
  private readonly logger = new Logger(CalculationInputService.name);

  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
    private readonly mappings: ImportMappingRepositoryPort,
    private readonly rates: ProjectRateRepositoryPort,
    private readonly corrections: CorrectionRepositoryPort,
    private readonly snapshots: CalculationSnapshotRepositoryPort,
    private readonly reader: SourceFileReader,
  ) {}

  /** The input hash alone — cheap (no file is read); tells whether a snapshot is stale. */
  async inputHash(project: Project): Promise<string> {
    return hashOf(project, await this.sources(project));
  }

  async build(project: Project): Promise<AssembledInput> {
    const rules = countryRules(project.country);
    if (!rules) throw new Error(`No country rules for ${project.country}`);
    const sources = await this.sources(project);
    const bookings: Booking[] = [];
    const holdings: Holding[] = [];
    let unreadable = 0;
    for (const file of sources.files) {
      try {
        const records = await this.recordsOf(file, sources.mappings);
        if (!records) continue;
        bookings.push(...records.bookings);
        holdings.push(...records.holdings);
      } catch (error) {
        if (!(error instanceof UnreadableFileError)) throw error;
        unreadable += 1;
      }
    }
    this.logger.log(
      `project ${project.id}: ${bookings.length} bookings, ${holdings.length} balances from ${sources.files.length} files (${unreadable} unreadable)`,
    );
    const corrections: Correction[] = sources.corrections
      .filter((c) => c.undoneAt === null)
      .map((c) => ({
        id: c.id,
        createdAt: c.createdAt,
        reason: c.reason,
        data: c.data,
      }));
    return {
      input: {
        taxYear: project.taxYear,
        rules,
        bookings,
        holdings,
        corrections,
        rates: sources.rates,
        previous: sources.previous,
      },
      files: sources.files.map((f) => ({
        projectFileId: f.id,
        sha256: f.sha256,
        displayName: f.displayName,
      })),
      inputHash: hashOf(project, sources),
      unreadable,
    };
  }

  /** The project's files as the calculation names them (F7.5). */
  async fileRefs(projectId: string): Promise<FileRef[]> {
    return (await this.files.listByProject(projectId)).map((f) => ({
      projectFileId: f.id,
      sha256: f.sha256,
      displayName: f.displayName,
    }));
  }

  private async sources(project: Project): Promise<Sources> {
    const files = (await this.files.listByProject(project.id))
      .filter((f) => f.status === 'standard' || f.status === 'mapped')
      .sort((a, b) => compareText(a.sha256, b.sha256));
    const mappings = new Map<string, ImportMapping>();
    for (const file of files) {
      if (file.mappingId && !mappings.has(file.mappingId)) {
        const mapping = await this.mappings.findById(file.mappingId);
        if (mapping) mappings.set(mapping.id, mapping);
      }
    }
    const rates: RateEntry[] = (await this.rates.listByProject(project.id)).map(
      (r) => ({
        kind: r.kind,
        asset: r.asset,
        currency: r.currency,
        date: r.date,
        value: r.value,
        source: r.source,
      }),
    );
    const corrections = await this.corrections.listByProject(project.id);
    const { previous, ref } = await this.previousYear(project);
    return {
      files,
      mappings,
      corrections,
      rates,
      previous,
      previousRef: ref,
    };
  }

  /** The owner's project of the year before (same country), via its latest snapshot. */
  private async previousYear(
    project: Project,
  ): Promise<{ previous: PreviousYear | undefined; ref: string | null }> {
    const candidates = (await this.projects.findByOwner(project.ownerId))
      .filter(
        (p) =>
          p.taxYear === project.taxYear - 1 && p.country === project.country,
      )
      .sort((a, b) => compareText(b.updatedAt, a.updatedAt));
    for (const candidate of candidates) {
      const snapshot = await this.snapshots.latest(candidate.id);
      if (!snapshot) continue;
      return {
        ref: snapshot.id,
        previous: {
          taxYear: candidate.taxYear,
          wealthChf: snapshot.result.totals.wealthChf,
          incomeChf: snapshot.result.totals.incomeChf,
          positions: snapshot.result.positions
            .filter((p) => p.status !== 'spam')
            .map((p) => ({
              platform: p.platform,
              accountId: p.accountId,
              asset: p.asset,
              quantity: p.quantity,
              valueChf: p.valueChf,
            })),
        },
      };
    }
    return { previous: undefined, ref: null };
  }

  /** The standard records of one project file (read again from its bytes); `undefined` without a mapping. */
  async recordsOf(
    file: ProjectFile,
    mappings: ReadonlyMap<string, ImportMapping>,
  ): Promise<
    { bookings: readonly Booking[]; holdings: readonly Holding[] } | undefined
  > {
    const { readable } = await readableOf(this.files, file);
    if (file.status === 'standard') {
      return parseStandardFile(await this.reader.read(readable));
    }
    const mapping = file.mappingId ? mappings.get(file.mappingId) : undefined;
    if (!mapping) return undefined;
    const source = await this.reader.read(readable, {
      encoding: mapping.spec.source.encoding,
      delimiter: mapping.spec.source.delimiter,
    });
    return applyMapping(mapping.spec, source);
  }
}

function hashOf(project: Project, sources: Sources): string {
  const canonical = {
    engineVersion: ENGINE_VERSION,
    taxYear: project.taxYear,
    country: project.country,
    files: sources.files.map((f) => [
      f.sha256,
      f.status,
      f.mappingId,
      f.mappingId
        ? (sources.mappings.get(f.mappingId)?.updatedAt ?? null)
        : null,
    ]),
    corrections: sources.corrections
      .filter((c) => c.undoneAt === null)
      .map((c) => [c.id, c.createdAt, c.data]),
    rates: [...sources.rates]
      .map(
        (r) =>
          `${r.kind}|${r.asset}|${r.currency}|${r.date}|${r.source}|${r.value}`,
      )
      .sort(compareText),
    previous: sources.previousRef,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
