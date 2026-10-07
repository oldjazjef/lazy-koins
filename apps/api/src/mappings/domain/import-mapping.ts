import type { MappingSpec } from '@lazykoins/engine';

/**
 * A stored mapping spec (libs/engine `mapping/`): owner-scoped, visible in every project whose
 * files it reads. Hand-written domain type — never a re-export of a Prisma model.
 */

/**
 * Mirrored by a CHECK in the migration. `library` = a private copy taken from the mapping library
 * (F5.16); `library` then names the entry and the version it was taken at.
 */
export const MAPPING_ORIGINS = ['ai', 'manual', 'copied', 'library'] as const;
export type MappingOrigin = (typeof MAPPING_ORIGINS)[number];

/** Where a copy came from (F5.16). The entry may have been deleted since — the copy stays. */
export interface LibraryRef {
  readonly id: string;
  readonly version: number;
}

/** `library:<id>@<version>` — how a copy names its source. */
export function libraryOriginLabel(ref: LibraryRef): string {
  return `library:${ref.id}@${ref.version}`;
}

export interface ImportMapping {
  readonly id: string;
  readonly ownerId: string;
  readonly name: string;
  readonly platform: string;
  readonly spec: MappingSpec;
  readonly fingerprint: string;
  readonly version: number;
  readonly origin: MappingOrigin;
  /** Set for origin `library`. */
  readonly library?: LibraryRef;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SaveMappingInput {
  readonly spec: MappingSpec;
  readonly origin: MappingOrigin;
  /** Create: required for origin `library`. Update: `undefined` keeps the stored reference. */
  readonly library?: LibraryRef;
}
