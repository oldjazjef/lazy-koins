import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import type { PinStatus } from '../../api/setup.types';
import { AuthService } from '../../auth/auth.service';
import { PinLockService } from '../pin-lock.service';
import { LockScreenService } from './lock-screen.service';

const status = (over: Partial<PinStatus> = {}): PinStatus => ({
  mode: 'desktop',
  hasPin: true,
  required: true,
  unlocked: false,
  expiresAt: null,
  autoLockMinutes: 15,
  failedAttempts: 0,
  retryAfterSeconds: 0,
  reloginRequired: false,
  maxFailures: null,
  ...over,
});

function setup(initial: PinStatus) {
  const current = signal<PinStatus | null>(initial);
  let forgotPending = false;
  const pin = {
    status: current,
    lockReason: signal<string | null>(null),
    unlock: vi.fn(),
    forgot: vi.fn(),
    forgotPending: () => forgotPending,
    rememberForgot: vi.fn(() => {
      forgotPending = true;
    }),
    clearForgotFlag: vi.fn(() => {
      forgotPending = false;
    }),
  };
  const auth = { signOut: vi.fn(async () => undefined) };
  const router = { navigate: vi.fn(async () => true) };
  TestBed.configureTestingModule({
    providers: [
      LockScreenService,
      { provide: PinLockService, useValue: pin },
      { provide: AuthService, useValue: auth },
      { provide: Router, useValue: router },
    ],
  });
  return {
    screen: TestBed.inject(LockScreenService),
    pin,
    auth,
    router,
    setForgotPending: (value: boolean) => {
      forgotPending = value;
    },
  };
}

describe('LockScreenService (F11.0p)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('takes digits from the pad and the field, at most 8; unlock only with 4–8 digits', () => {
    const { screen } = setup(status());
    for (const digit of ['1', '2', '3']) screen.press(digit);
    expect(screen.canSubmit()).toBe(false);
    screen.press('4');
    expect(screen.canSubmit()).toBe(true);
    screen.typed('12ab34567890');
    expect(screen.value()).toBe('12345678');
    screen.backspace();
    expect(screen.value()).toBe('1234567');
  });

  it('a wrong PIN shows the error and counts the wait down; no attempt meanwhile', async () => {
    const { screen, pin } = setup(status());
    pin.unlock.mockResolvedValue({
      code: 'wrongPin',
      retryAfterSeconds: 2,
      attemptsLeft: null,
    });
    screen.typed('0000');
    expect(await screen.submit()).toBe(false);
    expect(screen.problem()?.code).toBe('wrongPin');
    expect(screen.value()).toBe('');
    expect(screen.wait()).toBe(2);
    screen.typed('1234');
    expect(screen.canSubmit()).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(screen.wait()).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(screen.wait()).toBe(0);
    expect(screen.canSubmit()).toBe(true);
  });

  it('starts with the stored wait when the screen opens', async () => {
    const { screen } = setup(status({ retryAfterSeconds: 30 }));
    await screen.open();
    expect(screen.wait()).toBe(30);
  });

  it('desktop "PIN vergessen": only after the confirmation, then the wizard asks for a new PIN', async () => {
    const { screen, pin, router } = setup(status());
    pin.forgot.mockResolvedValue({
      status: status({ hasPin: false, unlocked: true }),
      erasedKeys: { ai: true, mail: false, coingecko: true, etherscan: false },
    });
    screen.openForgot();
    await screen.resetDesktop();
    expect(pin.forgot).not.toHaveBeenCalled();
    screen.understood.set(true);
    await screen.resetDesktop();
    expect(pin.forgot).toHaveBeenCalledWith(true);
    expect(router.navigate).toHaveBeenCalledWith(['/app/setup'], {
      queryParams: { step: 'pin' },
    });
  });

  it('web "PIN vergessen": without a fresh sign-in → remember it and sign out', async () => {
    const { screen, pin, auth, router } = setup(status({ mode: 'web' }));
    pin.forgot.mockResolvedValue({
      code: 'reloginRequired',
      retryAfterSeconds: 0,
      attemptsLeft: null,
    });
    await screen.resetWeb();
    expect(pin.rememberForgot).toHaveBeenCalled();
    expect(auth.signOut).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('web: after the new sign-in the pending reset runs on its own', async () => {
    const { screen, pin, router, setForgotPending } = setup(
      status({ mode: 'web' }),
    );
    setForgotPending(true);
    pin.forgot.mockResolvedValue({
      status: status({ mode: 'web', hasPin: false }),
      erasedKeys: null,
    });
    await screen.open();
    expect(pin.forgot).toHaveBeenCalledWith(false);
    expect(router.navigate).toHaveBeenCalledWith(['/app/setup'], {
      queryParams: { step: 'pin' },
    });
  });

  it('web: too many failures → only "sign in again"', () => {
    const { screen } = setup(status({ mode: 'web', reloginRequired: true }));
    screen.typed('1234');
    expect(screen.reloginRequired()).toBe(true);
    expect(screen.canSubmit()).toBe(false);
  });
});
