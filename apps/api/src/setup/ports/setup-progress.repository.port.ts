import type { SaveSetupProgressInput, SetupProgress } from '../domain/setup';

/** Persistence contract for the setup wizard's progress (`setup_progress`, one row per user). */
export abstract class SetupProgressRepositoryPort {
  /** `undefined` before the first step change. */
  abstract find(userId: string): Promise<SetupProgress | undefined>;

  /** Creates or replaces the user's row. */
  abstract save(
    userId: string,
    input: SaveSetupProgressInput,
  ): Promise<SetupProgress>;
}
