import type { SaveUserPinInput, UserPin } from '../domain/pin';
import { UserPinRepositoryPort } from '../ports/user-pin.repository.port';

/** Port double for handler specs: a real implementation over a Map. */
export class InMemoryUserPinRepository extends UserPinRepositoryPort {
  readonly rows = new Map<string, UserPin>();

  async find(userId: string): Promise<UserPin | undefined> {
    return this.rows.get(userId);
  }

  async save(userId: string, input: SaveUserPinInput): Promise<UserPin> {
    const row: UserPin = {
      userId,
      ...input,
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    this.rows.set(userId, row);
    return row;
  }

  async remove(userId: string): Promise<boolean> {
    return this.rows.delete(userId);
  }
}
