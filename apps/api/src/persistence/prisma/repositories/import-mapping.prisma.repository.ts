import { Injectable } from '@nestjs/common';
import {
  MAPPING_VERSION,
  mappingFingerprint,
  validateMappingSpec,
} from '@lazykoins/engine';
import type { ImportMapping as ImportMappingRow } from '../../../generated/prisma/client';
import type {
  ImportMapping,
  MappingOrigin,
  SaveMappingInput,
} from '../../../mappings/domain/import-mapping';
import { ImportMappingRepositoryPort } from '../../../mappings/ports/import-mapping.repository.port';
import { toIsoString } from '../mappers/scalar.mapper';
import { PrismaService } from '../prisma.service';

function toMapping(row: ImportMappingRow): ImportMapping {
  // Specs are validated before they are stored; a row that no longer validates (a manual edit
  // of the database) is a bug worth failing loudly on.
  const validation = validateMappingSpec(JSON.parse(row.spec));
  if (!validation.ok) {
    throw new Error(`Stored mapping ${row.id} does not validate`);
  }
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    platform: row.platform,
    spec: validation.spec,
    fingerprint: row.fingerprint,
    version: row.version,
    origin: row.origin as MappingOrigin,
    ...(row.libraryId !== null && row.libraryVersion !== null
      ? { library: { id: row.libraryId, version: row.libraryVersion } }
      : {}),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

function columns(input: SaveMappingInput) {
  return {
    name: input.spec.name,
    platform: input.spec.platform,
    spec: JSON.stringify(input.spec),
    fingerprint: mappingFingerprint(input.spec),
    version: MAPPING_VERSION,
    origin: input.origin,
    // An update without a reference keeps the stored one (an edited copy still names its source).
    ...(input.library !== undefined
      ? { libraryId: input.library.id, libraryVersion: input.library.version }
      : {}),
  };
}

@Injectable()
export class ImportMappingPrismaRepository extends ImportMappingRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findByOwner(ownerId: string): Promise<ImportMapping[]> {
    const rows = await this.prisma.importMapping.findMany({
      where: { ownerId },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toMapping);
  }

  async findById(id: string): Promise<ImportMapping | undefined> {
    const row = await this.prisma.importMapping.findUnique({ where: { id } });
    return row ? toMapping(row) : undefined;
  }

  async findByLibrary(
    ownerId: string,
    libraryId: string,
  ): Promise<ImportMapping[]> {
    const rows = await this.prisma.importMapping.findMany({
      where: { ownerId, libraryId },
      orderBy: [{ libraryVersion: 'desc' }, { id: 'asc' }],
    });
    return rows.map(toMapping);
  }

  async create(
    ownerId: string,
    input: SaveMappingInput,
  ): Promise<ImportMapping> {
    const row = await this.prisma.importMapping.create({
      data: { ownerId, ...columns(input) },
    });
    return toMapping(row);
  }

  async update(
    id: string,
    input: SaveMappingInput,
  ): Promise<ImportMapping | undefined> {
    const { count } = await this.prisma.importMapping.updateMany({
      where: { id },
      data: { ...columns(input), updatedAt: new Date() },
    });
    return count === 0 ? undefined : this.findById(id);
  }

  async delete(id: string): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.projectFile.updateMany({
        where: { mappingId: id },
        data: {
          status: 'needs_mapping',
          importerId: null,
          mappingId: null,
          platform: null,
          periodFrom: null,
          periodTo: null,
          bookingCount: 0,
          holdingCount: 0,
          errorCount: 0,
          coverage: '[]',
        },
      });
      await tx.importMapping.deleteMany({ where: { id } });
      return count;
    });
  }
}
