import { z } from 'zod';

/**
 * F5.18: the mapping library of a web deployment, read from the desktop app over its public,
 * read-only endpoint (`GET|POST <server>/api/public/library…`). Plain `fetch`, a timeout and a
 * size cap per call; every answer is parsed and validated here — nothing from the other server is
 * trusted beyond these schemas (texts stay texts; the spec is validated again before it is
 * stored).
 */

export type RemoteLibraryErrorCode =
  /** DNS, connection refused, TLS, a redirect. */
  | 'network'
  | 'timeout'
  /** The entry does not exist (any more). */
  | 'notFound'
  /** Not JSON, not the expected shape, too large. */
  | 'badResponse'
  /** The server has no public library (switched off, or not a lazy-koins server). */
  | 'disabled'
  /** The user's online switch or `RATES_ONLINE=false` (F11.3) — raised by the gate. */
  | 'offline'
  | 'rateLimited';

export class RemoteLibraryError extends Error {
  constructor(
    readonly code: RemoteLibraryErrorCode,
    /** One technical line (status, cause) — never a response body. */
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'RemoteLibraryError';
  }
}

const text = (max: number) => z.string().max(max);
const isoDate = z.string().max(40);

export const RemoteEntrySchema = z.object({
  id: z.uuid(),
  name: text(200).min(1),
  platform: text(40).min(1),
  description: text(2000).nullable(),
  authorName: text(80).nullable(),
  version: z.number().int().min(1).max(1_000_000),
  fingerprint: text(20_000),
  ratingAverage: z.number().min(0).max(5).nullable(),
  ratingCount: z.number().int().min(0),
  usageCount: z.number().int().min(0),
  publishedAt: isoDate,
  updatedAt: isoDate,
});
export type RemoteEntry = z.infer<typeof RemoteEntrySchema>;

export const RemoteEntryDetailSchema = RemoteEntrySchema.extend({
  /** Validated as a mapping spec by the caller (`validateRemoteSpec`). */
  spec: z.record(z.string(), z.unknown()),
});
export type RemoteEntryDetail = z.infer<typeof RemoteEntryDetailSchema>;

export const RemotePageSchema = z.object({
  items: z.array(RemoteEntrySchema).max(50),
  total: z.number().int().min(0),
  offset: z.number().int().min(0),
  limit: z.number().int().min(1),
});
export type RemotePage = z.infer<typeof RemotePageSchema>;

export const RemoteMatchesSchema = z.object({
  items: z.array(RemoteEntrySchema).max(10),
});

/** What one match request sends: the file's header row and its base name — nothing else. */
export interface RemoteMatchRequest {
  readonly fileName: string;
  readonly headers: readonly string[];
}

export interface RemoteSearch {
  readonly search?: string;
  readonly platform?: string;
  readonly sort?: string;
  readonly offset?: number;
  readonly limit?: number;
}

export abstract class RemoteLibraryPort {
  /** One page of entries. `baseUrl` = the normalised server address (no `/api`). */
  abstract search(baseUrl: string, search: RemoteSearch): Promise<RemotePage>;

  /** One entry with its spec (not yet validated as a spec). */
  abstract get(baseUrl: string, id: string): Promise<RemoteEntryDetail>;

  /** Entries that would read a file with this header row + name. Nothing else is sent. */
  abstract match(
    baseUrl: string,
    request: RemoteMatchRequest,
  ): Promise<RemoteEntry[]>;
}
