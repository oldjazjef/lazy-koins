/**
 * Shared plumbing of the rate adapters: one request at a time per source with a minimum spacing
 * (public APIs rate-limit), a timeout, and JSON parsed **with the numbers' source text** so a
 * rate never passes through a JS number (CLAUDE.md, Numbers).
 */

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export class RateSourceError extends Error {
  constructor(
    readonly source: string,
    readonly status: number | null,
  ) {
    super(
      `${source}: request failed${status === null ? '' : ` (HTTP ${status})`}`,
    );
    this.name = 'RateSourceError';
  }
}

/** Serialises calls and keeps at least `spacingMs` between their starts. */
export class SerialGate {
  private chain: Promise<unknown> = Promise.resolve();
  private last = 0;

  constructor(private readonly spacingMs: number) {}

  run<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.then(async () => {
      const wait = this.last + this.spacingMs - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.last = Date.now();
      return work();
    });
    this.chain = next.catch(() => undefined);
    return next;
  }
}

type ReviverContext = { source?: string } | undefined;

/**
 * `JSON.parse`, but every number becomes the **string** it was written as (`0.9123` stays
 * `"0.9123"`), using the reviver's source-text access (Node ≥ 21).
 */
export function parseJsonKeepingNumbers(text: string): unknown {
  return JSON.parse(text, function (_key, value: unknown, context?: unknown) {
    if (typeof value !== 'number') return value;
    const source = (context as ReviverContext)?.source;
    return typeof source === 'string' ? source : String(value);
  } as (this: unknown, key: string, value: unknown) => unknown);
}

/** GET a JSON document through the gate; `undefined` for a 400/404 (unknown symbol or coin). */
export async function getJson(
  fetcher: Fetcher,
  gate: SerialGate,
  source: string,
  url: string,
  headers: Record<string, string> = {},
): Promise<unknown> {
  return gate.run(async () => {
    let response: Response;
    try {
      response = await fetcher(url, {
        headers: { accept: 'application/json', ...headers },
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new RateSourceError(source, null);
    }
    if (response.status === 400 || response.status === 404) return undefined;
    if (!response.ok) throw new RateSourceError(source, response.status);
    return parseJsonKeepingNumbers(await response.text());
  });
}

/** `2025-01-31` → Unix milliseconds at 00:00 UTC. */
export function dayStartMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/** Unix milliseconds → the UTC day. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
