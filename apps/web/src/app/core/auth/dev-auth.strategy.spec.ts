import { DevAuthStrategy } from './dev-auth.strategy';

describe('DevAuthStrategy', () => {
  afterEach(() => localStorage.clear());

  it('produces the dev:<email> token the API accepts in AUTH_MODE=dev', async () => {
    const strategy = new DevAuthStrategy();
    expect(await strategy.restore()).toBe(false);
    expect(await strategy.token()).toBeNull();

    await strategy.signIn('  Anna@LazyKoins.dev ');

    expect(await new DevAuthStrategy().restore()).toBe(true);
    // With the sign-in time, like Firebase's auth_time (F11.0p "fresh sign-in").
    expect(await strategy.token()).toMatch(/^dev:anna@lazykoins\.dev#\d{13}$/);
    expect(strategy.email()).toBe('anna@lazykoins.dev');
  });

  it('a session from before the sign-in time existed sends the plain token', async () => {
    localStorage.setItem('lk-dev-auth-email', 'anna@lazykoins.dev');
    expect(await new DevAuthStrategy().token()).toBe('dev:anna@lazykoins.dev');
  });

  it('forgets the session on sign-out', async () => {
    const strategy = new DevAuthStrategy();
    await strategy.signIn('anna@lazykoins.dev');
    await strategy.signOut();
    expect(await strategy.token()).toBeNull();
  });
});
