import { HttpErrorResponse } from '@angular/common/http';

/** A translatable text: an i18n key and its values. */
export interface ErrorText {
  readonly key: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

/**
 * F11.2: the API's error **codes** are the contract — its `message` is English, for logs and
 * the OpenAPI document, and never shown as such. A failed request is told to the user by its
 * code (`errors.api.<code>`) or, without a known code, by its HTTP status
 * (`errors.status.<name>`). Endpoints with their own families (AI, mail, PIN, wallets, setup)
 * map their codes where they are called; this list is for the generic toasts.
 */
export const API_ERROR_CODES = [
  'projectClosed',
  'noCalculation',
  'offline',
  'estvAutoOff',
  'usedByClosedProject',
  'duplicateFile',
  'alreadyDecided',
  'invalidCorrection',
  'promptTooLong',
  'tooManyTokens',
  'setupIncomplete',
  'stepIncomplete',
  'stepRequired',
  'evidenceNotPdf',
  'encryptionUnavailable',
  'confirmationRequired',
  'consentRequired',
  'alreadyPublished',
  'ownEntry',
  'publishLimit',
  'privacyFindings',
  'specTooLarge',
  // F5.18: the desktop's link to a web deployment's mapping library.
  'libraryNotConfigured',
  'libraryNetwork',
  'libraryTimeout',
  'libraryBadResponse',
  'libraryDisabled',
  'libraryRateLimited',
  'libraryUrlInvalid',
  'incompatibleSpec',
  // F11.0u / F5.20: several mappings at once.
  'duplicateMapping',
  'libraryCopy',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** Package import problems (F10.9) — the texts the notification centre uses for them. */
export const PACKAGE_ERROR_CODES = [
  'notZip',
  'unsafePath',
  'manifest',
  'tampered',
  'version',
  'content',
] as const;

/** HTTP statuses with a text of their own; every other 5xx is `server`. */
export const HTTP_STATUS_TEXTS = {
  0: 'unreachable',
  400: 'badRequest',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'notFound',
  409: 'conflict',
  413: 'tooLarge',
  422: 'unprocessable',
  423: 'locked',
  429: 'rateLimited',
} as const satisfies Record<number, string>;
export const HTTP_STATUS_NAMES = [
  ...Object.values(HTTP_STATUS_TEXTS),
  'server',
] as const;

function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return (
    typeof value === 'string' &&
    (API_ERROR_CODES as readonly string[]).includes(value)
  );
}

/** The translatable reason of a failed API call, or `undefined` when it was no HTTP error. */
export function apiErrorText(error: unknown): ErrorText | undefined {
  if (!(error instanceof HttpErrorResponse)) return undefined;
  const code: unknown = (error.error as { code?: unknown } | null)?.code;
  if (isApiErrorCode(code)) return { key: `errors.api.${code}` };
  if (
    typeof code === 'string' &&
    (PACKAGE_ERROR_CODES as readonly string[]).includes(code)
  ) {
    return { key: `notifications.reason.${code}` };
  }
  const named = (HTTP_STATUS_TEXTS as Readonly<Record<number, string>>)[
    error.status
  ];
  if (named) return { key: `errors.status.${named}` };
  if (error.status >= 500) return { key: 'errors.status.server' };
  return undefined;
}
