import { app } from 'electron';
import { isDesktopLocale, systemLocale } from './lib/messages';
import { readConfig } from './lib/storage';
import { messages, setMessagesLocale } from './messages';
import { reportError } from './report';

/**
 * The bundle's entry point: installs the last-resort error handler FIRST, then loads the app.
 * Without it, a failure while loading (a native module that does not load, a broken bundle)
 * shows Electron's raw "A JavaScript error occurred in the main process" stack. Here the user
 * gets a German dialog with the reason (logged with the stack), and the process exits — no
 * half-started app.
 */
let failed = false;

// F11.2: dialogs in the app's language from the first moment (the config), else the system's.
try {
  const stored = readConfig(app.getPath('userData')).locale;
  setMessagesLocale(
    isDesktopLocale(stored) ? stored : systemLocale(app.getLocale()),
  );
} catch {
  // German, as before.
}

function fatal(error: unknown): void {
  if (failed) return;
  failed = true;
  const reason = error instanceof Error ? error.message : String(error);
  try {
    reportError(messages().fatal.title, messages().fatal.detail(reason), error);
  } finally {
    app.exit(1);
  }
}

process.on('uncaughtException', fatal);
process.on('unhandledRejection', fatal);

// esbuild inlines this (no code splitting) but evaluates main.ts only now, after the handlers.
import('./main').catch(fatal);
