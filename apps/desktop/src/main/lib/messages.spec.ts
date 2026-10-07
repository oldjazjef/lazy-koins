import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DESKTOP_LOCALES,
  desktopMessages,
  isDesktopLocale,
  MESSAGES,
  MESSAGES_BY_LOCALE,
  systemLocale,
} from './messages';
import { readConfig, writeConfig } from './storage';

/** Every leaf of a dictionary: strings as they are, functions called with sample arguments. */
function leaves(node: unknown, path = ''): [string, string][] {
  if (typeof node === 'string') return [[path, node]];
  if (typeof node === 'function') {
    const fn = node as (...args: unknown[]) => string;
    // conflictCopies.detail takes a list of files; the others strings.
    const args = path.endsWith('conflictCopies.detail')
      ? [['a.db']]
      : ['A', 'B', 'C', 'D'];
    return [[path, fn(...args)]];
  }
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([key, value]) =>
      leaves(value, path ? `${path}.${key}` : key),
    );
  }
  return [];
}

describe('desktop dictionary (F11.2)', () => {
  it('has the same texts in every language, none empty', () => {
    const german = leaves(MESSAGES_BY_LOCALE['de-CH']).map(([key]) => key);
    for (const locale of DESKTOP_LOCALES) {
      const texts = leaves(MESSAGES_BY_LOCALE[locale]);
      expect(texts.map(([key]) => key)).toEqual(german);
      expect(texts.filter(([, text]) => text.trim() === '')).toEqual([]);
    }
    // conflictCopies.detail takes a list.
    expect(desktopMessages('en').conflictCopies.detail(['a.db'])).toContain(
      'a.db',
    );
  });

  it('keeps the German texts and has English ones', () => {
    expect(MESSAGES).toBe(MESSAGES_BY_LOCALE['de-CH']);
    expect(desktopMessages('de-CH').about.item).toBe('Über lazy-koins');
    expect(desktopMessages('en').about.item).toBe('About lazy-koins');
    expect(desktopMessages('en').viewMenu).toBe('View');
    expect(desktopMessages('en').fatal.detail('boom')).toContain('boom');
  });

  it('takes the system language when none is stored', () => {
    expect(systemLocale('de-CH')).toBe('de-CH');
    expect(systemLocale('de')).toBe('de-CH');
    expect(systemLocale('en-US')).toBe('en');
    expect(systemLocale('fr-CH')).toBe('en');
    expect(systemLocale(undefined)).toBe('en');
    expect(isDesktopLocale('en')).toBe(true);
    expect(isDesktopLocale('fr')).toBe(false);
  });

  it('remembers the language in the desktop config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lk-locale-'));
    try {
      expect(readConfig(dir).locale).toBeUndefined();
      writeConfig(dir, { locale: 'en', systemNotifications: false });
      expect(readConfig(dir)).toEqual({
        locale: 'en',
        systemNotifications: false,
      });
      writeConfig(dir, { locale: 'xx' as never });
      expect(readConfig(dir).locale).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
