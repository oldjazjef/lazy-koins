import { defaultTaxCurrency } from '@lazykoins/engine';
import type {
  CreateProjectInput,
  Project,
  UpdateProjectInput,
} from '../domain/project';
import { ProjectRepositoryPort } from '../ports/project.repository.port';

/**
 * Port double for handler specs: a real implementation of the contract over a Map, not an ORM
 * mock. The Prisma adapter is held to the same contract by persistence.integration.spec.ts.
 */
export class InMemoryProjectRepository extends ProjectRepositoryPort {
  readonly rows = new Map<string, Project>();
  private seq = 0;
  private clock = Date.parse('2026-01-01T00:00:00.000Z');

  async findByOwner(ownerId: string): Promise<Project[]> {
    return [...this.rows.values()]
      .filter((project) => project.ownerId === ownerId)
      .sort(
        (a, b) =>
          b.taxYear - a.taxYear || b.createdAt.localeCompare(a.createdAt),
      );
  }

  async findByTaxYear(taxYear: number): Promise<Project[]> {
    return [...this.rows.values()]
      .filter((project) => project.taxYear === taxYear)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async findById(id: string): Promise<Project | undefined> {
    return this.rows.get(id);
  }

  async create(ownerId: string, input: CreateProjectInput): Promise<Project> {
    this.seq += 1;
    const now = this.tick();
    const project: Project = {
      id: `p${this.seq}`,
      ownerId,
      status: 'in_progress',
      ...input,
      taxCurrency: input.taxCurrency ?? defaultTaxCurrency(input.country),
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(project.id, project);
    return project;
  }

  async update(
    id: string,
    input: UpdateProjectInput,
  ): Promise<Project | undefined> {
    const existing = this.rows.get(id);
    if (!existing) return undefined;
    const changes = Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    );
    const updated: Project = {
      ...existing,
      ...changes,
      updatedAt: this.tick(),
    };
    this.rows.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.rows.delete(id);
  }

  private tick(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }
}
