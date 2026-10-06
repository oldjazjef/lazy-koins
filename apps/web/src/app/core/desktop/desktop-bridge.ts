/**
 * The desktop shell's API (`window.lazykoinsDesktop`, exposed by apps/desktop's preload script).
 * Absent in the browser. A mirror of `apps/desktop/src/shared/bridge.ts` — keep both in step; the
 * web app must not import from apps/desktop.
 */
export interface StorageInfo {
  dataDir: string;
  defaultDir: string;
  isDefault: boolean;
  databaseFile: string;
  syncProvider: string | null;
  conflictCopies: string[];
  appVersion: string;
}

export type StorageChangeResult =
  | { status: 'cancelled' }
  | { status: 'unchanged' }
  | { status: 'restarting' }
  | { status: 'failed'; message: string };

export interface DesktopBridge {
  readonly platform: string;
  readonly storage: {
    info(): Promise<StorageInfo>;
    choose(): Promise<StorageChangeResult>;
    useDefault(): Promise<StorageChangeResult>;
    reveal(): Promise<void>;
  };
}

declare global {
  interface Window {
    lazykoinsDesktop?: DesktopBridge;
  }
}

/** The bridge when running inside the desktop app, otherwise null. */
export function desktopBridge(): DesktopBridge | null {
  return window.lazykoinsDesktop ?? null;
}

/** Route guard: desktop-only pages (Einstellungen → Speicherort). */
export const desktopOnly = (): boolean => desktopBridge() !== null;
