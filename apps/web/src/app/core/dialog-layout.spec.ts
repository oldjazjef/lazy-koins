// @vitest-environment node
// Reads the templates from disk; no DOM involved.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Dialog layout (CLAUDE.md, user rule): header, `<div class="lk-dialog-body">` (padding, the only
 * scrolling part) and the footer. Regression (AI dialog, 07.10.2026): steps whose content sat
 * directly after the header had no padding and scrolled the whole dialog. After every
 * `</hlm-dialog-header>` the next element must be the body, the footer, or the end of a block.
 */
const APP_DIR = fileURLToPath(new URL('..', import.meta.url));

function templates(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return templates(path);
    return name.endsWith('.html') ? [path] : [];
  });
}

describe('dialog layout', () => {
  it('puts the content of every dialog into lk-dialog-body', () => {
    const offenders = templates(APP_DIR).flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return [...text.matchAll(/<\/hlm-dialog-header>\s*([^\n>]{0,60})/g)]
        .filter(
          ([, next]) =>
            !/^(<[a-z-]+ class="lk-dialog-body"|<hlm-dialog-footer|}|<\/hlm-dialog-content|<!--)/.test(
              next ?? '',
            ),
        )
        .map(([, next]) => `${file}: after the header comes "${next}"`);
    });
    expect(offenders).toEqual([]);
  });
});
