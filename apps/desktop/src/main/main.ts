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
  powerMonitor,
  Notification,
  session,
  shell,
} from 'electron';
import {
  IPC,
  type McpStdioInfo,
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
import { removeMcpEndpoint, writeMcpEndpoint } from './lib/mcp-endpoint';
import {
  LOCK_TICK_MS,
  LOCKING_EVENTS,
  type LockReason,
  LockWatch,
} from './lib/lock-watch';
import {
  parseOsNotification,
  systemNotificationsEnabled,
} from './lib/os-notification';
import { detectSyncProvider } from './lib/sync-folder';
import { APP_ORIGIN } from './lib/web-protocol';
import { isDesktopLocale, systemLocale } from './lib/messages';
import { messages, setMessagesLocale } from './messages';
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

// Windows shows OS notifications (F11.13) only for an app with its user model id (= appId).
if (process.platform === 'win32') app.setAppUserModelId('ch.lazykoins.desktop');

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
let lockTicker: NodeJS.Timeout | undefined;
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
  const config = readConfig(userData);
  // F11.2: the app's language (stored by the window), else the system's — now that it is known.
  setMessagesLocale(
    isDesktopLocale(config.locale)
      ? config.locale
      : systemLocale(app.getLocale()),
  );
  dataDir = resolveDataDir(userData, config, process.env);

  try {
    mkdirSync(dataDir, { recursive: true });
    if (!(await acquireLock())) {
      shutdownDone = true;
      app.quit();
      return;
    }
    warnAboutConflictCopies();
    api = await startApi({ appDir, dataDir });
    // F11.16: where MCP clients (the stdio proxy) find this run's loopback endpoint.
    try {
      writeMcpEndpoint(dataDir, {
        url: `${api.baseUrl}/api/mcp`,
        pid: process.pid,
      });
    } catch (error) {
      console.error('[desktop] MCP endpoint file not written', error);
    }
  } catch (error) {
    reportError(
      messages().startFailed.title,
      messages().startFailed.detail(
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
  startLockWatch();
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

/**
 * F11.0p: the PIN lock follows the OS — locking the screen or suspending locks the app, and so
 * does system-wide inactivity for the user's auto-lock time. Locking ends every unlocked session
 * in the API (data requests get 423) and tells the window to show the lock screen.
 */
function startLockWatch(): void {
  const lockWatch = new LockWatch({
    lock: (reason: LockReason) => {
      api?.lockAll();
      if (reason !== 'start') mainWindow?.webContents.send(IPC.locked, reason);
    },
    systemIdleSeconds: () => powerMonitor.getSystemIdleTime(),
  });
  lockWatch.start();
  for (const event of LOCKING_EVENTS) {
    // `suspend` / `lock-screen` are typed separately on PowerMonitor.
    (powerMonitor as unknown as NodeJS.EventEmitter).on(event, () =>
      lockWatch.onSystemEvent(event),
    );
  }
  lockTicker = setInterval(() => lockWatch.tick(), LOCK_TICK_MS);
  lockTicker.unref();
  ipcMain.handle(IPC.lockIdleMinutes, (event, minutes: unknown) => {
    if (event.senderFrame?.url.startsWith(`${APP_ORIGIN}/`) !== true) {
      throw new Error('IPC refused: not the app window');
    }
    lockWatch.setIdleMinutes(minutes);
  });
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
      title: messages().foreignLock.title,
      message: messages().foreignLock.message,
      detail: messages().foreignLock.detail(
        assessment.lock.host,
        new Date(assessment.lock.heartbeatAt).toLocaleString('de-CH'),
        dataDir,
      ),
      buttons: [messages().foreignLock.quit, messages().foreignLock.openAnyway],
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
    title: messages().conflictCopies.title,
    message: messages().conflictCopies.message,
    detail: messages().conflictCopies.detail(copies),
    buttons: [messages().conflictCopies.ok],
  });
}

/** Stops the API (closes the database) and removes our lock. Safe to call more than once. */
function shutdown(): Promise<void> {
  shuttingDown ??= (async () => {
    if (heartbeat) clearInterval(heartbeat);
    if (lockTicker) clearInterval(lockTicker);
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
        removeMcpEndpoint(dataDir, process.pid);
      } catch {
        // A stale file names a port nobody listens on; the proxy reports that.
      }
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
        title: messages().chooseFolder,
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
  // F11.16: the stdio configuration Einstellungen › MCP shows (the token is added by the user).
  ipcMain.handle(
    IPC.mcpStdio,
    guard((): McpStdioInfo => ({
      command: process.execPath,
      args: [join(app.getAppPath(), 'mcp-stdio.js')],
      env: { ELECTRON_RUN_AS_NODE: '1', LAZYKOINS_DATA_DIR: dataDir },
    })),
  );

  // --- F11.2: the app's language for the menus and dialogs, kept in the desktop config ---
  ipcMain.handle(
    IPC.localeSet,
    (event: IpcMainInvokeEvent, locale: unknown) => {
      if (!fromApp(event)) throw new Error('IPC refused: not the app window');
      if (!isDesktopLocale(locale))
        throw new Error('IPC refused: not a locale');
      const config = readConfig(userData);
      if (config.locale !== locale)
        writeConfig(userData, { ...config, locale });
      setMessagesLocale(locale);
      Menu.setApplicationMenu(buildMenu());
    },
  );

  // --- F11.13: OS notifications (Einstellungen → System) ---
  ipcMain.handle(
    IPC.notificationsEnabled,
    guard(() => systemNotificationsEnabled(readConfig(userData))),
  );
  ipcMain.handle(
    IPC.notificationsSetEnabled,
    (event: IpcMainInvokeEvent, on: unknown) => {
      if (!fromApp(event)) throw new Error('IPC refused: not the app window');
      if (typeof on !== 'boolean') throw new Error('IPC refused: not a flag');
      writeConfig(userData, {
        ...readConfig(userData),
        systemNotifications: on,
      });
      return on;
    },
  );
  ipcMain.handle(
    IPC.notificationsShow,
    (event: IpcMainInvokeEvent, input: unknown) => {
      if (!fromApp(event)) throw new Error('IPC refused: not the app window');
      const parsed = parseOsNotification(input);
      if (
        !parsed ||
        !Notification.isSupported() ||
        !systemNotificationsEnabled(readConfig(userData))
      ) {
        return;
      }
      const shown = new Notification({
        title: parsed.title,
        body: parsed.body,
        silent: parsed.kind !== 'error',
      });
      shown.on('click', () => {
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      });
      shown.show();
    },
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
      title: messages().foreignLock.title,
      message: messages().foreignLockTarget,
      buttons: [messages().switchExisting.cancel],
    });
    return { status: 'cancelled' };
  }

  const provider = detectSyncProvider(target, process.env);
  const syncNote = provider ? `\n\n${messages().syncFolder(provider)}` : '';
  let copy = false;

  if (hasDatabase(target)) {
    const { response } = await ask({
      type: 'question',
      title: messages().switchExisting.title,
      message: messages().switchExisting.message,
      detail: `${target}\n\n${messages().switchExisting.detail}${syncNote}`,
      buttons: [
        messages().switchExisting.open,
        messages().switchExisting.cancel,
      ],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response !== 0) return { status: 'cancelled' };
  } else {
    const { response } = await ask({
      type: 'question',
      title: messages().switchEmpty.title,
      message: messages().switchEmpty.message,
      detail: `${target}\n\n${messages().switchEmpty.detail}${syncNote}`,
      buttons: [
        messages().switchEmpty.copy,
        messages().switchEmpty.empty,
        messages().switchEmpty.cancel,
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
    const { dataDir: _old, ...kept } = readConfig(userData);
    writeConfig(userData, isDefault ? kept : { ...kept, dataDir: target });
  } catch (error) {
    // The API is already stopped: relaunch on the old folder rather than leave a dead window.
    reportError(
      messages().startFailed.title,
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
    title: messages().about.item,
    message: `lazy-koins ${fullVersion}`,
    detail: messages().about.detail(
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
      label: messages().viewMenu,
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
      label: messages().about.menu,
      submenu: [
        { label: messages().about.item, click: () => void showAbout() },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}
