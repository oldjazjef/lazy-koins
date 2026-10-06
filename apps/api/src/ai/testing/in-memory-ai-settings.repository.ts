import type { AiSettings, SaveAiSettingsInput } from '../domain/ai-settings';
import { AiSettingsRepositoryPort } from '../ports/ai-settings.repository.port';

/** Port double over a Map. */
export class InMemoryAiSettingsRepository extends AiSettingsRepositoryPort {
  readonly rows = new Map<string, AiSettings>();

  async find(userId: string): Promise<AiSettings | undefined> {
    return this.rows.get(userId);
  }

  async save(userId: string, input: SaveAiSettingsInput): Promise<AiSettings> {
    const row: AiSettings = {
      ...input,
      userId,
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    this.rows.set(userId, row);
    return row;
  }
}
