// `__LK_BUILD__` for src/app/build-info.ts: the version of this build (X.Y.Z+<commit>), computed
// ONCE at build time by scripts/build/version.mjs (LK_VERSION / LK_COMMIT / git). Shared by the
// server bundle (webpack.config.js) and the desktop library (webpack.desktop.config.js).
const { DefinePlugin } = require('webpack');
// eslint-disable-next-line @nx/enforce-module-boundaries -- build tooling shared by every app, not app code
const { resolveVersion } = require('../../scripts/build/version.mjs');

function buildInfoPlugin() {
  const info = resolveVersion();
  console.log(`build-info: ${info.full}`);
  return new DefinePlugin({ __LK_BUILD__: JSON.stringify(info) });
}

module.exports = { buildInfoPlugin };
