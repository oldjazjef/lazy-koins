import {
  defaultSettings,
  type UpdateSettingsInput,
  type UserSettings,
} from '../domain/user-settings';
import { UserSettingsRepositoryPort } from '../ports/user-settings.repository.port';

/** Port double for handler specs: a real implementation over a Map. */
export class InMemoryUserSettingsRepository extends UserSettingsRepositoryPort {
  readonly rows = new Map<string, UserSettings>();

  async find(userId: string): Promise<UserSettings | undefined> {
    return this.rows.get(userId);
  }

  async save(
    userId: string,
    input: UpdateSettingsInput,
  ): Promise<UserSettings> {
    const current = this.rows.get(userId) ?? defaultSettings(userId);
    const { sealedKeys, ...rest } = input;
    const changes = Object.fromEntries(
      Object.entries(rest).filter(([, value]) => value !== undefined),
    );
    const next: UserSettings = {
      ...current,
      ...changes,
      sealedKeys: { ...current.sealedKeys, ...(sealedKeys ?? {}) },
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    this.rows.set(userId, next);
    return next;
  }
}
