/** Hand-mirrored from `apps/api/src/notifications` (F11.11–F11.13). */

export const NOTIFICATION_KINDS = [
  'error',
  'action',
  'info',
  'success',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type NamedAction = 'retry:rates' | 'retry:estv';

/**
 * `notifications.title.<base>` — every title the API produces (its `TITLE_BASES`). Template
 * literals: i18n-keys.spec.ts reads quoted dotted literals as translation keys.
 */
export const NOTIFICATION_TITLE_BASES = [
  `rates.fetchFailed`,
  `rates.missingPrices`,
  `estv.fetchFailed`,
  `estv.newVersion`,
  `key.invalid`,
  `ai.callFailed`,
  `mail.sendFailed`,
  `mail.sent`,
  `export.failed`,
  `package.importFailed`,
  `wallet.fetchFailed`,
  `file.needsMapping`,
  `file.rowErrors`,
  `file.readFailed`,
  `hints.open`,
  `checks.openItems`,
  `project.changedSinceSent`,
  `desktop.syncConflict`,
  `setup.incomplete`,
  `task.done`,
  `task.failed`,
] as const;

/** `notifications.action.<label>` — the buttons the API names. */
export const NOTIFICATION_ACTION_LABELS = [
  'show',
  'retry',
  'checkKey',
  'checkSettings',
  'toFile',
  'toFiles',
  'toHint',
  'toChecks',
  'toRates',
  'toExports',
  'toStorage',
  'toSetup',
] as const;

/** `notifications.reason.<code>` — ESTV, mail and package failure codes. */
export const NOTIFICATION_REASONS = [
  'network',
  'timeout',
  'http',
  'badResponse',
  'tooLarge',
  'badArchive',
  'badXml',
  'notFound',
  'processing',
  'auth',
  'tls',
  'connection',
  'dns',
  'rejected',
  'protocol',
  'unknown',
  'notZip',
  'unsafePath',
  'manifest',
  'tampered',
  'version',
  'content',
  'unexpected',
  'notConfigured',
  'invalidKey',
  'rateLimited',
  'chainNotOnPlan',
  'providerError',
  'invalidAddress',
  'unsupported',
] as const;

export interface NotificationAction {
  /** i18n key of the button. */
  readonly labelKey: string;
  /** App route under `/app/`. */
  readonly route: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly fragment?: string;
  /** Run by the app before navigating ("Erneut versuchen"). */
  readonly named?: NamedAction;
}

export interface AppNotification {
  readonly id: string;
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly kind: NotificationKind;
  /** Stable key, `<area>.<what>[:<subject>]`. */
  readonly topic: string;
  readonly titleKey: string;
  readonly params: Readonly<Record<string, string | number | boolean | null>>;
  readonly action: NotificationAction | null;
  readonly createdAt: string;
  readonly occurredAt: string;
  readonly readAt: string | null;
  readonly resolvedAt: string | null;
  readonly dismissedAt: string | null;
}

export interface NotificationList {
  readonly items: readonly AppNotification[];
  readonly total: number;
  readonly unread: number;
}

export interface NotificationCount {
  readonly unread: number;
}
