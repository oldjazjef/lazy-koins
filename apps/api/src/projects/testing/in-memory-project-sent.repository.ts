import type {
  ProjectChangeFacts,
  ProjectSentState,
  SaveProjectSentInput,
} from '../domain/project-sent';
import { ProjectSentRepositoryPort } from '../ports/project-sent.repository.port';

/**
 * Port double for handler specs: sent states over a Map. The change facts the Prisma adapter
 * reads from other tables are set by the test (`facts`).
 */
export class InMemoryProjectSentRepository extends ProjectSentRepositoryPort {
  readonly rows = new Map<string, ProjectSentState>();
  readonly facts = new Map<string, ProjectChangeFacts>();

  async find(projectId: string): Promise<ProjectSentState | undefined> {
    return this.rows.get(projectId);
  }

  async findMany(
    projectIds: readonly string[],
  ): Promise<ReadonlyMap<string, ProjectSentState>> {
    const out = new Map<string, ProjectSentState>();
    for (const id of projectIds) {
      const row = this.rows.get(id);
      if (row) out.set(id, row);
    }
    return out;
  }

  async save(
    projectId: string,
    input: SaveProjectSentInput,
  ): Promise<ProjectSentState> {
    const row: ProjectSentState = {
      projectId,
      ...input,
      exportIds: [...input.exportIds],
      updatedAt: input.sentAt,
    };
    this.rows.set(projectId, row);
    return row;
  }

  async remove(projectId: string): Promise<boolean> {
    return this.rows.delete(projectId);
  }

  async changeFacts(
    projectIds: readonly string[],
  ): Promise<ReadonlyMap<string, ProjectChangeFacts>> {
    const out = new Map<string, ProjectChangeFacts>();
    for (const id of projectIds) {
      const facts = this.facts.get(id);
      if (facts) out.set(id, facts);
    }
    return out;
  }
}
