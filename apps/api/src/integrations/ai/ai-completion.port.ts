/**
 * The AI plugin's one seam to a language model (F5.13): provider-agnostic, one call = one
 * structured answer. Adapters live next to this file (`openai-compatible.adapter.ts`,
 * `anthropic.adapter.ts`); `IntegrationsModule` binds the port to a dispatcher that picks one per
 * call from the user's settings. Features never see an HTTP client or a provider SDK.
 */

export const AI_PROVIDER_KINDS = ['openai_compatible', 'anthropic'] as const;
export type AiProviderKind = (typeof AI_PROVIDER_KINDS)[number];

/** Where to send a request — the user's settings with the key already decrypted. */
export interface AiConnection {
  readonly kind: AiProviderKind;
  /** Empty = the provider's default (`https://api.openai.com/v1`, `https://api.anthropic.com`). */
  readonly baseUrl: string;
  /** Empty = the provider's default model. */
  readonly model: string;
  /** Optional: a local Ollama / LM Studio needs none. Never logged. */
  readonly apiKey?: string;
}

export interface AiMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface AiCompletionRequest {
  readonly system: string;
  /** The conversation so far; the last message is the user's. */
  readonly messages: readonly AiMessage[];
  /** The answer must be ONE JSON value conforming to this schema. */
  readonly output: {
    /** `[a-zA-Z0-9_-]`, e.g. `mapping_spec` — tool / schema name. */
    readonly name: string;
    readonly description: string;
    readonly schema: Record<string, unknown>;
  };
  readonly maxTokens?: number;
  /** Milliseconds until the request is aborted; default 120 s (local models are slow). */
  readonly timeoutMs?: number;
}

export interface AiUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface AiCompletion {
  /** The parsed JSON answer — untrusted, the caller validates it. */
  readonly json: unknown;
  /** The answer as text (JSON), for the follow-up message of a repair round. */
  readonly text: string;
  /** The model that answered, as the provider reports it. */
  readonly model: string;
  /** Only when the provider reports it. */
  readonly usage?: AiUsage;
}

/** Stable codes the app translates (`ai.errors.<code>`). */
export const AI_ERROR_CODES = [
  'invalidKey',
  'rateLimited',
  'network',
  'timeout',
  'badResponse',
  'providerError',
  'modelNotFound',
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

/**
 * A failed call, mapped to a code. `message` never contains the key or the request body; the
 * provider's own error text is kept short for the log.
 */
export class AiProviderError extends Error {
  constructor(
    readonly code: AiErrorCode,
    readonly status?: number,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'AiProviderError';
  }
}

export abstract class AiCompletionPort {
  abstract complete(
    connection: AiConnection,
    request: AiCompletionRequest,
  ): Promise<AiCompletion>;
}
