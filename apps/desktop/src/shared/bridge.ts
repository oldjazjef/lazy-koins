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
  /** F11.0p: the PIN lock driven by the OS (lock screen, suspend, system idle). */
  readonly lock: {
    /** Called when the shell locked the app; returns an unsubscribe function. */
    onLocked(listener: (reason: string) => void): () => void;
    /** The user's auto-lock time, so the shell's system-idle check uses it. */
    setIdleMinutes(minutes: number): Promise<void>;
  };
}

export const IPC = {
  storageInfo: 'lk:storage:info',
  storageChoose: 'lk:storage:choose',
  storageUseDefault: 'lk:storage:use-default',
  storageReveal: 'lk:storage:reveal',
  /** main → window: the app was locked (reason). */
  locked: 'lk:lock:locked',
  lockIdleMinutes: 'lk:lock:idle-minutes',
} as const;
