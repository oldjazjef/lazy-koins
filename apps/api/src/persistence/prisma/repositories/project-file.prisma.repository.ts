import { Injectable } from '@nestjs/common';
import type { CoverageEntry, FileKind } from '@lazykoins/engine';
import {
  Prisma,
  type ProjectFile as ProjectFileRow,
  type StoredFile as StoredFileRow,
} from '../../../generated/prisma/client';
import type {
  FileAnalysis,
  ProjectFile,
  StoredFileContent,
  StoredFileMeta,
} from '../../../files/domain/project-file';
import {
  type AddProjectFileInput,
  type MappingUse,
  ProjectFileRepositoryPort,
} from '../../../files/ports/project-file.repository.port';
import { toIsoString } from '../mappers/scalar.mapper';
import { PrismaService } from '../prisma.service';

type MetaRow = Omit<StoredFileRow, 'bytes'>;
type EntryRow = ProjectFileRow & { file: MetaRow };

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
} as const;

const WITH_META = { file: { select: META } } as const;

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

function toProjectFile(row: EntryRow): ProjectFile {
  return {
    id: row.id,
    projectId: row.projectId,
    fileId: row.fileId,
    sha256: row.file.sha256,
    kind: row.file.kind as FileKind,
    size: row.file.size,
    mediaType: row.file.mediaType,
    displayName: row.displayName,
    status: row.status as ProjectFile['status'],
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
    origin: row.origin,
    addedAt: toIsoString(row.addedAt),
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
      where: { mappingId },
      include: WITH_META,
      orderBy: [{ addedAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toProjectFile);
  }

  async countByMappings(mappingIds: readonly string[]): Promise<MappingUse[]> {
    if (mappingIds.length === 0) return [];
    const groups = await this.prisma.projectFile.groupBy({
      by: ['mappingId', 'projectId'],
      where: { mappingId: { in: [...mappingIds] } },
      _count: { _all: true },
      orderBy: [{ mappingId: 'asc' }, { projectId: 'asc' }],
    });
    return groups.flatMap((group) =>
      group.mappingId
        ? [
            {
              mappingId: group.mappingId,
              projectId: group.projectId,
              files: group._count._all,
            },
          ]
        : [],
    );
  }

  async add(
    input: AddProjectFileInput,
  ): Promise<{ created: ProjectFile } | { duplicate: ProjectFile }> {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const fileId =
          'existingId' in input.stored
            ? input.stored.existingId
            : (
                await tx.storedFile.create({
                  data: {
                    ownerId: input.ownerId,
                    sha256: input.stored.create.sha256,
                    bytes: new Uint8Array(input.stored.create.bytes),
                    size: input.stored.create.bytes.length,
                    mediaType: input.stored.create.mediaType,
                    kind: input.stored.create.kind,
                    originalName: input.stored.create.originalName,
                  },
                  select: { id: true },
                })
              ).id;
        return tx.projectFile.create({
          data: {
            projectId: input.projectId,
            fileId,
            displayName: input.displayName,
            origin: input.origin,
            ...analysisColumns(input.analysis),
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
    const { count } = await this.prisma.projectFile.updateMany({
      where: { id },
      data: analysisColumns(analysis),
    });
    return count === 0 ? undefined : this.findById(id);
  }

  async remove(
    id: string,
  ): Promise<{ storedFileDeleted: boolean } | undefined> {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.projectFile.findUnique({
        where: { id },
        select: { fileId: true },
      });
      if (!entry) return undefined;
      await tx.projectFile.delete({ where: { id } });
      const { count } = await tx.storedFile.deleteMany({
        where: { id: entry.fileId, projectFiles: { none: {} } },
      });
      return { storedFileDeleted: count > 0 };
    });
  }
}
