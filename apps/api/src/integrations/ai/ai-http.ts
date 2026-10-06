import { AiProviderError } from './ai-completion.port';

export const DEFAULT_TIMEOUT_MS = 120_000;

/** `fetch` is injectable so the adapters can be tested without a network. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface JsonResponse {
  readonly status: number;
  readonly body: unknown;
}

/**
 * POSTs JSON with a timeout and maps transport failures and error statuses to
 * `AiProviderError`. Successful statuses return the parsed body. Neither the request body nor
 * the headers (the key) ever end up in an error message.
 */
export async function postJson(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<JsonResponse> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new AiProviderError('timeout');
    }
    throw new AiProviderError('network', undefined, describe(error));
  }
  const text = await response.text().catch(() => '');
  let parsed: unknown = undefined;
  try {
    parsed = text === '' ? undefined : JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (!response.ok) {
    throw errorFor(response.status, providerMessage(parsed) ?? text);
  }
  if (parsed === undefined) {
    throw new AiProviderError('badResponse', response.status, 'not JSON');
  }
  return { status: response.status, body: parsed };
}

export function errorFor(status: number, detail: string): AiProviderError {
  const short = detail.slice(0, 300);
  if (status === 401 || status === 403) {
    return new AiProviderError('invalidKey', status, short);
  }
  if (status === 429) return new AiProviderError('rateLimited', status, short);
  if (status === 404)
    return new AiProviderError('modelNotFound', status, short);
  return new AiProviderError('providerError', status, short);
}

/** `{ error: { message } }` (OpenAI, Anthropic) or `{ error: "…" }` (Ollama). */
function providerMessage(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const error = (body as { error?: unknown }).error;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return undefined;
}

function describe(error: unknown): string {
  const cause = (error as { cause?: { code?: string } } | null)?.cause?.code;
  return cause ?? (error instanceof Error ? error.message : 'fetch failed');
}

/**
 * The first JSON object in a model's text answer: as is, inside a ```json fence, or between the
 * first `{` and the last `}` (models like to add a sentence around it).
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fence?.[1]) candidates.push(fence[1].trim());
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // next candidate
    }
  }
  throw new AiProviderError('badResponse', undefined, 'no JSON in the answer');
}

/** Removes a trailing slash so `${base}/chat/completions` never doubles it. */
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`;
}

/** JSON Schema keys some providers reject at the top level of a tool/response schema. */
export function plainSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = schema;
  return rest;
}
