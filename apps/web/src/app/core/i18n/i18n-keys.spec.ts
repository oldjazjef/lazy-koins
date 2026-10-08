// @vitest-environment node
// Reads source and message files from disk; no DOM involved.
import {
  ADMIN_ACTIONS,
  ADMIN_LIBRARY_FILTERS,
  ADMIN_USER_FILTERS,
} from '../api/admin.types';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from './locales';
import {
  LOCAL_SETTINGS_SECTIONS,
  SETTINGS_SECTIONS,
} from '../../features/settings/settings-shell';
import { WORKSPACE_TABS } from '../../features/calculation/components/project-workspace/project-workspace.service';
import {
  CHECK_KINDS,
  CORRECTION_TYPES,
  ESTV_PHASES,
  EXPORT_KINDS,
  FETCH_STATUSES,
  INCOME_CATEGORIES,
  LIGHTS,
  OPEN_ITEM_REASONS,
  POSITION_STATUSES,
  PRICE_ORIGINS,
  QUANTITY_SOURCES,
  RATE_SOURCES,
} from '../api/calculation.types';
import {
  PRICE_PROVIDERS,
  PRICE_SOURCE_ERROR_CODES,
} from '../api/price-sources.types';
import {
  ADDRESS_KINDS,
  CHAIN_SERVICES,
  FETCH_NOTES,
  NETWORK_COVERAGES,
  NETWORK_IDS,
  SECRET_KINDS,
  SPAM_REASONS,
  WALLET_ERROR_CODES,
} from '../api/wallets.types';
import {
  CHANGE_REASONS,
  MAIL_ERROR_CODES,
  MAIL_PLACEHOLDERS,
  MAIL_SECURITIES,
  SENT_VIA,
  SMTP_ERROR_KINDS,
} from '../api/mail.types';
import {
  CARRYOVER_KINDS,
  HOLDING_STATUSES,
  KPI_KINDS,
} from '../api/dashboard.types';
import {
  NOTIFICATION_ACTION_LABELS,
  NOTIFICATION_KINDS,
  NOTIFICATION_REASONS,
  NOTIFICATION_TITLE_BASES,
} from '../api/notifications.types';
import {
  FINGERPRINT_VERDICTS,
  HINT_KINDS,
  HINT_SEVERITIES,
  HINT_STATUSES,
  LIBRARY_SORTS,
  SUGGESTION_SOURCES,
  MISSING_FILE_KINDS,
  PRIVACY_FINDING_KINDS,
  REMOTE_URL_PROBLEMS,
} from '../api/api.types';
import {
  AUDIT_SOURCES,
  AUDIT_STATUSES,
  CHAT_EVENT_OUTCOMES,
  MCP_AREAS,
  MCP_TOKEN_STATES,
  TOKEN_EXPIRIES,
  TOOL_EFFECTS,
  TOOL_ERROR_CODES,
} from '../api/assistant.types';
import {
  API_ERROR_CODES,
  HTTP_STATUS_NAMES,
  PACKAGE_ERROR_CODES,
} from '../api/api-error';
import {
  KEY_CHECK_CODES,
  PIN_ERROR_CODES,
  SETUP_STEPS,
  STEP_STATES,
} from '../api/setup.types';

/**
 * Every i18n key the app references exists in every message file. A missing key renders as its
 * raw path (`projects.detail.title`) — invisible in review, obvious to users.
 *
 * Keys are found as quoted dotted literals ending in the `translate` pipe or passed to the
 * notification/action machinery. Keys assembled at runtime are listed explicitly below.
 */
const APP_DIR = fileURLToPath(new URL('../..', import.meta.url));
const I18N_DIR = fileURLToPath(
  new URL('../../../../public/i18n', import.meta.url),
);

