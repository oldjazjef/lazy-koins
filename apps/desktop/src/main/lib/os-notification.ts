import type { OsNotification } from '../../shared/bridge';
import type { DesktopConfig } from './storage';

/** Longest title / body an OS notification gets (the centre's texts are one line). */
export const OS_TEXT_MAX = 200;

/** F11.13: on unless switched off in Einstellungen › System. */
export function systemNotificationsEnabled(config: DesktopConfig): boolean {
  return config.systemNotifications !== false;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  if (text === '') return null;
  return text.length > OS_TEXT_MAX
    ? `${text.slice(0, OS_TEXT_MAX - 1)}…`
    : text;
}

/**
 * What the window may ask the main process to show — validated like every IPC input: only the
 * kinds error / action (F11.13), plain one-line text, cut to 200 characters. Anything else is
 * refused (`null`).
 */
export function parseOsNotification(input: unknown): OsNotification | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const kind = raw['kind'];
  if (kind !== 'error' && kind !== 'action') return null;
  const title = cleanText(raw['title']);
  const body = cleanText(raw['body']) ?? '';
  if (title === null) return null;
  return { kind, title, body };
}
