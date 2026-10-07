import { toDecimalString, tryParseDecimal } from '@lazykoins/engine';
import { redactSecrets, safeUrl } from '../../ai/redact';
import {
  type Fetcher,
  parseJsonKeepingNumbers,
  SerialGate,
} from '../http-rate-client';
import {
  PriceSourceError,
  type PriceSourceErrorCode,
  type PriceSourceId,
  type PriceSourceTestResult,
} from './price-history-source.port';

export const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface PriceHttpOptions {
  readonly fetcher?: Fetcher;
  /** Minimum time between the starts of two calls to this provider. */
  readonly spacingMs?: number;
  readonly timeoutMs?: number;
  /** Largest answer read; anything longer is `badResponse`. */
  readonly maxBytes?: number;
  /** The clock (tests pin it): "today" for depth probes and unfinished days. */
  readonly now?: () => number;
}

export interface PriceHttpAnswer {
  readonly status: number;
  /** JSON with every number as its source text; `undefined` when the body is not JSON. */
  readonly body: unknown;
  readonly text: string;
  /** scheme://host/path — never the query. */
  readonly url: string;
}

/**
 * One provider's HTTP access: serialised calls with spacing, a timeout that also covers reading
 * the body, a size cap, and JSON parsed with numbers as strings. It does not judge the status —
 * each adapter maps its provider's error shapes to codes (`fail`).
 */
export class PriceHttp {
  readonly now: () => number;
  private readonly fetcher: Fetcher;
  private readonly gate: SerialGate;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;

  constructor(
    readonly source: PriceSourceId,
    options: PriceHttpOptions = {},
  ) {
    this.fetcher = options.fetcher ?? fetch;
    this.gate = new SerialGate(options.spacingMs ?? 1000);
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maxBytes = options.maxBytes ?? 4_000_000;
    this.now = options.now ?? Date.now;
  }

  get(
    url: string,
    headers: Record<string, string> = {},
    secrets: readonly (string | undefined)[] = [],
  ): Promise<PriceHttpAnswer> {
    return this.gate.run(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const shown = safeUrl(url, secrets);
      try {
        let response: Response;
        try {
          response = await this.fetcher(url, {
            headers: { accept: 'application/json', ...headers },
            redirect: 'error',
            credentials: 'omit',
            signal: controller.signal,
          });
        } catch (error) {
          throw controller.signal.aborted
            ? this.error(
                'timeout',
                null,
                `no answer within ${this.timeoutMs} ms`,
              )
            : this.error('network', null, causeOf(error), secrets);
        }
        const text = await this.readCapped(response, controller, secrets);
        let body: unknown;
        try {
          body = text === '' ? undefined : parseJsonKeepingNumbers(text);
        } catch {
          body = undefined;
        }
        return { status: response.status, body, text, url: shown };
      } finally {
        clearTimeout(timer);
      }
    });
  }

  /** A `PriceSourceError` whose detail is the provider's message (or `text`), redacted. */
  fail(
    code: PriceSourceErrorCode,
    answer: PriceHttpAnswer | null,
    secrets: readonly (string | undefined)[] = [],
    message?: string,
  ): PriceSourceError {
    return this.error(
      code,
      answer?.status ?? null,
      message ?? (answer ? providerMessageOf(answer) : null),
      secrets,
    );
  }

  error(
    code: PriceSourceErrorCode,
    status: number | null,
    detail: string | null,
    secrets: readonly (string | undefined)[] = [],
  ): PriceSourceError {
    const clean = detail === null ? '' : redactSecrets(detail, secrets);
    return new PriceSourceError(
      this.source,
      code,
      status,
      clean === '' ? null : clean,
    );
  }

  /** Runs `work` and turns its outcome into a test result (`ok` unless it says so) — never throws. */
  async test(
    url: string,
    work: () => Promise<
      Omit<PriceSourceTestResult, 'millis' | 'url' | 'ok'> & { ok?: boolean }
    >,
    secrets: readonly (string | undefined)[] = [],
  ): Promise<PriceSourceTestResult> {
    const started = this.now();
    const shown = safeUrl(url, secrets);
    try {
      const result = await work();
      return { ok: true, ...result, url: shown, millis: this.now() - started };
    } catch (error) {
      const failure =
        error instanceof PriceSourceError
          ? error
          : this.error('badResponse', null, String(error), secrets);
      return {
        ok: false,
        code: failure.code,
        status: failure.status,
        historyDays: null,
        plan: null,
        detail: failure.detail,
        url: shown,
        millis: this.now() - started,
      };
    }
  }

  /** The UTC day "today" by this adapter's clock. */
  today(): string {
    return utcDay(this.now());
  }

  private async readCapped(
    response: Response,
    controller: AbortController,
    secrets: readonly (string | undefined)[],
  ): Promise<string> {
    const declared = Number(response.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > this.maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw this.error(
        'badResponse',
        response.status,
        `answer larger than ${this.maxBytes} bytes`,
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
        if (size > this.maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw this.error(
            'badResponse',
            response.status,
            `answer larger than ${this.maxBytes} bytes`,
          );
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof PriceSourceError) throw error;
      throw controller.signal.aborted
        ? this.error('timeout', response.status, 'the answer did not finish')
        : this.error('network', response.status, causeOf(error), secrets);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
}

/** The usual HTTP status → code mapping; `null` for a success. */
export function codeForStatus(status: number): PriceSourceErrorCode | null {
  if (status >= 200 && status < 300) return null;
  if (status === 401 || status === 403) return 'invalidKey';
  if (status === 402) return 'planLacksHistory';
  if (status === 404) return 'notFound';
  if (status === 429) return 'rateLimited';
  return 'badResponse';
}

/**
 * A provider price (already a string thanks to `parseJsonKeepingNumbers`) as a plain decimal
 * string > 0 — exponents expanded (`1e-7` → `0.0000001`), every digit kept. Anything else
 * (a JS number, null, text, 0, negative) is `undefined`: a missing day, never an invented one.
 */
export function priceText(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = tryParseDecimal(raw);
  if (!value || !value.isFinite() || value.lte(0)) return undefined;
  return toDecimalString(value);
}

/** `2025-01-31` → Unix milliseconds at 00:00 UTC; throws on anything else. */
export function dayStart(date: string): number {
  if (!ISO_DAY.test(date)) throw new RangeError(`not an ISO day: ${date}`);
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(ms)) throw new RangeError(`not an ISO day: ${date}`);
  return ms;
}

export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return utcDay(dayStart(date) + days * DAY_MS);
}

