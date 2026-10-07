import { type LockReason, LockWatch } from './lock-watch';

function watch() {
  const locks: LockReason[] = [];
  let idle = 0;
  const lw = new LockWatch({
    lock: (reason) => locks.push(reason),
    systemIdleSeconds: () => idle,
  });
  return {
    lw,
    locks,
    setIdle: (seconds: number) => {
      idle = seconds;
    },
  };
}

describe('LockWatch (F11.0p, desktop)', () => {
  it('every start is locked, once', () => {
    const { lw, locks } = watch();
    lw.start();
    lw.start();
    expect(locks).toEqual(['start']);
  });

  it('locks at once on OS lock and suspend, not on other events', () => {
    const { lw, locks } = watch();
    expect(lw.onSystemEvent('lock-screen')).toBe(true);
    expect(lw.onSystemEvent('suspend')).toBe(true);
    expect(lw.onSystemEvent('resume')).toBe(false);
    expect(lw.onSystemEvent('unlock-screen')).toBe(false);
    expect(locks).toEqual(['lock-screen', 'suspend']);
  });

  it('locks after the auto-lock time without input (default 15 min), once until input', () => {
    const { lw, locks, setIdle } = watch();
    setIdle(14 * 60);
    expect(lw.tick()).toBe(false);
    setIdle(15 * 60);
    expect(lw.tick()).toBe(true);
    setIdle(20 * 60);
    expect(lw.tick()).toBe(false);
    expect(locks).toEqual(['idle']);
    // Input again, then idle again: locks again.
    setIdle(3);
    lw.tick();
    setIdle(16 * 60);
    expect(lw.tick()).toBe(true);
    expect(locks).toEqual(['idle', 'idle']);
  });

  it('takes the user’s auto-lock time from the window, clamped to 1–240 minutes', () => {
    const { lw, locks, setIdle } = watch();
    lw.setIdleMinutes(5);
    setIdle(5 * 60);
    expect(lw.tick()).toBe(true);
    lw.setIdleMinutes(0);
    expect(lw.autoLockMinutes).toBe(1);
    lw.setIdleMinutes(9999);
    expect(lw.autoLockMinutes).toBe(240);
    lw.setIdleMinutes('15');
    expect(lw.autoLockMinutes).toBe(240);
    expect(locks).toEqual(['idle']);
  });
});
