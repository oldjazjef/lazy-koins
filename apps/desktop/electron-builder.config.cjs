// electron-builder configuration for the desktop app. Packages the folder that
// apps/desktop/scripts/stage.mjs assembled (`--projectDir dist/apps/desktop-app`) into
// dist/desktop: Windows NSIS (x64), macOS dmg (arm64 + x64). Run via `pnpm build:desktop`.
//
// Version: scripts/build/version.mjs (LK_VERSION = the release tag in .github/workflows/_desktop.yml),
// already written into the staged package.json.
//
// Signing: none yet (open decision, see CLAUDE.md). electron-builder picks it up from the
// environment once the secrets exist — never from files in the repo:
//   Windows + macOS certificate: CSC_LINK (base64 .p12/.pfx or URL), CSC_KEY_PASSWORD
//   macOS notarisation:          APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID (+ `notarize`)
// Without CSC_LINK the macOS identity is forced off (no ad-hoc keychain lookup on CI runners).
// Auto-update: none yet — no `publish` provider, so no latest*.yml is written.
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const electronVersion = require(
  path.join(repoRoot, 'node_modules/electron/package.json'),
).version;
const signing = Boolean(process.env.CSC_LINK);

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'ch.lazykoins.desktop',
  productName: 'lazy-koins',
  copyright: 'lazy-koins',
  electronVersion,
  directories: {
    output: path.join(repoRoot, 'dist/desktop'),
    buildResources: path.join(repoRoot, 'apps/desktop/build'),
  },
  files: [
    'package.json',
    'main.js',
    'preload.js',
    'api/**',
    'web/**',
    'migrations/**',
    'node_modules/**',
    '!**/*.map',
    '!pnpm-workspace.yaml',
    '!pnpm-lock.yaml',
    '!.deps-hash',
  ],
  asar: true,
  // Native code cannot be loaded from inside an asar archive.
  asarUnpack: ['node_modules/better-sqlite3/**', '**/*.node'],
  // Native modules per target arch (macOS x64 on an arm64 runner): electron-builder's rebuild
  // would compile with node-gyp; instead `afterPack` drops the prebuilt better-sqlite3 for
  // Electron and the target arch into app.asar.unpacked (scripts/native-deps.cjs).
  npmRebuild: false,
  nodeGypRebuild: false,
  afterPack: require('./scripts/native-deps.cjs').afterPack,
  publish: null,
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    // Both generated from assets/brand/icon.svg (`pnpm icons`); macOS derives .icns from the PNG.
    icon: 'icon.ico',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    artifactName: '${productName}-Setup-${version}.${ext}',
  },
  mac: {
    target: [{ target: 'dmg', arch: ['arm64', 'x64'] }],
    category: 'public.app-category.finance',
    icon: 'icon.png',
    ...(signing ? {} : { identity: null }),
  },
  dmg: {
    artifactName: '${productName}-${version}-${arch}.${ext}',
  },
};
