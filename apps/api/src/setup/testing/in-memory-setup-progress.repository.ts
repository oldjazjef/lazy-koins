import type { SaveSetupProgressInput, SetupProgress } from '../domain/setup';
import { SetupProgressRepositoryPort } from '../ports/setup-progress.repository.port';

/** Port double for handler specs: a real implementation over a Map. */
export class InMemorySetupProgressRepository extends SetupProgressRepositoryPort {
  readonly rows = new Map<string, SetupProgress>();

  async find(userId: string): Promise<SetupProgress | undefined> {
    return this.rows.get(userId);
  }

  async save(
    userId: string,
    input: SaveSetupProgressInput,
  ): Promise<SetupProgress> {
    const row: SetupProgress = {
      userId,
      ...input,
      steps: { ...input.steps },
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    this.rows.set(userId, row);
    return row;
  }
}
