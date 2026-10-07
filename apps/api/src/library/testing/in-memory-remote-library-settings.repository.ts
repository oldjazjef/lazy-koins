import type {
  RemoteLibrarySettings,
  SaveRemoteLibrarySettings,
} from '../domain/remote-library';
import { RemoteLibrarySettingsRepositoryPort } from '../ports/remote-library-settings.repository.port';

/** Port double for handler specs (F5.18). */
export class InMemoryRemoteLibrarySettingsRepository extends RemoteLibrarySettingsRepositoryPort {
  private readonly rows = new Map<string, RemoteLibrarySettings>();

  find(userId: string): Promise<RemoteLibrarySettings | null> {
    return Promise.resolve(this.rows.get(userId) ?? null);
  }

  save(
    userId: string,
    settings: SaveRemoteLibrarySettings,
  ): Promise<RemoteLibrarySettings> {
    const row: RemoteLibrarySettings = {
      userId,
      ...settings,
      updatedAt: new Date(0).toISOString(),
    };
    this.rows.set(userId, row);
    return Promise.resolve(row);
  }
}
