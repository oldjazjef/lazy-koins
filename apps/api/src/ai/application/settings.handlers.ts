import { UnprocessableEntityException } from '@nestjs/common';
import {
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import { secretHint } from '../../common/crypto/secret-box';
import {
  AiCompletionPort,
  type AiProviderKind,
  type AiUsage,
} from '../../integrations/ai/ai-completion.port';
import { aiReady, type AiSettings } from '../domain/ai-settings';
import { checkBaseUrl } from '../domain/base-url';
import { AiSettingsRepositoryPort } from '../ports/ai-settings.repository.port';
import { AiGate, AiRuntime, type AiConnectionDraft } from './ai-gate';

/** The settings as the app sees them — never the key, only its hint. */
export interface AiSettingsView {
  readonly enabled: boolean;
  readonly provider: AiProviderKind;
  readonly baseUrl: string;
  readonly model: string;
  readonly hasApiKey: boolean;
  readonly apiKeyHint: string | null;
  readonly consentAt: string | null;
  /** On and configured: the AI buttons work. */
  readonly ready: boolean;
  /** False without SETTINGS_ENCRYPTION_KEY: a key cannot be saved. */
  readonly canStoreKey: boolean;
  /** Private/loopback provider addresses (local Ollama) are allowed on this server. */
  readonly privateUrlsAllowed: boolean;
}

export function settingsView(
  settings: AiSettings,
  runtime: AiRuntime,
): AiSettingsView {
  return {
    enabled: settings.enabled,
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
    hasApiKey: settings.apiKeyCipher !== null,
    apiKeyHint: settings.apiKeyHint,
    consentAt: settings.consentAt,
    ready: aiReady(settings),
    canStoreKey: runtime.box.available,
    privateUrlsAllowed: runtime.allowPrivateUrls,
  };
}

export class GetAiSettingsQuery {
  constructor(readonly userId: string) {}
}

@QueryHandler(GetAiSettingsQuery)
export class GetAiSettingsHandler implements IQueryHandler<
  GetAiSettingsQuery,
  AiSettingsView
> {
  constructor(
    private readonly gate: AiGate,
    private readonly runtime: AiRuntime,
  ) {}

  async execute({ userId }: GetAiSettingsQuery): Promise<AiSettingsView> {
    return settingsView(await this.gate.settingsOf(userId), this.runtime);
  }
}

export interface SaveAiSettingsInput {
  readonly enabled: boolean;
  readonly provider: AiProviderKind;
  readonly baseUrl: string;
  readonly model: string;
  /** `undefined` keeps the stored key, `''` removes it, anything else replaces it. */
  readonly apiKey?: string;
  /** `true` withdraws the consent (F5.14): the next request asks again. */
  readonly revokeConsent?: boolean;
}

export class SaveAiSettingsCommand {
  constructor(
    readonly userId: string,
    readonly input: SaveAiSettingsInput,
  ) {}
}

/** F5.13: provider, address, model, key (sealed with AES-256-GCM), on/off. */
@CommandHandler(SaveAiSettingsCommand)
export class SaveAiSettingsHandler implements ICommandHandler<
  SaveAiSettingsCommand,
  AiSettingsView
> {
  constructor(
    private readonly settings: AiSettingsRepositoryPort,
    private readonly gate: AiGate,
    private readonly runtime: AiRuntime,
  ) {}

  async execute({
    userId,
    input,
  }: SaveAiSettingsCommand): Promise<AiSettingsView> {
    const current = await this.gate.settingsOf(userId);
    const baseUrl = input.baseUrl.trim().replace(/\/+$/, '');
    const problem = checkBaseUrl(baseUrl, this.runtime.allowPrivateUrls);
    if (problem) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message:
          problem === 'privateUrl'
            ? 'Private or local addresses are not allowed on this server'
            : 'The address must be an http(s) URL',
        code: problem,
      });
    }
    let apiKeyCipher = current.apiKeyCipher;
    let apiKeyHint = current.apiKeyHint;
    const key = input.apiKey?.trim();
    if (key === '') {
      apiKeyCipher = null;
      apiKeyHint = null;
    } else if (key !== undefined) {
      if (!this.runtime.box.available) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          error: 'Unprocessable Entity',
          message:
            'API keys cannot be stored: SETTINGS_ENCRYPTION_KEY is not set on the server',
          code: 'encryptionUnavailable',
        });
      }
      apiKeyCipher = this.runtime.box.seal(key);
      apiKeyHint = secretHint(key);
    }
    const saved = await this.settings.save(userId, {
      enabled: input.enabled,
      provider: input.provider,
      baseUrl,
      model: input.model.trim(),
      apiKeyCipher,
      apiKeyHint,
      consentAt: input.revokeConsent ? null : current.consentAt,
    });
    return settingsView(saved, this.runtime);
  }
}

export class TestAiConnectionCommand {
  constructor(
    readonly userId: string,
    /** The form's unsaved values; absent = test the saved settings. */
    readonly draft?: AiConnectionDraft,
  ) {}
}

export interface AiConnectionTest {
  readonly ok: true;
  readonly model: string;
  readonly usage: AiUsage | null;
  readonly millis: number;
}

/**
 * Sends one tiny request **without user data** with the saved settings, or the form's unsaved
 * values overlaid on them: proves the address,
 * the key and structured output work. No consent needed (nothing of the user's is sent).
 */
@CommandHandler(TestAiConnectionCommand)
export class TestAiConnectionHandler implements ICommandHandler<
  TestAiConnectionCommand,
  AiConnectionTest
> {
  constructor(
    private readonly gate: AiGate,
    private readonly ai: AiCompletionPort,
  ) {}

  async execute({
    userId,
    draft,
  }: TestAiConnectionCommand): Promise<AiConnectionTest> {
    const connection = this.gate.connectionForTest(
      await this.gate.settingsOf(userId),
      draft,
    );
    const started = Date.now();
    const answer = await this.gate.call(() =>
      this.ai.complete(connection, {
        system:
          'This is a connection test. Answer with the JSON object {"ok": true}.',
        messages: [{ role: 'user', content: 'Connection test.' }],
        output: {
          name: 'connection_test',
          description: 'Confirms the connection works.',
          schema: {
            type: 'object',
            properties: { ok: { type: 'boolean' } },
            required: ['ok'],
          },
        },
        maxTokens: 50,
        timeoutMs: 30_000,
      }),
    );
    return {
      ok: true,
      model: answer.model,
      usage: answer.usage ?? null,
      millis: Date.now() - started,
    };
  }
}
