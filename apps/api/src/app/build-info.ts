/**
 * Version of this build, injected by webpack's DefinePlugin (`__LK_BUILD__`, from
 * scripts/build/version.mjs — see webpack.config.js). Never read from git at run time: a container
 * has no .git. Unbundled (Vitest) it is a development placeholder.
 */
export interface BuildInfo {
  /** Semver, e.g. `1.2.3` or `0.0.0-dev`. */
  version: string;
  /** Short commit, e.g. `abc1234`. */
  commit: string;
  /** `1.2.3+abc1234` (`.dirty` for a local build with uncommitted changes). */
  full: string;
  /** ISO timestamp of the build, null when unbundled. */
  builtAt: string | null;
}

declare const __LK_BUILD__: BuildInfo | undefined;

export const BUILD_INFO: BuildInfo =
  typeof __LK_BUILD__ !== 'undefined'
    ? __LK_BUILD__
    : {
        version: '0.0.0-dev',
        commit: 'unknown',
        full: '0.0.0-dev+unknown',
        builtAt: null,
      };