const DYNAMIC_KEYS = [
  ...['in_progress', 'reviewed', 'closed'].map(
    (status) => `projects.status.${status}`,
  ),
  ...['standard', 'mapped', 'needs_mapping', 'evidence_only'].map(
    (status) => `files.status.${status}`,
  ),
  ...['queued', 'uploading', 'done', 'failed'].map(
    (state) => `files.upload.state.${state}`,
  ),
  ...MISSING_FILE_KINDS.map((kind) => `files.missing.howTo.${kind}`),
  ...['noYearDataZero', 'endsEarlyZero'].map(
    (kind) => `files.missing.howTo.${kind}`,
  ),
  ...HINT_KINDS.flatMap((kind) => [
    `hints.kind.${kind}`,
    `hints.short.${kind}`,
  ]),
  ...['noYearDataZero', 'endsEarlyZero'].map((kind) => `hints.short.${kind}`),
  ...['unrecognisedFile', 'rowErrors'].map((kind) => `hints.howTo.${kind}`),
  ...HINT_SEVERITIES.map((severity) => `hints.severity.${severity}`),
  ...HINT_STATUSES.map((status) => `hints.status.${status}`),
  ...['mapping', 'statement'].map((mode) => `activity.ai.${mode}Ready`),
  ...[
    'required',
    'invalidNumber',
    'invalidTimestamp',
    'timeZoneMissing',
    'invalidKind',
    'invalidDate',
    'negative',
    'headerNotFound',
  ].map((code) => `files.rowErrors.${code}`),
  ...[
    'trade',
    'deposit',
    'withdrawal',
    'fee',
    'transfer',
    'income_interest',
    'income_staking',
    'income_airdrop',
    'income_launchpool',
    'income_hardfork',
    'loss',
    'spam',
    'unknown',
  ].map((kind) => `bookings.kind.${kind}`),
  ...['ai', 'manual', 'copied', 'library'].map(
    (origin) => `mappings.origin.${origin}`,
  ),
  // F5.15–F5.17: the mapping library.
  ...LIBRARY_SORTS.map((sort) => `library.sortBy.${sort}`),
  ...PRIVACY_FINDING_KINDS.map((kind) => `library.findings.kind.${kind}`),
  // F5.18: the desktop's link to a web library.
  ...REMOTE_URL_PROBLEMS.map(
    (problem) => `library.remote.urlProblems.${problem}`,
  ),
  // F5.19 / F11.0u / F5.20: suggestions, several mapping files, bulk publish.
  ...SUGGESTION_SOURCES.map((source) => `files.suggestions.source.${source}`),
  ...[
    'stored',
    'duplicate',
    'invalid',
    'notJson',
    'tooLarge',
    'tooMany',
    'failed',
  ].map((state) => `mappings.import.state.${state}`),
  ...['libraryCopy', 'tooLarge', 'reviewFailed'].map(
    (block) => `library.bulk.block.${block}`,
  ),
  ...WORKSPACE_TABS.map((tab) => `workspace.tabs.${tab}`),
  // The management pages (platform admins).
  ...ADMIN_ACTIONS.map((action) => `admin.audit.actions.${action}`),
  ...ADMIN_USER_FILTERS.map((filter) => `admin.users.filters.${filter}`),
  ...ADMIN_LIBRARY_FILTERS.map((filter) => `admin.library.filters.${filter}`),
  ...['block', 'unblock', 'grant', 'revoke', 'delete'].flatMap((kind) =>
    ['title', 'body', 'action'].map(
      (part) => `admin.users.dialogs.${kind}.${part}`,
    ),
  ),
  ...['hide', 'unhide'].flatMap((kind) =>
    ['title', 'body', 'action'].map(
      (part) => `admin.library.dialogs.${kind}.${part}`,
    ),
  ),
  ...KPI_KINDS.map((kind) => `dashboard.kpi.${kind}`),
  ...HOLDING_STATUSES.map((status) => `dashboard.holdings.status.${status}`),
  ...CARRYOVER_KINDS.map((kind) => `projects.carryover.kind.${kind}`),
  ...POSITION_STATUSES.map((status) => `result.status.${status}`),
  ...QUANTITY_SOURCES.map((source) => `result.quantitySource.${source}`),
  ...PRICE_ORIGINS.map((origin) => `result.priceOrigin.${origin}`),
  ...INCOME_CATEGORIES.map((category) => `result.category.${category}`),
  ...['negative', 'missingPrice'].map((status) => `result.gapStatus.${status}`),
  ...LIGHTS.map((light) => `checks.light.${light}`),
  ...CHECK_KINDS.map((kind) => `checks.kind.${kind}`),
  ...OPEN_ITEM_REASONS.map((reason) => `checks.reason.${reason}`),
  ...CORRECTION_TYPES.map((type) => `corrections.type.${type}`),
  ...['price', 'fx'].map((kind) => `rates.kind.${kind}`),
  ...RATE_SOURCES.map((source) => `rates.source.${source}`),
  // Price sources: provider errors (refresh summary, notifications, "Testen").
  ...PRICE_SOURCE_ERROR_CODES.map((code) => `rates.sourceErrors.${code}`),
  ...PRICE_PROVIDERS.map((id) => `rates.source.${id}`),
  ...['coingecko', 'coinmarketcap'].map((id) => `rates.attribution.${id}`),
  ...['noKey', 'offline'].map((code) => `settings.priceSources.test.${code}`),
  ...FETCH_STATUSES.map((status) => `rates.status.${status}`),
  ...ESTV_PHASES.map((phase) => `estv.phase.${phase}`),
  ...['updated', 'current', 'failed'].map(
    (outcome) => `estv.outcome.${outcome}`,
  ),
  ...EXPORT_KINDS.map((kind) => `exports.kind.${kind}`),
  ...['statements', 'internal'].map((group) => `exports.groups.${group}`),
  ...SETTINGS_SECTIONS.map((section) => `settings.sections.${section}`),
  ...LOCAL_SETTINGS_SECTIONS.map((section) => `settings.sections.${section}`),
  ...MAIL_SECURITIES.map((security) => `settings.mail.securities.${security}`),
  ...MAIL_PLACEHOLDERS.map((name) => `mail.placeholders.${name}`),
  ...SMTP_ERROR_KINDS.map((kind) => `mail.smtp.kind.${kind}`),
  ...[...MAIL_ERROR_CODES, 'failed', 'unreachable'].map(
    (code) => `mail.errors.${code}`,
  ),
  ...SENT_VIA.map((way) => `projects.sent.via.${way}`),
  ...CHANGE_REASONS.map((reason) => `projects.sent.reason.${reason}`),
  ...['name', 'platform', 'updated', 'files'].map(
    (sort) => `mappings.list.sortBy.${sort}`,
  ),
  ...[
    'failed',
    'unreachable',
    'closed',
    'aiDisabled',
    'aiNotConfigured',
    'consentRequired',
    'keyUnreadable',
    'privateUrl',
    'invalidUrl',
    'encryptionUnavailable',
    'noText',
    'invalidAnswer',
    'invalidKey',
    'rateLimited',
    'network',
    'timeout',
    'badResponse',
    'providerError',
    'modelNotFound',
  ].map((code) => `ai.errors.${code}`),
  ...['disabled', 'notConfigured'].map((reason) => `ai.notReady.${reason}`),
  ...FINGERPRINT_VERDICTS.map(
    (verdict) => `mappings.sample.fingerprint.${verdict}`,
  ),
  ...[
    'invalidSpec',
    'headerNotFound',
    'noRecords',
    'rowErrors',
    'unknownKinds',
  ].map((problem) => `ai.mapping.problems.${problem}`),
  ...[
    'notVerbatim',
    'pageMismatch',
    'invalidNumber',
    'ambiguousSeparator',
    'priceNotVerbatim',
    'pageOutOfRange',
    'invalidRecord',
  ].map((issue) => `ai.statement.issues.${issue}`),
  ...NETWORK_IDS.map((network) => `wallets.network.${network}`),
  ...NETWORK_COVERAGES.map((coverage) => `wallets.coverage.${coverage}`),
  ...ADDRESS_KINDS.map((kind) => `wallets.kind.${kind}`),
  ...SECRET_KINDS.map((kind) => `wallets.secret.kind.${kind}`),
  ...WALLET_ERROR_CODES.map((code) => `wallets.errors.${code}`),
  ...FETCH_NOTES.map((note) => `wallets.notes.${note}`),
  ...SPAM_REASONS.map((reason) => `wallets.spamReason.${reason}`),
  ...CHAIN_SERVICES.flatMap((service) => [
    `settings.wallets.services.${service}.title`,
    `settings.wallets.services.${service}.hint`,
  ]),
  ...[
    'etherscanKey',
    'heliusKey',
    'subscanKey',
    'solanaRpcUrl',
    'esploraUrl',
    'koiosUrl',
    'cosmosLcdUrl',
  ].map((field) => `settings.wallets.fields.${field}`),
  ...MCP_AREAS.map((area) => `mcp.areas.${area}`),
  ...TOOL_EFFECTS.map((effect) => `assistant.effect.${effect}`),
  ...MCP_TOKEN_STATES.map((state) => `mcp.tokens.state.${state}`),
  ...TOKEN_EXPIRIES.map((expiry) => `mcp.tokens.expiry.${expiry}`),
  ...AUDIT_SOURCES.map((source) => `mcp.audit.source.${source}`),
  ...AUDIT_STATUSES.map((status) => `mcp.audit.status.${status}`),
  ...['openai_compatible', 'anthropic'].map(
    (provider) => `settings.ai.providers.${provider}`,
  ),
  ...NOTIFICATION_TITLE_BASES.map((base) => `notifications.title.${base}`),
  ...NOTIFICATION_ACTION_LABELS.map((label) => `notifications.action.${label}`),
  ...NOTIFICATION_REASONS.map((reason) => `notifications.reason.${reason}`),
  ...NOTIFICATION_KINDS.map((kind) => `notifications.kind.${kind}`),
  ...['all', 'unread', 'resolved'].map(
    (status) => `notifications.page.statuses.${status}`,
  ),
  ...[
    'openai',
    'anthropic',
    'mistral',
    'groq',
    'openrouter',
    'ollama',
    'lmstudio',
  ].map((preset) => `settings.ai.presets.${preset}`),
  // F11.0s / F11.0p: the setup wizard and the PIN lock.
  ...['noKey', 'offline'].map((code) => `settings.keyTest.${code}`),
  ...KEY_CHECK_CODES.flatMap((code) => [
    `settings.keyTest.codes.${code}`,
    `settings.keyTest.hints.${code}`,
  ]),
  ...SETUP_STEPS.flatMap((step) => [
    `setup.steps.${step}.title`,
    `setup.steps.${step}.intro`,
  ]),
  ...STEP_STATES.map((state) => `setup.state.${state}`),
  ...[
    'profile',
    'advisor',
    'ai',
    'onlineRates',
    'coingeckoKey',
    'etherscanKey',
    'mail',
    'pin',
  ].flatMap((item) =>
    ['title', 'ok', 'missing'].map(
      (part) => `setup.summary.items.${item}.${part}`,
    ),
  ),
  ...[...PIN_ERROR_CODES, 'failed'].map((code) => `pin.errors.${code}`),
  // F11.2: API errors by code / HTTP status, chat events and tool failures, notification params.
  ...API_ERROR_CODES.map((code) => `errors.api.${code}`),
  ...HTTP_STATUS_NAMES.map((name) => `errors.status.${name}`),
  ...PACKAGE_ERROR_CODES.map((code) => `notifications.reason.${code}`),
  ...TOOL_ERROR_CODES.map((code) => `chat.proposal.errors.${code}`),
  ...CHAT_EVENT_OUTCOMES.map((outcome) => `chat.event.${outcome}`),
  ...['ai', 'coingecko', 'coinmarketcap', 'mail', 'chain'].map(
    (service) => `notifications.service.${service}`,
  ),
  ...['idle', 'lock-screen', 'suspend', 'unknown'].map(
    (reason) => `pin.lock.reason.${reason}`,
  ),
];

