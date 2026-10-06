import { HttpErrorResponse } from '@angular/common/http';
import { aiErrorKey } from './ai-error-key';

/**
 * A failed AI request as the app shows it (user rule: "genaue Fehlerinfos"): the translated
 * summary plus what the API reported — the provider's HTTP status and own message, the URL
 * (without query), the model, the error code, the system cause — and a hint what to check.
 * The API redacts every text; nothing here can contain the key.
 */
export interface AiErrorInfo {
  /** `ai.errors.<code>` — the translated summary. */
  readonly key: string;
  /** The API's error code (`invalidKey`, `network`, …). */
  readonly code?: string;
  /** The API's own HTTP status (502 provider failure, 409 state, 0 unreachable). */
  readonly httpStatus?: number;
  /** The provider's HTTP status. */
  readonly status?: number;
  readonly providerMessage?: string;
  readonly providerType?: string;
  readonly providerCode?: string;
  readonly url?: string;
  readonly model?: string;
  readonly cause?: string;
  readonly timeoutMs?: number;
  /** One line from the API (502: everything above; 409: what is missing). */
  readonly detail?: string;
  /** `ai.hints.<case>` — what to check, when the case is typical. */
  readonly hintKey?: string;
}

export function aiErrorInfo(error: unknown): AiErrorInfo {
  const key = aiErrorKey(error);
  if (!(error instanceof HttpErrorResponse)) return { key };
  const body =
    typeof error.error === 'object' && error.error !== null
      ? (error.error as Record<string, unknown>)
      : {};
  const text = (name: string) =>
    typeof body[name] === 'string' && body[name] !== ''
      ? (body[name] as string)
      : undefined;
  const number = (name: string) =>
    typeof body[name] === 'number' ? (body[name] as number) : undefined;
  const info = {
    key,
    code: text('code'),
    httpStatus: error.status,
    status: number('status'),
    providerMessage: text('providerMessage'),
    providerType: text('providerType'),
    providerCode: text('providerCode'),
    url: text('url'),
    model: text('model'),
    cause: text('cause'),
    timeoutMs: number('timeoutMs'),
    detail: text('detail'),
  };
  const clean = Object.fromEntries(
    Object.entries(info).filter(([, value]) => value !== undefined),
  ) as unknown as AiErrorInfo;
  const hintKey = aiErrorHintKey(clean);
  return hintKey ? { ...clean, hintKey } : clean;
}

/** The hint for the typical cases (wrong key, wrong model/address, limits, no server, …). */
export function aiErrorHintKey(info: AiErrorInfo): string | undefined {
  const cause = info.cause ?? '';
  if (info.code === 'timeout') return 'ai.hints.timeout';
  if (/^ECONNREFUSED/.test(cause)) return 'ai.hints.refused';
  if (/^(ENOTFOUND|EAI_AGAIN)/.test(cause)) return 'ai.hints.notFound';
  if (/CERT|TLS|SSL/i.test(cause)) return 'ai.hints.tls';
  if (info.status === 401 || info.status === 403 || info.code === 'invalidKey')
    return 'ai.hints.key';
  if (info.status === 404 || info.code === 'modelNotFound')
    return 'ai.hints.model';
  if (info.status === 429 || info.code === 'rateLimited')
    return 'ai.hints.rateLimit';
  if (info.code === 'privateUrl' || info.code === 'invalidUrl')
    return 'ai.hints.address';
  if (info.httpStatus === 0) return 'ai.hints.unreachable';
  return undefined;
}

/** True when there is more to show than the summary. */
export function hasAiErrorDetails(info: AiErrorInfo): boolean {
  return (
    info.status !== undefined ||
    !!info.providerMessage ||
    !!info.url ||
    !!info.model ||
    !!info.cause ||
    !!info.detail ||
    !!info.code
  );
}

/** Plain text for "Details kopieren" (labels already translated by the caller). */
export function aiErrorReport(
  info: AiErrorInfo,
  label: (key: string) => string,
): string {
  const lines: [string, string | number | undefined][] = [
    [label('ai.details.summary'), label(info.key)],
    [label('ai.details.status'), info.status],
    [label('ai.details.providerMessage'), info.providerMessage],
    [
      label('ai.details.providerType'),
      [info.providerType, info.providerCode].filter(Boolean).join(' / ') ||
        undefined,
    ],
    [label('ai.details.url'), info.url],
    [label('ai.details.model'), info.model],
    [label('ai.details.code'), info.code],
    [label('ai.details.cause'), info.cause],
    [label('ai.details.detail'), info.detail],
    [label('ai.details.hint'), info.hintKey ? label(info.hintKey) : undefined],
  ];
  return lines
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n');
}
