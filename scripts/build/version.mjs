#!/usr/bin/env node
/**
 * THE version of a build — one source of truth for the API, the web app, the desktop app and the
 * container images. Format `X.Y.Z+<shortsha>`:
 *
 *   release build (CI, LK_VERSION=v1.2.3)     1.2.3+abc1234
 *   local build, nearest tag v1.2.3           1.2.3+abc1234
 *   no tag reachable                          0.0.0-dev+abc1234
 *   uncommitted changes (local only)          1.2.3+abc1234.dirty
 *
 * Inputs, strongest first:
 *   LK_VERSION   `v1.2.3` / `1.2.3` (CI: the release tag). A `+…` suffix is ignored.
 *   LK_COMMIT    the commit (Docker builds — the image has no .git), else GITHUB_SHA (CI), else
 *                `git rev-parse HEAD`. Shortened to 7 characters.
 *   git          nearest `vX.Y.Z` tag (`git describe --tags --abbrev=0`), dirty working tree.
 *
 * Read ONLY at build time (webpack DefinePlugin for the API, scripts/stage.mjs for the desktop):
 * a running container never asks git.
 *
 *   node scripts/build/version.mjs          → {"version":"1.2.3","commit":"abc1234",…}
 *   node scripts/build/version.mjs full     → 1.2.3+abc1234
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/;
export const DEV_VERSION = '0.0.0-dev';

/**
 * Pure: the build info from the environment and what git reported.
 * @param {{ env?: Record<string, string | undefined>, git?: { tag?: string | null, sha?: string | null, dirty?: boolean }, now?: Date }} input
 */
export function computeVersion({ env = {}, git = {}, now = new Date() } = {}) {
  const fromEnv = (env.LK_VERSION ?? '').trim().replace(/^v/, '').split('+')[0];
  if (fromEnv && !SEMVER.test(fromEnv)) {
    throw new Error(`LK_VERSION must look like v1.2.3 (got ${env.LK_VERSION})`);
  }
  const tag = (git.tag ?? '').replace(/^v/, '');
  const version = fromEnv || (SEMVER.test(tag) ? tag : DEV_VERSION);

  const ciSha = (env.LK_COMMIT || env.GITHUB_SHA || '').trim();
  const commit = (ciSha || git.sha || 'unknown').slice(0, 7);
  // A CI/Docker build is by definition clean; locally, uncommitted changes are flagged.
  const dirty = !ciSha && git.dirty === true;

  return {
    version,
    commit,
    full: `${version}+${commit}${dirty ? '.dirty' : ''}`,
    builtAt: now.toISOString(),
  };
}

/** What git says about the checkout at `cwd` — every field null when git (or .git) is missing. */
export function readGit(cwd) {
  const git = (...args) => {
    try {
      return execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return null;
    }
  };
  const status = git('status', '--porcelain', '--untracked-files=no');
  return {
    tag: git(
      'describe',
      '--tags',
      '--abbrev=0',
      '--match',
      'v[0-9]*.[0-9]*.[0-9]*',
    ),
    sha: git('rev-parse', 'HEAD'),
    dirty: status !== null && status.length > 0,
  };
}

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

/** The build info of this checkout and environment. */
export function resolveVersion(env = process.env, cwd = repoRoot) {
  return computeVersion({ env, git: readGit(cwd) });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const info = resolveVersion();
  const field = process.argv[2];
  console.log(field ? info[field] : JSON.stringify(info));
}
