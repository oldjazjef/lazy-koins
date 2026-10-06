// @vitest-environment node
// Reads source and message files from disk; no DOM involved.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SETTINGS_SECTIONS } from '../../features/settings/settings-shell';
import { WORKSPACE_TABS } from '../../features/calculation/components/project-workspace/project-workspace.service';
import {
  CHECK_KINDS,
  CORRECTION_TYPES,
  EXPORT_KINDS,
  FETCH_STATUSES,
  INCOME_CATEGORIES,
  LIGHTS,
  OPEN_ITEM_REASONS,
  POSITION_STATUSES,
  PRICE_ORIGINS,
  QUANTITY_SOURCES,
} from '../api/calculation.types';
import {
  CARRYOVER_KINDS,
  HOLDING_STATUSES,
  KPI_KINDS,
} from '../api/dashboard.types';

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
  ...['startsLate', 'endsEarly', 'noYearEndBalance'].flatMap((kind) => [
    `files.missing.kind.${kind}`,
    `files.missing.howTo.${kind}`,
  ]),
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
  ...['ai', 'manual', 'copied'].map((origin) => `mappings.origin.${origin}`),
  ...WORKSPACE_TABS.map((tab) => `workspace.tabs.${tab}`),
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
  ...['manual', 'estv', 'binance', 'coingecko', 'ecb'].map(
    (source) => `rates.source.${source}`,
  ),
  ...FETCH_STATUSES.map((status) => `rates.status.${status}`),
  ...EXPORT_KINDS.map((kind) => `exports.kind.${kind}`),
  ...['statements', 'internal'].map((group) => `exports.groups.${group}`),
  ...SETTINGS_SECTIONS.map((section) => `settings.sections.${section}`),
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
  ...['openai_compatible', 'anthropic'].map(
    (provider) => `settings.ai.providers.${provider}`,
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

describe('i18n message files', () => {
  const keys = [...referencedKeys()];

  it('finds the keys it is supposed to check', () => {
    expect(keys.length).toBeGreaterThan(40);
  });

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
