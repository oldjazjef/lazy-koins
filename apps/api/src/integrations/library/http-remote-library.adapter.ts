import type { z } from 'zod';
import {
  RemoteEntryDetailSchema,
  type RemoteEntry,
  type RemoteEntryDetail,
  RemoteLibraryError,
  type RemoteLibraryErrorCode,
  RemoteLibraryPort,
  type RemoteMatchRequest,
  RemoteMatchesSchema,
  type RemotePage,
  RemotePageSchema,
  type RemoteSearch,
} from './remote-library.port';

export interface RemoteLibraryLimits {
  readonly timeoutMs: number;
  /** Bytes of a list / match answer. */
  readonly maxListBytes: number;
  /** Bytes of one entry with its spec (specs are ≤ 64 KB). */
  readonly maxEntryBytes: number;
}

export const REMOTE_LIBRARY_LIMITS: RemoteLibraryLimits = {
  timeoutMs: 10_000,
  maxListBytes: 512 * 1024,
  maxEntryBytes: 256 * 1024,
};

/** The public endpoint under a server's base address. */
export const PUBLIC_LIBRARY_PATH = '/api/public/library';

interface Call {
  readonly method: 'GET' | 'POST';
  readonly body?: string;
  readonly maxBytes: number;
  /** What a 404 means here: the server has no public library, or the entry is gone. */
  readonly on404: Extract<RemoteLibraryErrorCode, 'disabled' | 'notFound'>;
}

/**
 * `RemoteLibraryPort` over plain `fetch` (F5.18): no cookies, no credentials, no redirects (a
 * redirect could lead anywhere — it is a `network` error naming the status), a timeout per call
 * and a byte cap while reading. Every answer is parsed through a zod schema. Errors carry a code
 * and one technical line, never the body.
 */
export class HttpRemoteLibrary extends RemoteLibraryPort {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly limits: RemoteLibraryLimits = REMOTE_LIBRARY_LIMITS,
  ) {
    super();
  }

  async search(baseUrl: string, search: RemoteSearch): Promise<RemotePage> {
    const params = new URLSearchParams();
    if (search.search) params.set('search', search.search);
    if (search.platform) params.set('platform', search.platform);
    if (search.sort) params.set('sort', search.sort);
    if (search.offset !== undefined)
      params.set('offset', String(search.offset));
    if (search.limit !== undefined) params.set('limit', String(search.limit));
    const query = params.toString();
    return this.call(
      `${baseUrl}${PUBLIC_LIBRARY_PATH}${query ? `?${query}` : ''}`,
      { method: 'GET', maxBytes: this.limits.maxListBytes, on404: 'disabled' },
      RemotePageSchema,
    );
  }

  async get(baseUrl: string, id: string): Promise<RemoteEntryDetail> {
    return this.call(
      `${baseUrl}${PUBLIC_LIBRARY_PATH}/${encodeURIComponent(id)}`,
      { method: 'GET', maxBytes: this.limits.maxEntryBytes, on404: 'notFound' },
      RemoteEntryDetailSchema,
    );
  }

  async match(
    baseUrl: string,
    request: RemoteMatchRequest,
  ): Promise<RemoteEntry[]> {
    const answer = await this.call(
      `${baseUrl}${PUBLIC_LIBRARY_PATH}/match`,
      {
        method: 'POST',
        // Exactly these two fields — never rows or values.
        body: JSON.stringify({
          fileName: request.fileName,
          headers: [...request.headers],
        }),
        maxBytes: this.limits.maxListBytes,
        on404: 'disabled',
      },
      RemoteMatchesSchema,
    );
    return answer.items;
  }

  private async call<T extends z.ZodType>(
    url: string,
    call: Call,
    schema: T,
  ): Promise<z.infer<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.limits.timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: call.method,
          headers: {
            accept: 'application/json',
            ...(call.body !== undefined
              ? { 'content-type': 'application/json' }
              : {}),
          },
          ...(call.body !== undefined ? { body: call.body } : {}),
          redirect: 'manual',
          credentials: 'omit',
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          throw new RemoteLibraryError(
            'timeout',
            `no answer within ${this.limits.timeoutMs} ms`,
          );
        }
        throw new RemoteLibraryError('network', causeOf(error));
      }
      if (response.status >= 300 && response.status < 400) {
        await discard(response);
        throw new RemoteLibraryError(
          'network',
          `HTTP ${response.status}: redirects are not followed — enter the final address`,
        );
      }
      if (response.status === 404) {
        await discard(response);
        throw new RemoteLibraryError(call.on404, 'HTTP 404');
      }
      if (response.status === 429) {
        await discard(response);
        throw new RemoteLibraryError('rateLimited', 'HTTP 429');
      }
      if (!response.ok) {
        await discard(response);
        throw new RemoteLibraryError('badResponse', `HTTP ${response.status}`);
      }
      const body = await readCapped(response, call.maxBytes, controller);
      let json: unknown;
      try {
        json = JSON.parse(body);
      } catch {
        throw new RemoteLibraryError('badResponse', 'the answer is not JSON');
      }
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        const where = (first?.path ?? []).map(String).join('.') || '(root)';
        throw new RemoteLibraryError(
          'badResponse',
          `unexpected answer at ${where}`,
        );
      }
      return parsed.data;
    } finally {
      clearTimeout(timer);
    }
  }
}

async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

async function readCapped(
  response: Response,
  maxBytes: number,
  controller: AbortController,
): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    await discard(response);
    throw new RemoteLibraryError(
      'badResponse',
      `answer larger than ${maxBytes} bytes`,
    );
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RemoteLibraryError(
          'badResponse',
          `answer larger than ${maxBytes} bytes`,
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof RemoteLibraryError) throw error;
    if (controller.signal.aborted) {
      throw new RemoteLibraryError('timeout', 'the answer did not finish');
    }
    throw new RemoteLibraryError('network', causeOf(error));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** The system cause undici hides (`ECONNREFUSED`, `ENOTFOUND`, TLS codes). */
function causeOf(error: unknown): string {
  const cause = (error as { cause?: { code?: unknown; message?: unknown } })
    ?.cause;
  if (cause && typeof cause.code === 'string') return cause.code;
  if (cause && typeof cause.message === 'string') {
    return cause.message.slice(0, 200);
  }
  return error instanceof Error ? error.message.slice(0, 200) : 'failed';
}
