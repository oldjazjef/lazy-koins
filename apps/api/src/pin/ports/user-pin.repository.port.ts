import type { SaveUserPinInput, UserPin } from '../domain/pin';

/** Persistence contract for the PIN of a user (`user_pin`, one row per user). */
export abstract class UserPinRepositoryPort {
  /** `undefined` when the user has no PIN. */
  abstract find(userId: string): Promise<UserPin | undefined>;

  /** Creates or replaces the user's row. */
  abstract save(userId: string, input: SaveUserPinInput): Promise<UserPin>;

  /** Deletes the PIN; false when there was none. */
  abstract remove(userId: string): Promise<boolean>;
}
