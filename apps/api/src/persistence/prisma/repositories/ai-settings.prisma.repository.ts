import { Injectable } from '@nestjs/common';
import type {
  AiSettings,
  SaveAiSettingsInput,
} from '../../../ai/domain/ai-settings';
import { AiSettingsRepositoryPort } from '../../../ai/ports/ai-settings.repository.port';
import type { AiSettings as AiSettingsRow } from '../../../generated/prisma/client';
import type { AiProviderKind } from '../../../integrations/ai/ai-completion.port';
import { toIsoString } from '../mappers/scalar.mapper';
import { PrismaService } from '../prisma.service';

function toSettings(row: AiSettingsRow): AiSettings {
  return {
    userId: row.userId,
    enabled: row.enabled,
    provider: row.provider as AiProviderKind,
    baseUrl: row.baseUrl,
    model: row.model,
    apiKeyCipher: row.apiKeyCipher,
    apiKeyHint: row.apiKeyHint,
    consentAt: row.consentAt ? toIsoString(row.consentAt) : null,
    updatedAt: toIsoString(row.updatedAt),
  };
}

@Injectable()
export class AiSettingsPrismaRepository extends AiSettingsRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async find(userId: string): Promise<AiSettings | undefined> {
    const row = await this.prisma.aiSettings.findUnique({ where: { userId } });
    return row ? toSettings(row) : undefined;
  }

  async save(userId: string, input: SaveAiSettingsInput): Promise<AiSettings> {
    const data = {
      enabled: input.enabled,
      provider: input.provider,
      baseUrl: input.baseUrl,
      model: input.model,
      apiKeyCipher: input.apiKeyCipher,
      apiKeyHint: input.apiKeyHint,
      consentAt: input.consentAt ? new Date(input.consentAt) : null,
    };
    const row = await this.prisma.aiSettings.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return toSettings(row);
  }
}
