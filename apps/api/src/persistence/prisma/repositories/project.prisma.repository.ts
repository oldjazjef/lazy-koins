import { Injectable } from '@nestjs/common';
import type { Project as ProjectRow } from '../../../generated/prisma/client';
import type {
  CreateProjectInput,
  Project,
  UpdateProjectInput,
} from '../../../projects/domain/project';
import { ProjectRepositoryPort } from '../../../projects/ports/project.repository.port';
import { toIsoString } from '../mappers/scalar.mapper';
import { PrismaService } from '../prisma.service';

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    taxYear: row.taxYear,
    country: row.country,
    canton: row.canton,
    status: row.status,
    notes: row.notes,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

@Injectable()
export class ProjectPrismaRepository extends ProjectRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findByOwner(ownerId: string): Promise<Project[]> {
    const rows = await this.prisma.project.findMany({
      where: { ownerId },
      orderBy: [{ taxYear: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toProject);
  }

  async findByTaxYear(taxYear: number): Promise<Project[]> {
    const rows = await this.prisma.project.findMany({
      where: { taxYear },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toProject);
  }

  async findById(id: string): Promise<Project | undefined> {
    const row = await this.prisma.project.findUnique({ where: { id } });
    return row ? toProject(row) : undefined;
  }

  async create(ownerId: string, input: CreateProjectInput): Promise<Project> {
    const row = await this.prisma.project.create({
      data: { ownerId, ...input },
    });
    return toProject(row);
  }

  async update(
    id: string,
    input: UpdateProjectInput,
  ): Promise<Project | undefined> {
    const { count } = await this.prisma.project.updateMany({
      where: { id },
      data: {
        name: input.name,
        notes: input.notes,
        status: input.status,
        canton: input.canton,
        // Explicit (as in surf-lend): on SQLite an `updateMany` that changes no column reports 0
        // rows, and an empty PATCH would then read as "no such project".
        updatedAt: new Date(),
      },
    });
    return count === 0 ? undefined : this.findById(id);
  }

  /**
   * Deletes the project with its file entries, and — in the same transaction — every stored file
   * of the owner that no project references any more (F5.7).
   */
  async delete(id: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.findUnique({
        where: { id },
        select: { ownerId: true },
      });
      if (!project) return false;
      await tx.projectFile.deleteMany({ where: { projectId: id } });
      await tx.project.delete({ where: { id } });
      await tx.storedFile.deleteMany({
        where: { ownerId: project.ownerId, projectFiles: { none: {} } },
      });
      return true;
    });
  }
}
