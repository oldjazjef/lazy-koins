import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import type {
  AdminAuditEntry,
  AdminLibraryCriteria,
  AdminLibraryEntry,
  AdminOverview,
  AdminUser,
  AdminUserCriteria,
  Page,
} from '../../../admin/domain/admin';
import type { AdminAction } from '../../../admin/domain/admin';
import { AdminRepositoryPort } from '../../../admin/ports/admin.repository.port';
import { toIsoString } from '../mappers/scalar.mapper';
import { PrismaService } from '../prisma.service';

const iso = (d: Date | null) => (d ? toIsoString(d) : null);

/** Metadata only: no query here selects file bytes, specs, settings or project content. */
@Injectable()
export class AdminPrismaRepository extends AdminRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async overview(sinceActiveIso: string): Promise<AdminOverview> {
    const p = this.prisma;
    const [
      users,
      activeUsers,
      blockedUsers,
      admins,
      projects,
      files,
      libraryEntries,
      hiddenLibraryEntries,
      pageCount,
      pageSize,
    ] = await Promise.all([
      p.user.count(),
      p.user.count({
        where: { lastSeenAt: { gte: new Date(sinceActiveIso) } },
      }),
      p.user.count({ where: { blockedAt: { not: null } } }),
      p.user.count({ where: { isPlatformAdmin: true } }),
      p.project.count(),
      p.storedFile.aggregate({ _count: { _all: true }, _sum: { size: true } }),
      p.libraryMapping.count({ where: { deletedAt: null, hiddenAt: null } }),
      p.libraryMapping.count({
        where: { deletedAt: null, hiddenAt: { not: null } },
      }),
      p.$queryRawUnsafe<{ page_count: bigint | number }[]>('PRAGMA page_count'),
      p.$queryRawUnsafe<{ page_size: bigint | number }[]>('PRAGMA page_size'),
    ]);
    return {
      users,
      activeUsers,
      blockedUsers,
      admins,
      projects,
      storedFiles: files._count._all,
      storageBytes: files._sum.size ?? 0,
      libraryEntries,
      hiddenLibraryEntries,
      databaseBytes:
        Number(pageCount[0]?.page_count ?? 0) *
        Number(pageSize[0]?.page_size ?? 0),
    };
  }

  private userWhere(criteria: AdminUserCriteria): Prisma.UserWhereInput {
    const q = (criteria.query ?? '').trim();
    return {
      ...(q
        ? { OR: [{ email: { contains: q } }, { displayName: { contains: q } }] }
        : {}),
      ...(criteria.filter === 'blocked' ? { blockedAt: { not: null } } : {}),
      ...(criteria.filter === 'admins' ? { isPlatformAdmin: true } : {}),
    };
  }

  private async toUsers(
    rows: readonly {
      id: string;
      email: string;
      displayName: string;
      signInProvider: string;
      createdAt: Date;
      lastSeenAt: Date | null;
      isPlatformAdmin: boolean;
      blockedAt: Date | null;
      blockedReason: string | null;
      _count: {
        projects: number;
        storedFiles: number;
        libraryMappings: number;
      };
    }[],
  ): Promise<AdminUser[]> {
    const storage = await this.prisma.storedFile.groupBy({
      by: ['ownerId'],
      where: { ownerId: { in: rows.map((r) => r.id) } },
      _sum: { size: true },
    });
    const bytes = new Map(storage.map((s) => [s.ownerId, s._sum.size ?? 0]));
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      displayName: r.displayName,
      signInProvider: r.signInProvider,
      createdAt: toIsoString(r.createdAt),
      lastSeenAt: iso(r.lastSeenAt),
      isPlatformAdmin: r.isPlatformAdmin,
      blockedAt: iso(r.blockedAt),
      blockedReason: r.blockedReason,
      projects: r._count.projects,
      storedFiles: r._count.storedFiles,
      storageBytes: bytes.get(r.id) ?? 0,
      libraryEntries: r._count.libraryMappings,
    }));
  }

  private readonly userSelect = {
    id: true,
    email: true,
    displayName: true,
    signInProvider: true,
    createdAt: true,
    lastSeenAt: true,
    isPlatformAdmin: true,
    blockedAt: true,
    blockedReason: true,
    _count: {
      select: {
        projects: true,
        storedFiles: true,
        libraryMappings: { where: { deletedAt: null } },
      },
    },
  } as const;

  async listUsers(criteria: AdminUserCriteria): Promise<Page<AdminUser>> {
    const where = this.userWhere(criteria);
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: this.userSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: criteria.offset,
        take: criteria.limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items: await this.toUsers(rows), total };
  }

  async findUser(id: string): Promise<AdminUser | undefined> {
    const row = await this.prisma.user.findUnique({
      where: { id },
      select: this.userSelect,
    });
    return row ? (await this.toUsers([row]))[0] : undefined;
  }

  countAdmins(): Promise<number> {
    return this.prisma.user.count({ where: { isPlatformAdmin: true } });
  }

  async setBlocked(
    id: string,
    block: { readonly atIso: string; readonly reason: string } | null,
  ): Promise<void> {
    await this.prisma.user.updateMany({
      where: { id },
      data: block
        ? { blockedAt: new Date(block.atIso), blockedReason: block.reason }
        : { blockedAt: null, blockedReason: null },
    });
  }

  async setAdmin(id: string, admin: boolean): Promise<void> {
    await this.prisma.user.updateMany({
      where: { id },
      data: { isPlatformAdmin: admin },
    });
  }

  async deleteUser(id: string): Promise<void> {
    await this.prisma.user.deleteMany({ where: { id } });
  }

  private libraryWhere(
    criteria: AdminLibraryCriteria,
  ): Prisma.LibraryMappingWhereInput {
    const q = (criteria.query ?? '').trim();
    return {
      deletedAt: null,
      ...(criteria.filter === 'hidden' ? { hiddenAt: { not: null } } : {}),
      ...(criteria.filter === 'visible' ? { hiddenAt: null } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { platform: { contains: q } },
              { authorName: { contains: q } },
              { author: { email: { contains: q } } },
            ],
          }
        : {}),
    };
  }

  private readonly librarySelect = {
    id: true,
    name: true,
    platform: true,
    description: true,
    authorName: true,
    authorId: true,
    version: true,
    usageCount: true,
    ratingCount: true,
    publishedAt: true,
    updatedAt: true,
    hiddenAt: true,
    hiddenReason: true,
    author: { select: { email: true } },
  } as const;

  private toEntry(row: {
    id: string;
    name: string;
    platform: string;
    description: string | null;
    authorName: string | null;
    authorId: string;
    version: number;
    usageCount: number;
    ratingCount: number;
    publishedAt: Date;
    updatedAt: Date;
    hiddenAt: Date | null;
    hiddenReason: string | null;
    author: { email: string };
  }): AdminLibraryEntry {
    return {
      id: row.id,
      name: row.name,
      platform: row.platform,
      description: row.description,
      authorName: row.authorName,
      authorId: row.authorId,
      authorEmail: row.author.email,
      version: row.version,
      usageCount: row.usageCount,
      ratingCount: row.ratingCount,
      publishedAt: toIsoString(row.publishedAt),
      updatedAt: toIsoString(row.updatedAt),
      hiddenAt: iso(row.hiddenAt),
      hiddenReason: row.hiddenReason,
    };
  }

  async listLibrary(
    criteria: AdminLibraryCriteria,
  ): Promise<Page<AdminLibraryEntry>> {
    const where = this.libraryWhere(criteria);
    const [rows, total] = await Promise.all([
      this.prisma.libraryMapping.findMany({
        where,
        select: this.librarySelect,
        orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
        skip: criteria.offset,
        take: criteria.limit,
      }),
      this.prisma.libraryMapping.count({ where }),
    ]);
    return { items: rows.map((r) => this.toEntry(r)), total };
  }

  async findLibraryEntry(id: string): Promise<AdminLibraryEntry | undefined> {
    const row = await this.prisma.libraryMapping.findFirst({
      where: { id, deletedAt: null },
      select: this.librarySelect,
    });
    return row ? this.toEntry(row) : undefined;
  }

  async setLibraryHidden(
    id: string,
    hide: { readonly atIso: string; readonly reason: string } | null,
  ): Promise<void> {
    await this.prisma.libraryMapping.updateMany({
      where: { id, deletedAt: null },
      data: hide
        ? { hiddenAt: new Date(hide.atIso), hiddenReason: hide.reason }
        : { hiddenAt: null, hiddenReason: null },
    });
  }

  async addAudit(
    entry: Omit<AdminAuditEntry, 'id' | 'createdAt'>,
  ): Promise<AdminAuditEntry> {
    const row = await this.prisma.adminAudit.create({ data: { ...entry } });
    return toAudit(row);
  }

  async listAudit(
    offset: number,
    limit: number,
  ): Promise<Page<AdminAuditEntry>> {
    const [rows, total] = await Promise.all([
      this.prisma.adminAudit.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: limit,
      }),
      this.prisma.adminAudit.count(),
    ]);
    return { items: rows.map(toAudit), total };
  }
}

function toAudit(row: {
  id: string;
  actorId: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
  reason: string | null;
  createdAt: Date;
}): AdminAuditEntry {
  return {
    id: row.id,
    actorId: row.actorId,
    actorEmail: row.actorEmail,
    action: row.action as AdminAction,
    targetType: row.targetType as 'user' | 'library',
    targetId: row.targetId,
    targetLabel: row.targetLabel,
    reason: row.reason,
    createdAt: toIsoString(row.createdAt),
  };
}
