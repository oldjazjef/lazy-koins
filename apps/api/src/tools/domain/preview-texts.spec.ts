import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SUPPORTED_LOCALES } from '../../common/i18n/locale';
import { ENUM_TEXTS, PREVIEW_TEXTS } from './preview-texts';

/**
 * F11.2: the proposal cards are rendered by the web from keys — every key the tools send must
 * exist in every message file of the web, with exactly the placeholders the tools fill.
 */
const I18N_DIR = resolve(__dirname, '../../../../web/public/i18n');
const DEFINITIONS_DIR = resolve(__dirname, '../definitions');

function flatten(
  node: unknown,
  prefix = '',
  out = new Map<string, string>(),
): Map<string, string> {
  if (typeof node === 'string') out.set(prefix, node);
  else if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      flatten(value, prefix ? `${prefix}.${key}` : key, out);
    }
  }
  return out;
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)]
    .map((match) => match[1] ?? '')
    .sort();
}

describe('proposal card texts (F11.2)', () => {
  for (const locale of SUPPORTED_LOCALES) {
    const messages = flatten(
      JSON.parse(readFileSync(join(I18N_DIR, `${locale}.json`), 'utf8')),
    );

    it(`${locale}.json has every chat.preview key with its placeholders`, () => {
      const wrong = Object.entries(PREVIEW_TEXTS)
        .filter(([key, params]) => {
          const text = messages.get(key);
          return (
            text === undefined ||
            placeholders(text).join() !== [...params].sort().join()
          );
        })
        .map(([key]) => key);
      expect(wrong).toEqual([]);
    });

    it(`${locale}.json has a text for every code a card shows`, () => {
      const missing = Object.values(ENUM_TEXTS)
        .flatMap(({ prefix, values }) =>
          values.map((value) => `${prefix}${value}`),
        )
        .filter((key) => !messages.has(key));
      expect(missing).toEqual([]);
    });
  }

  it('has no chat.preview key in the message files that no tool uses', () => {
    const messages = flatten(
      JSON.parse(readFileSync(join(I18N_DIR, 'de-CH.json'), 'utf8')),
    );
    const unused = [...messages.keys()].filter(
      (key) => key.startsWith('chat.preview.') && !(key in PREVIEW_TEXTS),
    );
    expect(unused).toEqual([]);
  });

  it('keeps sentences out of the tool definitions: summaries and labels are keys', () => {
    const literal = /\b(summary|label):\s*['`"]/;
    const offenders = readdirSync(DEFINITIONS_DIR)
      .filter((name) => name.endsWith('.tools.ts'))
      .flatMap((name) =>
        readFileSync(join(DEFINITIONS_DIR, name), 'utf8')
          .split('\n')
          .filter((line) => literal.test(line))
          .map((line) => `${name}: ${line.trim()}`),
      );
    expect(offenders).toEqual([]);
  });
});
