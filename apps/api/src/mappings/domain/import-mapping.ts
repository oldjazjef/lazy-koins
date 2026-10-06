import type { MappingSpec } from '@lazykoins/engine';

/**
 * A stored mapping spec (libs/engine `mapping/`): owner-scoped, visible in every project whose
 * files it reads. Hand-written domain type — never a re-export of a Prisma model.
 */

/** Mirrored by a CHECK in the migration. `ai` arrives with the AI phase. */
export const MAPPING_ORIGINS = ['ai', 'manual', 'copied'] as const;
export type MappingOrigin = (typeof MAPPING_ORIGINS)[number];

export interface ImportMapping {
  readonly id: string;
  readonly ownerId: string;
  readonly name: string;
  readonly platform: string;
  readonly spec: MappingSpec;
  readonly fingerprint: string;
  readonly version: number;
  readonly origin: MappingOrigin;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SaveMappingInput {
  readonly spec: MappingSpec;
  readonly origin: MappingOrigin;
}
