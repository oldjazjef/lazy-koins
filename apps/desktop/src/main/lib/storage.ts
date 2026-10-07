import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path';
import { type DesktopLocale, isDesktopLocale } from './messages';

/** The database file inside the data folder. */
export const DATABASE_FILE = 'lazykoins.db';
/** The key that seals secrets in the database (SETTINGS_ENCRYPTION_KEY) — travels with it. */
export const SECRET_KEY_FILE = 'lazykoins.key';
/** The "who has this open" marker (F3.4), see lock-file.ts. */
export const LOCK_FILE = 'lazykoins.lock';
/** Where the chosen data folder is remembered: in userData, never in the data folder itself. */
export const CONFIG_FILE = 'desktop-config.json';

export interface DesktopConfig {
  /** The chosen data folder; absent = the default (`<userData>/data`). */
  dataDir?: string;
  /** F11.13 "System-Benachrichtigungen"; absent = on. */
  systemNotifications?: boolean;
  /** F11.2: the app's language for menus and dialogs; absent = the system's. */
  locale?: DesktopLocale;
}

export function defaultDataDir(userData: string): string {
  return join(userData, 'data');
}

export function readConfig(userData: string): DesktopConfig {
  try {
    const raw: unknown = JSON.parse(
      readFileSync(join(userData, CONFIG_FILE), 'utf8'),
    );
    if (raw && typeof raw === 'object') {
      const dataDir = (raw as Record<string, unknown>)['dataDir'];
      const notifications = (raw as Record<string, unknown>)[
        'systemNotifications'
      ];
      const locale = (raw as Record<string, unknown>)['locale'];
      return {
        ...(isDesktopLocale(locale) ? { locale } : {}),
        ...(typeof dataDir === 'string' && isAbsolute(dataDir)
          ? { dataDir }
          : {}),
        ...(typeof notifications === 'boolean'
          ? { systemNotifications: notifications }
          : {}),
      };
    }
  } catch {
    // Missing or unreadable: the defaults.
  }
  return {};
}

/** Written to a temporary file first, so a crash never leaves half a config behind. */
export function writeConfig(userData: string, config: DesktopConfig): void {
  mkdirSync(userData, { recursive: true });
  const target = join(userData, CONFIG_FILE);
  const temp = `${target}.tmp`;
  writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  renameSync(temp, target);
}

/**
 * The data folder for this start (F3.1): `LK_DATA_DIR` (tests, a portable setup), else the
 * chosen folder, else `<userData>/data`.
 */
export function resolveDataDir(
  userData: string,
  config: DesktopConfig,
  env: Record<string, string | undefined> = {},
): string {
  const override = env['LK_DATA_DIR'];
  if (override && override.trim().length > 0) return resolve(override.trim());
  return config.dataDir ? normalize(config.dataDir) : defaultDataDir(userData);
}

export function sameFolder(
  a: string,
  b: string,
  platform = process.platform,
): boolean {
  const norm = (p: string) => {
    const n = resolve(p).replace(/[\\/]+$/, '');
    // Windows and (by default) macOS file systems are case-insensitive.
    return platform === 'linux' ? n : n.toLowerCase();
  };
  return norm(a) === norm(b);
}

export function hasDatabase(dir: string): boolean {
  return existsSync(join(dir, DATABASE_FILE));
}

/**
 * The secret behind SETTINGS_ENCRYPTION_KEY, created on first start. It lives next to the
 * database on purpose: a data folder moved or synced to another computer keeps its saved AI key
 * readable. (It protects the key at rest inside the database file, e.g. in an exported package —
 * not against someone who has the whole folder.)
 */
export function ensureSecretKey(dir: string): string {
  const file = join(dir, SECRET_KEY_FILE);
  if (existsSync(file)) {
    const existing = readFileSync(file, 'utf8').trim();
    if (existing.length >= 32) return existing;
  }
  mkdirSync(dirname(file), { recursive: true });
  const key = randomBytes(32).toString('hex');
  writeFileSync(file, `${key}\n`, { encoding: 'utf8', mode: 0o600 });
  return key;
}

/**
 * Copies left by sync clients when two devices changed the database at once (F3.4):
 * OneDrive `lazykoins-<PC>.db`, Dropbox `lazykoins (… conflicted copy …).db`, Google Drive
 * `lazykoins (1).db`, Proton/others with `conflict` in the name.
 */
export function findConflictCopies(fileNames: readonly string[]): string[] {
  return fileNames
    .filter((name) => name !== DATABASE_FILE)
    .filter((name) => /^lazykoins.+\.db$/i.test(name))
    .sort();
}

export function listConflictCopies(dir: string): string[] {
  try {
    return findConflictCopies(readdirSync(dir));
  } catch {
    return [];
  }
}
