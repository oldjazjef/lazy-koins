import type {
  UpdateSettingsInput,
  UserSettings,
} from '../domain/user-settings';

/** Persistence contract for user settings; the Prisma binding lives in `PersistenceModule`. */
export abstract class UserSettingsRepositoryPort {
  /** The stored settings, or `undefined` before the first save. */
  abstract find(userId: string): Promise<UserSettings | undefined>;

  /** Creates or updates the row; fields absent from `input` keep their value. */
  abstract save(
    userId: string,
    input: UpdateSettingsInput,
  ): Promise<UserSettings>;
}
