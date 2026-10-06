import {
  clampAutoLock,
  delayAfterFailures,
  isValidPin,
  secondsUntil,
  signedInAfter,
} from './pin';
import { hashPin, needsRehash, PIN_HASH_PARAMS, verifyPin } from './pin-hash';

describe('PIN rules (F11.0p)', () => {
  it.each([
    ['1234', true],
    ['12345678', true],
    ['123', false],
    ['123456789', false],
    ['12a4', false],
    [' 1234', false],
    ['١٢٣٤', false],
  ])('%s is a valid PIN: %s', (pin, valid) => {
    expect(isValidPin(pin)).toBe(valid);
  });

  it('waits longer after every wrong attempt: 0, 1, 2, 5, 10, 30 s …, capped', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(delayAfterFailures)).toEqual([
      0, 0, 1, 2, 5, 10, 30,
    ]);
    expect(delayAfterFailures(50)).toBe(900);
  });

  it('counts the seconds until the next attempt', () => {
    const now = Date.parse('2026-10-07T10:00:00Z');
    expect(secondsUntil(null, now)).toBe(0);
    expect(secondsUntil('2026-10-07T10:00:04.200Z', now)).toBe(5);
    expect(secondsUntil('2026-10-07T09:59:00Z', now)).toBe(0);
  });

  it('a fresh sign-in: at most 10 minutes ago, or after a given moment', () => {
    const now = Date.parse('2026-10-07T10:00:00Z');
    expect(signedInAfter('2026-10-07T09:55:00Z', null, now)).toBe(true);
    expect(signedInAfter('2026-10-07T09:45:00Z', null, now)).toBe(false);
    expect(signedInAfter(null, null, now)).toBe(false);
    expect(signedInAfter(undefined, null, now)).toBe(false);
    expect(
      signedInAfter('2026-10-07T09:00:00Z', '2026-10-07T08:00:00Z', now),
    ).toBe(true);
    expect(
      signedInAfter('2026-10-07T07:00:00Z', '2026-10-07T08:00:00Z', now),
    ).toBe(false);
  });

  it('keeps the auto-lock time between 1 and 240 minutes', () => {
    expect(clampAutoLock(0)).toBe(1);
    expect(clampAutoLock(15)).toBe(15);
    expect(clampAutoLock(1000)).toBe(240);
    expect(clampAutoLock(Number.NaN)).toBe(15);
  });
});

describe('PIN hash (scrypt)', () => {
  it('stores parameters + salt + hash, never the PIN; verifies in constant time', async () => {
    const stored = await hashPin('482913');
    expect(stored).toMatch(
      new RegExp(`^scrypt\\$${PIN_HASH_PARAMS.logN}\\$8\\$1\\$[^$]+\\$[^$]+$`),
    );
    expect(stored).not.toContain('482913');
    expect(await verifyPin('482913', stored)).toBe(true);
    expect(await verifyPin('482914', stored)).toBe(false);
    expect(needsRehash(stored)).toBe(false);
  });

  it('salts every hash: the same PIN twice gives two hashes', async () => {
    expect(await hashPin('1234')).not.toBe(await hashPin('1234'));
  });

  it('verifies old weaker parameters and asks for a rehash', async () => {
    const weak = await hashPin('1234', { logN: 10, r: 8, p: 1 });
    expect(await verifyPin('1234', weak)).toBe(true);
    expect(needsRehash(weak)).toBe(true);
  });

  it.each([
    '',
    'bcrypt$x',
    'scrypt$15$8$1$abc',
    'scrypt$40$8$1$c2FsdA==$aGFzaA==',
    'scrypt$15$8$1$c2FsdA==$',
  ])('never matches a malformed hash %s', async (stored) => {
    expect(await verifyPin('1234', stored)).toBe(false);
  });
});
