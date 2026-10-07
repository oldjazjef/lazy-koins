import { Injectable } from '@nestjs/common';
import {
  BOOKING_KINDS,
  type FileKind,
  mappingFingerprint,
  RATE_SOURCES,
  TAX_CURRENCIES,
  validateCorrectionData,
  validateMappingSpec,
} from '@lazykoins/engine';
import { z } from 'zod';
import {
  CorrectionRepositoryPort,
  OpenItemStateRepositoryPort,
} from '../../calculation/ports/calculation.repository.port';
import {
  CARRIED_PREFIX,
  CARRYOVER_KINDS,
  type ProjectBundle,
} from '../../carryover/domain/carryover';
import {
  CarryoverRepositoryPort,
  ProjectBundleRepositoryPort,
} from '../../carryover/ports/carryover.repository.port';
import { EXPORT_KINDS } from '../../exports/domain/project-export';
import { ProjectExportRepositoryPort } from '../../exports/ports/project-export.repository.port';
import { FileAnalysisService } from '../../files/application/file-analysis.service';
import {
  derivedFromId,
  type FileAnalysis,
  FILE_NOTE_MAX,
  MAX_FILE_BYTES,
  MEDIA_TYPES,
  PROJECT_FILE_STATUSES,
  sniffFileKind,
  UPLOADED,
} from '../../files/domain/project-file';
import { ProjectFileRepositoryPort } from '../../files/ports/project-file.repository.port';
import type { ImportMapping } from '../../mappings/domain/import-mapping';
import { ImportMappingRepositoryPort } from '../../mappings/ports/import-mapping.repository.port';
import {
  CH_CANTONS,
  COUNTRIES,
  MAX_TAX_YEAR,
  MIN_TAX_YEAR,
  type Project,
} from '../../projects/domain/project';
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import { ProjectRateRepositoryPort } from '../../rates/ports/project-rate.repository.port';
import {
  buildPackage,
  jsonBytes,
  type OpenedPackage,
  openPackage,
  PACKAGE_FORMAT_VERSION,
  PackageError,
  PROJECT_PACKAGE_EXTENSION,
  PROJECT_PACKAGE_FORMAT,
  readJson,
  slug,
} from '../domain/package-format';

/** The app version written into manifests (the desktop build sets APP_VERSION). */
export function appVersion(): string {
  return process.env['APP_VERSION'] ?? '0.0.0-dev';
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^-?\d+(\.\d+)?$/;
const ISO_TS = z.string().datetime({ offset: true });

const ProjectFactsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  taxYear: z.number().int().min(MIN_TAX_YEAR).max(MAX_TAX_YEAR),
  country: z.enum(COUNTRIES),
  canton: z.enum(CH_CANTONS),
  /** F4.1a; packages made before it carry none and are CHF. */
  taxCurrency: z.enum(TAX_CURRENCIES).default('CHF'),
  status: z.enum(['in_progress', 'reviewed', 'closed']),
  notes: z.string().max(5000),
});

const AnalysisSchema = z.object({
  status: z.enum(PROJECT_FILE_STATUSES),
  platform: z.string().nullable(),
  periodFrom: z.string().regex(ISO_DATE).nullable(),
  periodTo: z.string().regex(ISO_DATE).nullable(),
  bookingCount: z.number().int().nonnegative(),
  holdingCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
});

const ManifestSchema = z.object({
  format: z.literal(PROJECT_PACKAGE_FORMAT),
  formatVersion: z.number().int(),
  appVersion: z.string().max(40),
  createdAt: ISO_TS,
  project: ProjectFactsSchema,
  files: z
    .array(
      z.object({
        key: z.string().min(1).max(100),
        path: z.string(),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
        size: z.number().int().nonnegative(),
        displayName: z.string().min(1).max(255),
        kind: z.enum(['csv', 'xlsx', 'pdf']),
        role: z.enum(['original', 'derived']),
        derivedFromKey: z.string().nullable(),
        mappingKey: z.string().nullable(),
        analysis: AnalysisSchema,
        // F5.7a: deactivated in the project. Older packages have no such field = active.
        disabled: z
          .object({
            at: ISO_TS,
            note: z.string().max(FILE_NOTE_MAX).nullable(),
          })
          .nullable()
          .default(null),
      }),
    )
    .max(5000),
  mappings: z
    .array(
      z.object({
        key: z.string().min(1).max(100),
        path: z.string(),
        fingerprint: z.string(),
        name: z.string(),
        platform: z.string(),
      }),
    )
    .max(1000),
  exports: z
    .array(
      z.object({
        path: z.string(),
        kind: z.enum(EXPORT_KINDS),
        fileName: z.string().min(1).max(255),
        wealthChf: z.string().regex(DECIMAL),
        incomeChf: z.string().regex(DECIMAL),
        createdAt: ISO_TS,
      }),
    )
    .max(1000),
  counts: z.record(z.string(), z.number().int().nonnegative()),
});
export type ProjectManifest = z.infer<typeof ManifestSchema>;

