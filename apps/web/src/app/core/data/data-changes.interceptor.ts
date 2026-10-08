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
  // F9.10: what the AI would get — nothing is stored.
  /^transactions\/ai\/payload$/,
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
  // Price sources: "Testen" of one provider (typed or stored key) stores nothing.
  /^settings\/price-sources\/[^/]+\/test$/,
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
  // Platform admin: accounts, the admin role, library moderation (the library lists follow).
  [
    /^admin\/library\/[^/]+\/(hide|unhide)$/,
    () => ({ scope: ['admin', 'mappings'] }),
  ],
  [/^admin\//, () => ({ scope: 'admin' })],
  // F5.7a: a file (de)activated — the project's files, hints, result status and the dashboard
  // follow; its "ohne Mapping"/"Zeilenfehler" notifications are resolved or raised again.
  [
    /^projects\/([^/]+)\/files\/[^/]+\/active$/,
    (m) => ({ projectId: m[1], scope: ['notifications', 'files'] }),
  ],
  [/^projects$/, () => ({ scope: 'projects' })],
  // F7.4 "Coin wählen": the coin of a ticker is the user's — it removes that asset's fetched
  // prices in every open project and the dashboard's cache, so every project, the dashboard
  // (via `projects`) and Einstellungen › Kurse reload.
  [
    /^projects\/[^/]+\/rates\/coin$/,
    () => ({ projectId: EVERY_PROJECT, scope: ['rates', 'settings'] }),
  ],
  [
    /^settings\/coins\/[^/]+(\/dismissal)?$/,
    () => ({ projectId: EVERY_PROJECT, scope: ['rates', 'settings'] }),
  ],
  // A mapping saved from a project's file: the mappings page shows it, too.
  [
    /^projects\/[^/]+\/files\/[^/]+\/ai\/mapping\/accept$/,
    () => ({
      projectId: EVERY_PROJECT,
      scope: ['mappings', 'files'],
    }),
  ],
  [
    /^projects\/([^/]+)\/wallets(\/.*)?$/,
    (m) => ({
      projectId: m[1],
      scope: 'wallets',
    }),
  ],
  // F5.21: how a file is read is the file's — every project selecting it follows (a removal
  // from the project shares the URL and only reloads more).
  [
    /^projects\/([^/]+)\/files\/select$/,
    (m) => ({ projectId: m[1], scope: 'files' }),
  ],
  [
    /^projects\/[^/]+\/files\/[^/]+$/,
    () => ({ projectId: EVERY_PROJECT, scope: 'files' }),
  ],
  // An upload, a selection (F5.22) or a derived file: the project and my files.
  [
    /^projects\/([^/]+)\/files(\/.*)?$/,
    (m) => ({ projectId: m[1], scope: 'files' }),
  ],
  // F9.8: a global transaction edit (or an accepted AI suggestion) changes every project that
  // reads the transaction; a mapping rule changes the mapping too (F9.10).
  [
    /^transactions\/(edits(\/[^/]+\/(undo|redo))?|suggestions\/accept)$/,
    () => ({ projectId: EVERY_PROJECT, scope: 'transactions' }),
  ],
  [
    /^transactions\/mapping-rule$/,
    () => ({ projectId: EVERY_PROJECT, scope: ['mappings', 'transactions'] }),
  ],
  [
    /^transactions\/(ai\/suggest|suggestions\/dismiss)$/,
    () => ({ scope: 'transactions' }),
  ],
  [/^files$/, () => ({ scope: 'files' })],
  [/^files\/.+$/, () => ({ projectId: EVERY_PROJECT, scope: 'files' })],
  [/^projects\/([^/]+)(\/.*)?$/, (m) => ({ projectId: m[1] })],
  // Mappings and wallets feed every project that uses them (files read again, derived files).
  [
    /^mappings(\/.*)?$/,
    () => ({ projectId: EVERY_PROJECT, scope: ['mappings', 'files'] }),
  ],
  [
    /^ai\/mapping-sample\/accept$/,
    () => ({
      projectId: EVERY_PROJECT,
      scope: ['mappings', 'files'],
    }),
  ],
  [/^wallets(\/.*)?$/, () => ({ projectId: EVERY_PROJECT, scope: 'wallets' })],
  // F5.16: taking from the library = a new mapping of mine, maybe assigned to a file of a
  // project the URL does not name. Publishing / rating / deleting an entry touch no own data.
  [
    /^library\/[^/]+\/take$/,
    () => ({ projectId: EVERY_PROJECT, scope: ['mappings', 'files'] }),
  ],
  // F5.19: taking a standard mapping = a copy in my mappings, maybe assigned to a file of a
  // project the URL does not name (as the library's take).
  [
    /^standard-mappings\/[^/]+\/take$/,
    () => ({ projectId: EVERY_PROJECT, scope: ['mappings', 'files'] }),
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
  // Price sources: PUT /settings may change the provider order (or a key) — it ranks the stored
  // series of every project and the dashboard, so their results (stale) and rates follow.
  [
    /^settings$/,
    () => ({ projectId: EVERY_PROJECT, scope: ['rates', 'settings'] }),
  ],
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
