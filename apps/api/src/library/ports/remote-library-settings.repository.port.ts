import type {
  RemoteLibrarySettings,
  SaveRemoteLibrarySettings,
} from '../domain/remote-library';

/**
 * F5.18 (desktop): the link to a web deployment's mapping library, one row per user. No row =
 * not linked (`defaultRemoteLibrarySettings`). The Prisma binding lives in `PersistenceModule`.
 */
export abstract class RemoteLibrarySettingsRepositoryPort {
  abstract find(userId: string): Promise<RemoteLibrarySettings | null>;

  abstract save(
    userId: string,
    settings: SaveRemoteLibrarySettings,
  ): Promise<RemoteLibrarySettings>;
}
