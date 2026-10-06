// better-sqlite3 for Electron: puts the PREBUILT binary for Electron's ABI and the target
// platform/arch into a better-sqlite3 folder (prebuild-install, which ships with better-sqlite3).
// No compiler needed — neither on a developer machine nor on CI runners.
//
// Used twice:
//   - scripts/stage.mjs, for the host (dev runs: `pnpm start:desktop`);
//   - electron-builder's `afterPack` hook (electron-builder.config.cjs), once per target arch, on
//     the unpacked copy inside the packaged app (`app.asar.unpacked`). electron-builder's own
//     rebuild is off (`npmRebuild: false`): @electron/rebuild goes straight to node-gyp (it does
//     not use prebuild-install) and would need Visual Studio / Xcode.
//
// Constraint: better-sqlite3 must publish a prebuild for the Electron ABI in use — see the
// `electron` pin in the root package.json (CLAUDE.md, Desktop).
const { execFileSync } = require('node:child_process');
const { existsSync, realpathSync, rmSync } = require('node:fs');
const path = require('node:path');

/** electron-builder's `Arch` enum → Node's arch names. */
const ARCH_NAMES = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64' };

function installBetterSqlite3({
  moduleDir,
  prebuildBin,
  electronVersion,
  platform,
  arch,
}) {
  console.log(
    `native-deps: better-sqlite3 for Electron ${electronVersion} ${platform}-${arch} → ${moduleDir}`,
  );
  // Unlink first, never overwrite in place: should the file be a hard link into pnpm's store
  // (shared with every other checkout on this machine), writing into it would swap the Node
  // binary of all of them for an Electron one. stage.mjs installs with `copy` for the same reason.
  rmSync(path.join(moduleDir, 'build'), { recursive: true, force: true });
  // Windows: a virus scanner may still hold a binary that was just written (EBUSY) — retry.
  for (let attempt = 1; ; attempt++) {
    try {
      execFileSync(
        process.execPath,
        [
          prebuildBin,
          '--runtime=electron',
          `--target=${electronVersion}`,
          `--platform=${platform}`,
          `--arch=${arch}`,
          '--force',
        ],
        { cwd: moduleDir, stdio: 'inherit' },
      );
      break;
    } catch (error) {
      if (attempt >= 5) throw error;
      console.log(
        `native-deps: attempt ${attempt} failed, retrying in ${attempt * 3} s`,
      );
      Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)),
        0,
        0,
        attempt * 3000,
      );
    }
  }
  const binary = path.join(
    moduleDir,
    'build',
    'Release',
    'better_sqlite3.node',
  );
  if (!existsSync(binary))
    throw new Error(`native-deps: ${binary} missing after install`);
}

/** prebuild-install from the staged app (a dependency of better-sqlite3). */
function prebuildBinFor(appDir) {
  // pnpm's isolated layout: prebuild-install sits next to better-sqlite3's real folder.
  const moduleDir = realpathSync(
    path.join(appDir, 'node_modules', 'better-sqlite3'),
  );
  return require.resolve('prebuild-install/bin.js', {
    paths: [moduleDir, appDir],
  });
}

/** electron-builder `afterPack`: swap in the binary for this target's platform and arch. */
async function afterPack(context) {
  const { appOutDir, electronPlatformName, arch, packager } = context;
  const resources =
    electronPlatformName === 'darwin'
      ? path.join(
          appOutDir,
          `${packager.appInfo.productFilename}.app`,
          'Contents',
          'Resources',
        )
      : path.join(appOutDir, 'resources');
  installBetterSqlite3({
    moduleDir: path.join(
      resources,
      'app.asar.unpacked',
      'node_modules',
      'better-sqlite3',
    ),
    prebuildBin: prebuildBinFor(packager.info.appDir),
    electronVersion: packager.config.electronVersion,
    platform: electronPlatformName,
    arch: ARCH_NAMES[arch] ?? String(arch),
  });
}

module.exports = { installBetterSqlite3, prebuildBinFor, afterPack };
