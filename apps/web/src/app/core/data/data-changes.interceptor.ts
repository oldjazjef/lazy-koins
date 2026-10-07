import { type HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { tap } from 'rxjs';
import { runtimeEnv } from '../config/runtime-env';
import { type DataChange, DataChanges } from './data-changes';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * POSTs that only read (previews, inspections, AI proposals, tests on unsaved form values) and
 * routes whose effect the URL cannot tell — they never report a change. The chat: a confirmed
 * proposal names its project only in the answer (`AssistantEvents`); asking changes no data.
 */
const READ_ONLY: readonly RegExp[] = [
  /^projects\/[^/]+\/files\/[^/]+\/mapping-preview$/,
  /^projects\/[^/]+\/files\/[^/]+\/ai\/(mapping|statement)$/,
  /^projects\/[^/]+\/mail\/compose$/,
  /^mapping-samples\//,
  // F5.15: the review before publishing to the mapping library stores nothing.
  /^library\/review$/,
  /^ai\/mapping-sample(\/payload)?$/,
  /^ai\/settings\/test$/,
  /^mail\/settings\/test$/,
  /^mail\/template\/preview$/,
  /^settings\/keys\/[^/]+\/test$/,
  /^settings\/wallets\/test$/,
  // F5.18: "Verbindung testen" with the typed address of a web library stores nothing.
  /^settings\/library\/test$/,
  /^wallets\/inspect$/,
  /^chat\//,
  /^pin\//,
  /^mcp$/,
  // Fetched asset by asset; the dashboard reloads once at the end.
  /^dashboard\/rates\/refresh$/,
];

/** What a change to the user's global data means for the projects: every one may use it. */
const EVERY_PROJECT = null;

/** `[pattern, change]` — the first match wins. Paths are relative to `/api/`. */
const RULES: readonly (readonly [
  RegExp,
  (match: RegExpMatchArray) => DataChange,
])[] = [
  [
    /^account\/import-package$/,
    () => ({
      projectId: EVERY_PROJECT,
      scope: ['mappings', 'wallets', 'settings', 'notifications'],
    }),
  ],
  [/^projects\/import-package$/, () => ({ scope: 'projects' })],
  [/^projects$/, () => ({ scope: 'projects' })],
  // A mapping saved from a project's file: the mappings page shows it, too.
  [
    /^projects\/([^/]+)\/files\/[^/]+\/ai\/mapping\/accept$/,
    (m) => ({
      projectId: m[1],
      scope: 'mappings',
    }),
  ],
  [
    /^projects\/([^/]+)\/wallets(\/.*)?$/,
    (m) => ({
      projectId: m[1],
      scope: 'wallets',
    }),
  ],
  [/^projects\/([^/]+)(\/.*)?$/, (m) => ({ projectId: m[1] })],
  // Mappings and wallets feed every project that uses them (files read again, derived files).
  [
    /^mappings(\/.*)?$/,
    () => ({ projectId: EVERY_PROJECT, scope: 'mappings' }),
  ],
  [
    /^ai\/mapping-sample\/accept$/,
    () => ({
      projectId: EVERY_PROJECT,
      scope: 'mappings',
    }),
  ],
  [/^wallets(\/.*)?$/, () => ({ projectId: EVERY_PROJECT, scope: 'wallets' })],
  // F5.16: taking from the library = a new mapping of mine, maybe assigned to a file of a
  // project the URL does not name. Publishing / rating / deleting an entry touch no own data.
  [
    /^library\/[^/]+\/take$/,
    () => ({ projectId: EVERY_PROJECT, scope: 'mappings' }),
  ],
  // F5.19: taking a standard mapping = a copy in my mappings, maybe assigned to a file of a
  // project the URL does not name (as the library's take).
  [
    /^standard-mappings\/[^/]+\/take$/,
    () => ({ projectId: EVERY_PROJECT, scope: 'mappings' }),
  ],
  // A new ESTV Kursliste: every project's Kurse tab says "neuer Stand".
  [
    /^rates\/estv\/update$/,
    () => ({ projectId: EVERY_PROJECT, scope: 'rates' }),
  ],
  [/^notifications(\/.*)?$/, () => ({ scope: 'notifications' })],
  // F5.18 (desktop): the link to a web library — the nav entry, the files tab's suggestions
  // and the library pages follow it (`LibraryAvailability` reloads on `settings`).
  [/^settings\/library$/, () => ({ scope: 'settings' })],
  [
    /^(settings|ai\/settings|assistant\/settings|mail|setup)(\/.*)?$/,
    () => ({
      scope: 'settings',
    }),
  ],
];

/** The path below `/api/`, without query; undefined for anything else. */
function apiPath(url: string): string | undefined {
  const base = runtimeEnv().apiBaseUrl;
  const path = (url.startsWith(base) ? url.slice(base.length) : url).split(
    '?',
  )[0];
  return path?.startsWith('/api/') ? path.slice('/api/'.length) : undefined;
}

/**
 * The change a successful request makes, from its method and URL — null for reads (GET, and the
 * POSTs in `READ_ONLY`) and for routes nothing on screen depends on.
 */
export function changeOf(method: string, url: string): DataChange | null {
  if (!MUTATING.has(method.toUpperCase())) return null;
  const path = apiPath(url);
  if (path === undefined) return null;
  if (READ_ONLY.some((pattern) => pattern.test(path))) return null;
  for (const [pattern, change] of RULES) {
    const match = path.match(pattern);
    if (match) return change(match);
  }
  return null;
}

/**
 * Reports every successful mutating API request to `DataChanges` (user rule 08.10.2026: every
 * change refreshes every view that shows affected data). Failed requests report nothing; a GET
 * never does, so a refetch can never trigger another one.
 */
export const dataChangesInterceptor: HttpInterceptorFn = (request, next) => {
  const change = changeOf(request.method, request.url);
  if (!change) return next(request);
  const changes = inject(DataChanges);
  return next(request).pipe(
    tap((event) => {
      if (event instanceof HttpResponse && event.ok) changes.changed(change);
    }),
  );
};
