import { Injectable } from '@nestjs/common';
import type { CorrectionData, RecordSummary } from '@lazykoins/engine';
import type {
  CalculationSnapshot as SnapshotRow,
  Correction as CorrectionRow,
  OpenItemState as OpenItemStateRow,
} from '../../../generated/prisma/client';
import type {
  NewSnapshot,
  OpenItemState,
  ProjectFigures,
  Snapshot,
  SnapshotMeta,
  StoredCorrection,
  StoredResult,
} from '../../../calculation/domain/calculation';
import {
  CalculationSnapshotRepositoryPort,
  CorrectionRepositoryPort,
  OpenItemStateRepositoryPort,
} from '../../../calculation/ports/calculation.repository.port';
import { toIsoString } from '../mappers/scalar.mapper';
import { PrismaService } from '../prisma.service';

/** Snapshots kept per project: the latest is used; a few older ones help when comparing. */
const KEEP_SNAPSHOTS = 3;

function toMeta(row: Omit<SnapshotRow, 'result' | 'records'>): SnapshotMeta {
  return {
    id: row.id,
    projectId: row.projectId,
    inputHash: row.inputHash,
    engineVersion: row.engineVersion,
    wealthChf: row.wealthChf,
    incomeChf: row.incomeChf,
    createdAt: toIsoString(row.createdAt),
  };
}

const META_SELECT = {
  id: true,
  projectId: true,
  inputHash: true,
  engineVersion: true,
  wealthChf: true,
  incomeChf: true,
  createdAt: true,
} as const;

@Injectable()
export class CalculationSnapshotPrismaRepository extends CalculationSnapshotRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async save(projectId: string, snapshot: NewSnapshot): Promise<SnapshotMeta> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.calculationSnapshot.create({
        data: {
          projectId,
          inputHash: snapshot.inputHash,
          engineVersion: snapshot.engineVersion,
          result: JSON.stringify(snapshot.result),
          records: JSON.stringify(snapshot.records),
          wealthChf: snapshot.result.totals.wealthChf,
          incomeChf: snapshot.result.totals.incomeChf,
        },
        select: META_SELECT,
      });
      const old = await tx.calculationSnapshot.findMany({
        where: { projectId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: KEEP_SNAPSHOTS,
        select: { id: true },
      });
      if (old.length > 0) {
        await tx.calculationSnapshot.deleteMany({
          where: { id: { in: old.map((o) => o.id) } },
        });
      }
      return toMeta(row);
    });
  }

  async latest(projectId: string): Promise<Snapshot | undefined> {
    const row = await this.prisma.calculationSnapshot.findFirst({
      where: { projectId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { ...META_SELECT, result: true },
    });
    if (!row) return undefined;
    return {
      ...toMeta(row),
      // Snapshots of engine version ≤ 3 predate the tax currency (F4.1a): they are CHF.
      result: {
        currency: 'CHF',
        ...(JSON.parse(row.result) as object),
      } as StoredResult,
    };
  }

  async records(
    snapshotId: string,
  ): Promise<Readonly<Record<string, RecordSummary>> | undefined> {
    const row = await this.prisma.calculationSnapshot.findUnique({
      where: { id: snapshotId },
      select: { records: true },
    });
    return row
      ? (JSON.parse(row.records) as Record<string, RecordSummary>)
      : undefined;
  }

  async latestFigures(
    projectIds: readonly string[],
  ): Promise<ReadonlyMap<string, ProjectFigures>> {
    const out = new Map<string, ProjectFigures>();
    if (projectIds.length === 0) return out;
    const rows = await this.prisma.calculationSnapshot.findMany({
      where: { projectId: { in: [...projectIds] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        projectId: true,
        wealthChf: true,
        incomeChf: true,
        createdAt: true,
        inputHash: true,
        engineVersion: true,
      },
    });
    for (const row of rows) {
      if (out.has(row.projectId)) continue;
      out.set(row.projectId, {
        wealthChf: row.wealthChf,
        incomeChf: row.incomeChf,
        calculatedAt: toIsoString(row.createdAt),
        inputHash: row.inputHash,
        engineVersion: row.engineVersion,
      });
    }
    return out;
  }
}

function toCorrection(row: CorrectionRow): StoredCorrection {
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type as StoredCorrection['type'],
    data: JSON.parse(row.data) as CorrectionData,
    reason: row.reason,
    createdAt: toIsoString(row.createdAt),
    undoneAt: row.undoneAt ? toIsoString(row.undoneAt) : null,
  };
}

@Injectable()
export class CorrectionPrismaRepository extends CorrectionRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listByProject(projectId: string): Promise<StoredCorrection[]> {
    const rows = await this.prisma.correction.findMany({
      where: { projectId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toCorrection);
  }

  async findById(id: string): Promise<StoredCorrection | undefined> {
    const row = await this.prisma.correction.findUnique({ where: { id } });
    return row ? toCorrection(row) : undefined;
  }

  async create(
    projectId: string,
    input: { readonly data: CorrectionData; readonly reason: string },
  ): Promise<StoredCorrection> {
    const row = await this.prisma.correction.create({
      data: {
        projectId,
        type: input.data.type,
        data: JSON.stringify(input.data),
        reason: input.reason,
      },
    });
    return toCorrection(row);
  }

  async setUndone(
    id: string,
    undone: boolean,
  ): Promise<StoredCorrection | undefined> {
    const { count } = await this.prisma.correction.updateMany({
      where: { id },
      data: { undoneAt: undone ? new Date() : null },
    });
    return count === 0 ? undefined : this.findById(id);
  }
}

function toState(row: OpenItemStateRow): OpenItemState {
  return {
    itemKey: row.itemKey,
    done: row.done,
    note: row.note,
    updatedAt: toIsoString(row.updatedAt),
  };
}

@Injectable()
export class OpenItemStatePrismaRepository extends OpenItemStateRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listByProject(projectId: string): Promise<OpenItemState[]> {
    const rows = await this.prisma.openItemState.findMany({
      where: { projectId },
      orderBy: { itemKey: 'asc' },
    });
    return rows.map(toState);
  }

  async save(
    projectId: string,
    itemKey: string,
    changes: { readonly done?: boolean; readonly note?: string },
  ): Promise<OpenItemState> {
    const row = await this.prisma.openItemState.upsert({
      where: { projectId_itemKey: { projectId, itemKey } },
      create: {
        projectId,
        itemKey,
        done: changes.done ?? false,
        note: changes.note ?? '',
      },
      update: {
        done: changes.done,
        note: changes.note,
        updatedAt: new Date(),
      },
    });
    return toState(row);
  }
}
