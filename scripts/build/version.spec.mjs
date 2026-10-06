import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  computeVersion,
  DEV_VERSION,
  readGit,
  resolveVersion,
} from './version.mjs';

const NOW = new Date('2026-10-07T12:00:00.000Z');
const SHA = 'abc1234def5678';

describe('computeVersion', () => {
  it('uses the nearest tag and the short commit', () => {
    expect(
      computeVersion({
        git: { tag: 'v1.2.3', sha: SHA, dirty: false },
        now: NOW,
      }),
    ).toEqual({
      version: '1.2.3',
      commit: 'abc1234',
      full: '1.2.3+abc1234',
      builtAt: '2026-10-07T12:00:00.000Z',
    });
  });

  it('falls back to 0.0.0-dev without a tag', () => {
    const info = computeVersion({ git: { tag: null, sha: SHA } });
    expect(info.version).toBe(DEV_VERSION);
    expect(info.full).toBe('0.0.0-dev+abc1234');
  });

  it('flags uncommitted changes locally', () => {
    expect(
      computeVersion({ git: { tag: 'v1.2.3', sha: SHA, dirty: true } }).full,
    ).toBe('1.2.3+abc1234.dirty');
  });

  it('prefers LK_VERSION and the CI commit, and never calls a CI build dirty', () => {
    const info = computeVersion({
      env: { LK_VERSION: 'v2.0.0', GITHUB_SHA: 'fedcba9876543210' },
      git: { tag: 'v1.2.3', sha: SHA, dirty: true },
    });
    expect(info.full).toBe('2.0.0+fedcba9');
    expect(
      computeVersion({
        env: { LK_VERSION: '2.0.1+ignored', LK_COMMIT: '1111111222' },
      }).full,
    ).toBe('2.0.1+1111111');
  });

  it('refuses a malformed LK_VERSION and ignores a non-semver tag', () => {
    expect(() => computeVersion({ env: { LK_VERSION: 'latest' } })).toThrow(
      /LK_VERSION/,
    );
    expect(computeVersion({ git: { tag: 'vNext', sha: SHA } }).version).toBe(
      DEV_VERSION,
    );
  });

  it('works without git at all (Docker build context)', () => {
    expect(
      computeVersion({ git: { tag: null, sha: null, dirty: false } }).full,
    ).toBe('0.0.0-dev+unknown');
  });
});

describe('readGit / resolveVersion on a real repository', () => {
  it('reads tag, sha and dirtiness', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lk-version-'));
    try {
      const git = (...args) =>
        execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
      git('init', '-q');
      git('config', 'user.email', 'test@lazykoins.dev');
      git('config', 'user.name', 'test');
      git('config', 'commit.gpgsign', 'false');
      writeFileSync(join(dir, 'a.txt'), 'a');
      git('add', 'a.txt');
      git('commit', '-q', '-m', 'one');
      expect(readGit(dir).tag).toBeNull();
      expect(resolveVersion({}, dir).version).toBe(DEV_VERSION);

      git('tag', 'v1.4.0');
      writeFileSync(join(dir, 'a.txt'), 'b');
      const info = resolveVersion({}, dir);
      expect(info.version).toBe('1.4.0');
      expect(info.full).toMatch(/^1\.4\.0\+[0-9a-f]{7}\.dirty$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
