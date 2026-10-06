import type { CorrectionData, RateEntry } from '@lazykoins/engine';
import type { ExportKind } from '../../exports/domain/project-export';
import type { NewStoredFile } from '../../files/ports/project-file.repository.port';
import type { FileAnalysis } from '../../files/domain/project-file';
import type { MappingSpec } from '@lazykoins/engine';
import type { MappingOrigin } from '../../mappings/domain/import-mapping';
import type {
  CreateProjectInput,
  ProjectStatus,
} from '../../projects/domain/project';

/**
 * What a project took over from another project (F4.4, F4.4a) or from a package (F10.8) — one
 * row per item, so the new project shows "aus Projekt X". Hand-written domain types.
 */

/** Mirrored by a CHECK in the migration. */
export const CARRYOVER_KINDS = [
  'project',
  'file',
  'correction',
  'open_item',
  'notes',
] as const;
export type CarryoverKind = (typeof CARRYOVER_KINDS)[number];

export interface Carryover {
  readonly id: string;
  readonly projectId: string;
  /** null for a package import. */
  readonly sourceProjectId: string | null;
  readonly sourceProjectName: string;
  readonly kind: CarryoverKind;
  /** The new project's item (project file id, correction id), if any. */
  readonly ref: string | null;
  readonly label: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

/** The open-item key of a carried-over open item (its tick lives in `open_item_state`). */
export const CARRIED_PREFIX = 'carried:';

/**
 * Everything a new (or existing) project receives in ONE transaction: a follow-up project
 * (F4.4a), files taken over from another project (F4.4) or an imported package (F10.8). Items
 * reference each other by `key` (the ids are only known once written).
 */
export interface ProjectBundle {
  readonly target:
    | {
        readonly create: CreateProjectInput & {
          readonly status?: ProjectStatus;
        };
      }
    | { readonly existingProjectId: string };
  readonly mappings: readonly {
    readonly key: string;
    /** Reuse the owner's mapping … */
    readonly existingId?: string;
    /** … or store a new one. */
    readonly create?: {
      readonly spec: MappingSpec;
      readonly origin: MappingOrigin;
    };
  }[];
  readonly files: readonly {
    readonly key: string;
    readonly stored:
      { readonly existingId: string } | { readonly create: NewStoredFile };
    readonly displayName: string;
    /** `uploaded`, `from_project:<id>`; ignored when `derivedFromKey` is set. */
    readonly origin: string;
    /** `derived_from:<the new project file of that key>`. */
    readonly derivedFromKey?: string;
    /** Its `mappingId` is replaced by the mapping of `mappingKey`. */
    readonly analysis: FileAnalysis;
    readonly mappingKey: string | null;
  }[];
  readonly corrections: readonly {
    readonly key: string;
    readonly data: CorrectionData;
    readonly reason: string;
    /** Kept from the source (history, F9.4); absent = now. */
    readonly createdAt?: string;
    readonly undoneAt?: string | null;
  }[];
  readonly rates: readonly RateEntry[];
  readonly openItemStates: readonly {
    /** The item key, or `carried:` + the new id of `carryoverKey`. */
    readonly itemKey?: string;
    readonly carryoverKey?: string;
    readonly done: boolean;
    readonly note: string;
  }[];
  readonly exports: readonly {
    readonly kind: ExportKind;
    readonly fileName: string;
    readonly bytes: Uint8Array;
    readonly wealthChf: string;
    readonly incomeChf: string;
    readonly createdAt?: string;
  }[];
  readonly carryovers: readonly {
    readonly key?: string;
    readonly sourceProjectId: string | null;
    readonly sourceProjectName: string;
    readonly kind: CarryoverKind;
    /** The item it produced: a file or correction of this bundle. */
    readonly refFileKey?: string;
    readonly refCorrectionKey?: string;
    readonly label: string;
    readonly data: Readonly<Record<string, unknown>>;
  }[];
}

export interface BundleResult {
  readonly projectId: string;
  readonly files: number;
  readonly mappingsCreated: number;
  readonly mappingsReused: number;
  readonly storedFilesCreated: number;
  readonly corrections: number;
}
