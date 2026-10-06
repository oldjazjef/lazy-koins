import { createHash } from 'node:crypto';
import { unzipSync, zipSync, type Zippable } from 'fflate';
import { z } from 'zod';

/**
 * Project and account packages (F10.8, F10.9 = F1.3, F2.3): ZIP files with a `manifest.json`
 * that lists EVERY other entry with its SHA-256 and size. Import refuses a package whose entries
 * do not match the manifest exactly (tampered, truncated, extra files), unsafe paths (zip-slip:
 * nothing is ever written to disk, but such a name is refused anyway) and sizes beyond the limits
 * below — checked from the ZIP directory before anything is inflated, and again after.
 */

export const PROJECT_PACKAGE_FORMAT = 'lazy-koins-project';
export const ACCOUNT_PACKAGE_FORMAT = 'lazy-koins-account';
export const PACKAGE_FORMAT_VERSION = 1;
export const PROJECT_PACKAGE_EXTENSION = '.lkproj.zip';
export const ACCOUNT_PACKAGE_EXTENSION = '.lkaccount.zip';
export const MANIFEST = 'manifest.json';

/** Limits (CLAUDE.md, Packages). */
export const PACKAGE_LIMITS = {
  /** Request body of an import (the ZIP itself). */
  maxPackageBytes: 200 * 1024 * 1024,
  /** Σ of the inflated entries. */
  maxTotalBytes: 1024 * 1024 * 1024,
  /** One inflated entry. */
  maxEntryBytes: 200 * 1024 * 1024,
  maxEntries: 20_000,
} as const;

export class PackageError extends Error {
  constructor(
    readonly code:
      | 'notZip'
      | 'tooLarge'
      | 'unsafePath'
      | 'manifest'
      | 'tampered'
      | 'version'
      | 'content',
    message: string,
  ) {
    super(message);
    this.name = 'PackageError';
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const SAFE_PATH = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

/** A relative path of plain segments: no `..`, no absolute path, no backslash, no drive. */
export function isSafePath(path: string): boolean {
  return (
    path.length <= 300 &&
    SAFE_PATH.test(path) &&
    !path.split('/').some((segment) => segment === '..' || segment === '.')
  );
}

export const EntrySchema = z.object({
  path: z.string().refine(isSafePath, 'unsafe path'),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().nonnegative(),
  role: z.enum([
    'file',
    'mapping',
    'data',
    'export',
    'project',
    'settings',
    'profile',
  ]),
});
export type PackageEntry = z.infer<typeof EntrySchema>;

/** Builds a package: `manifest` (without `entries`) + files → ZIP bytes. */
export function buildPackage(
  manifest: Record<string, unknown>,
  files: readonly {
    readonly path: string;
    readonly role: PackageEntry['role'];
    readonly bytes: Uint8Array;
    /** Already compressed (a nested package, an XLSX): stored, not deflated again. */
    readonly store?: boolean;
  }[],
): Uint8Array {
  const entries: PackageEntry[] = files.map((f) => ({
    path: f.path,
    sha256: sha256Hex(f.bytes),
    size: f.bytes.length,
    role: f.role,
  }));
  const zippable: Zippable = {
    [MANIFEST]: new TextEncoder().encode(
      JSON.stringify({ ...manifest, entries }, null, 2),
    ),
  };
  for (const f of files) {
    if (!isSafePath(f.path) || f.path === MANIFEST) {
      throw new Error(`Bad package path ${f.path}`);
    }
    zippable[f.path] = f.store ? [f.bytes, { level: 0 }] : f.bytes;
  }
  return zipSync(zippable, {
    level: 6,
    mtime: new Date('2026-01-01T00:00:00Z'),
  });
}

export interface OpenedPackage {
  readonly manifest: unknown;
  readonly entries: readonly PackageEntry[];
  /** path → bytes, every one verified against the manifest. */
  readonly files: ReadonlyMap<string, Uint8Array>;
}

/**
 * Opens and verifies a package: ZIP directory within the limits, safe names, a manifest whose
 * `entries` list exactly the other entries with matching SHA-256 and size.
 */
export function openPackage(bytes: Uint8Array): OpenedPackage {
  if (bytes.length > PACKAGE_LIMITS.maxPackageBytes) {
    throw new PackageError('tooLarge', 'The package is too large');
  }
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new PackageError('notZip', 'Not a ZIP file');
  }
  let declared = 0;
  let count = 0;
  let unsafe: string | undefined;
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(bytes, {
      filter: (file) => {
        count += 1;
        declared += file.originalSize;
        if (file.name.endsWith('/')) return false;
        if (!isSafePath(file.name)) unsafe = file.name;
        if (
          count > PACKAGE_LIMITS.maxEntries ||
          file.originalSize > PACKAGE_LIMITS.maxEntryBytes ||
          declared > PACKAGE_LIMITS.maxTotalBytes
        ) {
          throw new PackageError('tooLarge', 'The package unpacks too large');
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof PackageError) throw error;
    throw new PackageError('notZip', 'The ZIP file cannot be read');
  }
  if (unsafe !== undefined) {
    throw new PackageError('unsafePath', 'The package contains an unsafe path');
  }
  const manifestBytes = unzipped[MANIFEST];
  if (!manifestBytes) {
    throw new PackageError('manifest', 'The package has no manifest.json');
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes),
    );
  } catch {
    throw new PackageError('manifest', 'manifest.json is not valid JSON');
  }
  const listed = z
    .object({ entries: z.array(EntrySchema).max(PACKAGE_LIMITS.maxEntries) })
    .safeParse(manifest);
  if (!listed.success) {
    throw new PackageError('manifest', 'manifest.json lists no valid entries');
  }
  const entries = listed.data.entries;
  const files = new Map<string, Uint8Array>();
  const names = Object.keys(unzipped).filter((name) => name !== MANIFEST);
  if (
    names.length !== entries.length ||
    new Set(entries.map((e) => e.path)).size !== entries.length
  ) {
    throw new PackageError(
      'tampered',
      'The package does not match its manifest',
    );
  }
  for (const entry of entries) {
    const content = unzipped[entry.path];
    if (
      !content ||
      content.length !== entry.size ||
      sha256Hex(content) !== entry.sha256
    ) {
      throw new PackageError(
        'tampered',
        'The package does not match its manifest',
      );
    }
    files.set(entry.path, content);
  }
  return { manifest, entries, files };
}

/** Parses a JSON entry of an opened package with a schema, or a `content` error. */
export function readJson<T>(
  opened: OpenedPackage,
  path: string,
  schema: z.ZodType<T>,
): T {
  const bytes = opened.files.get(path);
  if (!bytes) throw new PackageError('content', `${path} is missing`);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new PackageError('content', `${path} is not valid JSON`);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new PackageError('content', `${path} is not valid`);
  }
  return parsed.data;
}

export function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, null, 2));
}

/** A file-name-safe slug of a project name. */
export function slug(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return cleaned.slice(0, 60) || 'projekt';
}