const CorrectionsSchema = z
  .array(
    z.object({
      key: z.string().min(1).max(100),
      data: z.unknown(),
      reason: z.string().min(1).max(2000),
      createdAt: ISO_TS,
      undoneAt: ISO_TS.nullable(),
    }),
  )
  .max(10_000);

const RatesSchema = z
  .array(
    z.object({
      kind: z.enum(['price', 'fx']),
      asset: z.string().trim().min(1).max(40),
      currency: z.string().regex(/^[A-Z]{3}$/),
      date: z.string().regex(ISO_DATE),
      value: z.string().regex(DECIMAL),
      source: z.enum(RATE_SOURCES),
    }),
  )
  .max(500_000);

const StatesSchema = z
  .array(
    z.object({
      itemKey: z.string().min(1).max(500),
      done: z.boolean(),
      note: z.string().max(5000),
    }),
  )
  .max(10_000);

const CarryoversSchema = z
  .array(
    z.object({
      key: z.string().min(1).max(100),
      sourceProjectName: z.string().max(200),
      kind: z.enum(CARRYOVER_KINDS),
      refFileKey: z.string().nullable(),
      refCorrectionKey: z.string().nullable(),
      label: z.string().max(500),
      data: z.record(z.string(), z.unknown()),
    }),
  )
  .max(10_000);

export interface ImportedProject {
  readonly projectId: string;
  readonly name: string;
  readonly files: number;
  readonly storedFilesCreated: number;
  readonly mappingsCreated: number;
  readonly mappingsReused: number;
  readonly corrections: number;
}

/** A canonical JSON text (keys sorted) — to compare two specs for equality. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * F10.8 = F1.3: the project package — export and import. Export reads everything of a project
 * (originals, the mappings its files use, corrections with their history, stored rates and
 * overrides, open-item ticks and notes, carry-over records, stored statements). Import validates
 * the whole package first, then writes it as ONE bundle (transaction) into a new project:
 * stored files deduplicated by SHA-256 per owner, mappings reused when fingerprint AND spec are
 * equal (else stored as copies), a name suffix when the owner has the same name + year.
 */
