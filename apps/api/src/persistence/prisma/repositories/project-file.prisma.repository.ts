import { Injectable } from '@nestjs/common';
import type { CoverageEntry, FileKind } from '@lazykoins/engine';
import {
  Prisma,
  type ProjectFile as ProjectFileRow,
  type StoredFile as StoredFileRow,
} from '../../../generated/prisma/client';
import type {
  FileAnalysis,
  FileDeactivation,
  ProjectFile,
  StoredFileContent,
  StoredFileMeta,
  UserFile,
} from '../../../files/domain/project-file';
import {
  type AddProjectFileInput,
  type MappingUse,
  type NewStoredFile,
  ProjectFileRepositoryPort,
} from '../../../files/ports/project-file.repository.port';
import { toIsoString } from '../mappers/scalar.mapper';
import { PrismaService } from '../prisma.service';

type MetaRow = Omit<StoredFileRow, 'bytes'>;
type EntryRow = ProjectFileRow & { file: MetaRow };
type UsageRow = Pick<ProjectFileRow, 'id' | 'projectId' | 'disabledAt'>;
type UserFileRow = MetaRow & { projectFiles: UsageRow[] };

/** Every stored-file column but the BLOB — listings never load the bytes. */
const META = {
  id: true,
  ownerId: true,
  sha256: true,
  size: true,
  mediaType: true,
  kind: true,
  originalName: true,
  createdAt: true,
  status: true,
  importerId: true,
  mappingId: true,
  platform: true,
  periodFrom: true,
  periodTo: true,
  bookingCount: true,
  holdingCount: true,
  errorCount: true,
  coverage: true,
  source: true,
} as const;

const WITH_META = { file: { select: META } } as const;

