import { Injectable } from '@nestjs/common';
import type { ProjectSentState as ProjectSentRow } from '../../../generated/prisma/client';
import type {
  ProjectChangeFacts,
  ProjectSentState,
  SaveProjectSentInput,
  SentVia,
} from '../../../projects/domain/project-sent';
import { ProjectSentRepositoryPort } from '../../../projects/ports/project-sent.repository.port';
import { toIsoString } from '../mappers/scalar.mapper';
import { PrismaService } from '../prisma.service';

function toState(row: ProjectSentRow): ProjectSentState {
  const exportIds: unknown = JSON.parse(row.sentExports);
  return {
    projectId: row.projectId,
    sentAt: toIsoString(row.sentToAdvisorAt),
    sentTo: row.sentTo,
    via: row.sentVia as SentVia,
    note: row.sentNote,
    exportIds: Array.isArray(exportIds) ? exportIds.map(String) : [],
    mailLogId: row.mailLogId,
    snapshotHash: row.snapshotHash,
    updatedAt: toIsoString(row.updatedAt),
  };
}

const later = (a: Date | null, b: Date | null): Date | null =>
  a === null ? b : b === null ? a : a > b ? a : b;

@Injectable()
export class ProjectSentPrismaRepository extends ProjectSentRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async find(projectId: string): Promise<ProjectSentState | undefined> {
    const row = await this.prisma.projectSentState.findUnique({
      where: { projectId },
    });
    return row ? toState(row) : undefined;
  }

  async findMany(
    projectIds: readonly string[],
  ): Promise<ReadonlyMap<string, ProjectSentState>> {
    if (projectIds.length === 0) return new Map();
    const rows = await this.prisma.projectSentState.findMany({
      where: { projectId: { in: [...projectIds] } },
    });
    return new Map(rows.map((row) => [row.projectId, toState(row)]));
  }

  async save(
    projectId: string,
    input: SaveProjectSentInput,
  ): Promise<ProjectSentState> {
    const data = {
      sentToAdvisorAt: new Date(input.sentAt),
      sentTo: input.sentTo,
      sentVia: input.via,
      sentNote: input.note,
      sentExports: JSON.stringify(input.exportIds),
      mailLogId: input.mailLogId,
      snapshotHash: input.snapshotHash,
    };
    const row = await this.prisma.projectSentState.upsert({
      where: { projectId },
      create: { projectId, ...data },
      update: data,
    });
    return toState(row);
  }

  async remove(projectId: string): Promise<boolean> {
    const { count } = await this.prisma.projectSentState.deleteMany({
      where: { projectId },
    });
    return count > 0;
  }

  async changeFacts(
    projectIds: readonly string[],
  ): Promise<ReadonlyMap<string, ProjectChangeFacts>> {
    if (projectIds.length === 0) return new Map();
    const ids = { in: [...projectIds] };
    const [snapshots, exports, corrections, files] = await Promise.all([
      this.prisma.calculationSnapshot.findMany({
        where: { projectId: ids },
        select: { projectId: true, createdAt: true, inputHash: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.projectExport.findMany({
        where: { projectId: ids },
        select: { id: true, projectId: true, createdAt: true },
      }),
      this.prisma.correction.groupBy({
        by: ['projectId'],
        where: { projectId: ids },
        _max: { createdAt: true, undoneAt: true },
      }),
      this.prisma.projectFile.groupBy({
        by: ['projectId'],
        where: { projectId: ids },
        _max: { addedAt: true },
      }),
    ]);
    const out = new Map<string, ProjectChangeFacts>();
    for (const projectId of projectIds) {
      const latest = snapshots.find((s) => s.projectId === projectId);
      const correction = corrections.find((c) => c.projectId === projectId);
      const correctionAt = correction
        ? later(correction._max.createdAt, correction._max.undoneAt)
        : null;
      const fileAt =
        files.find((f) => f.projectId === projectId)?._max.addedAt ?? null;
      out.set(projectId, {
        latestSnapshot: latest
          ? {
              createdAt: toIsoString(latest.createdAt),
              inputHash: latest.inputHash,
            }
          : null,
        exports: exports
          .filter((e) => e.projectId === projectId)
          .map((e) => ({ id: e.id, createdAt: toIsoString(e.createdAt) })),
        lastCorrectionAt: correctionAt ? toIsoString(correctionAt) : null,
        lastFileAddedAt: fileAt ? toIsoString(fileAt) : null,
      });
    }
    return out;
  }
}
