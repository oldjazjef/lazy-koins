import {
  BadGatewayException,
  ConflictException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { SecretBox } from '../../common/crypto/secret-box';
import { NotificationService } from '../../notifications/application/notification.service';
import { Topics } from '../../notifications/domain/notification';
import {
  type AiConnection,
  type AiErrorDetails,
  AiProviderError,
} from '../../integrations/ai/ai-completion.port';
import {
  redactDetails,
  redactSecrets,
  safeUrl,
} from '../../integrations/ai/redact';
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

/** `detail`: what exactly is missing or refused, readable by a human (shown in the app). */
export function aiConflict(
  code: AiStateCode,
  message: string,
  detail?: string,
): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message,
    code,
    ...(detail ? { detail: redactSecrets(detail) } : {}),
  });
}

/** What `aiReady` found missing, for the 409's detail. */
function missingSetup(settings: AiSettings): string {
  if (settings.provider === 'anthropic') {
    return 'Anthropic needs an API key — none is stored.';
  }
  return 'OpenAI needs an API key; a local or other OpenAI-compatible server needs its address (base URL). Neither is set.';
}

function urlDetail(problem: 'invalidUrl' | 'privateUrl', baseUrl: string) {
  const shown = safeUrl(baseUrl);
  return problem === 'privateUrl'
    ? `${shown} is a private or local address; this server only calls public providers (AI_ALLOW_PRIVATE_URLS is off).`
    : `${shown || '(empty)'} is not an http(s) URL without user info, query or fragment.`;
}

/** One line for the toast and the log: "HTTP 401 · POST https://… · gpt-4.1 · invalid_api_key: …". */
export function describeAiFailure(
  code: string,
  details: AiErrorDetails,
): string {
  const parts = [
    details.status !== undefined ? `HTTP ${details.status}` : undefined,
    details.url,
    details.model ? `model ${details.model}` : undefined,
    [details.providerType, details.providerCode]
      .filter((part) => part)
      .join('/') || undefined,
    details.providerMessage,
    details.cause,
  ].filter((part): part is string => !!part);
  return parts.length > 0 ? `${code}: ${parts.join(' · ')}` : code;
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
    @Optional() private readonly notifications?: NotificationService,
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
          'The first AI request needs consent: tick the box under the shown excerpt (it is stored and can be withdrawn under Einstellungen → AI).',
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
      throw aiConflict(
        'aiDisabled',
        'The AI plugin is switched off',
        'Switch it on under Einstellungen → AI ("AI-Plugin verwenden") and save.',
      );
    }
    if (!aiReady(settings)) {
      throw aiConflict(
        'aiNotConfigured',
        'Set the AI provider (address, model, key) in the settings first',
        missingSetup(settings),
      );
    }
    const urlProblem = checkBaseUrl(
      settings.baseUrl,
      this.runtime.allowPrivateUrls,
    );
    if (urlProblem) {
      throw aiConflict(
        urlProblem,
        'The provider address is not allowed',
        urlDetail(urlProblem, settings.baseUrl),
      );
    }
    let apiKey: string | undefined;
    if (settings.apiKeyCipher) {
      apiKey = this.runtime.box.open(settings.apiKeyCipher);
      if (apiKey === undefined) {
        throw aiConflict(
          'keyUnreadable',
          'The stored API key cannot be decrypted (SETTINGS_ENCRYPTION_KEY changed?) — enter it again',
          `The key ${settings.apiKeyHint ?? ''} was sealed with another SETTINGS_ENCRYPTION_KEY than the server has now. Enter the key again and save.`,
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
      throw aiConflict(
        urlProblem,
        'The provider address is not allowed',
        urlDetail(urlProblem, settings.baseUrl),
      );
    }
    return {
      kind: settings.provider,
      baseUrl: settings.baseUrl,
      model: settings.model,
      apiKey: typedKey,
    };
  }

  /**
   * Runs a provider call; its failure becomes a 502 with the error code for the app plus the
   * redacted details (`status`, `providerMessage`, `providerType`, `providerCode`, `url`,
   * `model`, `cause`, `timeoutMs`, a one-line `detail`) — logged the same way at warn level.
   * `connection` lets the key be redacted once more, whatever the adapter missed.
   *
   * `context` (F11.12): whose call it was — a failure becomes "AI-Aufruf fehlgeschlagen" (code
   * and HTTP status, never the key or the provider's text) and a 401/403 "Schlüssel prüfen"; a
   * success resolves both. A connection test (`test`) only resolves: its failure is on screen.
   */
  async call<T>(
    work: () => Promise<T>,
    connection?: AiConnection,
    context?: { readonly userId: string; readonly test?: boolean },
  ): Promise<T> {
    try {
      const result = await work();
      if (context && this.notifications) {
        await this.notifications.resolve(context.userId, [
          Topics.aiCallFailed(),
          Topics.keyInvalid('ai'),
        ]);
      }
      return result;
    } catch (error) {
      if (error instanceof AiProviderError) {
        if (context && !context.test && this.notifications) {
          await this.notifyFailure(
            context.userId,
            error.code,
            error.details.status,
          );
        }
        const details = redactDetails(
          {
            ...(connection
              ? { model: connection.model || undefined }
              : undefined),
            ...error.details,
          },
          [connection?.apiKey],
        );
        const detail = redactSecrets(describeAiFailure(error.code, details), [
          connection?.apiKey,
        ]);
        this.logger.warn(`AI provider call failed: ${detail}`);
        throw new BadGatewayException({
          statusCode: 502,
          error: 'Bad Gateway',
          message: 'The AI provider did not answer usefully',
          code: error.code,
          detail,
          ...details,
        });
      }
      throw error;
    }
  }

  private async notifyFailure(
    userId: string,
    code: string,
    status: number | undefined,
  ): Promise<void> {
    const settings = {
      labelKey: 'notifications.action.checkSettings',
      route: '/app/settings/ai',
    };
    await this.notifications?.raise(userId, Topics.aiCallFailed(), {
      kind: 'error',
      params: { code, status: status ?? null },
      action: settings,
    });
    if (code === 'invalidKey') {
      await this.notifications?.raise(userId, Topics.keyInvalid('ai'), {
        kind: 'action',
        params: { service: 'AI' },
        action: { ...settings, labelKey: 'notifications.action.checkKey' },
      });
    }
  }
}
