import { resolve, sep } from 'node:path';

export type SyncProvider =
  'OneDrive' | 'Google Drive' | 'Proton Drive' | 'Dropbox' | 'iCloud Drive';

/**
 * Whether `dir` lies inside a cloud sync folder (F3.1/F3.4), from its path alone: the folder names
 * the clients create by default on Windows and macOS, plus the OneDrive roots Windows publishes as
 * environment variables. A heuristic — a renamed sync root is not recognised — used only to warn.
 */
export function detectSyncProvider(
  dir: string,
  env: Record<string, string | undefined> = {},
): SyncProvider | null {
  const path = resolve(dir);
  const lower = path.toLowerCase();

  for (const key of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
    const root = env[key];
    if (root && isInside(lower, resolve(root).toLowerCase())) return 'OneDrive';
  }

  const segments = lower.split(/[\\/]+/);
  const has = (test: (segment: string) => boolean) => segments.some(test);

  // macOS: ~/Library/CloudStorage/<Provider>-<account>, iCloud in Mobile Documents.
  if (
    has(
      (s) =>
        s === 'onedrive' ||
        s.startsWith('onedrive -') ||
        s.startsWith('onedrive-'),
    )
  )
    return 'OneDrive';
  if (
    has(
      (s) =>
        s === 'google drive' ||
        s.startsWith('googledrive-') ||
        s === 'my drive' ||
        s === 'meine ablage',
    )
  )
    return 'Google Drive';
  if (has((s) => s === 'proton drive' || s.startsWith('protondrive-')))
    return 'Proton Drive';
  if (
    has(
      (s) =>
        s === 'dropbox' ||
        s.startsWith('dropbox (') ||
        s.startsWith('dropbox-'),
    )
  )
    return 'Dropbox';
  if (
    has(
      (s) =>
        s === 'mobile documents' || s === 'icloud drive' || s === 'iclouddrive',
    )
  )
    return 'iCloud Drive';
  return null;
}

function isInside(child: string, parent: string): boolean {
  const p = parent.replace(/[\\/]+$/, '');
  return (
    child === p ||
    child.startsWith(p + sep) ||
    child.startsWith(`${p}/`) ||
    child.startsWith(`${p}\\`)
  );
}
