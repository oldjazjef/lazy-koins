/**
 * The window's only access to the desktop shell: `window.lazykoinsDesktop`, exposed by the
 * preload script through contextBridge. Keep it minimal and typed — every function is an IPC call
 * the main process validates. The web app mirrors these types in
 * `apps/web/src/app/core/desktop/desktop-bridge.ts` (it must not import from apps/desktop).
 */
export interface StorageInfo {
  /** The data folder in use (database, key, lock file). */
  dataDir: string;
  /** `<userData>/data`. */
  defaultDir: string;
  isDefault: boolean;
  /** The SQLite file. */
  databaseFile: string;
  /** The sync client whose folder this is, if recognised (F3.4 warning). */
  syncProvider: string | null;
  /** Sync conflict copies of the database found next to it (F3.4). */
  conflictCopies: string[];
  appVersion: string;
}

export type StorageChangeResult =
  | { status: 'cancelled' }
  | { status: 'unchanged' }
  /** The app restarts on the new folder; the window reloads. */
  | { status: 'restarting' }
  | { status: 'failed'; message: string };

/** An OS notification (F11.13) — error and "Handlungsbedarf" only, text without secrets. */
export interface OsNotification {
  readonly kind: 'error' | 'action';
  readonly title: string;
  readonly body: string;
}

export interface DesktopBridge {
  readonly platform: string;
  readonly storage: {
    info(): Promise<StorageInfo>;
    /** Folder picker → copy the data there or open the data already there (asks) → restart. */
    choose(): Promise<StorageChangeResult>;
    /** Back to `<userData>/data` (asks the same questions). */
    useDefault(): Promise<StorageChangeResult>;
    /** Opens the data folder in Explorer / Finder. */
    reveal(): Promise<void>;
  };
  readonly notifications: {
    /** Einstellungen › System › "System-Benachrichtigungen" (default on). */
    enabled(): Promise<boolean>;
    /** Stores the switch; resolves with the stored value. */
    setEnabled(on: boolean): Promise<boolean>;
    /** Shown only while enabled; clicking it brings the window to the front. */
    show(notification: OsNotification): Promise<void>;
  };
}

export const IPC = {
  storageInfo: 'lk:storage:info',
  storageChoose: 'lk:storage:choose',
  storageUseDefault: 'lk:storage:use-default',
  storageReveal: 'lk:storage:reveal',
  notificationsEnabled: 'lk:notifications:enabled',
  notificationsSetEnabled: 'lk:notifications:set-enabled',
  notificationsShow: 'lk:notifications:show',
} as const;