/** Days from `from` to `to`, both inclusive (0 when `to` is before `from`). */
export function daysBetween(from: string, to: string): number {
  return Math.max(0, Math.round((dayStart(to) - dayStart(from)) / DAY_MS) + 1);
}

/** `[from, to]` cut into consecutive ranges of at most `size` days. */
export function chunkDays(
  from: string,
  to: string,
  size: number,
): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  let start = from;
  while (dayStart(start) <= dayStart(to)) {
    const candidate = addDays(start, size - 1);
    const end = dayStart(candidate) < dayStart(to) ? candidate : to;
    out.push({ from: start, to: end });
    start = addDays(end, 1);
  }
  return out;
}

/** Validates the request's days (`from` ≤ `to`). */
export function checkRange(from: string, to: string): void {
  if (dayStart(from) > dayStart(to)) {
    throw new RangeError(`from ${from} is after to ${to}`);
  }
}

/**
 * Collects points into one value per day: keeps the days inside `[from, to]` and before
 * `notFrom` (an unfinished day), `first` or `last` value of a day, sorted by date.
 */
export class DaySeries {
  private readonly days = new Map<string, string>();

  constructor(
    private readonly from: string,
    private readonly to: string,
    private readonly keep: 'first' | 'last',
    private readonly notFrom?: string,
  ) {}

  add(date: string, raw: unknown): void {
    if (date < this.from || date > this.to) return;
    if (this.notFrom !== undefined && date >= this.notFrom) return;
    const value = priceText(raw);
    if (value === undefined) return;
    if (this.keep === 'first' && this.days.has(date)) return;
    this.days.set(date, value);
  }

  get size(): number {
    return this.days.size;
  }

  toArray(): { date: string; value: string }[] {
    return [...this.days.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, value]) => ({ date, value }));
  }
}

/** The usual places a provider puts its message: `status.error_message`, `error`, `message`. */
export function providerMessageOf(answer: PriceHttpAnswer): string | null {
  const body = answer.body;
  if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    const status = record['status'];
    if (typeof status === 'object' && status !== null) {
      const message = (status as Record<string, unknown>)['error_message'];
      if (typeof message === 'string' && message !== '') return message;
    }
    for (const key of ['error', 'message', 'Message']) {
      const value = record[key];
      if (typeof value === 'string' && value !== '') return value;
      if (Array.isArray(value) && value.length > 0) return value.join(', ');
    }
  }
  if (Array.isArray(body) && body[0] === 'error')
    return body.slice(1).join(' ');
  const text = answer.text.trim();
  return text === '' ? null : text.slice(0, 500);
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

/** A record or `undefined` — for walking provider JSON without casts everywhere. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** A rank-like field (source text) as a whole number, else `null`. */
export function rankOf(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const rank = Number(value);
  return Number.isInteger(rank) && rank > 0 ? rank : null;
}

/** Exact symbol matches first, then by rank (unranked last), then the provider's order. */
export function rankCandidates<
  T extends { symbol: string; rank: number | null },
>(candidates: readonly T[], symbol?: string): T[] {
  const wanted = symbol?.trim().toUpperCase();
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => {
      const exactA = wanted && a.candidate.symbol.toUpperCase() === wanted;
      const exactB = wanted && b.candidate.symbol.toUpperCase() === wanted;
      if (exactA !== exactB) return exactA ? -1 : 1;
      const rankA = a.candidate.rank ?? Number.MAX_SAFE_INTEGER;
      const rankB = b.candidate.rank ?? Number.MAX_SAFE_INTEGER;
      return rankA - rankB || a.index - b.index;
    })
    .map(({ candidate }) => candidate);
}
