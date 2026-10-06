import { Injectable } from '@nestjs/common';
import type { ProjectHintState as HintStateRow } from '../../../generated/prisma/client';
import type {
  HintState,
  StoredHintStatus,
} from '../../../files/domain/project-hint';
import { HintStateRepositoryPort } from '../../../files/ports/hint-state.repository.port';
import { toIsoString } from '../mappers/scalar.mapper';
import { PrismaService } from '../prisma.service';

function toState(row: HintStateRow): HintState {
  return {
    hintKey: row.hintKey,
    status: row.status as StoredHintStatus,
    note: row.note,
    updatedAt: toIsoString(row.updatedAt),
  };
}

@Injectable()
export class HintStatePrismaRepository extends HintStateRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listByProject(projectId: string): Promise<HintState[]> {
    const rows = await this.prisma.projectHintState.findMany({
      where: { projectId },
      orderBy: { hintKey: 'asc' },
    });
    return rows.map(toState);
  }

  async save(
    projectId: string,
    hintKey: string,
    state: { readonly status: StoredHintStatus; readonly note: string },
  ): Promise<HintState> {
    const row = await this.prisma.projectHintState.upsert({
      where: { projectId_hintKey: { projectId, hintKey } },
      create: { projectId, hintKey, status: state.status, note: state.note },
      update: {
        status: state.status,
        note: state.note,
        updatedAt: new Date(),
      },
    });
    return toState(row);
  }

  async remove(projectId: string, hintKey: string): Promise<void> {
    await this.prisma.projectHintState.deleteMany({
      where: { projectId, hintKey },
    });
  }
}
