#!/usr/bin/env node
/**
 * Assembles the Electron app folder `dist/apps/desktop-app` — what `electron` runs in dev
 * (`pnpm start:desktop`) and what electron-builder packages (`pnpm build:desktop`):
 *
 *   main.js, preload.js   the main process + preload, bundled here with esbuild
 *   api/main.js           the NestJS API as a library (`nx run api:build-desktop`)
 *   web/                  the Angular build (`nx run web:build:desktop`), served via app://
 *   migrations/           apps/api/prisma/migrations, applied at start (src/main/lib/migrations.ts)
 *   package.json          name/version/main + the API's runtime dependencies
 *   node_modules/         `pnpm install --prod` — OUTSIDE the workspace's node_modules,
 *                         with better-sqlite3 rebuilt for Electron's ABI, so the workspace copy
 *                         (Node ABI: API, tests) is never touched.
 *
 * Expects the web and API builds to exist (the Nx target `desktop:stage` depends on them).
 * Env: LK_VERSION (e.g. v1.2.3, the release tag) and LK_COMMIT — see scripts/build/version.mjs.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const out = path.join(repoRoot, 'dist/apps/desktop-app');
const apiDist = path.join(repoRoot, 'dist/apps/desktop-api');
const webDist = path.join(repoRoot, 'dist/apps/web-desktop/browser');
const migrations = path.join(repoRoot, 'apps/api/prisma/migrations');
const require = createRequire(import.meta.url);

// The one version source (scripts/build/version.mjs): LK_VERSION (CI: the release tag) or the
// nearest tag, + the commit. Installers get the plain semver (`version`); the full
// `X.Y.Z+<commit>` goes into package.json's `lkBuild` (About dialog, Einstellungen → Speicherort).
const { resolveVersion } = await import('../../../scripts/build/version.mjs');
const build = resolveVersion();
const version = build.version;

for (const [what, dir] of [
  ['API bundle (nx run api:build-desktop)', path.join(apiDist, 'main.js')],
  ['web build (nx run web:build:desktop)', path.join(webDist, 'index.html')],
]) {
  if (!existsSync(dir)) throw new Error(`Missing ${what}: ${dir}`);
}

// --- fresh folder, but keep node_modules when the dependencies did not change ---
mkdirSync(out, { recursive: true });
for (const entry of readdirSync(out)) {
  if (entry !== 'node_modules' && entry !== '.deps-hash') {
    rmSync(path.join(out, entry), { recursive: true, force: true });
  }
}

// --- main + preload ---
const esbuild = require('esbuild');
await esbuild.build({
  entryPoints: {
    // entry.ts installs the fatal-error dialog, then loads main.ts.
    main: path.join(repoRoot, 'apps/desktop/src/main/entry.ts'),
    preload: path.join(repoRoot, 'apps/desktop/src/preload/preload.ts'),
  },
  outdir: out,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  // electron: provided by the runtime; better-sqlite3: native, installed below.
  external: ['electron', 'better-sqlite3'],
  sourcemap: true,
  logLevel: 'warning',
});

// --- API, web, migrations ---
cpSync(apiDist, path.join(out, 'api'), {
  recursive: true,
  filter: (src) => !/package\.json$|pnpm-lock\.yaml$/.test(src),
});
cpSync(webDist, path.join(out, 'web'), { recursive: true });
// The protocol handler generates env.js (authMode 'local'); the dev file must not shadow it.
rmSync(path.join(out, 'web', 'env.js'), { force: true });
cpSync(migrations, path.join(out, 'migrations'), {
  recursive: true,
  filter: (src) => !src.endsWith('.toml'),
});

// --- package.json ---
const rootManifest = JSON.parse(
  readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
);
const apiManifest = JSON.parse(
  readFileSync(path.join(apiDist, 'package.json'), 'utf8'),
);
const installed = (name) =>
  JSON.parse(
    readFileSync(
      path.join(repoRoot, 'node_modules', name, 'package.json'),
      'utf8',
    ),
  ).version;
const electronVersion = installed('electron');

const dependencies = { ...apiManifest.dependencies };
// The Prisma CLI (and the dotenv its config needs) run migrations in the container; the desktop
// app applies them itself, so neither ships.
delete dependencies.prisma;
delete dependencies.dotenv;
dependencies['better-sqlite3'] = installed('better-sqlite3');

const manifest = {
  name: 'lazy-koins',
  productName: 'lazy-koins',
  version,
  description: 'Krypto-Steuerauszug: Vermögen per 31.12. und Ertrag',
  author: 'lazy-koins',
  license: 'UNLICENSED',
  private: true,
  main: 'main.js',
  // Read by the main process (About, storage page): { version, commit, full, builtAt }.
  lkBuild: build,
  dependencies: Object.fromEntries(
    Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b)),
  ),
  // Read by electron-builder; never installed (`--prod`).
  devDependencies: { electron: electronVersion },
  packageManager: rootManifest.packageManager,
};
writeFileSync(
  path.join(out, 'package.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

// Its own pnpm workspace root, so pnpm does not walk up into the repo's workspace. pnpm's normal
// (isolated) layout: electron-builder's pnpm collector reads it via `pnpm list` and lays out
// node_modules itself — with `nodeLinker: hoisted` it silently dropped nested packages
// (lazystream's readable-stream@2) and the packaged API died loading exceljs. Copy, not hard
// links: native-deps.cjs replaces better-sqlite3's binary, and a hard link would reach into
// pnpm's store (and every other checkout's Node binary).
const workspaceYaml = [
  'packageImportMethod: copy',
  'allowBuilds:',
  '  better-sqlite3: true',
  "  '@prisma/engines': false",
  '  prisma: false',
  "  '@nestjs/core': false",
  "  '@scarf/scarf': false",
  "  '@firebase/util': false",
  '  protobufjs: false',
  '',
].join('\n');
writeFileSync(path.join(out, 'pnpm-workspace.yaml'), workspaceYaml);

// --- install + rebuild for Electron (skipped when nothing changed) ---
const depsHash = createHash('sha256')
  .update(
    JSON.stringify({
      dependencies: manifest.dependencies,
      workspaceYaml,
      electronVersion,
      arch: process.arch,
    }),
  )
  .digest('hex');
const hashFile = path.join(out, '.deps-hash');
const upToDate =
  existsSync(path.join(out, 'node_modules')) &&
  existsSync(hashFile) &&
  readFileSync(hashFile, 'utf8') === depsHash;

if (upToDate) {
  console.log('stage: dependencies unchanged, node_modules kept');
} else {
  rmSync(path.join(out, 'node_modules'), { recursive: true, force: true });
  rmSync(hashFile, { force: true });
  console.log('stage: installing runtime dependencies (pnpm install --prod)…');
  execFileSync('pnpm', ['install', '--prod', '--no-frozen-lockfile'], {
    cwd: out,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, NX_DAEMON: 'false' },
  });

  // The install above fetched better-sqlite3's binary for Node; swap in the one for Electron.
  const { installBetterSqlite3, prebuildBinFor } = require('./native-deps.cjs');
  installBetterSqlite3({
    moduleDir: path.join(out, 'node_modules', 'better-sqlite3'),
    prebuildBin: prebuildBinFor(out),
    electronVersion,
    platform: process.platform,
    arch: process.arch,
  });
  writeFileSync(hashFile, depsHash);
}

console.log(
  `stage: ${out} ready (lazy-koins ${build.full}, Electron ${electronVersion})`,
);
