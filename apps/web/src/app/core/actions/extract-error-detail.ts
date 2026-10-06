import { HttpErrorResponse } from '@angular/common/http';

/**
 * Pulls a human-readable detail out of a failed HTTP call, when there is one worth showing.
 *
 * Nest's default exception filter answers with `{ statusCode, message, error }` — `message` is a
 * plain string for most exceptions and an array of strings for a `ValidationPipe` failure. Handler
 * messages are deliberately specific ("The project is closed: reopen it first") precisely so a
 * caller can surface them; without this, every failure collapses into the same generic toast
 * regardless of why.
 */
export function extractErrorDetail(error: unknown): string | undefined {
  if (!(error instanceof HttpErrorResponse)) {
    return undefined;
  }

  const message: unknown = error.error?.message;
  if (Array.isArray(message)) {
    return message.join('; ');
  }
  if (typeof message === 'string' && message.length > 0) {
    return message;
  }
  return undefined;
}
