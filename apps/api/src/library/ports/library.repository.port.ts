import type {
  LibraryMapping,
  LibraryPublication,
} from '../domain/library-mapping';

/**
 * Persistence contract of the mapping library (F5.15–F5.17). The Prisma binding lives in
 * `PersistenceModule`; who may do what is decided by the handlers.
 */
export abstract class LibraryRepositoryPort {
  /** Every entry that is not deleted, newest first. */
  abstract listActive(): Promise<LibraryMapping[]>;

  /** One entry — deleted ones too (`deletedAt` set); callers decide what that means. */
  abstract findById(id: string): Promise<LibraryMapping | undefined>;

  /** The author's entries that are not deleted, newest first. */
  abstract findActiveByAuthor(authorId: string): Promise<LibraryMapping[]>;

  /** Entries the author created since `sinceIso` — deleted ones count too (spam guard). */
  abstract countPublishedSince(
    authorId: string,
    sinceIso: string,
  ): Promise<number>;

  /** The pseudonym of the author's latest entry (prefill), `null` when none or anonymous. */
  abstract lastAuthorName(authorId: string): Promise<string | null>;

  abstract create(
    authorId: string,
    publication: LibraryPublication,
  ): Promise<LibraryMapping>;

  /** Replaces the spec and texts, version + 1. `undefined` when gone or deleted. */
  abstract publishVersion(
    id: string,
    publication: LibraryPublication,
  ): Promise<LibraryMapping | undefined>;

  /** Soft delete (kept for the audit). False when already deleted or missing. */
  abstract softDelete(id: string, atIso: string): Promise<boolean>;

  /** One more copy taken. */
  abstract incrementUsage(id: string): Promise<void>;

  /**
   * Sets (1–5) or removes (`null`) the user's stars and returns the entry with its new
   * aggregate — one transaction (the adapter's triggers keep count and sum).
   */
  abstract setRating(
    libraryId: string,
    userId: string,
    stars: number | null,
  ): Promise<LibraryMapping | undefined>;

  /** The user's stars per entry id (only the given ids). */
  abstract ratingsBy(
    userId: string,
    libraryIds: readonly string[],
  ): Promise<Map<string, number>>;
}
