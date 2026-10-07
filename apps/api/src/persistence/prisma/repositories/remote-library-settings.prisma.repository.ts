import { Injectable } from '@nestjs/common';
import type { RemoteLibrarySettings as RemoteLibrarySettingsRow } from '../../../generated/prisma/client';
import type {
  RemoteLibrarySettings,
  SaveRemoteLibrarySettings,
} from '../../../library/domain/remote-library';
import { RemoteLibrarySettingsRepositoryPort } from '../../../library/ports/remote-library-settings.repository.port';
import { toIsoString } from '../mappers/scalar.mapper';
import { PrismaService } from '../prisma.service';

function toSettings(row: RemoteLibrarySettingsRow): RemoteLibrarySettings {
  return {
    userId: row.userId,
    url: row.url,
    enabled: row.enabled,
    suggestions: row.suggestions,
    updatedAt: toIsoString(row.updatedAt),
  };
}

/** F5.18: the desktop's link to a web deployment's mapping library. */
@Injectable()
export class RemoteLibrarySettingsPrismaRepository extends RemoteLibrarySettingsRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async find(userId: string): Promise<RemoteLibrarySettings | null> {
    const row = await this.prisma.remoteLibrarySettings.findUnique({
      where: { userId },
    });
    return row ? toSettings(row) : null;
  }

  async save(
    userId: string,
    settings: SaveRemoteLibrarySettings,
  ): Promise<RemoteLibrarySettings> {
    const data = {
      url: settings.url,
      enabled: settings.enabled,
      suggestions: settings.suggestions,
    };
    const row = await this.prisma.remoteLibrarySettings.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return toSettings(row);
  }
}
