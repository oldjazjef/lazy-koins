import type { AiSettings, SaveAiSettingsInput } from '../domain/ai-settings';

/** Persistence contract for the per-user AI settings (`ai_settings`, one row per user). */
export abstract class AiSettingsRepositoryPort {
  /** `undefined` when the user never saved any. */
  abstract find(userId: string): Promise<AiSettings | undefined>;

  /** Creates or replaces the user's row. */
  abstract save(
    userId: string,
    input: SaveAiSettingsInput,
  ): Promise<AiSettings>;
}
