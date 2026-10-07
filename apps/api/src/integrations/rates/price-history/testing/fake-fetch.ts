import { expect } from 'vitest';
import type { Fetcher } from '../../http-rate-client';
import type { DailyPrice } from '../price-history-source.port';

export interface FakeAnswer {
  readonly status: number;
  readonly body: string;
}

export interface RecordedCall {
  readonly url: string;
  readonly headers: Record<string, string>;
}

/**
 * A fetch double for the price-history adapters — no network. Answers by the first route whose
 * key the URL contains (in insertion order); an answer list is used one per call (the last one
 * repeats). `'hang'` never answers until the request is aborted (timeout tests).
 */
export function fakeFetch(
  routes: Record<string, FakeAnswer | readonly FakeAnswer[] | 'hang'>,
): { fetcher: Fetcher; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const used = new Map<string, number>();
  const fetcher: Fetcher = async (url, init) => {
    calls.push({
      url,
      headers: { ...(init?.headers as Record<string, string>) },
    });
    const match = Object.entries(routes).find(([key]) => url.includes(key));
    if (!match) return new Response('{"error":"no route"}', { status: 404 });
    const [key, answer] = match;
    if (answer === 'hang') {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    }
    const list: readonly FakeAnswer[] = Array.isArray(answer)
      ? (answer as readonly FakeAnswer[])
      : [answer as FakeAnswer];
    const index = used.get(key) ?? 0;
    used.set(key, index + 1);
    const chosen = list[Math.min(index, list.length - 1)] as FakeAnswer;
    return new Response(chosen.body, { status: chosen.status });
  };
  return { fetcher, calls };
}

export const json = (status: number, body: unknown): FakeAnswer => ({
  status,
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

/** A fetch that fails like undici does when the host is unreachable. */
export const unreachable: Fetcher = async () => {
  throw new TypeError('fetch failed', {
    cause: Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
    }),
  });
};

/** Pinned clock: 2026-10-07 12:00 UTC. */
export const NOW = Date.parse('2026-10-07T12:00:00Z');
export const now = () => NOW;

export const sec = (date: string) => Date.parse(`${date}T00:00:00Z`) / 1000;
export const ms = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** Fast options: no spacing, the pinned clock. */
export function opts(
  fetcher: Fetcher,
  extra: { timeoutMs?: number; maxBytes?: number } = {},
) {
  return { fetcher, spacingMs: 0, now, ...extra };
}

/** Every price is a plain decimal string > 0 — never a JS number, never an exponent. */
export function expectDecimalStrings(series: readonly DailyPrice[]): void {
  for (const point of series) {
    expect(typeof point.value).toBe('string');
    expect(point.value).toMatch(/^\d+(\.\d+)?$/);
    expect(point.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }
  const dates = series.map((point) => point.date);
  expect([...dates].sort()).toEqual(dates);
  expect(new Set(dates).size).toBe(dates.length);
}
