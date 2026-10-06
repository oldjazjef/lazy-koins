import { createHash } from 'node:crypto';
import {
  ChainDataError,
  type ChainErrorCode,
} from '../../wallets/ports/chain-data.port';
import {
  type Fetcher,
  parseJsonKeepingNumbers,
  SerialGate,
} from '../rates/http-rate-client';

export type { Fetcher } from '../rates/http-rate-client';

/**
 * Shared plumbing of the chain adapters (F6.3): one request at a time per provider with a minimum
 * spacing (free plans rate-limit), a timeout, a short cache of successful answers (a network
 * check followed by a fetch asks the same questions), JSON parsed with the numbers' **source
 * text** (amounts never pass through a JS number), and errors mapped to stable codes with the
 * provider's message **redacted** — no key ever reaches a log, the database or a response.
 */

const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 500;

/** Removes every secret (and anything that looks like a key parameter) from a provider message. */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length >= 4) out = out.split(secret).join('…');
  }
  return out
    .replace(/(api[-_]?key|apikey|key|token)=([^&\s"']+)/gi, '$1=…')
    .slice(0, 300);
}

export interface ChainRequest {
  readonly url: string;
  readonly method?: 'GET' | 'POST';
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  /** Secrets in URL/headers: redacted from messages and left out of the cache key. */
  readonly secrets?: readonly string[];
  readonly timeoutMs?: number;
  /** Statuses that are an answer, not an error (e.g. 404 = unknown account). */
  readonly acceptStatus?: readonly number[];
}

export interface ChainResponse {
  readonly status: number;
  readonly body: unknown;
}

export class ChainHttpClient {
  private readonly gate: SerialGate;
  private readonly cache = new Map<
    string,
    { at: number; value: ChainResponse }
  >();

  constructor(
    private readonly fetcher: Fetcher,
    spacingMs: number,
    private readonly now: () => number = Date.now,
  ) {
    this.gate = new SerialGate(spacingMs);
  }

  private cacheKey(request: ChainRequest): string {
    let key = `${request.method ?? 'GET'} ${request.url} ${JSON.stringify(request.body ?? null)}`;
    for (const secret of request.secrets ?? []) {
      if (secret.length > 0) key = key.split(secret).join('<key>');
    }
    // Keyed per secret too, without storing it: an invalid key never reads a valid key's answer.
    const keyHash = createHash('sha256')
      .update((request.secrets ?? []).join('\u0000'))
      .digest('hex')
      .slice(0, 16);
    return `${keyHash} ${key}`;
  }

  async request(request: ChainRequest): Promise<ChainResponse> {
    const key = this.cacheKey(request);
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < CACHE_TTL_MS) return hit.value;
    const value = await this.gate.run(() => this.send(request));
    if (this.cache.size >= CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { at: this.now(), value });
    return value;
  }

  private async send(request: ChainRequest): Promise<ChainResponse> {
    const secrets = request.secrets ?? [];
    let response: Response;
    try {
      response = await this.fetcher(request.url, {
        method: request.method ?? 'GET',
        headers: {
          accept: 'application/json',
          ...(request.body === undefined
            ? {}
            : { 'content-type': 'application/json' }),
          ...request.headers,
        },
        body:
          request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: AbortSignal.timeout(request.timeoutMs ?? 30_000),
      });
    } catch (error) {
      const timeout =
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new ChainDataError(timeout ? 'timeout' : 'network');
    }
    const text = await response.text();
    if (
      !response.ok &&
      !(request.acceptStatus ?? []).includes(response.status)
    ) {
      throw new ChainDataError(
        codeForStatus(response.status),
        redact(text.trim(), secrets) || null,
        response.status,
      );
    }
    let body: unknown;
    try {
      body = text.trim() === '' ? null : parseJsonKeepingNumbers(text);
    } catch {
      throw new ChainDataError('badResponse', null, response.status);
    }
    return { status: response.status, body };
  }
}

export function codeForStatus(status: number): ChainErrorCode {
  if (status === 401 || status === 403) return 'invalidKey';
  if (status === 429) return 'rateLimited';
  if (status === 400 || status === 422) return 'invalidAddress';
  return 'providerError';
}

/** Narrowing helpers for untyped JSON. */
export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** A JSON scalar as text (numbers arrive as their source text). */
export function asText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return String(value);
  return null;
}

/** Unix seconds (as text) → ISO UTC. */
export function isoFromUnix(seconds: string | number | null): string | null {
  if (seconds === null) return null;
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000).toISOString();
}
