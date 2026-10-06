import type { AiProviderKind } from '../../integrations/ai/ai-completion.port';

/**
 * A user's AI plugin settings (F5.13, F5.14) — hand-written domain type, never a Prisma model.
 * The key is held only sealed (`apiKeyCipher`, AES-256-GCM); the API returns `apiKeyHint`.
 */
export interface AiSettings {
  readonly userId: string;
  readonly enabled: boolean;
  readonly provider: AiProviderKind;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKeyCipher: string | null;
  readonly apiKeyHint: string | null;
  /** F5.14: first consent to sending file excerpts; null = not given yet. */
  readonly consentAt: string | null;
  readonly updatedAt: string | null;
}

/** What a user who never saved anything has. */
export function defaultAiSettings(userId: string): AiSettings {
  return {
    userId,
    enabled: false,
    provider: 'openai_compatible',
    baseUrl: '',
    model: '',
    apiKeyCipher: null,
    apiKeyHint: null,
    consentAt: null,
    updatedAt: null,
  };
}

export type SaveAiSettingsInput = Omit<AiSettings, 'userId' | 'updatedAt'>;

/**
 * Whether the plugin can be used: switched on and pointed somewhere. OpenAI's own API and
 * Anthropic need a key; a custom OpenAI-compatible base URL (Ollama, LM Studio) may run without.
 */
export function aiReady(settings: AiSettings): boolean {
  if (!settings.enabled) return false;
  if (settings.apiKeyCipher) return true;
  return settings.provider === 'openai_compatible' && settings.baseUrl !== '';
}
