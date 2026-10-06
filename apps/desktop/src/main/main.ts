import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  app,
  BrowserWindow,
  dialog,
  type IpcMainInvokeEvent,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  session,
  shell,
} from 'electron';
import {
  IPC,
  type StorageChangeResult,
  type StorageInfo,
} from '../shared/bridge';
import { type RunningApi, startApi } from './api-host';
import {
  assessLock,
  HEARTBEAT_MS,
  isPidAlive,
  type LockInfo,
  readLock,
  releaseLock,
  writeLock,
} from './lib/lock-file';
import {
  DATABASE_FILE,
  defaultDataDir,
  hasDatabase,
  listConflictCopies,
  readConfig,
  resolveDataDir,
  SECRET_KEY_FILE,
  sameFolder,
  writeConfig,
} from './lib/storage';
import { detectSyncProvider } from './lib/sync-folder';
import { APP_ORIGIN } from './lib/web-protocol';
import { MESSAGES } from './messages';
import { handleAppScheme, registerAppScheme } from './protocol';
import { reportError } from './report';

// The packaged app and a dev run (`pnpm start:desktop`) must never share data.
if (!app.isPackaged) {
  app.setPath('userData', join(app.getPath('appData'), 'lazy-koins-dev'));
}

// One instance per user: two would open the same SQLite file with two writers.
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
}

registerAppScheme();

/** main.js, preload.js, api/, web/ and migrations/ sit next to each other (scripts/stage.mjs). */
const appDir = __dirname;
const self = { host: hostname(), pid: process.pid };

/** `X.Y.Z+<commit>` — written into package.json's `lkBuild` by scripts/stage.mjs. */
const fullVersion = ((): string => {
  try {
    const manifest = JSON.parse(
      readFileSync(join(appDir, 'package.json'), 'utf8'),
    ) as { lkBuild?: { full?: unknown } };
    const full = manifest.lkBuild?.full;
    return typeof full === 'string' ? full : app.getVersion();
  } catch {
    return app.getVersion();
  }
})();

let mainWindow: BrowserWindow | null = null;
let api: RunningApi | null = null;
let dataDir = '';
let heartbeat: NodeJS.Timeout | undefined;
let shutdownDone = false;
let shuttingDown: Promise<void> | null = null;

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// Nothing in the window may open other windows, navigate away, or embed other content.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${APP_ORIGIN}/`)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    }
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

app.on('window-all-closed', () => app.quit());

app.on('before-quit', (event) => {
  if (shutdownDone) return;
  event.preventDefault();
  void shutdown().finally(() => {
    shutdownDone = true;
    app.quit();
  });
});

void app.whenReady().then(start);

