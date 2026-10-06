import { createHash } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  type Booking,
  type Correction,
  type CountryRules,
  chRules,
  countryRules,
  dashboardCorrections,
  dashboardRates,
  ENGINE_VERSION,
  type Holding,
  type ProjectCorrection,
  type RateEntry,
  withTaxCurrency,
} from '@lazykoins/engine';
import { CalculationInputService } from '../../calculation/application/calculation-input.service';
import { CorrectionRepositoryPort } from '../../calculation/ports/calculation.repository.port';
import { UnreadableFileError } from '../../files/application/source-file-reader';
import type { ProjectFile } from '../../files/domain/project-file';
import { ProjectFileRepositoryPort } from '../../files/ports/project-file.repository.port';
import type { ImportMapping } from '../../mappings/domain/import-mapping';
import { ImportMappingRepositoryPort } from '../../mappings/ports/import-mapping.repository.port';
import type { Project } from '../../projects/domain/project';
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import { ProjectRateRepositoryPort } from '../../rates/ports/project-rate.repository.port';
import { UserRateRepositoryPort } from '../ports/user-rate.repository.port';

/** Where a record of the dashboard comes from (drill-down: file + row, link to the project). */
export interface DashboardFileRef {
  readonly projectId: string;
  readonly projectFileId: string;
  readonly displayName: string;
}

/** What the dashboard is computed from — metadata only, no file read yet. */
export interface DashboardSources {
  /**
   * F4.1a: the tax currency shown — the dashboard values one currency at a time and includes the
   * projects in it (per-currency totals; amounts in different currencies are never added up).
   */
  readonly currency: string;
  /** Every tax currency among the user's projects (the newest project's first). */
  readonly currencies: readonly string[];
  readonly projects: readonly Project[];
  /** One entry per stored file (rule 1: the newest project's entry). */
  readonly files: readonly ProjectFile[];
  readonly mappings: ReadonlyMap<string, ImportMapping>;
  readonly corrections: readonly ProjectCorrection[];
  readonly projectRates: readonly {
    readonly projectId: string;
    readonly rates: readonly RateEntry[];
  }[];
  readonly userRates: readonly RateEntry[];
}

export interface DashboardRecords {
  readonly rules: CountryRules;
  readonly bookings: readonly Booking[];
  readonly holdings: readonly Holding[];
  readonly corrections: readonly Correction[];
  readonly rates: readonly RateEntry[];
  /** SHA-256 → the file the dashboard read it from. */
  readonly fileRefs: ReadonlyMap<string, DashboardFileRef>;
  readonly unreadable: number;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The distinct tax currencies of the projects (newest tax year first), in that order. */
export function currenciesOf(projects: readonly Project[]): string[] {
  return [...new Set(projects.map((p) => p.taxCurrency))];
}

/**
 * Assembles the dashboard's input across ALL projects of a user (F11.4) in one tax currency
 * (F4.1a): one deduplicated record
 * set (a stored file in several projects is read once — from the project with the newest tax
 * year), every project's corrections and stored rates (the engine keeps those that belong to the
 * date's year, `dashboardCorrections` / `dashboardRates`), plus the user's rate cache.
 */
@Injectable()
export class DashboardInputService {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
    private readonly mappings: ImportMappingRepositoryPort,
    private readonly rates: ProjectRateRepositoryPort,
    private readonly corrections: CorrectionRepositoryPort,
    private readonly userRates: UserRateRepositoryPort,
    private readonly inputs: CalculationInputService,
  ) {}

