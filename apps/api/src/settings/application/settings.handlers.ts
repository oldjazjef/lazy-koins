import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import type { Env } from '../../config/env';
import {
  API_KEY_NAMES,
  type ApiKeyName,
  defaultSettings,
  keyHint,
  type UpdateSettingsInput,
  type UserSettings,
} from '../domain/user-settings';
import { UserSettingsRepositoryPort } from '../ports/user-settings.repository.port';
import { SecretBox } from './secret-box';

/** The SecretBox keyed by `SETTINGS_ENCRYPTION_KEY` (empty = keys cannot be stored). */
@Injectable()
export class SettingsSecrets {
  readonly box: SecretBox;

  constructor(config: ConfigService<Env, true>) {
    this.box = new SecretBox(
      config.get('SETTINGS_ENCRYPTION_KEY', { infer: true }) ?? '',
    );
  }
}

/** Settings as the API shows them: keys only as hints (F6.7), never the value. */
export interface SettingsView {
  readonly displayName: string;
  readonly canton: string;
  readonly advisorName: string;
  readonly advisorEmail: string;
  readonly numberFormat: UserSettings['numberFormat'];
  readonly dateFormat: UserSettings['dateFormat'];
  readonly onlineRates: boolean;
  readonly keys: Readonly<Record<ApiKeyName, string | null>>;
  readonly coingeckoIds: Readonly<Record<string, string>>;
  /** Whether keys can be stored at all (`SETTINGS_ENCRYPTION_KEY` set). */
  readonly keyStorageAvailable: boolean;
}

/** Settings with the keys opened, for the API's own use (rate lookups) — never returned. */
export interface ResolvedSettings extends UserSettings {
  readonly keys: Readonly<Partial<Record<ApiKeyName, string>>>;
}

/** Reads a user's settings for other slices (rates, exports). */
@Injectable()
export class SettingsReader {
  constructor(
    private readonly settings: UserSettingsRepositoryPort,
    private readonly secrets: SettingsSecrets,
  ) {}

  async resolve(userId: string): Promise<ResolvedSettings> {
    const stored =
      (await this.settings.find(userId)) ?? defaultSettings(userId);
    const keys: Partial<Record<ApiKeyName, string>> = {};
    for (const name of API_KEY_NAMES) {
      const sealed = stored.sealedKeys[name];
      const plain = sealed ? this.secrets.box.open(sealed) : undefined;
      if (plain) keys[name] = plain;
    }
    return { ...stored, keys };
  }

  async view(userId: string): Promise<SettingsView> {
    const resolved = await this.resolve(userId);
    return {
      displayName: resolved.displayName,
      canton: resolved.canton,
      advisorName: resolved.advisorName,
      advisorEmail: resolved.advisorEmail,
      numberFormat: resolved.numberFormat,
      dateFormat: resolved.dateFormat,
      onlineRates: resolved.onlineRates,
      keys: {
        coingecko: keyHint(resolved.keys.coingecko),
        etherscan: keyHint(resolved.keys.etherscan),
      },
      coingeckoIds: resolved.coingeckoIds,
      keyStorageAvailable: this.secrets.box.available,
    };
  }
}

export class GetSettingsQuery {
  constructor(readonly userId: string) {}
}

@QueryHandler(GetSettingsQuery)
export class GetSettingsHandler implements IQueryHandler<
  GetSettingsQuery,
  SettingsView
> {
  constructor(private readonly reader: SettingsReader) {}

  execute({ userId }: GetSettingsQuery): Promise<SettingsView> {
    return this.reader.view(userId);
  }
}

/** Plain keys as entered: a string stores it, `''` or `null` removes it, absent keeps it. */
export interface SettingsChanges extends Omit<
  UpdateSettingsInput,
  'sealedKeys'
> {
  readonly keys?: Partial<Record<ApiKeyName, string | null>>;
}

export class UpdateSettingsCommand {
  constructor(
    readonly userId: string,
    readonly changes: SettingsChanges,
  ) {}
}

/** F11.1–F11.3, F6.7: keys are sealed before they reach the database. */
@CommandHandler(UpdateSettingsCommand)
export class UpdateSettingsHandler implements ICommandHandler<
  UpdateSettingsCommand,
  SettingsView
> {
  constructor(
    private readonly settings: UserSettingsRepositoryPort,
    private readonly secrets: SettingsSecrets,
    private readonly reader: SettingsReader,
  ) {}

  async execute({
    userId,
    changes,
  }: UpdateSettingsCommand): Promise<SettingsView> {
    const { keys, ...rest } = changes;
    const sealedKeys: Partial<Record<ApiKeyName, string | null>> = {};
    for (const name of API_KEY_NAMES) {
      const value = keys?.[name];
      if (value === undefined) continue;
      const trimmed = value?.trim() ?? '';
      if (trimmed === '') {
        sealedKeys[name] = null;
        continue;
      }
      if (!this.secrets.box.available) {
        throw new ServiceUnavailableException(
          'API keys cannot be stored: SETTINGS_ENCRYPTION_KEY is not configured',
        );
      }
      sealedKeys[name] = this.secrets.box.seal(trimmed);
    }
    await this.settings.save(userId, {
      ...rest,
      displayName: rest.displayName?.trim(),
      advisorName: rest.advisorName?.trim(),
      advisorEmail: rest.advisorEmail?.trim(),
      sealedKeys,
    });
    return this.reader.view(userId);
  }
}
