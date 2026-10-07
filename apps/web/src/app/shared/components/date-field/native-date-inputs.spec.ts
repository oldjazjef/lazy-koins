// @vitest-environment node
// Reads templates from disk; no DOM involved.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every date in the app looks and behaves the same (user rule, 07.10.2026: "den gleichen Date
 * Selector wie im etx-work-time-manager"): single days use `lk-date-field`, periods
 * `lk-date-range-picker` — never the browser's own `<input type="date">`, whose look, format and
 * week start follow the browser instead of the user's profile.
 *
 * ALLOWED lists the exceptions, each with its reason.
 */
const ALLOWED: Readonly<Record<string, string>> = {
  // A booking's moment with time of day (manual booking correction): the date field has no
  // time part; it stays a native datetime-local input until one exists.
  'features/calculation/components/project-corrections/project-corrections.html:datetime-local':
    'date + time',
};

const APP_DIR = fileURLToPath(new URL('../../..', import.meta.url));
const NATIVE = /type\s*=\s*["'](date|month|week|datetime-local)["']/g;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.(html|ts)$/.test(name) && !name.endsWith('.spec.ts')
      ? [full]
      : [];
  });
}

describe('date inputs', () => {
  it('uses lk-date-field / lk-date-range-picker instead of native date inputs', () => {
    const found: string[] = [];
    for (const file of sources(APP_DIR)) {
      const path = relative(APP_DIR, file).split(sep).join('/');
      for (const [, type] of readFileSync(file, 'utf8').matchAll(NATIVE)) {
        const key = `${path}:${type}`;
        if (!(key in ALLOWED)) found.push(key);
      }
    }
    expect(found).toEqual([]);
  });

  it('keeps the allow-list honest (every entry still exists)', () => {
    for (const key of Object.keys(ALLOWED)) {
      const [path, type] = key.split(':') as [string, string];
      const text = readFileSync(join(APP_DIR, path), 'utf8');
      expect(text).toContain(`type="${type}"`);
    }
  });
});
