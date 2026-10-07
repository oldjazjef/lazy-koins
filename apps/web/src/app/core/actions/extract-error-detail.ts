import { apiErrorText, type ErrorText } from '../api/api-error';

/**
 * The reason of a failed HTTP call as a translatable text, appended to a failure toast.
 *
 * F11.2: the API's `message` is English and meant for logs — the app tells the reason in the
 * user's language from the error **code** (`errors.api.<code>`, e.g. "The project is closed –
 * reopen it first") or, without a known code, from the HTTP status (`errors.status.<name>`).
 * `undefined` for a failure that was no HTTP call: the toast then shows only its own message.
 */
export function extractErrorDetail(error: unknown): ErrorText | undefined {
  return apiErrorText(error);
}
