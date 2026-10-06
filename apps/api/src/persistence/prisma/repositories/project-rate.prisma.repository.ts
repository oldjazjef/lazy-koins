import { Injectable } from '@nestjs/common';
import type { RateEntry } from '@lazykoins/engine';
import type { ProjectRate as ProjectRateRow } from '../../../generated/prisma/client';
import type { ProjectRate, RateKey } from '../../../rates/domain/project-rate';
import { ProjectRateRepositoryPort } from '../../../rates/ports/project-rate.repository.port';
import { toIsoString } from '../mappers/scalar.mapper';
import { PrismaService } from '../prisma.service';

function toRate(row: ProjectRateRow): ProjectRate {
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind as ProjectRate['kind'],
    asset: row.asset,
    currency: row.currency as ProjectRate['currency'],
    date: row.date,
    value: row.value,
    source: row.source as ProjectRate['source'],
    fetchedAt: toIsoString(row.fetchedAt),
  };
}

/** Rows per transaction when storing a fetched series. */
const CHUNK = 500;

@Injectable()
export class ProjectRatePrismaRepository extends ProjectRateRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listByProject(projectId: string): Promise<ProjectRate[]> {
    const rows = await this.prisma.projectRate.findMany({
      where: { projectId },
      orderBy: [
        { kind: 'asc' },
        { asset: 'asc' },
        { currency: 'asc' },
        { date: 'asc' },
        { source: 'asc' },
      ],
    });
    return rows.map(toRate);
  }

  async upsertMany(
    projectId: string,
    entries: readonly RateEntry[],
  ): Promise<number> {
    for (let start = 0; start < entries.length; start += CHUNK) {
      const chunk = entries.slice(start, start + CHUNK);
      await this.prisma.$transaction(
        chunk.map((entry) =>
          this.prisma.projectRate.upsert({
            where: {
              projectId_kind_asset_currency_date_source: {
                projectId,
                kind: entry.kind,
                asset: entry.asset,
                currency: entry.currency,
                date: entry.date,
                source: entry.source,
              },
            },
            create: { projectId, ...entry },
            update: { value: entry.value, fetchedAt: new Date() },
          }),
        ),
      );
    }
    return entries.length;
  }

  async delete(projectId: string, key: RateKey): Promise<boolean> {
    const { count } = await this.prisma.projectRate.deleteMany({
      where: { projectId, ...key },
    });
    return count > 0;
  }
}
