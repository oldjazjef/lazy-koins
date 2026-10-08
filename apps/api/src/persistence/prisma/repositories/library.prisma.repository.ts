import { Injectable } from '@nestjs/common';
import { mappingFingerprint, validateMappingSpec } from '@lazykoins/engine';
import type { LibraryMapping as LibraryMappingRow } from '../../../generated/prisma/client';
import type {
  LibraryMapping,
  LibraryPublication,
} from '../../../library/domain/library-mapping';
import { LibraryRepositoryPort } from '../../../library/ports/library.repository.port';
import { toIsoString } from '../mappers/scalar.mapper';
import { PrismaService } from '../prisma.service';

function toEntry(row: LibraryMappingRow): LibraryMapping {
  // Specs are validated before they are stored; a row that no longer validates is a bug.
  const validation = validateMappingSpec(JSON.parse(row.spec));
  if (!validation.ok) {
    throw new Error(`Stored library mapping ${row.id} does not validate`);
  }
  return {
    id: row.id,
    authorId: row.authorId,
    authorName: row.authorName,
    sourceMappingId: row.sourceMappingId,
    name: row.name,
    platform: row.platform,
    description: row.description,
    spec: validation.spec,
    fingerprint: row.fingerprint,
    version: row.version,
    ratingCount: row.ratingCount,
    ratingSum: row.ratingSum,
    usageCount: row.usageCount,
    publishedAt: toIsoString(row.publishedAt),
    updatedAt: toIsoString(row.updatedAt),
    deletedAt: row.deletedAt ? toIsoString(row.deletedAt) : null,
    hiddenAt: row.hiddenAt ? toIsoString(row.hiddenAt) : null,
    hiddenReason: row.hiddenReason,
  };
}

function columns(publication: LibraryPublication) {
  return {
    authorName: publication.authorName,
    sourceMappingId: publication.sourceMappingId,
    name: publication.spec.name,
    platform: publication.spec.platform,
    description: publication.description,
    spec: JSON.stringify(publication.spec),
    fingerprint: mappingFingerprint(publication.spec),
  };
}

@Injectable()
export class LibraryPrismaRepository extends LibraryRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listActive(): Promise<LibraryMapping[]> {
    const rows = await this.prisma.libraryMapping.findMany({
      where: { deletedAt: null, hiddenAt: null },
      orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
    });
    return rows.map(toEntry);
  }

  async findById(id: string): Promise<LibraryMapping | undefined> {
    const row = await this.prisma.libraryMapping.findUnique({ where: { id } });
    return row ? toEntry(row) : undefined;
  }

  async findActiveByAuthor(authorId: string): Promise<LibraryMapping[]> {
    const rows = await this.prisma.libraryMapping.findMany({
      where: { authorId, deletedAt: null, hiddenAt: null },
      orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
    });
    return rows.map(toEntry);
  }

  async countPublishedSince(
    authorId: string,
    sinceIso: string,
  ): Promise<number> {
    return this.prisma.libraryMapping.count({
      where: { authorId, publishedAt: { gte: new Date(sinceIso) } },
    });
  }

  async lastAuthorName(authorId: string): Promise<string | null> {
    const row = await this.prisma.libraryMapping.findFirst({
      where: { authorId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: { authorName: true },
    });
    return row?.authorName ?? null;
  }

  async create(
    authorId: string,
    publication: LibraryPublication,
  ): Promise<LibraryMapping> {
    const row = await this.prisma.libraryMapping.create({
      data: { authorId, ...columns(publication) },
    });
    return toEntry(row);
  }

  async publishVersion(
    id: string,
    publication: LibraryPublication,
  ): Promise<LibraryMapping | undefined> {
    const { count } = await this.prisma.libraryMapping.updateMany({
      where: { id, deletedAt: null },
      data: {
        ...columns(publication),
        version: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    return count === 0 ? undefined : this.findById(id);
  }

  async softDelete(id: string, atIso: string): Promise<boolean> {
    const { count } = await this.prisma.libraryMapping.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date(atIso) },
    });
    return count > 0;
  }

  async incrementUsage(id: string): Promise<void> {
    await this.prisma.libraryMapping.updateMany({
      where: { id },
      data: { usageCount: { increment: 1 } },
    });
  }

  async setRating(
    libraryId: string,
    userId: string,
    stars: number | null,
  ): Promise<LibraryMapping | undefined> {
    // One transaction: the rating row and (through the migration's triggers) the aggregate.
    return this.prisma.$transaction(async (tx) => {
      if (stars === null) {
        await tx.libraryRating.deleteMany({
          where: { libraryMappingId: libraryId, userId },
        });
      } else {
        await tx.libraryRating.upsert({
          where: {
            libraryMappingId_userId: { libraryMappingId: libraryId, userId },
          },
          create: { libraryMappingId: libraryId, userId, stars },
          update: { stars },
        });
      }
      const row = await tx.libraryMapping.findUnique({
        where: { id: libraryId },
      });
      return row ? toEntry(row) : undefined;
    });
  }

  async ratingsBy(
    userId: string,
    libraryIds: readonly string[],
  ): Promise<Map<string, number>> {
    if (libraryIds.length === 0) return new Map();
    const rows = await this.prisma.libraryRating.findMany({
      where: { userId, libraryMappingId: { in: [...libraryIds] } },
      select: { libraryMappingId: true, stars: true },
    });
    return new Map(rows.map((row) => [row.libraryMappingId, row.stars]));
  }
}
