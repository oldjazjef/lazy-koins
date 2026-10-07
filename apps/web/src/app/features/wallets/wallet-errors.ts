import { HttpErrorResponse } from '@angular/common/http';
import { WALLET_ERROR_CODES } from '../../core/api/wallets.types';

/**
 * The translated reason of a failed wallet request (`wallets.errors.<code>`) and the provider's
 * own words (`detail`, redacted by the API) for the precise error F6.7 asks for.
 */
export function walletError(error: unknown): {
  key: string;
  detail?: string;
} {
  if (!(error instanceof HttpErrorResponse)) {
    return { key: 'wallets.errors.failed' };
  }
  const body = error.error as {
    code?: unknown;
    detail?: unknown;
    status?: unknown;
  } | null;
  const code = body?.code;
  const parts = [
    typeof body?.status === 'number' ? `HTTP ${body.status}` : '',
    typeof body?.detail === 'string' ? body.detail : '',
  ].filter((part) => part !== '');
  const detail = parts.length > 0 ? parts.join(' – ') : undefined;
  if (
    typeof code === 'string' &&
    (WALLET_ERROR_CODES as readonly string[]).includes(code)
  ) {
    return { key: `wallets.errors.${code}`, detail };
  }
  if (error.status === 0) return { key: 'wallets.errors.unreachable' };
  if (error.status === 409) return { key: 'wallets.errors.closed' };
  return { key: 'wallets.errors.failed', detail };
}

/** The secret kind of a refused input (F6.2), if that is what the API said. */
export function refusedSecret(error: unknown): string | null {
  if (!(error instanceof HttpErrorResponse)) return null;
  const body = error.error as { code?: unknown; kind?: unknown } | null;
  return body?.code === 'secretRefused' && typeof body.kind === 'string'
    ? body.kind
    : null;
}
