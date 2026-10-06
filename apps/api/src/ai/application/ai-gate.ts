import {
  BadGatewayException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { SecretBox } from '../../common/crypto/secret-box';
import {
  type AiConnection,
  AiProviderError,
} from '../../integrations/ai/ai-completion.port';
import { checkBaseUrl } from '../domain/base-url';
import {
  aiReady,
  type AiSettings,
  defaultAiSettings,
} from '../domain/ai-settings';
import { AiSettingsRepositoryPort } from '../ports/ai-settings.repository.port';

/** Process-wide AI options from the environment (bound in `AiModule`). */
export class AiRuntime {
  constructor(
    readonly box: SecretBox,
    /** `AI_ALLOW_PRIVATE_URLS` resolved (`config/env.ts`, `aiPrivateUrlsAllowed`). */
    readonly allowPrivateUrls: boolean,
  ) {}
}

/** Stable codes of the AI plugin's 409/422 answers; the app translates `ai.errors.<code>`. */
export const AI_STATE_CODES = [
  'aiDisabled',
  'aiNotConfigured',
  'consentRequired',
  'keyUnreadable',
  'privateUrl',
  'invalidUrl',
  'encryptionUnavailable',
  'noText',
] as const;
export type AiStateCode = (typeof AI_STATE_CODES)[number];

export function aiConflict(
  code: AiStateCode,
  message: string,
): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message,
    code,
  });
}

/** Unsaved values from the settings form, for testing before saving. */
export interface AiConnectionDraft {
  readonly provider: AiSettings['provider'];
  readonly baseUrl: string;
  readonly model: string;
  /** Typed into the form; omitted = use the saved key, "" = test without a key. */
  readonly apiKey?: string;
}

/**
 * The gate every AI request passes: the plugin is on and configured, the user has consented
 * (F5.14 — the first use records the consent, every use shows the payload first), the key is
 * decrypted only here and only for the call.
 */
@Injectable()
export class AiGate {
  private readonly logger = new Logger(AiGate.name);

  constructor(
    private readonly settings: AiSettingsRepositoryPort,
    private readonly runtime: AiRuntime,
  ) {}

  async settingsOf(userId: string): Promise<AiSettings> {
    return (await this.settings.find(userId)) ?? defaultAiSettings(userId);
  }

  /** The connection for a request that sends user data; records the first consent. */
  async connect(userId: string, consent: boolean): Promise<AiConnection> {
    const settings = await this.settingsOf(userId);
    const connection = this.connectionOf(settings);
    if (!settings.consentAt) {
      if (!consent) {
        throw aiConflict(
          'consentRequired',
          'Agree to sending the shown excerpt to the AI provider first',
        );
      }
      const { userId: _id, updatedAt: _at, ...rest } = settings;
      await this.settings.save(userId, {
        ...rest,
        consentAt: new Date().toISOString(),
      });
    }
    return connection;
  }

  /** The connection from saved settings, or the 409 that says what is missing. */
  connectionOf(settings: AiSettings): AiConnection {
    if (!settings.enabled) {
      throw aiConflict('aiDisabled', 'The AI plugin is switched off');
    }
    if (!aiReady(settings)) {
      throw aiConflict(
        'aiNotConfigured',
        'Set the AI provider (address, model, key) in the settings first',
      );
    }
    const urlProblem = checkBaseUrl(
      settings.baseUrl,
      this.runtime.allowPrivateUrls,
    );
    if (urlProblem) {
      throw aiConflict(urlProblem, 'The provider address is not allowed');
    }
    let apiKey: string | undefined;
    if (settings.apiKeyCipher) {
      apiKey = this.runtime.box.open(settings.apiKeyCipher);
      if (apiKey === undefined) {
        throw aiConflict(
          'keyUnreadable',
          'The stored API key cannot be decrypted (SETTINGS_ENCRYPTION_KEY changed?) — enter it again',
        );
      }
    }
    return {
      kind: settings.provider,
      baseUrl: settings.baseUrl,
      model: settings.model,
      ...(apiKey ? { apiKey } : {}),
    };
  }

  /**
   * The connection for the settings page's "Verbindung testen": the saved settings overlaid with
   * the form's unsaved values, so testing never requires saving first. The on/off switch is
   * ignored (a test sends no user data) and a key typed into the form is used as is, never
   * stored; without one the saved key is used.
   */
  connectionForTest(
    saved: AiSettings,
    draft?: AiConnectionDraft,
  ): AiConnection {
    const typedKey = draft?.apiKey?.trim() ?? '';
    const settings: AiSettings = {
      ...saved,
      ...(draft
        ? {
            provider: draft.provider,
            baseUrl: draft.baseUrl,
            model: draft.model,
          }
        : {}),
      enabled: true,
      ...(draft?.apiKey === '' ? { apiKeyCipher: null } : {}),
    };
    if (typedKey === '') return this.connectionOf(settings);
    const urlProblem = checkBaseUrl(
      settings.baseUrl,
      this.runtime.allowPrivateUrls,
    );
    if (urlProblem) {
      throw aiConflict(urlProblem, 'The provider address is not allowed');
    }
    return {
      kind: settings.provider,
      baseUrl: settings.baseUrl,
      model: settings.model,
      apiKey: typedKey,
    };
  }

  /** Runs a provider call; its failure becomes a 502 with the error code for the app. */
  async call<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof AiProviderError) {
        this.logger.warn(
          `AI provider call failed: ${error.code}${error.status ? ` (${error.status})` : ''}`,
        );
        throw new BadGatewayException({
          statusCode: 502,
          error: 'Bad Gateway',
          message: 'The AI provider did not answer usefully',
          code: error.code,
        });
      }
      throw error;
    }
  }
}
