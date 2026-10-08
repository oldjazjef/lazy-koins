import { mappingFingerprint } from '@lazykoins/engine';
import {
  isVisible,
  type LibraryMapping,
  type LibraryPublication,
} from '../domain/library-mapping';
import { LibraryRepositoryPort } from '../ports/library.repository.port';

/** Port double over Maps; the rating aggregate is recomputed like the adapter's triggers. */
export class InMemoryLibraryRepository extends LibraryRepositoryPort {
  readonly rows = new Map<string, LibraryMapping>();
  readonly ratings = new Map<string, number>();
  private seq = 0;
  /** The clock of `create` (tests move it). */
  now = '2026-10-08T10:00:00.000Z';

  async listActive(): Promise<LibraryMapping[]> {
    return [...this.rows.values()]
      .filter(isVisible)
      .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
  }

  async findById(id: string): Promise<LibraryMapping | undefined> {
    return this.rows.get(id);
  }

  async findActiveByAuthor(authorId: string): Promise<LibraryMapping[]> {
    return (await this.listActive()).filter(
      (entry) => entry.authorId === authorId,
    );
  }

  async countPublishedSince(
    authorId: string,
    sinceIso: string,
  ): Promise<number> {
    return [...this.rows.values()].filter(
      (entry) => entry.authorId === authorId && entry.publishedAt >= sinceIso,
    ).length;
  }

  async lastAuthorName(authorId: string): Promise<string | null> {
    const mine = [...this.rows.values()]
      .filter((entry) => entry.authorId === authorId)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return mine[0]?.authorName ?? null;
  }

  async create(
    authorId: string,
    publication: LibraryPublication,
  ): Promise<LibraryMapping> {
    this.seq += 1;
    const entry: LibraryMapping = {
      id: `lib${this.seq}`,
      authorId,
      ...this.columns(publication),
      version: 1,
      ratingCount: 0,
      ratingSum: 0,
      usageCount: 0,
      publishedAt: this.now,
      updatedAt: this.now,
      deletedAt: null,
      hiddenAt: null,
      hiddenReason: null,
    };
    this.rows.set(entry.id, entry);
    return entry;
  }

  async publishVersion(
    id: string,
    publication: LibraryPublication,
  ): Promise<LibraryMapping | undefined> {
    const existing = this.rows.get(id);
    if (!existing || existing.deletedAt !== null) return undefined;
    const updated: LibraryMapping = {
      ...existing,
      ...this.columns(publication),
      version: existing.version + 1,
      updatedAt: this.now,
    };
    this.rows.set(id, updated);
    return updated;
  }

  async softDelete(id: string, atIso: string): Promise<boolean> {
    const existing = this.rows.get(id);
    if (!existing || existing.deletedAt !== null) return false;
    this.rows.set(id, { ...existing, deletedAt: atIso });
    return true;
  }

  async incrementUsage(id: string): Promise<void> {
    const existing = this.rows.get(id);
    if (existing) {
      this.rows.set(id, { ...existing, usageCount: existing.usageCount + 1 });
    }
  }

  async setRating(
    libraryId: string,
    userId: string,
    stars: number | null,
  ): Promise<LibraryMapping | undefined> {
    const existing = this.rows.get(libraryId);
    if (!existing) return undefined;
    const key = `${libraryId}|${userId}`;
    if (stars === null) this.ratings.delete(key);
    else this.ratings.set(key, stars);
    const all = [...this.ratings.entries()]
      .filter(([k]) => k.startsWith(`${libraryId}|`))
      .map(([, value]) => value);
    const updated = {
      ...existing,
      ratingCount: all.length,
      ratingSum: all.reduce((sum, value) => sum + value, 0),
    };
    this.rows.set(libraryId, updated);
    return updated;
  }

  async ratingsBy(
    userId: string,
    libraryIds: readonly string[],
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (const id of libraryIds) {
      const stars = this.ratings.get(`${id}|${userId}`);
      if (stars !== undefined) out.set(id, stars);
    }
    return out;
  }

  private columns(publication: LibraryPublication) {
    return {
      authorName: publication.authorName,
      sourceMappingId: publication.sourceMappingId,
      name: publication.spec.name,
      platform: publication.spec.platform,
      description: publication.description,
      spec: publication.spec,
      fingerprint: mappingFingerprint(publication.spec),
    };
  }
}
