import {
  HttpClient,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { PinStatus } from '../api/setup.types';
import { DEV_AUTH_STORAGE_KEY } from '../auth/dev-auth.strategy';
import {
  PinLockService,
  UNLOCK_HEADER,
  UNLOCK_STORAGE_KEY,
} from './pin-lock.service';
import { unlockInterceptor } from './unlock.interceptor';

const settle = async () => {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve));
  }
};

const status = (over: Partial<PinStatus> = {}): PinStatus => ({
  mode: 'web',
  hasPin: true,
  required: false,
  unlocked: false,
  expiresAt: null,
  autoLockMinutes: 15,
  failedAttempts: 0,
  retryAfterSeconds: 0,
  reloginRequired: false,
  maxFailures: 10,
  ...over,
});

function setup() {
  // One tab only: no other tab to ask for its unlock (that would wait 250 ms).
  vi.stubGlobal('BroadcastChannel', undefined);
  localStorage.setItem(DEV_AUTH_STORAGE_KEY, 'anna@lazykoins.dev');
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(withInterceptors([unlockInterceptor])),
      provideHttpClientTesting(),
    ],
  });
  return {
    pin: TestBed.inject(PinLockService),
    http: TestBed.inject(HttpTestingController),
    client: TestBed.inject(HttpClient),
  };
}

describe('PinLockService + unlockInterceptor (F11.0p)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('no PIN: data requests go straight out', async () => {
    const { pin, http, client } = setup();
    const done = firstValueFrom(client.get('/api/projects'));
    await settle();
    http
      .expectOne('/api/pin/status')
      .flush(status({ hasPin: false, unlocked: true }));
    await settle();
    http.expectOne('/api/projects').flush([]);
    await done;
    expect(pin.locked()).toBe(false);
  });

  it('locked: holds data requests until the PIN is entered, then sends them with the token', async () => {
    const { pin, http, client } = setup();
    const done = firstValueFrom(client.get('/api/projects'));
    await settle();
    http.expectOne('/api/pin/status').flush(status());
    await settle();
    expect(pin.locked()).toBe(true);
    http.expectNone('/api/projects');

    const unlocked = pin.unlock('482913');
    await settle();
    const unlock = http.expectOne('/api/pin/unlock');
    expect(unlock.request.body).toEqual({ pin: '482913' });
    unlock.flush({
      status: status({ unlocked: true }),
      unlock: { token: 'tok-1', expiresAt: '2026-10-07T10:15:00Z' },
    });
    expect(await unlocked).toBeNull();
    await settle();
    const data = http.expectOne('/api/projects');
    expect(data.request.headers.get(UNLOCK_HEADER)).toBe('tok-1');
    data.flush([]);
    await done;
    expect(sessionStorage.getItem(UNLOCK_STORAGE_KEY)).toBe('tok-1');
  });

  it('a wrong PIN reports the wait and the attempts left', async () => {
    const { pin, http } = setup();
    void pin.ensure();
    await settle();
    http.expectOne('/api/pin/status').flush(status());
    const result = pin.unlock('0000');
    await settle();
    http
      .expectOne('/api/pin/unlock')
      .flush(
        { code: 'wrongPin', retryAfterSeconds: 2, attemptsLeft: 7 },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
    expect(await result).toEqual({
      code: 'wrongPin',
      retryAfterSeconds: 2,
      attemptsLeft: 7,
    });
    expect(pin.locked()).toBe(true);
  });

  it('a 423 from the API (expired session) shows the lock screen and retries after unlocking', async () => {
    sessionStorage.setItem(UNLOCK_STORAGE_KEY, 'old-token');
    const { pin, http, client } = setup();
    const done = firstValueFrom(client.get('/api/dashboard'));
    await settle();
    http.expectOne('/api/pin/status').flush(status({ unlocked: true }));
    await settle();
    http
      .expectOne('/api/dashboard')
      .flush({ code: 'pinLocked' }, { status: 423, statusText: 'Locked' });
    await settle();
    expect(pin.locked()).toBe(true);
    expect(sessionStorage.getItem(UNLOCK_STORAGE_KEY)).toBeNull();

    void pin.unlock('1234');
    await settle();
    http.expectOne('/api/pin/unlock').flush({
      status: status({ unlocked: true }),
      unlock: { token: 'new-token', expiresAt: '2026-10-07T10:15:00Z' },
    });
    await settle();
    const retried = http.expectOne('/api/dashboard');
    expect(retried.request.headers.get(UNLOCK_HEADER)).toBe('new-token');
    retried.flush({ ok: true });
    expect(await done).toEqual({ ok: true });
  });

  it('locks itself after the auto-lock time without input and ends the token', async () => {
    sessionStorage.setItem(UNLOCK_STORAGE_KEY, 'tok');
    const { pin, http } = setup();
    void pin.ensure();
    await settle();
    http
      .expectOne('/api/pin/status')
      .flush(status({ unlocked: true, autoLockMinutes: 5 }));
    await settle();
    expect(pin.state()).toBe('unlocked');
    pin.checkIdle(Date.now() + 4 * 60_000);
    expect(pin.locked()).toBe(false);
    pin.checkIdle(Date.now() + 5 * 60_000 + 1);
    expect(pin.locked()).toBe(true);
    expect(pin.lockReason()).toBe('idle');
    await settle();
    const lock = http.expectOne('/api/pin/lock');
    expect(lock.request.headers.get(UNLOCK_HEADER)).toBe('tok');
    lock.flush(null);
  });

  it('the lock endpoints and /me never wait for the PIN', async () => {
    const { http, client } = setup();
    const me = firstValueFrom(client.get('/api/me'));
    http.expectOne('/api/me').flush({});
    await me;
  });
});