/** Keys that only exist in specs (fixtures of the copied ActionRunner spec). */
const SPEC_ONLY = /^(thing|groups|greeting)\./;

/** DatePipe formats look like keys (`'dd.MM.yyyy'`) but are not. */
const DATE_FORMAT = /^[dMyHhms]+(\.[dMyHhms]+)+$/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(html|ts)$/.test(name) && !name.endsWith('.spec.ts')
      ? [path]
      : [];
  });
}

function referencedKeys(): Set<string> {
  const keys = new Set(DYNAMIC_KEYS);
  const literal = /'([a-z][a-zA-Z]*(?:\.[a-zA-Z]+)+)'/g;
  for (const file of files(APP_DIR)) {
    for (const [, key] of readFileSync(file, 'utf8').matchAll(literal)) {
      if (
        key &&
        !SPEC_ONLY.test(key) &&
        !DATE_FORMAT.test(key) &&
        !key.startsWith('projects.status.') &&
        !/\.(ts|html|css|json|js|zip)$/.test(key)
      ) {
        keys.add(key);
      }
    }
  }
  return keys;
}

function has(messages: unknown, key: string): boolean {
  let node: unknown = messages;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null || !(part in node))
      return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string';
}

/** Every `key → text` of a message file, flattened (`a.b.c`). */
function flatten(
  node: unknown,
  prefix = '',
  out = new Map<string, string>(),
): Map<string, string> {
  if (typeof node === 'string') {
    out.set(prefix, node);
  } else if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      flatten(value, prefix ? `${prefix}.${key}` : key, out);
    }
  }
  return out;
}

