// The API as a CommonJS library for the desktop app (apps/desktop): `src/desktop.ts` exports
// `bootstrap()` and starts nothing on import. Same compiler settings as webpack.config.js (the
// server bundle), so both run the same code; only the entry, the output folder and the library
// output differ. Built by `nx run api:build-desktop`.
const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');
const { buildInfoPlugin } = require('./webpack.build-info');

module.exports = {
  output: {
    path: join(__dirname, '../../dist/apps/desktop-api'),
    clean: true,
    // `module.exports = { bootstrap, … }` instead of a script with no exports.
    library: { type: 'commonjs2' },
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      // Emitted as main.js: Nx names the entry `main`, and another name would leave webpack's
      // default `main: ./src` entry in place.
      main: './src/desktop.ts',
      tsConfig: './tsconfig.app.json',
      assets: [],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      sourceMap: true,
    }),
    buildInfoPlugin(),
  ],
};