  /**
   * `projectId`: only that project (the compact card on a project, F11.4); 404 if not mine.
   * `currency`: the projects in that tax currency (F4.1a); absent or unknown = the newest
   * project's currency.
   */
  async sources(
    userId: string,
    projectId?: string,
    currency?: string,
  ): Promise<DashboardSources> {
    const owned = await this.projects.findByOwner(userId);
    const currencies = currenciesOf(owned);
    let projects: Project[];
    let selected: string;
    if (projectId) {
      projects = owned.filter((p) => p.id === projectId);
      if (projects.length === 0) {
        throw new NotFoundException('No such project');
      }
      selected = (projects[0] as Project).taxCurrency;
    } else {
      selected =
        currency && currencies.includes(currency)
          ? currency
          : (currencies[0] ?? 'CHF');
      projects = owned.filter((p) => p.taxCurrency === selected);
    }
    const bySha = new Map<string, { file: ProjectFile; year: number }>();
    const corrections: ProjectCorrection[] = [];
    const projectRates: DashboardSources['projectRates'][number][] = [];
    for (const project of projects) {
      for (const file of await this.files.listByProject(project.id)) {
        if (file.status !== 'standard' && file.status !== 'mapped') continue;
        const current = bySha.get(file.sha256);
        if (
          !current ||
          project.taxYear > current.year ||
          (project.taxYear === current.year &&
            compareText(file.id, current.file.id) < 0)
        ) {
          bySha.set(file.sha256, { file, year: project.taxYear });
        }
      }
      for (const c of await this.corrections.listByProject(project.id)) {
        if (c.undoneAt !== null) continue;
        corrections.push({
          id: c.id,
          projectId: project.id,
          createdAt: c.createdAt,
          reason: c.reason,
          data: c.data,
        });
      }
      projectRates.push({
        projectId: project.id,
        rates: (await this.rates.listByProject(project.id)).map((r) => ({
          kind: r.kind,
          asset: r.asset,
          currency: r.currency,
          date: r.date,
          value: r.value,
          source: r.source,
        })),
      });
    }
    const files = [...bySha.values()]
      .map((v) => v.file)
      .sort((a, b) => compareText(a.sha256, b.sha256));
    const mappings = new Map<string, ImportMapping>();
    for (const file of files) {
      if (file.mappingId && !mappings.has(file.mappingId)) {
        const mapping = await this.mappings.findById(file.mappingId);
        if (mapping) mappings.set(mapping.id, mapping);
      }
    }
    return {
      currency: selected,
      currencies,
      projects,
      files,
      mappings,
      corrections,
      projectRates,
      userRates: await this.userRates.listByUser(userId),
    };
  }

  /** What decides the dashboard — same hash, same answer (cache key). */
  hash(sources: DashboardSources, from: string, to: string): string {
    const canonical = {
      engineVersion: ENGINE_VERSION,
      from,
      to,
      currency: sources.currency,
      projects: sources.projects.map((p) => [
        p.id,
        p.taxYear,
        p.country,
        p.taxCurrency,
      ]),
      files: sources.files.map((f) => [
        f.sha256,
        f.status,
        f.mappingId,
        f.mappingId
          ? (sources.mappings.get(f.mappingId)?.updatedAt ?? null)
          : null,
      ]),
      corrections: sources.corrections.map((c) => [
        c.projectId,
        c.id,
        c.createdAt,
        c.data,
      ]),
      rates: sources.projectRates.map(({ projectId, rates }) => [
        projectId,
        rates
          .map(
            (r) =>
              `${r.kind}|${r.asset}|${r.currency}|${r.date}|${r.source}|${r.value}`,
          )
          .sort(compareText),
      ]),
      userRates: sources.userRates
        .map(
          (r) =>
            `${r.kind}|${r.asset}|${r.currency}|${r.date}|${r.source}|${r.value}`,
        )
        .sort(compareText),
    };
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }

  /** Reads the files (once each) and applies the dashboard rules for corrections and rates. */
  async records(sources: DashboardSources): Promise<DashboardRecords> {
    const newest = sources.projects[0];
    const rules = withTaxCurrency(
      (newest ? countryRules(newest.country) : undefined) ?? chRules,
      sources.currency,
    );
    const bookings: Booking[] = [];
    const holdings: Holding[] = [];
    const fileRefs = new Map<string, DashboardFileRef>();
    let unreadable = 0;
    for (const file of sources.files) {
      try {
        const records = await this.inputs.recordsOf(file, sources.mappings);
        if (!records) continue;
        bookings.push(...records.bookings);
        holdings.push(...records.holdings);
        fileRefs.set(file.sha256, {
          projectId: file.projectId,
          projectFileId: file.id,
          displayName: file.displayName,
        });
      } catch (error) {
        if (!(error instanceof UnreadableFileError)) throw error;
        unreadable += 1;
      }
    }
    const projects = sources.projects.map((p) => ({
      id: p.id,
      taxYear: p.taxYear,
    }));
    return {
      rules,
      bookings,
      holdings,
      corrections: dashboardCorrections(
        projects,
        sources.corrections,
        bookings,
      ),
      rates: dashboardRates(projects, sources.projectRates, sources.userRates),
      fileRefs,
      unreadable,
    };
  }
}
