import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  defaultTitleKey,
  isAppRoute,
  looksSecret,
  TITLE_BASES,
  topicBase,
  Topics,
} from './notification';

/** The app's messages: every title the API can produce must have a text (F11.11). */
const MESSAGES = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../../web/public/i18n/de-CH.json'),
    'utf8',
  ),
) as Record<string, unknown>;

function message(key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object'
          ? (node as Record<string, unknown>)[part]
          : undefined,
      MESSAGES,
    );
}

describe('notification topics', () => {
  it('derive their title key from the topic base, and every base has a text', () => {
    expect(topicBase(Topics.ratesFetchFailed('p1'))).toBe('rates.fetchFailed');
    expect(defaultTitleKey(Topics.taskDone('activity.rates', 'p1'))).toBe(
      'notifications.title.task.done',
    );
    for (const base of TITLE_BASES) {
      expect(typeof message(`notifications.title.${base}`)).toBe('string');
    }
    const produced = Object.values(Topics).map((topic) =>
      topicBase((topic as (...args: never[]) => string)(...([] as never[]))),
    );
    for (const base of produced) expect(TITLE_BASES).toContain(base);
  });

  it('every action label the API uses has a text', () => {
    const root = resolve(__dirname, '../..');
    const files = (readdirSync(root, { recursive: true }) as string[]).filter(
      (name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'),
    );
    const labels = new Set<string>();
    for (const file of files) {
      const text = readFileSync(resolve(root, file), 'utf8');
      for (const [key] of text.matchAll(/notifications\.action\.[a-zA-Z]+/g)) {
        labels.add(key);
      }
    }
    expect(labels.size).toBeGreaterThan(5);
    for (const label of labels) expect(typeof message(label)).toBe('string');
  });

  it('accepts app routes only', () => {
    expect(isAppRoute('/app/projects/abc')).toBe(true);
    expect(isAppRoute('/app/settings/rates')).toBe(true);
    expect(isAppRoute('/login')).toBe(false);
    expect(isAppRoute('https://example.com/app')).toBe(false);
    expect(isAppRoute('/app/../x')).toBe(false);
  });

  it('recognises secrets but not file names or plain words', () => {
    expect(looksSecret('sk-ant-api03-abcdefgh')).toBe(true);
    expect(looksSecret('ghp_0123456789abcdefABCDEF0123456789abcd')).toBe(true);
    expect(
      looksSecret(
        'xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi',
      ),
    ).toBe(true);
    expect(looksSecret('kraken-ledger-2025.csv')).toBe(false);
    expect(looksSecret('Binance Transaktionshistorie 2025.xlsx')).toBe(false);
    expect(looksSecret('invalidKey')).toBe(false);
  });
});
