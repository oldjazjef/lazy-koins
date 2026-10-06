/**
 * The notification centre (F11.11–F11.13). Hand-written domain types — never a re-export of a
 * Prisma model.
 *
 * A notification belongs to one user and is keyed by a stable **topic** `<area>.<what>[:<subject>]`
 * (`rates.fetchFailed:<projectId>`, `file.needsMapping:<projectFileId>`, `estv.fetchFailed:2025`,
 * `key.invalid:ai`). Raising a topic again updates the one row (no duplicates); resolving it marks
 * the cause as gone. The text is an i18n key (`notifications.title.<area>.<what>`) plus short
 * params — **never** keys, passwords or booking details (F11.13): `sanitizeParams` enforces it.
 */

/** Mirrored by a CHECK in the migration. */
export const NOTIFICATION_KINDS = [
  'error',
  'action',
  'info',
  'success',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Actions the app runs itself instead of navigating ("Erneut versuchen"). */
export const NAMED_ACTIONS = ['retry:rates', 'retry:estv'] as const;
export type NamedAction = (typeof NAMED_ACTIONS)[number];

/** The button of a notification: a route in the app, or a named action (plus where to go). */
export interface NotificationAction {
  /** i18n key of the button ("Zum Hinweis", "Erneut versuchen", "Schlüssel prüfen", …). */
  readonly labelKey: string;
  /** An app route, always under `/app/`. */
  readonly route: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly fragment?: string;
  /** Run by the app before navigating (e.g. start the rate refresh again). */
  readonly named?: NamedAction;
}

export type NotificationParamValue = string | number | boolean | null;
export type NotificationParams = Readonly<
  Record<string, NotificationParamValue>
>;

export interface AppNotification {
  readonly id: string;
  readonly userId: string;
  readonly projectId: string | null;
  /** The project's name for grouping (null without a project or once it is gone). */
  readonly projectName: string | null;
  readonly kind: NotificationKind;
  readonly topic: string;
  readonly titleKey: string;
  readonly params: NotificationParams;
  readonly action: NotificationAction | null;
  /** First raised. */
  readonly createdAt: string;
  /** Last raised — the list is sorted by it, newest first. */
  readonly occurredAt: string;
  readonly readAt: string | null;
  readonly resolvedAt: string | null;
  readonly dismissedAt: string | null;
}

/** What a trigger hands to `NotificationService.raise`. */
export interface RaiseInput {
  readonly kind: NotificationKind;
  readonly projectId?: string | null;
  /** Default: `notifications.title.<topic base>`. */
  readonly titleKey?: string;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly action?: NotificationAction | null;
  /**
   * `event` (default for error/info/success): every raise is news — unread again, back from
   * resolved/dismissed. `condition` (default for `action`): a state that is checked again and
   * again (open items after every calculation) — only a change of its params, or its return after
   * it was resolved, makes it unread again; a dismissed condition stays dismissed until it changes.
   */
  readonly mode?: 'event' | 'condition';
}

/** The fields the repository stores for a raise. */
export interface NotificationWrite {
  readonly projectId: string | null;
  readonly kind: NotificationKind;
  readonly titleKey: string;
  readonly params: NotificationParams;
  readonly action: NotificationAction | null;
}

export const TOPIC_MAX = 300;

/** `rates.fetchFailed:abc` → `rates.fetchFailed`. */
export function topicBase(topic: string): string {
  const colon = topic.indexOf(':');
  return colon === -1 ? topic : topic.slice(0, colon);
}

export function defaultTitleKey(topic: string): string {
  return `notifications.title.${topicBase(topic)}`;
}

/** Stable topic names — one place, so triggers and auto-resolve always agree. */
export const Topics = {
  ratesFetchFailed: (projectId: string) => `rates.fetchFailed:${projectId}`,
  missingPrices: (projectId: string) => `rates.missingPrices:${projectId}`,
  estvFetchFailed: (year: number) => `estv.fetchFailed:${year}`,
  estvNewVersion: (projectId: string) => `estv.newVersion:${projectId}`,
  keyInvalid: (service: 'ai' | 'coingecko' | 'mail' | 'chain') =>
    `key.invalid:${service}`,
  walletFetchFailed: (walletId: string) => `wallet.fetchFailed:${walletId}`,
  aiCallFailed: () => 'ai.callFailed',
  mailSendFailed: (projectId: string) => `mail.sendFailed:${projectId}`,
  mailSent: (projectId: string) => `mail.sent:${projectId}`,
  exportFailed: (projectId: string) => `export.failed:${projectId}`,
  packageImportFailed: () => 'package.importFailed',
  fileNeedsMapping: (projectFileId: string) =>
    `file.needsMapping:${projectFileId}`,
  fileRowErrors: (projectFileId: string) => `file.rowErrors:${projectFileId}`,
  fileReadFailed: (projectId: string) => `file.readFailed:${projectId}`,
  openHints: (projectId: string) => `hints.open:${projectId}`,
  openItems: (projectId: string) => `checks.openItems:${projectId}`,
  changedSinceSent: (projectId: string) =>
    `project.changedSinceSent:${projectId}`,
  syncConflict: () => 'desktop.syncConflict',
  taskDone: (label: string, projectId: string | null) =>
    `task.done:${label}${projectId ? `:${projectId}` : ''}`,
  taskFailed: (label: string, projectId: string | null) =>
    `task.failed:${label}${projectId ? `:${projectId}` : ''}`,
} as const;

/** Every title key a topic can produce — the app's i18n spec lists them, too. */
export const TITLE_BASES = [
  'rates.fetchFailed',
  'rates.missingPrices',
  'estv.fetchFailed',
  'estv.newVersion',
  'key.invalid',
  'ai.callFailed',
  'mail.sendFailed',
  'mail.sent',
  'export.failed',
  'package.importFailed',
  'wallet.fetchFailed',
  'file.needsMapping',
  'file.rowErrors',
  'file.readFailed',
  'hints.open',
  'checks.openItems',
  'project.changedSinceSent',
  'desktop.syncConflict',
  'task.done',
  'task.failed',
] as const;

/** Links into a project's workspace (`?tab=` is read by the project page). */
export function projectRoute(
  projectId: string,
  labelKey: string,
  tab?: string,
  extra: { fragment?: string; named?: NamedAction } = {},
): NotificationAction {
  return {
    labelKey,
    route: `/app/projects/${projectId}`,
    ...(tab ? { query: { tab } } : {}),
    ...extra,
  };
}

const PARAM_NAME = /^[a-zA-Z][a-zA-Z0-9]{0,30}$/;
const PARAM_MAX = 12;
const STRING_MAX = 200;
export const REDACTED = '[…]';

/**
 * Patterns of things that must never reach a notification (F11.13): API keys and tokens, bearer
 * headers, URL credentials, extended private keys, raw 256-bit hex keys and seed phrases.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(?:sk|pk|rk|xai|gsk|hf)[-_][A-Za-z0-9_-]{8,}/,
  /\bbearer\s+\S{8,}/i,
  /\b(?:api[_-]?key|apikey|token|secret|password|passwd|pwd)\s*[:=]\s*\S+/i,
  /\b[xyzt](?:prv|pub)[1-9A-HJ-NP-Za-km-z]{30,}/,
  /\b(?:0x)?[0-9a-fA-F]{64}\b/,
  /\/\/[^/\s:@]+:[^/\s@]+@/,
  /^(?:[a-z]{3,8}\s+){11,23}[a-z]{3,8}$/,
];

/** One opaque token (no spaces, no dot) of 32+ characters mixing letters and digits. */
function looksLikeToken(value: string): boolean {
  return (
    value.length >= 32 &&
    /^[A-Za-z0-9_\-+/=]+$/.test(value) &&
    /[A-Za-z]/.test(value) &&
    /\d/.test(value)
  );
}

export function looksSecret(value: string): boolean {
  const trimmed = value.trim();
  return (
    looksLikeToken(trimmed) ||
    SECRET_PATTERNS.some((pattern) => pattern.test(trimmed))
  );
}

/**
 * Only short, flat, harmless params survive: names like `count`/`assets`, values string / number
 * / boolean / null (string lists are joined), control characters out, strings cut to 200, and
 * anything that looks like a key, token, password or seed phrase replaced by `[…]`.
 */
export function sanitizeParams(
  params: Readonly<Record<string, unknown>> | undefined,
): Record<string, NotificationParamValue> {
  const out: Record<string, NotificationParamValue> = {};
  if (!params) return out;
  for (const [name, raw] of Object.entries(params)) {
    if (Object.keys(out).length >= PARAM_MAX) break;
    if (!PARAM_NAME.test(name)) continue;
    let value: NotificationParamValue | undefined;
    if (raw === null || typeof raw === 'boolean') value = raw;
    else if (typeof raw === 'number') value = Number.isFinite(raw) ? raw : null;
    else if (typeof raw === 'string') value = cleanString(raw);
    else if (Array.isArray(raw)) {
      value = cleanString(
        raw
          .filter((item): item is string => typeof item === 'string')
          .slice(0, 20)
          .map((item) => (looksSecret(item) ? REDACTED : item))
          .join(', '),
      );
    }
    if (value !== undefined) out[name] = value;
  }
  return out;
}

function cleanString(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  if (looksSecret(text)) return REDACTED;
  return text.length > STRING_MAX ? `${text.slice(0, STRING_MAX - 1)}…` : text;
}

/** A route the app may navigate to: inside the app, no scheme, no `..`. */
export function isAppRoute(route: string): boolean {
  return (
    /^\/app(?:\/[A-Za-z0-9._~-]+)*\/?$/.test(route) && !route.includes('..')
  );
}

/** Keeps only a well-formed action (route inside the app, short query/fragment, known name). */
export function sanitizeAction(
  action: NotificationAction | null | undefined,
): NotificationAction | null {
  if (!action || !isAppRoute(action.route)) return null;
  if (!/^notifications\.action\.[a-zA-Z]+$/.test(action.labelKey)) return null;
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(action.query ?? {})) {
    if (/^[a-zA-Z]{1,20}$/.test(key) && /^[A-Za-z0-9._:-]{0,80}$/.test(value)) {
      query[key] = value;
    }
  }
  const fragment =
    action.fragment && /^[A-Za-z0-9_-]{1,80}$/.test(action.fragment)
      ? action.fragment
      : undefined;
  const named =
    action.named && (NAMED_ACTIONS as readonly string[]).includes(action.named)
      ? action.named
      : undefined;
  return {
    labelKey: action.labelKey,
    route: action.route,
    ...(Object.keys(query).length > 0 ? { query } : {}),
    ...(fragment ? { fragment } : {}),
    ...(named ? { named } : {}),
  };
}

