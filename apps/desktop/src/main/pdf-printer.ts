import { randomBytes } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, session } from 'electron';
import {
  allowPrintRequest,
  type PdfPrintOptions,
  toElectronPrintOptions,
} from './lib/print-options';

const PRINT_TIMEOUT_MS = 60_000;

/** One print at a time: each gets its own hidden window, and they are cheap but not free. */
let queue: Promise<unknown> = Promise.resolve();

/**
 * HTML → PDF with Electron's own Chromium (`webContents.printToPDF`) — the desktop app's
 * `HostPdfPrinter` for the API (bootstrap `pdfPrinter`), so PDF exports work on every user's
 * machine without a separately installed browser. Same HTML templates and print options as the
 * server's Playwright renderer.
 *
 * Offline and inert: a hidden window in its own in-memory session that may load nothing but the
 * temporary HTML file, JavaScript off, sandboxed. The file lives in the OS temp folder only for
 * the print (a data: URL would hit Chromium's URL length limit on long statements).
 */
export function printToPdf(
  html: string,
  options: PdfPrintOptions,
): Promise<Uint8Array> {
  const run = queue.then(() => printOnce(html, options));
  queue = run.catch(() => undefined);
  return run;
}

async function printOnce(
  html: string,
  options: PdfPrintOptions,
): Promise<Uint8Array> {
  const file = join(
    app.getPath('temp'),
    `lk-pdf-${randomBytes(8).toString('hex')}.html`,
  );
  const documentUrl = pathToFileURL(file).toString();
  const printSession = session.fromPartition('lk-pdf'); // no `persist:` = in memory
  printSession.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: !allowPrintRequest(details.url, documentUrl) }),
  );
  printSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );

  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      session: printSession,
      javascript: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  let timer: NodeJS.Timeout | undefined;
  try {
    await writeFile(file, html, 'utf8');
    const printing = (async () => {
      await window.loadURL(documentUrl);
      return window.webContents.printToPDF(toElectronPrintOptions(options));
    })();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('PDF printing timed out')),
        PRINT_TIMEOUT_MS,
      );
    });
    const pdf = await Promise.race([printing, timeout]);
    return new Uint8Array(pdf);
  } finally {
    if (timer) clearTimeout(timer);
    if (!window.isDestroyed()) window.destroy();
    await rm(file, { force: true });
  }
}
