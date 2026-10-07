import { Injectable } from '@nestjs/common';
import { isLocale } from '../../../common/i18n/locale';
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
import {
  type CoinChoices,
  parseCoinChoices,
} from '../../../rates/domain/coin-choice';
import { toIsoString } from '../mappers/scalar.mapper';
import { PrismaService } from '../prisma.service';

/** The stored JSON array of upper-case tickers. */
function parseSymbols(text: string): string[] {
  try {
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value)) return [];
    return [
      ...new Set(
        value
          .filter((v): v is string => typeof v === 'string')
          .map((v) => v.toUpperCase()),
      ),
    ].sort();
  } catch {
    return [];
  }
}

/** The stored JSON; also reads the older symbol → CoinGecko id shape. */
function parseChoices(text: string): CoinChoices {
  try {
    return parseCoinChoices(JSON.parse(text));
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
    locale: isLocale(row.locale) ? row.locale : null,
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
    coinChoices: parseChoices(row.coinChoices),
    coinDismissed: parseSymbols(row.coinDismissed),
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
      locale: input.locale,
      numberFormat: input.numberFormat,
      dateFormat: input.dateFormat,
      onlineRates: input.onlineRates,
      coingeckoKey: input.sealedKeys?.coingecko,
      etherscanKey: input.sealedKeys?.etherscan,
      coinChoices:
        input.coinChoices === undefined
          ? undefined
          : JSON.stringify(input.coinChoices),
      coinDismissed:
        input.coinDismissed === undefined
          ? undefined
          : JSON.stringify([...input.coinDismissed]),
    };
    const row = await this.prisma.userSettings.upsert({
      where: { userId },
      create: { userId, ...data },
      update: { ...data, updatedAt: new Date() },
    });
    return toSettings(row);
  }
}
