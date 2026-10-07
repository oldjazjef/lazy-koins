import { Injectable } from '@nestjs/common';
import type {
  EstvCheck as EstvCheckRow,
  EstvKursliste as EstvKurslisteRow,
  EstvRate as EstvRateRow,
} from '../../../generated/prisma/client';
import type {
  EstvCheck,
  EstvRate,
  EstvVersion,
} from '../../../rates/domain/estv';
import { EstvKurslisteRepositoryPort } from '../../../rates/ports/estv.port';
import { toIsoString } from '../mappers/scalar.mapper';
import { PrismaService } from '../prisma.service';

function toVersion(row: EstvKurslisteRow): EstvVersion {
  return {
    year: row.year,
    exportType: row.exportType,
    exportDate: toIsoString(row.exportDate),
    fileHash: row.fileHash,
    fileName: row.fileName,
    schemaVersion: row.schemaVersion,
    downloadedAt: toIsoString(row.downloadedAt),
    entryCount: row.entryCount,
    cryptoCount: row.cryptoCount,
  };
}

function toRate(row: EstvRateRow): EstvRate {
  return {
    kind: row.kind as EstvRate['kind'],
    ictaxId: row.ictaxId,
    symbol: row.symbol,
    name: row.name,
    valorNumber: row.valorNumber,
    isin: row.isin,
    value: row.value,
  };
}

function toCheck(row: EstvCheckRow): EstvCheck {
  return {
    year: row.year,
    checkedAt: toIsoString(row.checkedAt),
    outcome: row.outcome as EstvCheck['outcome'],
    error: row.error,
  };
}

/** The deployment-wide ESTV Kursliste (F7.4a): one version per year, its values, the checks. */
@Injectable()
export class EstvKurslistePrismaRepository extends EstvKurslisteRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listVersions(): Promise<EstvVersion[]> {
    const rows = await this.prisma.estvKursliste.findMany({
      orderBy: { year: 'desc' },
    });
    return rows.map(toVersion);
  }

  async findVersion(year: number): Promise<EstvVersion | undefined> {
    const row = await this.prisma.estvKursliste.findUnique({ where: { year } });
    return row ? toVersion(row) : undefined;
  }

  async listRates(year: number): Promise<EstvRate[]> {
    const rows = await this.prisma.estvRate.findMany({
      where: { year },
      orderBy: [{ kind: 'asc' }, { symbol: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toRate);
  }

  async replaceYear(
    version: EstvVersion,
    rates: readonly EstvRate[],
  ): Promise<void> {
    const data = {
      exportType: version.exportType,
      exportDate: new Date(version.exportDate),
      fileHash: version.fileHash,
      fileName: version.fileName,
      schemaVersion: version.schemaVersion,
      downloadedAt: new Date(version.downloadedAt),
      entryCount: version.entryCount,
      cryptoCount: version.cryptoCount,
    };
    await this.prisma.$transaction([
      this.prisma.estvRate.deleteMany({ where: { year: version.year } }),
      this.prisma.estvKursliste.upsert({
        where: { year: version.year },
        create: { year: version.year, ...data },
        update: data,
      }),
      this.prisma.estvRate.createMany({
        data: rates.map((rate) => ({ year: version.year, ...rate })),
      }),
    ]);
  }

  async listChecks(): Promise<EstvCheck[]> {
    const rows = await this.prisma.estvCheck.findMany({
      orderBy: { year: 'desc' },
    });
    return rows.map(toCheck);
  }

  async saveCheck(check: EstvCheck): Promise<void> {
    const data = {
      checkedAt: new Date(check.checkedAt),
      outcome: check.outcome,
      error: check.error,
    };
    await this.prisma.estvCheck.upsert({
      where: { year: check.year },
      create: { year: check.year, ...data },
      update: data,
    });
  }
}
