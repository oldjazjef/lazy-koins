import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assessLock,
  isPidAlive,
  type LockInfo,
  parseLock,
  readLock,
  releaseLock,
  writeLock,
} from './lock-file';

const NOW = new Date('2026-10-07T12:00:00.000Z');
const self = { host: 'LAPTOP', pid: 100 };
const lock = (patch: Partial<LockInfo>): LockInfo => ({
  host: 'DESKTOP',
  pid: 200,
  startedAt: '2026-10-07T11:00:00.000Z',
  heartbeatAt: '2026-10-07T11:59:00.000Z',
  ...patch,
});
const alive = () => true;
const dead = () => false;

describe('assessLock (F3.4)', () => {
  it('is free without a marker', () => {
    expect(assessLock(null, self, NOW, alive)).toEqual({ kind: 'free' });
  });

  it('recognises its own marker', () => {
    expect(
      assessLock(lock({ host: 'laptop', pid: 100 }), self, NOW, alive).kind,
    ).toBe('own');
  });

  it('warns about a fresh marker from another device', () => {
    expect(assessLock(lock({}), self, NOW, dead).kind).toBe('foreign');
  });

  it('ignores another device after the heartbeat went stale', () => {
    expect(
      assessLock(
        lock({ heartbeatAt: '2026-10-07T11:50:00.000Z' }),
        self,
        NOW,
        alive,
      ).kind,
    ).toBe('stale');
    expect(
      assessLock(lock({ heartbeatAt: 'garbage' }), self, NOW, alive).kind,
    ).toBe('stale');
  });

  it('on the same machine asks the process table instead of the clock', () => {
    expect(assessLock(lock({ host: 'LAPTOP' }), self, NOW, alive).kind).toBe(
      'foreign',
    );
    expect(assessLock(lock({ host: 'LAPTOP' }), self, NOW, dead).kind).toBe(
      'stale',
    );
  });
});

describe('lock file on disk', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lk-lock-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('round-trips and removes only its own marker', () => {
    writeLock(dir, lock({ host: 'LAPTOP', pid: 100 }));
    expect(readLock(dir)).toEqual(lock({ host: 'LAPTOP', pid: 100 }));

    releaseLock(dir, { host: 'OTHER', pid: 100 });
    expect(readLock(dir)).not.toBeNull();

    releaseLock(dir, self);
    expect(readLock(dir)).toBeNull();
  });

  it('treats an unreadable marker as none', () => {
    writeFileSync(join(dir, 'lazykoins.lock'), '{not json');
    expect(readLock(dir)).toBeNull();
    expect(parseLock('{"host":1}')).toBeNull();
  });

  it('knows this process is alive', () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });
});
