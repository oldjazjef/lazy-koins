import { ConflictException } from '@nestjs/common';

/**
 * F11.2: an error's **code** is the contract with the app, which shows it in the user's language
 * (`errors.api.<code>` in the web's message files). The `message` stays English — for logs, the
 * OpenAPI document and API clients — and is never shown by the app.
 */
export type ConflictCode =
  | 'projectClosed'
  | 'noCalculation'
  | 'offline'
  | 'estvAutoOff'
  | 'usedByClosedProject'
  | 'alreadyDecided';

/** A 409 with a code: `{ statusCode, error, message, code }`. */
export function conflict(
  code: ConflictCode,
  message: string,
  extra: Readonly<Record<string, unknown>> = {},
): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message,
    code,
    ...extra,
  });
}

/** F4.5: the 409 for any change to a closed project. */
export function projectClosed(
  message = 'The project is closed: reopen it first, then change it',
): ConflictException {
  return conflict('projectClosed', message);
}
