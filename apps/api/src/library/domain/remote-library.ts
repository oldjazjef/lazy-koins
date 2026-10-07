import {
  classifyPrivateValue,
  guessHeaderRow,
  looksLikeData,
  MAPPING_VERSION,
  type MappingSpec,
  type SourceFile,
  validateMappingSpec,
} from '@lazykoins/engine';
import {
  type HeaderMatchRequest,
  PUBLIC_LIBRARY_LIMITS,
} from './public-library';

/**
 * F5.18, desktop side: the installed app can be linked to the mapping library of a web
 * deployment (its public, read-only endpoint). Off and empty by default — without an address
 * (or with the F11.3 online switch off) the app never goes online for it. Hand-written domain
 * types (never a Prisma model).
 */
export interface RemoteLibrarySettings {
  readonly userId: string;
  /** The web deployment's normalised address, e.g. `https://lazykoins.example.ch`; `''` = none. */
  readonly url: string;
  readonly enabled: boolean;
  /** Library suggestions in the files tab (sends the header row + file name of a file). */
  readonly suggestions: boolean;
  readonly updatedAt: string | null;
}

export interface SaveRemoteLibrarySettings {
  readonly url: string;
  readonly enabled: boolean;
  readonly suggestions: boolean;
}

export function defaultRemoteLibrarySettings(
  userId: string,
): RemoteLibrarySettings {
  return {
    userId,
    url: '',
    enabled: false,
    suggestions: true,
    updatedAt: null,
  };
}

export const REMOTE_URL_MAX = 300;

/** Why an address cannot be used (the web translates `library.remote.urlProblems.<code>`). */
export const REMOTE_URL_PROBLEMS = [
  'invalidUrl',
  'httpsRequired',
  'credentialsInUrl',
  'tooLong',
] as const;
export type RemoteUrlProblem = (typeof REMOTE_URL_PROBLEMS)[number];

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The address rule: `https://` only — plain `http://` just for this machine (`localhost`,
 * `127.0.0.1`, `[::1]`: a dev server). No user/password, query or fragment. Returns the
 * normalised base (lower-case host, no trailing slash, a trailing `/api` dropped) or a problem.
 */
export function normaliseRemoteUrl(
  raw: string,
): { ok: true; url: string } | { ok: false; problem: RemoteUrlProblem } {
  const text = raw.trim();
  if (text.length > REMOTE_URL_MAX) return { ok: false, problem: 'tooLong' };
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return { ok: false, problem: 'invalidUrl' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, problem: 'invalidUrl' };
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return { ok: false, problem: 'credentialsInUrl' };
  }
  // `new URL` drops an empty `?` / `#`; look at the text too.
  if (
    parsed.search !== '' ||
    parsed.hash !== '' ||
    text.includes('?') ||
    text.includes('#')
  ) {
    return { ok: false, problem: 'invalidUrl' };
  }
  if (parsed.protocol === 'http:' && !LOOPBACK.has(parsed.hostname)) {
    return { ok: false, problem: 'httpsRequired' };
  }
  const path = parsed.pathname.replace(/\/+$/, '').replace(/\/api$/i, '');
  const url = `${parsed.origin}${path.replace(/\/+$/, '')}`;
  if (url.length > REMOTE_URL_MAX) return { ok: false, problem: 'tooLong' };
  return { ok: true, url };
}

/**
 * What a match request sends for one file: the likely header row (the engine's guess — the
 * widest row without numbers, dates or ids among the first rows, so no preamble value and no
 * data row) and the base file name. Cells that look like data are dropped anyway; sizes are
 * capped. `undefined` when the file has no such row (a PDF, an empty file).
 */
export function headerMatchRequest(
  file: SourceFile,
  fileName: string,
): HeaderMatchRequest | undefined {
  if (file.kind === 'pdf') return undefined;
  for (const sheet of file.sheets) {
    if (sheet.rows.length === 0) continue;
    const row = sheet.rows[guessHeaderRow(sheet.rows)] ?? [];
    const headers = row
      .map((cell) => cell.trim())
      .filter(
        (cell) =>
          cell !== '' &&
          !looksLikeData(cell) &&
          classifyPrivateValue(cell) === null,
      )
      .map((cell) => cell.slice(0, PUBLIC_LIBRARY_LIMITS.maxHeaderCellLength))
      .slice(0, PUBLIC_LIBRARY_LIMITS.maxHeaderCells);
    if (headers.length >= 2) {
      return { fileName: baseName(fileName), headers };
    }
  }
  return undefined;
}

/** The last path segment, capped — never a folder of this machine. */
export function baseName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? '';
  return base.slice(0, PUBLIC_LIBRARY_LIMITS.maxFileNameLength);
}

/**
 * Validates a spec that came from another server. Beyond `validateMappingSpec`: a key the local
 * schema does not know would be dropped silently (zod strips unknown keys) — a spec of a newer
 * app version could then read a file differently than its author saw. A newer spec `version`
 * likewise. Both mean "this app is too old" (`incompatibleSpec`); the paths are JSON Pointers.
 */
export function validateRemoteSpec(
  input: unknown,
): { ok: true; spec: MappingSpec } | { ok: false; paths: string[] } {
  const version = (input as { version?: unknown } | null)?.version;
  if (typeof version === 'number' && version > MAPPING_VERSION) {
    return { ok: false, paths: ['/version'] };
  }
  const validation = validateMappingSpec(input);
  if (!validation.ok) {
    return {
      ok: false,
      paths: validation.issues.map(
        (issue) => `/${issue.path.split('.').filter(Boolean).join('/')}`,
      ),
    };
  }
  const dropped = droppedKeys(input, validation.spec, '');
  return dropped.length > 0
    ? { ok: false, paths: dropped }
    : { ok: true, spec: validation.spec };
}

/** JSON Pointers of object keys in `input` that the parsed value no longer has. */
export function droppedKeys(
  input: unknown,
  parsed: unknown,
  path: string,
): string[] {
  if (Array.isArray(input) && Array.isArray(parsed)) {
    return input.flatMap((item, index) =>
      droppedKeys(item, parsed[index], `${path}/${index}`),
    );
  }
  if (isObject(input) && isObject(parsed)) {
    return Object.keys(input).flatMap((key) =>
      key in parsed
        ? droppedKeys(input[key], parsed[key], `${path}/${key}`)
        : [`${path}/${pointerToken(key)}`],
    );
  }
  return [];
}

function pointerToken(key: string): string {
  return key.replace(/~/g, '~0').replace(/\//g, '~1');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** What the app shows about the library (`GET /api/library/status`). */
export interface LibraryStatus {
  /** `web` = this deployment's own library; `remote` = the desktop, linked to a web server. */
  readonly mode: 'web' | 'remote';
  /** The library can be used now (web: always; desktop: linked, switched on and online). */
  readonly available: boolean;
  /** No publish / rate / delete (the desktop). */
  readonly readOnly: boolean;
  /** The linked server (desktop), `null` on the web or when none is set. */
  readonly server: string | null;
  /** Suggestions in the files tab are on and possible. */
  readonly suggestions: boolean;
  /** Desktop only: why it is not available (`libraryNotConfigured` | `offline`), else `null`. */
  readonly reason: 'libraryNotConfigured' | 'offline' | null;
}
