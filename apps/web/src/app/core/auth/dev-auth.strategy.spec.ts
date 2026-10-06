import { DevAuthStrategy } from './dev-auth.strategy';

describe('DevAuthStrategy', () => {
  afterEach(() => localStorage.clear());

  it('produces the dev:<email> token the API accepts in AUTH_MODE=dev', async () => {
    const strategy = new DevAuthStrategy();
    expect(await strategy.restore()).toBe(false);
    expect(await strategy.token()).toBeNull();

    await strategy.signIn('  Anna@LazyKoins.dev ');

    expect(await new DevAuthStrategy().restore()).toBe(true);
    expect(await strategy.token()).toBe('dev:anna@lazykoins.dev');
    expect(strategy.email()).toBe('anna@lazykoins.dev');
  });

  it('forgets the session on sign-out', async () => {
    const strategy = new DevAuthStrategy();
    await strategy.signIn('anna@lazykoins.dev');
    await strategy.signOut();
    expect(await strategy.token()).toBeNull();
  });
});
