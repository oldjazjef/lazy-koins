import type { HintState, StoredHintStatus } from '../domain/project-hint';
import { HintStateRepositoryPort } from '../ports/hint-state.repository.port';

/** Port double for handler specs — a real in-memory implementation, not an ORM mock. */
export class InMemoryHintStateRepository extends HintStateRepositoryPort {
  private readonly rows = new Map<string, HintState & { projectId: string }>();
  private tick = 0;

  async listByProject(projectId: string): Promise<HintState[]> {
    return [...this.rows.values()]
      .filter((row) => row.projectId === projectId)
      .sort((a, b) => (a.hintKey < b.hintKey ? -1 : 1))
      .map(({ projectId: _projectId, ...state }) => state);
  }

  async save(
    projectId: string,
    hintKey: string,
    state: { readonly status: StoredHintStatus; readonly note: string },
  ): Promise<HintState> {
    const saved = {
      projectId,
      hintKey,
      ...state,
      updatedAt: new Date(
        Date.UTC(2026, 0, 1, 0, 0, this.tick++),
      ).toISOString(),
    };
    this.rows.set(`${projectId}|${hintKey}`, saved);
    const { projectId: _projectId, ...result } = saved;
    return result;
  }

  async remove(projectId: string, hintKey: string): Promise<void> {
    this.rows.delete(`${projectId}|${hintKey}`);
  }
}
