// @vitest-environment node
// Reads the templates from disk; no DOM involved.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Regression (chat sidebar, 07.10.2026): `<form (ngSubmit)>` only works when Angular puts a form
 * directive on the element — `[formGroup]` (ReactiveFormsModule) or NgForm (FormsModule, which
 * this app does not use). Without one the browser submits the form natively and RELOADS THE PAGE:
 * the chat lost its state and asked for consent again. Forms without `[formGroup]` must use
 * `(submit)="$event.preventDefault(); …"`.
 */
const APP_DIR = fileURLToPath(new URL('..', import.meta.url));

function templates(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return templates(path);
    return name.endsWith('.html') ? [path] : [];
  });
}

describe('form submission', () => {
  it('never relies on (ngSubmit) without a [formGroup] on the same form', () => {
    const offenders = templates(APP_DIR).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/<form\b[^>]*>/gs)]
        .map((match) => match[0])
        .filter((tag) => tag.includes('ngSubmit') && !tag.includes('formGroup'))
        .map((tag) => `${file}: ${tag.replace(/\s+/g, ' ')}`),
    );
    expect(offenders).toEqual([]);
  });
});