/** Same content (kind, title, params, action) — a repeated condition is no news. */
export function sameContent(
  existing: Pick<AppNotification, 'kind' | 'titleKey' | 'params' | 'action'>,
  next: NotificationWrite,
): boolean {
  return (
    existing.kind === next.kind &&
    existing.titleKey === next.titleKey &&
    canonical(existing.params) === canonical(next.params) &&
    canonical(existing.action) === canonical(next.action)
  );
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
    )
    .join(',')}}`;
}

/** Status filter of the list. `unread` = not read yet; `all` = read or not. */
export const NOTIFICATION_STATUSES = ['unread', 'all'] as const;
export type NotificationStatusFilter = (typeof NOTIFICATION_STATUSES)[number];

export interface NotificationListCriteria {
  readonly status: NotificationStatusFilter;
  /** Also those whose cause is gone ("erledigte" shown). Dismissed ones are never listed. */
  readonly includeResolved: boolean;
  readonly kind?: NotificationKind;
  readonly projectId?: string;
  readonly offset: number;
  readonly limit: number;
}

export interface NotificationPage {
  readonly items: readonly AppNotification[];
  readonly total: number;
}

/** Which notifications a bulk resolve touches. */
export interface ResolveCriteria {
  readonly topics?: readonly string[];
  /** Topics starting with this text (e.g. `file.needsMapping:`). */
  readonly topicPrefix?: string;
  readonly projectId?: string;
  /** Topics that stay (the ones still true). */
  readonly exceptTopics?: readonly string[];
}

/** Resolved or dismissed notifications older than this are deleted. */
export const RETENTION_DAYS = 30;
