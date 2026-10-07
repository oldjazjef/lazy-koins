import type { ImportMapping, SaveMappingInput } from '../domain/import-mapping';

/**
 * Persistence contract for mapping specs. The Prisma binding lives in `PersistenceModule`;
 * ownership is checked by the handlers.
 */
export abstract class ImportMappingRepositoryPort {
  /** The owner's mappings, by name then id. */
  abstract findByOwner(ownerId: string): Promise<ImportMapping[]>;

  abstract findById(id: string): Promise<ImportMapping | undefined>;

  /** The owner's copies of one library entry (F5.16), newest version first. */
  abstract findByLibrary(
    ownerId: string,
    libraryId: string,
  ): Promise<ImportMapping[]>;

  abstract create(
    ownerId: string,
    input: SaveMappingInput,
  ): Promise<ImportMapping>;

  /** Replaces the spec (name, platform, fingerprint follow it); `undefined` when gone. */
  abstract update(
    id: string,
    input: SaveMappingInput,
  ): Promise<ImportMapping | undefined>;

  /**
   * Deletes the mapping and, in the same transaction, sets every file it read back to
   * `needs_mapping` (counts and coverage cleared). Returns how many files were reset.
   */
  abstract delete(id: string): Promise<number>;
}
