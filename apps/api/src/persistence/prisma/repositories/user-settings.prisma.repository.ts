import { Injectable } from '@nestjs/common';
import type { UserSettings as UserSettingsRow } from '../../../generated/prisma/client';
import {
  DATE_FORMATS,
  type DateFormat,
  NUMBER_FORMATS,
  type NumberFormat,
  type UpdateSettingsInput,
  type UserSettings,
} from '../../../settings/domain/user-settings';
import { UserSettingsRepositoryPort } from '../../../settings/ports/user-settings.repository.port';
import { toIsoString } from '../mappers/scalar.mapper';
import { PrismaService } from '../prisma.service';

function parseIds(text: string): Record<string, string> {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  } catch {
    return {};
  }
}

function toSettings(row: UserSettingsRow): UserSettings {
  return {
    userId: row.userId,
    displayName: row.displayName,
    canton: row.canton,
    advisorName: row.advisorName,
    advisorEmail: row.advisorEmail,
    numberFormat: (NUMBER_FORMATS as readonly string[]).includes(
      row.numberFormat,
    )
      ? (row.numberFormat as NumberFormat)
      : 'de-CH',
    dateFormat: (DATE_FORMATS as readonly string[]).includes(row.dateFormat)
      ? (row.dateFormat as DateFormat)
      : 'dd.MM.yyyy',
    onlineRates: row.onlineRates,
    sealedKeys: { coingecko: row.coingeckoKey, etherscan: row.etherscanKey },
    coingeckoIds: parseIds(row.coingeckoIds),
    updatedAt: toIsoString(row.updatedAt),
  };
}

@Injectable()
export class UserSettingsPrismaRepository extends UserSettingsRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async find(userId: string): Promise<UserSettings | undefined> {
    const row = await this.prisma.userSettings.findUnique({
      where: { userId },
    });
    return row ? toSettings(row) : undefined;
  }

  async save(
    userId: string,
    input: UpdateSettingsInput,
  ): Promise<UserSettings> {
    const data = {
      displayName: input.displayName,
      canton: input.canton,
      advisorName: input.advisorName,
      advisorEmail: input.advisorEmail,
      numberFormat: input.numberFormat,
      dateFormat: input.dateFormat,
      onlineRates: input.onlineRates,
      coingeckoKey: input.sealedKeys?.coingecko,
      etherscanKey: input.sealedKeys?.etherscan,
      coingeckoIds:
        input.coingeckoIds === undefined
          ? undefined
          : JSON.stringify(input.coingeckoIds),
    };
    const row = await this.prisma.userSettings.upsert({
      where: { userId },
      create: { userId, ...data },
      update: { ...data, updatedAt: new Date() },
    });
    return toSettings(row);
  }
}
