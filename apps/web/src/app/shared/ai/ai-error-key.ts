import { HttpErrorResponse } from '@angular/common/http';

/**
 * The codes the API's AI endpoints answer with (`body.code`): 409/422 for the plugin's state,
 * 502 for the provider's failures. Each has a message `ai.errors.<code>`.
 */
export const AI_ERROR_CODES = [
  'aiDisabled',
  'aiNotConfigured',
  'consentRequired',
  'keyUnreadable',
  'privateUrl',
  'invalidUrl',
  'encryptionUnavailable',
  'noText',
  'invalidAnswer',
  'invalidKey',
  'rateLimited',
  'network',
  'timeout',
  'badResponse',
  'providerError',
  'modelNotFound',
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

/** The translated reason of a failed AI request. */
export function aiErrorKey(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) return 'ai.errors.failed';
  const code = (error.error as { code?: unknown } | null)?.code;
  if (
    typeof code === 'string' &&
    (AI_ERROR_CODES as readonly string[]).includes(code)
  ) {
    return `ai.errors.${code}`;
  }
  if (error.status === 0) return 'ai.errors.unreachable';
  if (error.status === 409) return 'ai.errors.closed';
  return 'ai.errors.failed';
}
