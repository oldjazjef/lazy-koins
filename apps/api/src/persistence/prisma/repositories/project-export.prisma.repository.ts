import { Injectable } from '@nestjs/common';
import type { ProjectExport as ProjectExportRow } from '../../../generated/prisma/client';
import type {
  ExportKind,
  NewProjectExport,
  ProjectExportContent,
  ProjectExportMeta,
} from '../../../exports/domain/project-export';
import { mediaTypeOf } from '../../../exports/domain/project-export';
import { ProjectExportRepositoryPort } from '../../../exports/ports/project-export.repository.port';
import { toIsoString } from '../mappers/scalar.mapper';
import { PrismaService } from '../prisma.service';

const META_SELECT = {
  id: true,
  projectId: true,
  kind: true,
  fileName: true,
  mediaType: true,
  size: true,
  snapshotId: true,
  wealthChf: true,
  incomeChf: true,
  createdAt: true,
} as const;

function toMeta(row: Omit<ProjectExportRow, 'bytes'>): ProjectExportMeta {
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind as ExportKind,
    fileName: row.fileName,
    mediaType: row.mediaType,
    size: row.size,
    snapshotId: row.snapshotId,
    wealthChf: row.wealthChf,
    incomeChf: row.incomeChf,
    createdAt: toIsoString(row.createdAt),
  };
}

@Injectable()
export class ProjectExportPrismaRepository extends ProjectExportRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listByProject(projectId: string): Promise<ProjectExportMeta[]> {
    const rows = await this.prisma.projectExport.findMany({
      where: { projectId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: META_SELECT,
    });
    return rows.map(toMeta);
  }

  async findContent(id: string): Promise<ProjectExportContent | undefined> {
    const row = await this.prisma.projectExport.findUnique({ where: { id } });
    return row ? { ...toMeta(row), bytes: row.bytes } : undefined;
  }

  async create(
    projectId: string,
    input: NewProjectExport,
  ): Promise<ProjectExportMeta> {
    const row = await this.prisma.projectExport.create({
      data: {
        projectId,
        kind: input.kind,
        fileName: input.fileName,
        mediaType: mediaTypeOf(input.kind),
        bytes: new Uint8Array(input.bytes),
        size: input.bytes.byteLength,
        snapshotId: input.snapshotId,
        wealthChf: input.wealthChf,
        incomeChf: input.incomeChf,
      },
      select: META_SELECT,
    });
    return toMeta(row);
  }
}
