// @vitest-environment node
// Reads source and message files from disk; no DOM involved.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
        !/\.(ts|html|css|json|js)$/.test(key)
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