async function start(): Promise<void> {
  const userData = app.getPath('userData');
  dataDir = resolveDataDir(userData, readConfig(userData), process.env);

  try {
    mkdirSync(dataDir, { recursive: true });
    if (!(await acquireLock())) {
      shutdownDone = true;
      app.quit();
      return;
    }
    warnAboutConflictCopies();
    api = await startApi({ appDir, dataDir });
  } catch (error) {
    reportError(
      MESSAGES.startFailed.title,
      MESSAGES.startFailed.detail(
        error instanceof Error ? error.message : String(error),
        dataDir,
      ),
      error,
    );
    await shutdown();
    shutdownDone = true;
    app.quit();
    return;
  }

  handleAppScheme(join(appDir, 'web'), api);
  // The app needs no camera, microphone, notifications, … — refuse every permission request.
  session.defaultSession.setPermissionRequestHandler(
    (_wc, _permission, callback) => callback(false),
  );
  registerIpc(userData);
  // macOS "About lazy-koins" (appMenu); Windows uses the Hilfe menu below.
  app.setAboutPanelOptions({
    applicationName: 'lazy-koins',
    applicationVersion: fullVersion,
    version: `Electron ${process.versions.electron}`,
  });
  Menu.setApplicationMenu(buildMenu());
  createWindow();
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'lazy-koins',
    webPreferences: {
      preload: join(appDir, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  void mainWindow.loadURL(`${APP_ORIGIN}/`);
}

/** F3.4: refuse silently to share a folder with another running device; ask instead. */
async function acquireLock(): Promise<boolean> {
  const assessment = assessLock(
    readLock(dataDir),
    self,
    new Date(),
    isPidAlive,
  );
  if (assessment.kind === 'foreign') {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: MESSAGES.foreignLock.title,
      message: MESSAGES.foreignLock.message,
      detail: MESSAGES.foreignLock.detail(
        assessment.lock.host,
        new Date(assessment.lock.heartbeatAt).toLocaleString('de-CH'),
        dataDir,
      ),
      buttons: [MESSAGES.foreignLock.quit, MESSAGES.foreignLock.openAnyway],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (response !== 1) return false;
  }
  const now = new Date().toISOString();
  const lock: LockInfo = { ...self, startedAt: now, heartbeatAt: now };
  writeLock(dataDir, lock);
  heartbeat = setInterval(() => {
    try {
      writeLock(dataDir, { ...lock, heartbeatAt: new Date().toISOString() });
    } catch {
      // A sync client may hold the file for a moment; the next beat tries again.
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();
  return true;
}

function warnAboutConflictCopies(): void {
  const copies = listConflictCopies(dataDir);
  if (copies.length === 0) return;
  dialog.showMessageBoxSync({
    type: 'warning',
    title: MESSAGES.conflictCopies.title,
    message: MESSAGES.conflictCopies.message,
    detail: MESSAGES.conflictCopies.detail(copies),
    buttons: [MESSAGES.conflictCopies.ok],
  });
}

/** Stops the API (closes the database) and removes our lock. Safe to call more than once. */
function shutdown(): Promise<void> {
  shuttingDown ??= (async () => {
    if (heartbeat) clearInterval(heartbeat);
    const running = api;
    api = null;
    if (running) {
      try {
        await running.close();
      } catch (error) {
        console.error('[desktop] API did not stop cleanly', error);
      }
    }
    if (dataDir) {
      try {
        releaseLock(dataDir, self);
      } catch {
        // Nothing to do: a stale marker is recognised as such by the next start.
      }
    }
  })();
  return shuttingDown;
}

// --- IPC (Einstellungen → Speicherort) ---

function registerIpc(userData: string): void {
  const fromApp = (event: IpcMainInvokeEvent) =>
    event.senderFrame?.url.startsWith(`${APP_ORIGIN}/`) === true;
  const guard =
    <T>(handler: () => Promise<T> | T) =>
    (event: IpcMainInvokeEvent) => {
      if (!fromApp(event)) throw new Error('IPC refused: not the app window');
      return handler();
    };

  ipcMain.handle(
    IPC.storageInfo,
    guard((): StorageInfo => storageInfo(userData)),
  );
  ipcMain.handle(
    IPC.storageChoose,
    guard(async (): Promise<StorageChangeResult> => {
      const options = {
        title: MESSAGES.chooseFolder,
        defaultPath: dataDir,
        properties: ['openDirectory', 'createDirectory'] as Array<
          'openDirectory' | 'createDirectory'
        >,
      };
      const picked = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options);
      const target = picked.filePaths[0];
      if (picked.canceled || !target) return { status: 'cancelled' };
      return switchDataDir(userData, target);
    }),
  );
  ipcMain.handle(
    IPC.storageUseDefault,
    guard(() => switchDataDir(userData, defaultDataDir(userData))),
  );
  ipcMain.handle(
    IPC.storageReveal,
    guard(async () => {
      await shell.openPath(dataDir);
    }),
  );
}

function storageInfo(userData: string): StorageInfo {
  const defaultDir = defaultDataDir(userData);
  return {
    dataDir,
    defaultDir,
    isDefault: sameFolder(dataDir, defaultDir),
    databaseFile: join(dataDir, DATABASE_FILE),
    syncProvider: detectSyncProvider(dataDir, process.env),
    conflictCopies: listConflictCopies(dataDir),
    appVersion: fullVersion,
  };
}

/**
 * F3.1/F3.3: switch the data folder — open the data already there, or copy the current data
 * over (or start empty), then relaunch: the API reads its environment once per process.
 */
async function switchDataDir(
  userData: string,
  target: string,
): Promise<StorageChangeResult> {
  if (sameFolder(target, dataDir)) return { status: 'unchanged' };
  const window = mainWindow ?? undefined;
  const ask = (options: Electron.MessageBoxOptions) =>
    window
      ? dialog.showMessageBox(window, options)
      : dialog.showMessageBox(options);

  const targetLock = assessLock(readLock(target), self, new Date(), isPidAlive);
  if (targetLock.kind === 'foreign') {
    await ask({
      type: 'warning',
      title: MESSAGES.foreignLock.title,
      message: MESSAGES.foreignLockTarget,
      buttons: [MESSAGES.switchExisting.cancel],
    });
    return { status: 'cancelled' };
  }

  const provider = detectSyncProvider(target, process.env);
  const syncNote = provider ? `\n\n${MESSAGES.syncFolder(provider)}` : '';
  let copy = false;

  if (hasDatabase(target)) {
    const { response } = await ask({
      type: 'question',
      title: MESSAGES.switchExisting.title,
      message: MESSAGES.switchExisting.message,
      detail: `${target}\n\n${MESSAGES.switchExisting.detail}${syncNote}`,
      buttons: [MESSAGES.switchExisting.open, MESSAGES.switchExisting.cancel],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response !== 0) return { status: 'cancelled' };
  } else {
    const { response } = await ask({
      type: 'question',
      title: MESSAGES.switchEmpty.title,
      message: MESSAGES.switchEmpty.message,
      detail: `${target}\n\n${MESSAGES.switchEmpty.detail}${syncNote}`,
      buttons: [
        MESSAGES.switchEmpty.copy,
        MESSAGES.switchEmpty.empty,
        MESSAGES.switchEmpty.cancel,
      ],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (response === 2) return { status: 'cancelled' };
    copy = response === 0;
  }

  try {
    // Stop writing first, so the copy is the final state.
    await shutdown();
    mkdirSync(target, { recursive: true });
    if (copy) {
      const source = new Database(join(dataDir, DATABASE_FILE), {
        readonly: true,
      });
      try {
        // The backup API copies a consistent snapshot, WAL contents included.
        await source.backup(join(target, DATABASE_FILE));
      } finally {
        source.close();
      }
      const key = join(dataDir, SECRET_KEY_FILE);
      if (existsSync(key) && !existsSync(join(target, SECRET_KEY_FILE))) {
        copyFileSync(key, join(target, SECRET_KEY_FILE));
      }
    }
    const isDefault = sameFolder(target, defaultDataDir(userData));
    writeConfig(userData, isDefault ? {} : { dataDir: target });
  } catch (error) {
    // The API is already stopped: relaunch on the old folder rather than leave a dead window.
    reportError(
      MESSAGES.startFailed.title,
      error instanceof Error ? error.message : String(error),
      error,
    );
  }

  app.relaunch();
  shutdownDone = true;
  app.quit();
  return { status: 'restarting' };
}

async function showAbout(): Promise<void> {
  const options: Electron.MessageBoxOptions = {
    type: 'info',
    title: MESSAGES.about.item,
    message: `lazy-koins ${fullVersion}`,
    detail: MESSAGES.about.detail(
      process.versions.electron ?? '',
      process.versions.chrome ?? '',
      process.versions.node,
      dataDir,
    ),
    buttons: ['OK'],
  };
  if (mainWindow) await dialog.showMessageBox(mainWindow, options);
  else await dialog.showMessageBox(options);
}

function buildMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [{ role: 'appMenu' } as MenuItemConstructorOptions]
      : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'Ansicht',
      submenu: [
        { role: 'reload' },
        ...(app.isPackaged
          ? []
          : [{ role: 'toggleDevTools' } as MenuItemConstructorOptions]),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      label: MESSAGES.about.menu,
      submenu: [{ label: MESSAGES.about.item, click: () => void showAbout() }],
    },
  ];
  return Menu.buildFromTemplate(template);
}
