#!/usr/bin/env node
/**
 * Completes the runtime `package.json` that `nx build api` writes to dist/apps/api.
 *
 * WHY THIS EXISTS
 *
 * `generatePackageJson` derives dependencies from what webpack bundled. Two categories escape it,
 * and both fail at *runtime* rather than at build time — which is the worst place to find out:
 *
 *   - **webpack externals.** `oidc-provider` and `openid-client` are ESM-only and deliberately
 *     marked external in webpack.config.js, loaded through dynamic `import()`. Nothing bundles
 *     them, so nothing declares them. A container built without them starts fine and dies on the
 *     first login attempt.
 *   - **transitive requires of generated code.** The Prisma client under src/generated pulls in
 *     `@prisma/client`, and tsc's helpers pull in `tslib`. Missing `@prisma/client` kills the
 *     process at boot.
 *
 * Measured on 2026-09-08, the generated manifest was missing exactly those four.
 *
 * WHY IT DETECTS RATHER THAN HARDCODES
 *
 * A hardcoded list is right once and then rots silently — the next external added to
 * webpack.config.js would reintroduce the same class of runtime crash, and nothing would say so.
 * This scans the built bundle for module specifiers it actually requires or imports, and adds any
 * that the manifest does not declare, pinned to the exact version this workspace resolved. A short
 * explicit list covers what the container needs but never imports — see RUNTIME_TOOLS below.
 *
 * Run as the second step of `nx build api`. Also runnable by hand:
 *   node scripts/build/complete-api-package-json.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const distDir = path.join(repoRoot, 'dist/apps/api');
const bundlePath = path.join(distDir, 'main.js');
const manifestPath = path.join(distDir, 'package.json');

// Everything Node resolves on its own. `node:`-prefixed specifiers are filtered separately.
const NODE_BUILTINS = new Set([
  'assert',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'domain',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'sys',
  'timers',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
]);

/** `@scope/name/deep/path` -> `@scope/name`, `name/deep/path` -> `name`. */
function packageNameOf(specifier) {
  const segments = specifier.split('/');
  return specifier.startsWith('@')
    ? segments.slice(0, 2).join('/')
    : segments[0];
}

const bundle = readFileSync(bundlePath, 'utf8');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const rootManifest = JSON.parse(
  readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
);

const rootRanges = {
  ...rootManifest.devDependencies,
  ...rootManifest.dependencies,
};

/**
 * The version actually installed in this workspace, read from the package's own manifest — i.e.
 * what the root lockfile resolved.
 *
 * An **exact** pin rather than the root's range, and that matters: the pruned pnpm-lock.yaml is
 * written by `generatePackageJson` before this script runs, so it cannot contain the entries added
 * here and `--frozen-lockfile` would reject the manifest. The runtime install therefore resolves
 * these four itself, and an exact pin is what keeps it from drifting off what the workspace tested.
 */
function installedVersion(name) {
  try {
    const installed = JSON.parse(
      readFileSync(
        path.join(repoRoot, 'node_modules', name, 'package.json'),
        'utf8',
      ),
    );
    return typeof installed.version === 'string'
      ? installed.version
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Tools the running container needs but the bundle never imports, so no amount of scanning would
 * find them.
 *
 * `prisma` is here because the API image applies the migration history at container start
 * (`prisma migrate deploy && node main.js`, WTA-274) — the same shape as the reference project's
 * `runMigrations()`, except Prisma has no runtime migrate API, so the CLI has to be present.
 * Keep this list short: everything in it is weight and attack surface in the production image.
 */
const RUNTIME_TOOLS = [
  'prisma',
  // prisma.config.ts imports dotenv at module scope, and the CLI loads that config before it does
  // anything — so `migrate deploy` in the container dies with `Cannot find module 'dotenv'` even
  // though a container has real environment variables and no .env to read.
  'dotenv',
];

const required = new Set(RUNTIME_TOOLS);
// Both forms matter: `require()` for the CJS bundle, `import()` for the ESM-only externals, which
// are precisely the ones generatePackageJson misses.
for (const pattern of [
  /require\(["']([^"'.][^"']*)["']\)/g,
  /import\(["']([^"'.][^"']*)["']\)/g,
]) {
  for (const match of bundle.matchAll(pattern)) {
    const name = packageNameOf(match[1]);
    if (!name.startsWith('node:') && !NODE_BUILTINS.has(name)) {
      required.add(name);
    }
  }
}

manifest.dependencies ??= {};
const added = [];
const unresolved = [];

for (const name of [...required].sort()) {
  if (manifest.dependencies[name]) continue;

  const version = installedVersion(name) ?? rootRanges[name];
  if (!version) {
    unresolved.push(name);
    continue;
  }

  manifest.dependencies[name] = version;
  added.push(`${name}@${version}`);
}

if (unresolved.length > 0) {
  // Fail rather than ship a manifest that cannot install: a specifier the bundle requires but the
  // root manifest does not declare means the dependency graph is wrong somewhere upstream, and a
  // container built from it would crash at runtime with a bare MODULE_NOT_FOUND.
  console.error(
    `complete-api-package-json: the bundle requires ${unresolved.join(', ')}, which the root ` +
      `package.json does not declare. Add them there first.`,
  );
  process.exit(1);
}

if (added.length === 0) {
  console.log('complete-api-package-json: nothing missing.');
} else {
  // Keep the key order stable so the file diffs cleanly between builds.
  manifest.dependencies = Object.fromEntries(
    Object.entries(manifest.dependencies).sort(([a], [b]) =>
      a.localeCompare(b),
    ),
  );
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`complete-api-package-json: added ${added.join(', ')}`);
}