const WITH_USAGES = {
  ...META,
  projectFiles: {
    select: { id: true, projectId: true, disabledAt: true },
    orderBy: [{ addedAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.StoredFileSelect;

function toMeta(row: MetaRow): StoredFileMeta {
  return {
    id: row.id,
    ownerId: row.ownerId,
    sha256: row.sha256,
    size: row.size,
    mediaType: row.mediaType,
    kind: row.kind as FileKind,
    originalName: row.originalName,
    createdAt: toIsoString(row.createdAt),
  };
}

function parseCoverage(text: string): CoverageEntry[] {
  const value: unknown = JSON.parse(text);
  return Array.isArray(value) ? (value as CoverageEntry[]) : [];
}

function toAnalysis(row: MetaRow): FileAnalysis {
  return {
    status: row.status as FileAnalysis['status'],
    importerId: row.importerId,
    mappingId: row.mappingId,
    platform: row.platform,
    period:
      row.periodFrom && row.periodTo
        ? { from: row.periodFrom, to: row.periodTo }
        : null,
    bookingCount: row.bookingCount,
    holdingCount: row.holdingCount,
    errorCount: row.errorCount,
    coverage: parseCoverage(row.coverage),
  };
}

function toProjectFile(row: EntryRow): ProjectFile {
  return {
    ...toAnalysis(row.file),
    id: row.id,
    projectId: row.projectId,
    fileId: row.fileId,
    sha256: row.file.sha256,
    kind: row.file.kind as FileKind,
    size: row.file.size,
    mediaType: row.file.mediaType,
    displayName: row.displayName,
    origin: row.origin,
    addedAt: toIsoString(row.addedAt),
    disabledAt: row.disabledAt ? toIsoString(row.disabledAt) : null,
    disabledNote: row.disabledAt ? row.disabledNote : null,
  };
}

function toUserFile(row: UserFileRow): UserFile {
  return {
    ...toMeta(row),
    ...toAnalysis(row),
    source: row.source,
    usages: row.projectFiles.map((usage) => ({
      projectFileId: usage.id,
      projectId: usage.projectId,
      active: usage.disabledAt === null,
    })),
  };
}

function analysisColumns(analysis: FileAnalysis) {
  return {
    status: analysis.status,
    importerId: analysis.importerId,
    mappingId: analysis.mappingId,
    platform: analysis.platform,
    periodFrom: analysis.period?.from ?? null,
    periodTo: analysis.period?.to ?? null,
    bookingCount: analysis.bookingCount,
    holdingCount: analysis.holdingCount,
    errorCount: analysis.errorCount,
    coverage: JSON.stringify(analysis.coverage),
  };
}

function storedColumns(ownerId: string, file: NewStoredFile) {
  return {
    ownerId,
    sha256: file.sha256,
    bytes: new Uint8Array(file.bytes),
    size: file.bytes.length,
    mediaType: file.mediaType,
    kind: file.kind,
    originalName: file.originalName,
    source: file.source,
    ...analysisColumns(file.analysis),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

@Injectable()
export class ProjectFilePrismaRepository extends ProjectFileRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findStoredBySha(
    ownerId: string,
    sha256: string,
  ): Promise<StoredFileMeta | undefined> {
    const row = await this.prisma.storedFile.findUnique({
      where: { ownerId_sha256: { ownerId, sha256 } },
      select: META,
    });
    return row ? toMeta(row) : undefined;
  }

  async readContent(fileId: string): Promise<StoredFileContent | undefined> {
    const row = await this.prisma.storedFile.findUnique({
      where: { id: fileId },
    });
    return row ? { ...toMeta(row), bytes: row.bytes } : undefined;
  }

  async findInProject(
    projectId: string,
    fileId: string,
  ): Promise<ProjectFile | undefined> {
    const row = await this.prisma.projectFile.findUnique({
      where: { projectId_fileId: { projectId, fileId } },
      include: WITH_META,
    });
    return row ? toProjectFile(row) : undefined;
  }

  async firstOtherProjectUsing(
    fileId: string,
    exceptProjectId: string,
  ): Promise<string | undefined> {
    const row = await this.prisma.projectFile.findFirst({
      where: { fileId, projectId: { not: exceptProjectId } },
      orderBy: [{ addedAt: 'asc' }, { id: 'asc' }],
      select: { projectId: true },
    });
    return row?.projectId;
  }

  async findById(id: string): Promise<ProjectFile | undefined> {
    const row = await this.prisma.projectFile.findUnique({
      where: { id },
      include: WITH_META,
    });
    return row ? toProjectFile(row) : undefined;
  }

  async listByProject(projectId: string): Promise<ProjectFile[]> {
    const rows = await this.prisma.projectFile.findMany({
      where: { projectId },
      include: WITH_META,
      orderBy: [{ addedAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toProjectFile);
  }

  async listByMapping(mappingId: string): Promise<ProjectFile[]> {
    const rows = await this.prisma.projectFile.findMany({
      where: { file: { mappingId } },
      include: WITH_META,
      orderBy: [{ addedAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toProjectFile);
  }

  async countByMappings(mappingIds: readonly string[]): Promise<MappingUse[]> {
    if (mappingIds.length === 0) return [];
    const rows = await this.prisma.projectFile.findMany({
      where: { file: { mappingId: { in: [...mappingIds] } } },
      select: { projectId: true, file: { select: { mappingId: true } } },
    });
    const counts = new Map<string, MappingUse>();
    for (const row of rows) {
      const mappingId = row.file.mappingId;
      if (!mappingId) continue;
      const key = `${mappingId}|${row.projectId}`;
      counts.set(key, {
        mappingId,
        projectId: row.projectId,
        files: (counts.get(key)?.files ?? 0) + 1,
      });
    }
    return [...counts.values()].sort((a, b) =>
      a.mappingId === b.mappingId
        ? a.projectId < b.projectId
          ? -1
          : a.projectId > b.projectId
            ? 1
            : 0
        : a.mappingId < b.mappingId
          ? -1
          : 1,
    );
  }

  async add(
    input: AddProjectFileInput,
  ): Promise<{ created: ProjectFile } | { duplicate: ProjectFile }> {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        if ('existingId' in input.stored) {
          // Defence in depth (F11.16 audit): stored files are deduplicated per owner — a
          // project never links another user's bytes, even if a caller passed a foreign id.
          const owned = await tx.storedFile.findFirst({
            where: { id: input.stored.existingId, ownerId: input.ownerId },
            select: { id: true },
          });
          if (!owned) {
            throw new Error('The stored file belongs to another owner');
          }
        }
        const fileId =
          'existingId' in input.stored
            ? input.stored.existingId
            : (
                await tx.storedFile.create({
                  data: storedColumns(input.ownerId, input.stored.create),
                  select: { id: true },
                })
              ).id;
        return tx.projectFile.create({
          data: {
            projectId: input.projectId,
            fileId,
            displayName: input.displayName,
            origin: input.origin,
          },
          include: WITH_META,
        });
      });
      return { created: toProjectFile(row) };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // A concurrent upload of the same bytes won the race: report its entry as the duplicate.
      const sha =
        'create' in input.stored ? input.stored.create.sha256 : undefined;
      const stored =
        'existingId' in input.stored
          ? { id: input.stored.existingId }
          : sha
            ? await this.findStoredBySha(input.ownerId, sha)
            : undefined;
      const existing = stored
        ? await this.findInProject(input.projectId, stored.id)
        : undefined;
      if (!existing) throw error;
      return { duplicate: existing };
    }
  }

  async updateAnalysis(
    id: string,
    analysis: FileAnalysis,
  ): Promise<ProjectFile | undefined> {
    const entry = await this.prisma.projectFile.findUnique({
      where: { id },
      select: { fileId: true },
    });
    if (!entry) return undefined;
    await this.prisma.storedFile.updateMany({
      where: { id: entry.fileId },
      data: analysisColumns(analysis),
    });
    return this.findById(id);
  }

  async setDeactivation(
    id: string,
    state: FileDeactivation | null,
  ): Promise<ProjectFile | undefined> {
    const { count } = await this.prisma.projectFile.updateMany({
      where: { id },
      data: state
        ? { disabledAt: new Date(state.at), disabledNote: state.note }
        : { disabledAt: null, disabledNote: null },
    });
    return count === 0 ? undefined : this.findById(id);
  }

  async remove(id: string): Promise<boolean> {
    const { count } = await this.prisma.projectFile.deleteMany({
      where: { id },
    });
    return count > 0;
  }

  async listByOwner(ownerId: string): Promise<UserFile[]> {
    const rows = await this.prisma.storedFile.findMany({
      where: { ownerId },
      select: WITH_USAGES,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toUserFile);
  }

  async findStored(id: string): Promise<UserFile | undefined> {
    const row = await this.prisma.storedFile.findUnique({
      where: { id },
      select: WITH_USAGES,
    });
    return row ? toUserFile(row) : undefined;
  }

  async listStoredByMapping(mappingId: string): Promise<UserFile[]> {
    const rows = await this.prisma.storedFile.findMany({
      where: { mappingId },
      select: WITH_USAGES,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toUserFile);
  }

  async addStored(
    ownerId: string,
    file: NewStoredFile,
  ): Promise<{ created: UserFile } | { duplicate: UserFile }> {
    const existing = await this.findStoredBySha(ownerId, file.sha256);
    if (existing) {
      const found = await this.findStored(existing.id);
      if (found) return { duplicate: found };
    }
    try {
      const row = await this.prisma.storedFile.create({
        data: storedColumns(ownerId, file),
        select: WITH_USAGES,
      });
      return { created: toUserFile(row) };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.findStoredBySha(ownerId, file.sha256);
      const found = raced ? await this.findStored(raced.id) : undefined;
      if (!found) throw error;
      return { duplicate: found };
    }
  }

  async updateStoredAnalysis(
    id: string,
    analysis: FileAnalysis,
  ): Promise<UserFile | undefined> {
    const { count } = await this.prisma.storedFile.updateMany({
      where: { id },
      data: analysisColumns(analysis),
    });
    return count === 0 ? undefined : this.findStored(id);
  }

  async deleteStored(id: string): Promise<boolean> {
    // The project entries go with it (ON DELETE CASCADE), in the same statement.
    const { count } = await this.prisma.storedFile.deleteMany({
      where: { id },
    });
    return count > 0;
  }
}
