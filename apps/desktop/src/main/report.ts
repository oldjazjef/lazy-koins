import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app, dialog } from 'electron';

/**
 * Shows an error the user must see (native dialog) and records it with its stack in
 * `<userData>/logs/main.log`, so a report can include more than the dialog's text.
 * `LK_NO_DIALOGS=1` (automated runs) logs only.
 */
export function reportError(
  title: string,
  detail: string,
  error: unknown,
): void {
  const stack =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(`[desktop] ${title}\n${stack}`);
  try {
    const dir = join(app.getPath('userData'), 'logs');
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      join(dir, 'main.log'),
      `${new Date().toISOString()} ${title}\n${stack}\n\n`,
      'utf8',
    );
  } catch {
    // Logging must never hide the dialog.
  }
  if (process.env['LK_NO_DIALOGS'] !== '1') dialog.showErrorBox(title, detail);
}
