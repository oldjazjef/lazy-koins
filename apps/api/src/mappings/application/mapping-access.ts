import { BadRequestException, NotFoundException } from '@nestjs/common';
import { type MappingSpec, validateMappingSpec } from '@lazykoins/engine';
import type { ImportMapping } from '../domain/import-mapping';
import type { ImportMappingRepositoryPort } from '../ports/import-mapping.repository.port';

/** Someone else's mapping reads exactly like a missing one (404). */
export async function loadOwnMapping(
  mappings: ImportMappingRepositoryPort,
  userId: string,
  mappingId: string,
): Promise<ImportMapping> {
  const mapping = await mappings.findById(mappingId);
  if (!mapping || mapping.ownerId !== userId) {
    throw new NotFoundException('No such mapping');
  }
  return mapping;
}

/**
 * Two specs are "the same mapping" when their validated JSON is identical (zod output has the
 * schema's key order, unknown keys stripped) — duplicate uploads (F11.0u) and standard mappings
 * taken twice (F5.19) reuse the stored one.
 */
export function canonicalSpec(spec: MappingSpec): string {
  return JSON.stringify(spec);
}

/** My mapping with exactly this spec, if any. */
export async function findSameSpec(
  mappings: ImportMappingRepositoryPort,
  userId: string,
  spec: MappingSpec,
): Promise<ImportMapping | undefined> {
  const wanted = canonicalSpec(spec);
  return (await mappings.findByOwner(userId)).find(
    (mapping) => canonicalSpec(mapping.spec) === wanted,
  );
}

/** Untrusted JSON → a valid spec, or 400 with every issue (path + message). */
export function specOr400(input: unknown): MappingSpec {
  const validation = validateMappingSpec(input);
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
