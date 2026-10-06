import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  defaultDataDir,
  ensureSecretKey,
  findConflictCopies,
  readConfig,
  resolveDataDir,
  sameFolder,
  writeConfig,
} from './storage';
import { detectSyncProvider } from './sync-folder';

describe('data folder (F3.1)', () => {
  let userData: string;

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'lk-userdata-'));
  });
  afterEach(() => rmSync(userData, { recursive: true, force: true }));

  it('defaults to <userData>/data', () => {
    expect(resolveDataDir(userData, readConfig(userData))).toBe(
      join(userData, 'data'),
    );
    expect(defaultDataDir(userData)).toBe(join(userData, 'data'));
  });

  it('remembers a chosen folder and ignores relative or garbage values', () => {
    const chosen = resolve(userData, 'OneDrive', 'lazy-koins');
    writeConfig(userData, { dataDir: chosen });
    expect(resolveDataDir(userData, readConfig(userData))).toBe(chosen);

    writeConfig(userData, { dataDir: 'relative/path' });
    expect(readConfig(userData)).toEqual({});
  });

  it('lets LK_DATA_DIR override everything', () => {
    writeConfig(userData, { dataDir: resolve(userData, 'x') });
    expect(
      resolveDataDir(userData, readConfig(userData), {
        LK_DATA_DIR: resolve(userData, 'override'),
      }),
    ).toBe(resolve(userData, 'override'));
  });

  it('compares folders case-insensitively except on Linux', () => {
    expect(sameFolder('C:\\Data\\', 'c:\\data', 'win32')).toBe(true);
    expect(sameFolder('/home/a/Data', '/home/a/data', 'linux')).toBe(false);
  });

  it('creates the secret key once and keeps it', () => {
    const dir = join(userData, 'data');
    const key = ensureSecretKey(dir);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(join(dir, 'lazykoins.key'))).toBe(true);
    expect(ensureSecretKey(dir)).toBe(key);
    expect(readFileSync(join(dir, 'lazykoins.key'), 'utf8').trim()).toBe(key);
  });

  it('finds the conflict copies sync clients leave behind (F3.4)', () => {
    expect(
      findConflictCopies([
        'lazykoins.db',
        'lazykoins.db-wal',
        'lazykoins-LAPTOP-7.db',
        'lazykoins (Annas conflicted copy 2026-10-07).db',
        'lazykoins (1).db',
        'other.db',
        'lazykoins.key',
      ]),
    ).toEqual([
      'lazykoins (1).db',
      'lazykoins (Annas conflicted copy 2026-10-07).db',
      'lazykoins-LAPTOP-7.db',
    ]);
  });
});

describe('detectSyncProvider', () => {
  it.each([
    ['C:\\Users\\anna\\OneDrive\\Steuern', 'OneDrive'],
    ['C:\\Users\\anna\\OneDrive - Firma AG\\lazy-koins', 'OneDrive'],
    ['/Users/anna/Library/CloudStorage/OneDrive-Personal/lk', 'OneDrive'],
    ['G:\\My Drive\\lazy-koins', 'Google Drive'],
    ['G:\\Meine Ablage\\lazy-koins', 'Google Drive'],
    [
      '/Users/anna/Library/CloudStorage/GoogleDrive-anna@example.com/My Drive/lk',
      'Google Drive',
    ],
    ['C:\\Users\\anna\\Proton Drive\\anna\\My files\\lk', 'Proton Drive'],
    [
      '/Users/anna/Library/CloudStorage/ProtonDrive-anna@proton.me/lk',
      'Proton Drive',
    ],
    ['C:\\Users\\anna\\Dropbox\\lk', 'Dropbox'],
    [
      '/Users/anna/Library/Mobile Documents/com~apple~CloudDocs/lk',
      'iCloud Drive',
    ],
    ['C:\\Users\\anna\\Documents\\lazy-koins', null],
  ])('%s → %s', (dir, expected) => {
    expect(detectSyncProvider(dir)).toBe(expected);
  });

  it('recognises a renamed OneDrive root through the environment', () => {
    expect(
      detectSyncProvider('D:\\Cloud\\Firma\\lk', {
        OneDriveCommercial: 'D:\\Cloud\\Firma',
      }),
    ).toBe('OneDrive');
    expect(
      detectSyncProvider('D:\\Cloud\\FirmaX\\lk', {
        OneDriveCommercial: 'D:\\Cloud\\Firma',
      }),
    ).toBeNull();
  });
});