@Injectable()
export class ProjectPackageService {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
    private readonly mappings: ImportMappingRepositoryPort,
    private readonly corrections: CorrectionRepositoryPort,
    private readonly rates: ProjectRateRepositoryPort,
    private readonly states: OpenItemStateRepositoryPort,
    private readonly exports: ProjectExportRepositoryPort,
    private readonly carryovers: CarryoverRepositoryPort,
    private readonly bundles: ProjectBundleRepositoryPort,
    private readonly analysis: FileAnalysisService,
  ) {}

  fileName(project: Project): string {
    return `${slug(project.name)}-${project.taxYear}${PROJECT_PACKAGE_EXTENSION}`;
  }

  async export(project: Project, createdAt: string): Promise<Uint8Array> {
    const files = await this.files.listByProject(project.id);
    const out: Parameters<typeof buildPackage>[1][number][] = [];
    const seenSha = new Set<string>();
    const mappingKeys = new Map<string, ImportMapping>();
    const manifestFiles: ProjectManifest['files'] = [];
    for (const file of files) {
      const content = await this.files.readContent(file.fileId);
      if (!content) continue;
      const path = `files/${file.sha256}`;
      if (!seenSha.has(file.sha256)) {
        seenSha.add(file.sha256);
        out.push({
          path,
          role: 'file',
          bytes: content.bytes,
          store: file.kind === 'xlsx',
        });
      }
      if (file.mappingId && !mappingKeys.has(file.mappingId)) {
        const mapping = await this.mappings.findById(file.mappingId);
        // Defence in depth (F11.16 audit): a package never carries another user's mapping.
        if (mapping && mapping.ownerId === project.ownerId) {
          mappingKeys.set(mapping.id, mapping);
        }
      }
      const derivedFrom = derivedFromId(file.origin);
      manifestFiles.push({
        key: file.id,
        path,
        sha256: file.sha256,
        size: content.bytes.length,
        displayName: file.displayName,
        kind: file.kind,
        role: derivedFrom ? 'derived' : 'original',
        derivedFromKey: derivedFrom ?? null,
        mappingKey:
          file.mappingId && mappingKeys.has(file.mappingId)
            ? file.mappingId
            : null,
        analysis: {
          status: file.status,
          platform: file.platform,
          periodFrom: file.period?.from ?? null,
          periodTo: file.period?.to ?? null,
          bookingCount: file.bookingCount,
          holdingCount: file.holdingCount,
          errorCount: file.errorCount,
        },
        disabled: file.disabledAt
          ? { at: file.disabledAt, note: file.disabledNote }
          : null,
      });
    }
    const manifestMappings: ProjectManifest['mappings'] = [];
    for (const mapping of mappingKeys.values()) {
      const path = `mappings/${mapping.id}.json`;
      out.push({ path, role: 'mapping', bytes: jsonBytes(mapping.spec) });
      manifestMappings.push({
        key: mapping.id,
        path,
        fingerprint: mapping.fingerprint,
        name: mapping.name,
        platform: mapping.platform,
      });
    }
    const corrections = (await this.corrections.listByProject(project.id)).map(
      (c) => ({
        key: c.id,
        data: c.data,
        reason: c.reason,
        createdAt: c.createdAt,
        undoneAt: c.undoneAt,
      }),
    );
    const rates = (await this.rates.listByProject(project.id)).map((r) => ({
      kind: r.kind,
      asset: r.asset,
      currency: r.currency,
      date: r.date,
      value: r.value,
      source: r.source,
    }));
    const states = (await this.states.listByProject(project.id)).map((s) => ({
      itemKey: s.itemKey,
      done: s.done,
      note: s.note,
    }));
    const carryovers = (await this.carryovers.listByProject(project.id)).map(
      (c) => ({
        key: c.id,
        sourceProjectName: c.sourceProjectName,
        kind: c.kind,
        refFileKey: c.kind === 'file' ? c.ref : null,
        refCorrectionKey: c.kind === 'correction' ? c.ref : null,
        label: c.label,
        data: c.data,
      }),
    );
    const manifestExports: ProjectManifest['exports'] = [];
    for (const meta of await this.exports.listByProject(project.id)) {
      const content = await this.exports.findContent(meta.id);
      if (!content) continue;
      const path = `exports/${meta.id}.${meta.kind.endsWith('_pdf') ? 'pdf' : 'xlsx'}`;
      out.push({ path, role: 'export', bytes: content.bytes, store: true });
      manifestExports.push({
        path,
        kind: meta.kind,
        fileName: meta.fileName,
        wealthChf: meta.wealthChf,
        incomeChf: meta.incomeChf,
        createdAt: meta.createdAt,
      });
    }
    out.push(
      {
        path: 'data/corrections.json',
        role: 'data',
        bytes: jsonBytes(corrections),
      },
      { path: 'data/rates.json', role: 'data', bytes: jsonBytes(rates) },
      { path: 'data/open-items.json', role: 'data', bytes: jsonBytes(states) },
      {
        path: 'data/carryovers.json',
        role: 'data',
        bytes: jsonBytes(carryovers),
      },
    );
    const manifest: Omit<ProjectManifest, 'counts'> & {
      counts: Record<string, number>;
    } = {
      format: PROJECT_PACKAGE_FORMAT,
      formatVersion: PACKAGE_FORMAT_VERSION,
      appVersion: appVersion(),
      createdAt,
      project: {
        name: project.name,
        taxYear: project.taxYear,
        country: project.country,
        canton: project.canton as ProjectManifest['project']['canton'],
        taxCurrency:
          project.taxCurrency as ProjectManifest['project']['taxCurrency'],
        status: project.status,
        notes: project.notes,
      },
      files: manifestFiles,
      mappings: manifestMappings,
      exports: manifestExports,
      counts: {
        files: manifestFiles.length,
        storedFiles: seenSha.size,
        mappings: manifestMappings.length,
        corrections: corrections.length,
        rates: rates.length,
        openItemStates: states.length,
        carryovers: carryovers.length,
        exports: manifestExports.length,
      },
    };
    return buildPackage(manifest, out);
  }

  /** Validates and imports a project package into a new project of `ownerId`. */
  async import(ownerId: string, bytes: Uint8Array): Promise<ImportedProject> {
    return this.importOpened(ownerId, openPackage(bytes));
  }

  async importOpened(
    ownerId: string,
    opened: OpenedPackage,
  ): Promise<ImportedProject> {
    const parsed = ManifestSchema.safeParse(opened.manifest);
    if (!parsed.success) {
      const format = (opened.manifest as { format?: unknown } | null)?.format;
      throw new PackageError(
        'manifest',
        format === PROJECT_PACKAGE_FORMAT
          ? 'manifest.json is not valid'
          : 'This is not a lazy-koins project package',
      );
    }
    const manifest = parsed.data;
    if (manifest.formatVersion > PACKAGE_FORMAT_VERSION) {
      throw new PackageError(
        'version',
        `Package format ${manifest.formatVersion} is newer than this app supports`,
      );
    }

    // --- Mappings: same fingerprint AND spec → reuse; else a copy. ---
    const owned = await this.mappings.findByOwner(ownerId);
    const mappingsBundle: ProjectBundle['mappings'][number][] = [];
    const specOf = new Map<string, ImportMapping['spec']>();
    for (const m of manifest.mappings) {
      const raw = readJson(opened, m.path, z.unknown());
      const validation = validateMappingSpec(raw);
      if (!validation.ok) {
        throw new PackageError('content', `${m.path} is not a valid mapping`);
      }
      const spec = validation.spec;
      specOf.set(m.key, spec);
      const fingerprint = mappingFingerprint(spec);
      const same = owned.find(
        (o) =>
          o.fingerprint === fingerprint &&
          canonical(o.spec) === canonical(spec),
      );
      mappingsBundle.push(
        same
          ? { key: m.key, existingId: same.id }
          : { key: m.key, create: { spec, origin: 'copied' } },
      );
    }

    // --- Files: verified bytes, kind from the bytes, read again. ---
    const filesBundle: ProjectBundle['files'][number][] = [];
    const keys = new Set(manifest.files.map((f) => f.key));
    for (const f of manifest.files) {
      const content = opened.files.get(f.path);
      if (!content || f.path !== `files/${f.sha256}`) {
        throw new PackageError('content', `${f.path} is missing`);
      }
      if (content.length > MAX_FILE_BYTES) {
        throw new PackageError('tooLarge', `${f.displayName} is too large`);
      }
      const kind: FileKind | undefined = sniffFileKind(content);
      if (!kind || kind !== f.kind) {
        throw new PackageError('content', `${f.displayName}: unexpected kind`);
      }
      if (f.derivedFromKey && !keys.has(f.derivedFromKey)) {
        throw new PackageError('content', 'A derived file names no source');
      }
      if (f.mappingKey && !specOf.has(f.mappingKey)) {
        throw new PackageError('content', 'A file names an unknown mapping');
      }
      const readable = {
        sha256: f.sha256,
        name: f.displayName,
        kind,
        bytes: content,
      };
      let analysis: FileAnalysis;
      let mappingKey: string | null = null;
      if (f.mappingKey) {
        analysis = await this.analysis.withMapping(readable, {
          id: f.mappingKey,
          spec: specOf.get(f.mappingKey) as ImportMapping['spec'],
        } as ImportMapping);
        mappingKey = f.mappingKey;
      } else {
        analysis = await this.analysis.analyse(ownerId, readable).catch(() => ({
          status: 'needs_mapping' as const,
          importerId: null,
          mappingId: null,
          platform: null,
          period: null,
          bookingCount: 0,
          holdingCount: 0,
          errorCount: 0,
          coverage: [],
        }));
        if (analysis.mappingId) {
          mappingsBundle.push({
            key: analysis.mappingId,
            existingId: analysis.mappingId,
          });
          mappingKey = analysis.mappingId;
        }
      }
      filesBundle.push({
        key: f.key,
        stored: {
          create: {
            sha256: f.sha256,
            bytes: content,
            mediaType: MEDIA_TYPES[kind],
            kind,
            originalName: f.displayName,
          },
        },
        displayName: f.displayName,
        origin: UPLOADED,
        derivedFromKey: f.derivedFromKey ?? undefined,
        analysis,
        mappingKey,
        deactivation: f.disabled,
      });
    }

    // --- Data ---
    const corrections = readJson(
      opened,
      'data/corrections.json',
      CorrectionsSchema,
    ).map((c) => {
      const validation = validateCorrectionData(c.data);
      if (!validation.ok) {
        throw new PackageError('content', 'A correction is not valid');
      }
      if (
        validation.data.type === 'reclassify' &&
        !(BOOKING_KINDS as readonly string[]).includes(validation.data.kind)
      ) {
        throw new PackageError('content', 'A correction is not valid');
      }
      return {
        key: c.key,
        data: validation.data,
        reason: c.reason,
        createdAt: c.createdAt,
        undoneAt: c.undoneAt,
      };
    });
    const rates = readJson(opened, 'data/rates.json', RatesSchema);
    const states = readJson(opened, 'data/open-items.json', StatesSchema);
    const carryovers = readJson(
      opened,
      'data/carryovers.json',
      CarryoversSchema,
    );
    const carryoverKeys = new Set(carryovers.map((c) => c.key));
    const exportsBundle = manifest.exports.map((e) => {
      const content = opened.files.get(e.path);
      if (!content) throw new PackageError('content', `${e.path} is missing`);
      return {
        kind: e.kind,
        fileName: e.fileName,
        bytes: content,
        wealthChf: e.wealthChf,
        incomeChf: e.incomeChf,
        createdAt: e.createdAt,
      };
    });

    // --- Name: suffixed when the owner has the same name + year. ---
    const existing = await this.projects.findByOwner(ownerId);
    const taken = new Set(
      existing
        .filter((p) => p.taxYear === manifest.project.taxYear)
        .map((p) => p.name),
    );
    let name = manifest.project.name;
    for (let n = 2; taken.has(name); n += 1) {
      name = `${manifest.project.name} (${n})`.slice(0, 120);
    }

    const correctionKeys = new Set(corrections.map((c) => c.key));
    const bundle: ProjectBundle = {
      target: {
        create: {
          name,
          taxYear: manifest.project.taxYear,
          country: manifest.project.country,
          canton: manifest.project.canton,
          taxCurrency: manifest.project.taxCurrency,
          notes: manifest.project.notes,
          // Imported projects open for work: a recalculation is needed (no snapshot travels).
          status:
            manifest.project.status === 'closed'
              ? 'reviewed'
              : manifest.project.status,
        },
      },
      mappings: dedupeKeys(mappingsBundle),
      files: filesBundle,
      corrections,
      rates,
      openItemStates: states.map((s) =>
        s.itemKey.startsWith(CARRIED_PREFIX) &&
        carryoverKeys.has(s.itemKey.slice(CARRIED_PREFIX.length))
          ? {
              carryoverKey: s.itemKey.slice(CARRIED_PREFIX.length),
              done: s.done,
              note: s.note,
            }
          : { itemKey: s.itemKey, done: s.done, note: s.note },
      ),
      exports: exportsBundle,
      carryovers: carryovers.map((c) => ({
        key: c.key,
        sourceProjectId: null,
        sourceProjectName: c.sourceProjectName,
        kind: c.kind,
        refFileKey:
          c.refFileKey && keys.has(c.refFileKey) ? c.refFileKey : undefined,
        refCorrectionKey:
          c.refCorrectionKey && correctionKeys.has(c.refCorrectionKey)
            ? c.refCorrectionKey
            : undefined,
        label: c.label,
        data: c.data,
      })),
    };
    const result = await this.bundles.write(ownerId, bundle);
    return {
      projectId: result.projectId,
      name,
      files: result.files,
      storedFilesCreated: result.storedFilesCreated,
      mappingsCreated: result.mappingsCreated,
      mappingsReused: result.mappingsReused,
      corrections: result.corrections,
    };
  }
}

function dedupeKeys<T extends { readonly key: string }>(
  items: readonly T[],
): T[] {
  const seen = new Set<string>();
  return items.filter((i) =>
    seen.has(i.key) ? false : (seen.add(i.key), true),
  );
}
