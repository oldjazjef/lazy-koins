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

/** How an MCP client starts the desktop app's stdio server (F11.16). */
export interface McpStdioConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

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
    choose(): Promise<StorageChangeResult>;
    useDefault(): Promise<StorageChangeResult>;
    reveal(): Promise<void>;
  };
  /** Absent in older desktop builds. */
  readonly mcp?: {
    stdio(): Promise<McpStdioConfig>;
  };
  /** F11.0p: the shell locks the app on OS lock / suspend / system idle. */
  readonly lock?: {
    onLocked(listener: (reason: string) => void): () => void;
    setIdleMinutes(minutes: number): Promise<void>;
  };
  /**
   * F11.2: the app's language for the shell's menus and dialogs (stored in the desktop config).
   * Absent in desktop builds older than the language setting.
   */
  readonly locale?: {
    set(locale: string): Promise<void>;
  };
  /** Absent in desktop builds older than the notification centre. */
  readonly notifications?: {
    /** Einstellungen › System › "System-Benachrichtigungen" (default on). */
    enabled(): Promise<boolean>;
    setEnabled(on: boolean): Promise<boolean>;
    /** Shown only while enabled; clicking it brings the window to the front. */
    show(notification: OsNotification): Promise<void>;
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