/** `{{ name }}` placeholders of a text, sorted. */
function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)]
    .map((match) => match[1] ?? '')
    .sort();
}

function messagesOf(locale: string): Map<string, string> {
  return flatten(
    JSON.parse(readFileSync(join(I18N_DIR, `${locale}.json`), 'utf8')),
  );
}

describe('i18n message files', () => {
  const keys = [...referencedKeys()];

  it('finds the keys it is supposed to check', () => {
    expect(keys.length).toBeGreaterThan(40);
  });

  it('has exactly one file per supported locale (F11.2)', () => {
    expect(
      readdirSync(I18N_DIR)
        .filter((name) => name.endsWith('.json'))
        .map((name) => name.replace(/\.json$/, ''))
        .sort(),
    ).toEqual([...SUPPORTED_LOCALES].sort());
  });

  const reference = messagesOf(DEFAULT_LOCALE);
  for (const locale of SUPPORTED_LOCALES.filter((l) => l !== DEFAULT_LOCALE)) {
    it(`${locale}.json has the same keys as ${DEFAULT_LOCALE}.json — none missing, none extra`, () => {
      const messages = messagesOf(locale);
      expect([...reference.keys()].filter((key) => !messages.has(key))).toEqual(
        [],
      );
      expect([...messages.keys()].filter((key) => !reference.has(key))).toEqual(
        [],
      );
    });

    it(`${locale}.json keeps every placeholder and translates every text`, () => {
      const messages = messagesOf(locale);
      const wrong = [...reference].filter(
        ([key, text]) =>
          placeholders(messages.get(key) ?? '').join() !==
          placeholders(text).join(),
      );
      expect(wrong.map(([key]) => key)).toEqual([]);
      expect(
        [...messages].filter(([, text]) => text.trim() === '').map(([k]) => k),
      ).toEqual([]);
    });
  }

  for (const file of readdirSync(I18N_DIR).filter((name) =>
    name.endsWith('.json'),
  )) {
    it(`${file} contains every referenced key`, () => {
      const messages: unknown = JSON.parse(
        readFileSync(join(I18N_DIR, file), 'utf8'),
      );
      expect(keys.filter((key) => !has(messages, key))).toEqual([]);
    });
  }
});
